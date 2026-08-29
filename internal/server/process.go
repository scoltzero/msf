package server

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

type ServiceManager struct {
	app   *App
	mu    sync.Mutex
	procs map[string]*exec.Cmd
}

var processProcRoot = "/proc"

type ServiceStatus struct {
	Name        string  `json:"name"`
	DisplayName string  `json:"display_name"`
	Installed   bool    `json:"installed"`
	Running     bool    `json:"running"`
	PID         int     `json:"pid,omitempty"`
	Status      string  `json:"status"`
	Version     string  `json:"version,omitempty"`
	Uptime      int64   `json:"uptime,omitempty"`
	Memory      int64   `json:"memory,omitempty"`
	CPU         float64 `json:"cpu,omitempty"`
	BinaryPath  string  `json:"binary_path,omitempty"`
	ConfigPath  string  `json:"config_path,omitempty"`
	LogPath     string  `json:"log_path,omitempty"`
	Error       string  `json:"error,omitempty"`
}

func NewServiceManager(app *App) *ServiceManager {
	return &ServiceManager{app: app, procs: map[string]*exec.Cmd{}}
}

func (sm *ServiceManager) List() []ServiceStatus {
	return []ServiceStatus{sm.Status("mosdns"), sm.Status("mihomo")}
}

func (sm *ServiceManager) Status(name string) ServiceStatus {
	spec, err := sm.spec(name)
	if err != nil {
		return ServiceStatus{Name: name, Status: "unknown", Error: err.Error()}
	}
	status := ServiceStatus{Name: name, DisplayName: spec.DisplayName, BinaryPath: spec.Binary, ConfigPath: spec.Config, LogPath: spec.Stdout}
	if _, err := os.Stat(spec.Binary); err == nil {
		status.Installed = true
	}
	pid := readPID(spec.PIDFile)
	if pid > 0 && processAliveCross(pid) {
		status.Running = true
		status.PID = pid
		status.Status = "running"
		if metrics, ok := processResourceSnapshot(pid); ok {
			status.Uptime = metrics.Uptime
			status.Memory = metrics.Memory
			status.CPU = metrics.CPU
		} else if info, err := os.Stat(spec.PIDFile); err == nil {
			status.Uptime = int64(time.Since(info.ModTime()).Seconds())
		}
		return status
	}
	status.Status = "stopped"
	return status
}

func (sm *ServiceManager) Start(ctx context.Context, name string) (ServiceStatus, error) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	spec, err := sm.spec(name)
	if err != nil {
		return sm.Status(name), err
	}
	if st := sm.Status(name); st.Running {
		sm.setDesired(name, true)
		sm.app.afterServiceStart(name)
		return st, nil
	}
	if _, err := os.Stat(spec.Binary); err != nil {
		return sm.Status(name), fmt.Errorf("%s binary not installed at %s", name, spec.Binary)
	}
	if name == "mosdns" {
		dns53 := setupDNS53Preflight(ctx, collectSetupPortListeners(ctx, []int{53}), true)
		if dns53.Status == "blocked" {
			return sm.Status(name), fmt.Errorf("mosdns cannot bind 53: %s", dns53.Message)
		}
	}
	if err := os.MkdirAll(filepath.Dir(spec.Stdout), 0755); err != nil {
		return sm.Status(name), err
	}
	stdout, err := os.OpenFile(spec.Stdout, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return sm.Status(name), err
	}
	stderr, err := os.OpenFile(spec.Stderr, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		stdout.Close()
		return sm.Status(name), err
	}
	stdoutOffset := openedFileSize(stdout)
	stderrOffset := openedFileSize(stderr)
	// Managed services must outlive the HTTP request that triggered them.
	// Stop/Restart owns shutdown through PID files and process signals.
	cmd := exec.CommandContext(context.Background(), spec.Binary, spec.Args...)
	cmd.Dir = spec.Dir
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	if runtime.GOOS != "windows" {
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	}
	if err := cmd.Start(); err != nil {
		stdout.Close()
		stderr.Close()
		return sm.Status(name), err
	}
	sm.procs[name] = cmd
	_ = os.WriteFile(spec.PIDFile, []byte(strconv.Itoa(cmd.Process.Pid)), 0644)
	waitDone := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		stdout.Close()
		stderr.Close()
		close(waitDone)
		sm.mu.Lock()
		if sm.procs[name] == cmd {
			delete(sm.procs, name)
		}
		removePIDFileIfMatches(spec.PIDFile, cmd.Process.Pid)
		sm.mu.Unlock()
	}()
	timer := time.NewTimer(300 * time.Millisecond)
	exitedDuringStartup := false
	select {
	case <-waitDone:
		exitedDuringStartup = true
		if !timer.Stop() {
			<-timer.C
		}
	case <-timer.C:
		select {
		case <-waitDone:
			exitedDuringStartup = true
		default:
		}
	}
	st := sm.Status(name)
	if !exitedDuringStartup && st.Running {
		sm.setDesired(name, true)
		sm.app.afterServiceStart(name)
		return st, nil
	}
	lines := make([]string, 0, 8)
	for _, item := range []struct {
		path   string
		offset int64
	}{{spec.Stdout, stdoutOffset}, {spec.Stderr, stderrOffset}} {
		if part, err := tailFileSince(item.path, item.offset, 8); err == nil {
			lines = append(lines, part...)
		}
	}
	if len(lines) > 8 {
		lines = lines[len(lines)-8:]
	}
	if len(lines) > 0 {
		return st, fmt.Errorf("%s exited after start: %s", name, strings.Join(lines, "\n"))
	}
	return st, fmt.Errorf("%s exited after start", name)
}

func (sm *ServiceManager) Stop(ctx context.Context, name string) (ServiceStatus, error) {
	return sm.stop(ctx, name, true)
}

func (sm *ServiceManager) stop(ctx context.Context, name string, persistDesired bool) (ServiceStatus, error) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	spec, err := sm.spec(name)
	if err != nil {
		return sm.Status(name), err
	}
	pid := readPID(spec.PIDFile)
	if pid <= 0 {
		if persistDesired {
			sm.setDesired(name, false)
		}
		return sm.Status(name), nil
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		_ = os.Remove(spec.PIDFile)
		if persistDesired {
			sm.setDesired(name, false)
		}
		return sm.Status(name), nil
	}
	termErr := proc.Signal(syscall.SIGTERM)
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if !processAliveCross(pid) {
			_ = os.Remove(spec.PIDFile)
			if persistDesired {
				sm.setDesired(name, false)
			}
			return sm.Status(name), nil
		}
		select {
		case <-ctx.Done():
			return sm.Status(name), ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}
	killErr := proc.Signal(syscall.SIGKILL)
	killDeadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(killDeadline) {
		if !processAliveCross(pid) {
			_ = os.Remove(spec.PIDFile)
			if persistDesired {
				sm.setDesired(name, false)
			}
			return sm.Status(name), nil
		}
		select {
		case <-ctx.Done():
			return sm.Status(name), ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
	if killErr != nil {
		return sm.Status(name), fmt.Errorf("failed to stop %s process %d: SIGTERM=%v SIGKILL=%w", name, pid, termErr, killErr)
	}
	return sm.Status(name), fmt.Errorf("failed to stop %s process %d after SIGKILL", name, pid)
}

func (sm *ServiceManager) Restart(ctx context.Context, name string) (ServiceStatus, error) {
	_, _ = sm.stop(ctx, name, false)
	return sm.Start(ctx, name)
}

func (sm *ServiceManager) StopAll(ctx context.Context) error {
	var errs []string
	for _, name := range []string{"mosdns", "mihomo"} {
		if _, err := sm.stop(ctx, name, false); err != nil {
			errs = append(errs, err.Error())
		}
	}
	if len(errs) > 0 {
		return errors.New(strings.Join(errs, "; "))
	}
	return nil
}

func (sm *ServiceManager) StartEnabled(ctx context.Context) []string {
	var errs []string
	for _, name := range []string{"mosdns", "mihomo"} {
		if sm.app.setting(serviceDesiredKey(name), "") != "true" {
			continue
		}
		if _, err := sm.Start(ctx, name); err != nil {
			msg := fmt.Sprintf("failed to restore %s service: %v", name, err)
			log.Print(msg)
			errs = append(errs, msg)
		}
	}
	return errs
}

func (sm *ServiceManager) setDesired(name string, enabled bool) {
	value := "false"
	if enabled {
		value = "true"
	}
	sm.app.setSetting(serviceDesiredKey(name), value)
}

func serviceDesiredKey(name string) string {
	if name == "proxy" || name == "clash" {
		name = "mihomo"
	}
	return "service." + name + ".enabled"
}

type serviceSpec struct {
	DisplayName string
	Binary      string
	Args        []string
	Dir         string
	Config      string
	Stdout      string
	Stderr      string
	PIDFile     string
}

func (sm *ServiceManager) spec(name string) (serviceSpec, error) {
	root := sm.app.DataDir
	switch name {
	case "mihomo", "proxy":
		bin := sm.app.currentMihomoBinaryPath()
		cfg := filepath.Join(root, "configs/mihomo/config.yaml")
		return serviceSpec{
			DisplayName: "Mihomo",
			Binary:      bin,
			Args:        []string{"-d", filepath.Join(root, "configs/mihomo"), "-f", cfg},
			Dir:         filepath.Join(root, "configs/mihomo"),
			Config:      cfg,
			Stdout:      filepath.Join(root, "logs/mihomo.out.log"),
			Stderr:      filepath.Join(root, "logs/mihomo.err.log"),
			PIDFile:     filepath.Join(root, "data/mihomo.pid"),
		}, nil
	case "mosdns":
		bin := firstExisting(
			filepath.Join(root, "data/binaries/mosdns/mosdns"),
			filepath.Join(root, "data/binaries/mosdns/latest/mosdns"),
		)
		cfgDir := filepath.Join(root, "configs/mosdns")
		return serviceSpec{
			DisplayName: "MosDNS",
			Binary:      bin,
			Args:        []string{"start", "--dir", cfgDir},
			Dir:         cfgDir,
			Config:      filepath.Join(cfgDir, "config.yaml"),
			Stdout:      filepath.Join(root, "logs/mosdns.out.log"),
			Stderr:      filepath.Join(root, "logs/mosdns.err.log"),
			PIDFile:     filepath.Join(root, "data/mosdns.pid"),
		}, nil
	default:
		return serviceSpec{}, fmt.Errorf("unknown service %s", name)
	}
}

func (a *App) currentMihomoBinaryPath() string {
	root := filepath.Join(a.DataDir, "data", "binaries", "mihomo")
	return firstExisting(
		filepath.Join(root, "mihomo"),
		filepath.Join(root, "latest", "mihomo"),
		filepath.Join(root, "mihomo-linux-amd64"),
	)
}

func firstExisting(paths ...string) string {
	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return paths[0]
}

func readPID(path string) int {
	b, err := os.ReadFile(path)
	if err != nil {
		return 0
	}
	pid, _ := strconv.Atoi(strings.TrimSpace(string(b)))
	return pid
}

func removePIDFileIfMatches(path string, pid int) {
	if readPID(path) == pid {
		_ = os.Remove(path)
	}
}

func openedFileSize(file *os.File) int64 {
	if info, err := file.Stat(); err == nil {
		return info.Size()
	}
	return 0
}

func processAliveCross(pid int) bool {
	if pid <= 0 {
		return false
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	if runtime.GOOS == "windows" {
		return true
	}
	if proc.Signal(syscall.Signal(0)) != nil {
		return false
	}
	return runtime.GOOS != "linux" || !processZombieCross(pid)
}

func processZombieCross(pid int) bool {
	body, err := os.ReadFile(filepath.Join(processProcRoot, strconv.Itoa(pid), "stat"))
	if err != nil {
		return false
	}
	// /proc/<pid>/stat starts with "pid (comm) state" and comm may contain
	// spaces or parentheses, so locate the final closing parenthesis.
	text := string(body)
	end := strings.LastIndex(text, ") ")
	return end >= 0 && len(text) > end+2 && text[end+2] == 'Z'
}

func tailFile(path string, maxLines int) ([]string, error) {
	return tailFileSince(path, 0, maxLines)
}

func tailFileSince(path string, offset int64, maxLines int) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	if info, statErr := f.Stat(); statErr == nil && offset > info.Size() {
		offset = 0
	}
	if _, err := f.Seek(offset, io.SeekStart); err != nil {
		return nil, err
	}
	scanner := bufio.NewScanner(f)
	buf := make([]string, 0, maxLines)
	for scanner.Scan() {
		line := scanner.Text()
		if len(buf) == maxLines {
			copy(buf, buf[1:])
			buf[maxLines-1] = line
		} else {
			buf = append(buf, line)
		}
	}
	return buf, scanner.Err()
}
