package main

import (
	"archive/tar"
	"bufio"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/scoltzero/msf/internal/cloudflareredirect"
	"github.com/scoltzero/msf/internal/server"
)

var (
	version           = "0.1.0-dev"
	buildCommit       = "unknown"
	buildTag          = "unknown"
	buildTagCommit    = "unknown"
	buildSourceCommit = "unknown"
	buildDirty        = "unknown"
	buildTime         = ""
)

var (
	currentEUID                        = os.Geteuid
	systemdServiceDir                  = "/etc/systemd/system"
	uninstallStdin           io.Reader = os.Stdin
	uninstallStdout          io.Writer = os.Stdout
	uninstallInputIsTerminal           = defaultInputIsTerminal
	procRoot                           = "/proc"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		log.Fatal(err)
	}
}

func run(args []string) error {
	command := "serve"
	if len(args) > 0 && args[0] != "-h" && args[0] != "--help" && args[0] != "-v" && args[0] != "--version" {
		command = args[0]
		args = args[1:]
	}

	if command == "cloudflare-redirect" || command == "cf-redirect" {
		return runCloudflareRedirectCLI(args)
	}

	fs := flag.NewFlagSet(command, flag.ExitOnError)
	configDir := fs.String("c", defaultDataDir(), "data/config directory")
	fs.StringVar(configDir, "config", defaultDataDir(), "data/config directory")
	host := fs.String("host", "0.0.0.0", "listen host")
	port := fs.Int("p", 7777, "HTTP listen port")
	fs.IntVar(port, "port", 7777, "HTTP listen port")
	prefix := fs.String("prefix", "/usr/local", "install prefix for uninstall")
	serviceName := fs.String("service-name", "msf", "systemd service name")
	aliasName := fs.String("alias-name", "msm", "optional extra CLI alias to register under PATH/bin")
	purge := fs.Bool("purge", false, "remove data directory during uninstall")
	yes := fs.Bool("yes", false, "confirm destructive uninstall actions")
	keepData := fs.Bool("keep-data", false, "keep the data directory during uninstall without prompting")
	wait := fs.Bool("wait", true, "wait for stop to complete")
	force := fs.Bool("force", false, "force kill process if graceful stop times out")
	timeout := fs.Duration("timeout", 15*time.Second, "stop/uninstall timeout")
	lines := fs.Int("n", 100, "log lines")
	fs.IntVar(lines, "lines", 100, "log lines")
	repo := fs.String("repo", defaultGitHubRepo(), "GitHub repository for update")
	updateURL := fs.String("url", "", "release tarball URL for update")
	daemon := fs.Bool("d", false, "daemon mode placeholder")
	versionFlag := fs.Bool("v", false, "print version")
	fs.BoolVar(versionFlag, "version", false, "print version")
	versionJSON := fs.Bool("json", false, "print machine-readable JSON for the version command")
	helpAll := fs.Bool("help-all", false, "print full help")
	_ = fs.Parse(args)
	configExplicit := false
	hostExplicit := false
	portExplicit := false
	fs.Visit(func(f *flag.Flag) {
		if f.Name == "c" || f.Name == "config" {
			configExplicit = true
		}
		if f.Name == "host" {
			hostExplicit = true
		}
		if f.Name == "p" || f.Name == "port" {
			portExplicit = true
		}
	})

	if *versionFlag || command == "version" {
		info := map[string]string{
			"name":          "msf",
			"version":       version,
			"commit":        buildCommit,
			"tag":           buildTag,
			"tag_commit":    buildTagCommit,
			"source_commit": buildSourceCommit,
			"dirty":         buildDirty,
			"build_time":    buildTime,
		}
		if *versionJSON {
			return json.NewEncoder(os.Stdout).Encode(info)
		}
		fmt.Printf("msf %s commit=%s tag=%s source=%s dirty=%s\n", version, buildCommit, buildTag, buildSourceCommit, buildDirty)
		return nil
	}
	if command == "help" || *helpAll {
		printUsage()
		return nil
	}

	switch command {
	case "serve", "":
		if *daemon {
			log.Println("daemon mode is accepted for compatibility; running in foreground")
		}
		return serve(*configDir, *host, *port)
	case "init", "migrate":
		app, err := server.New(serverOptions(*configDir))
		if err != nil {
			return err
		}
		defer app.Close()
		return app.EnsureBaseLayout()
	case "reset-password":
		app, err := server.New(serverOptions(*configDir))
		if err != nil {
			return err
		}
		defer app.Close()
		password := "admin123456"
		if fs.NArg() > 0 {
			password = fs.Arg(0)
		}
		if err := app.ResetAdminPassword(password); err != nil {
			return err
		}
		fmt.Printf("admin password reset to: %s\n", password)
		return nil
	case "status":
		return printStatus(*configDir, *serviceName)
	case "stop":
		return stopRuntime(*configDir, *wait, *timeout, *force)
	case "restart":
		return restartRuntime(*configDir, *host, *port, *serviceName, *timeout, *force)
	case "logs":
		service := "msf"
		if fs.NArg() > 0 {
			service = fs.Arg(0)
		}
		return printLogs(*configDir, *serviceName, service, *lines)
	case "doctor":
		return runDoctor(*configDir, *serviceName)
	case "update":
		return updateRuntime(updateOptions{Repo: *repo, URL: *updateURL, Prefix: *prefix, DataDir: *configDir, DataDirExplicit: configExplicit, Host: *host, HostExplicit: hostExplicit, Port: *port, PortExplicit: portExplicit, ServiceName: *serviceName})
	case "service":
		action := ""
		if fs.NArg() > 0 {
			action = fs.Arg(0)
		}
		return serviceCommand(action, serviceOptions{Prefix: *prefix, DataDir: *configDir, Host: *host, Port: *port, ServiceName: *serviceName})
	case "license":
		action := "status"
		if fs.NArg() > 0 {
			action = fs.Arg(0)
		}
		return licenseCommand(action)
	case "uninstall":
		return uninstallRuntime(uninstallOptions{
			Prefix:          *prefix,
			DataDir:         *configDir,
			ServiceName:     *serviceName,
			AliasName:       *aliasName,
			Purge:           *purge,
			Yes:             *yes,
			KeepData:        *keepData,
			Timeout:         *timeout,
			DataDirExplicit: configExplicit,
		})
	default:
		return fmt.Errorf("unknown command %q", command)
	}
}

func printUsage() {
	fmt.Print(`Usage:
  msf serve [--config /opt/msf] [--host 0.0.0.0] [--port 7777]
  msf init [--config /opt/msf]
  msf status [--config /opt/msf]
  msf restart [--config /opt/msf]
  msf stop [--config /opt/msf] [--timeout 15s] [--force]
  msf logs [--lines 100] [msf|mosdns|mihomo]
  msf doctor [--config /opt/msf]
  msf cloudflare-redirect start|stop|scan|apply|status [--config PATH]
  msf update [--repo scoltzero/msf] [--url https://.../msf-linux-amd64.tar.gz]
  msf uninstall [--config /opt/msf] [--prefix /usr/local] [--service-name msf] [--purge --yes|--keep-data]
  msf migrate [--config /opt/msf]
  msf reset-password [--config /opt/msf] [password]
  msf service install|uninstall [--config /opt/msf]
  msf license status|fingerprint
  msf version

Notes:
  stop sends SIGTERM to the running msf process and waits for MosDNS/Mihomo child services to exit.
  update is for Linux tarball/systemd installs. Docker, Unraid, and fnOS FPK installs must be updated from their platform manager.
  update reuses the data directory from --config or the installed systemd service to avoid resetting setup state.
  uninstall is for Linux tarball/systemd installs. Docker, Unraid, and fnOS FPK installs must be removed from their platform manager.
  uninstall asks whether to remove the data directory on interactive terminals. In automation, pass --purge --yes to remove it or --keep-data to retain it.
`)
}

func serve(dataDir, host string, port int) error {
	app, err := server.New(serverOptions(dataDir))
	if err != nil {
		return err
	}
	defer app.Close()
	app.LogInfo("app/app.go:114", "MSF 后端服务启动中...", nil)
	app.LogInfo("app/app.go:115", "使用配置目录", map[string]any{"path": dataDir})

	if err := app.EnsureBaseLayout(); err != nil {
		return err
	}
	app.LogInfo("app/app.go:158", "已生成配置文件并落地当前有效 JWT 密钥", map[string]any{"file": filepath.Join(dataDir, "configs/app.yaml")})
	app.LogInfo("app/app.go:173", "JWT配置初始化成功", nil)
	app.LogInfo("app/app.go:182", "数据库初始化成功", nil)
	app.LogInfo("supervisor/manager.go:160", "Supervisord配置生成成功", map[string]any{"config": filepath.Join(dataDir, "configs/supervisor/supervisord.conf")})
	app.LogInfo("supervisor/manager.go:219", "Supervisord Manager 初始化成功", nil)
	app.LogInfo("app/app.go:209", "Supervisor 初始化成功", nil)
	app.LogInfo("app/app.go:217", "服务管理器初始化成功", nil)
	app.LogInfo("app/app.go:221", "系统监控器初始化成功", nil)
	app.LogInfo("app/app.go:235", "许可证未启用", map[string]any{"reason": "msf unlocked"})
	app.LogInfo("app/app.go:241", "Setup 服务初始化成功", nil)
	app.LogInfo("app/app.go:246", "更新服务初始化成功", nil)
	if err := os.WriteFile(filepath.Join(dataDir, "msf.pid"), []byte(fmt.Sprint(os.Getpid())), 0644); err != nil {
		return err
	}
	defer os.Remove(filepath.Join(dataDir, "msf.pid"))

	go func() {
		restoreCtx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		report := app.RestoreConfiguredRuntime(restoreCtx)
		if len(report.Errors) > 0 {
			app.LogError("app/app.go:298", "启动恢复完成但存在错误", map[string]any{"errors": report.Errors})
			log.Printf("runtime restore completed with errors: %v", report.Errors)
		}
	}()

	srv := &http.Server{
		Addr:              fmt.Sprintf("%s:%d", host, port),
		Handler:           app.Router(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = app.ShutdownRuntime(shutdownCtx)
		_ = srv.Shutdown(shutdownCtx)
	}()

	app.LogInfo("update/scheduler.go:51", "更新调度器已启动", map[string]any{"interval": 86400, "auto_download": false})
	app.LogInfo("componentupdate/scheduler.go:54", "组件更新调度器已启动", nil)
	app.LogInfo("app/app.go:372", "HTTP 服务器启动", map[string]any{"addr": fmt.Sprintf("%s:%d", host, port)})
	log.Printf("msf %s listening on http://%s:%d data=%s", version, host, port, dataDir)
	err = srv.ListenAndServe()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func serverOptions(dataDir string) server.Options {
	return server.Options{
		DataDir: dataDir,
		Version: version,
		Build: server.BuildInfo{
			Commit:       buildCommit,
			Tag:          buildTag,
			TagCommit:    buildTagCommit,
			SourceCommit: buildSourceCommit,
			Dirty:        buildDirty,
			BuildTime:    buildTime,
		},
	}
}

func defaultDataDir() string {
	if v := os.Getenv("MSF_DATA_DIR"); v != "" {
		return v
	}
	if v := os.Getenv("MSM_FREE_DATA_DIR"); v != "" {
		return v
	}
	if os.Geteuid() == 0 {
		return "/opt/msf"
	}
	return "./data"
}

func runCloudflareRedirectCLI(args []string) error {
	dataDir := defaultCloudflareRedirectDataDir()
	action := "status"
	actionSet := false
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "-h" || arg == "--help":
			printCloudflareRedirectUsage()
			return nil
		case arg == "-c" || arg == "--config":
			if i+1 >= len(args) {
				return fmt.Errorf("%s requires a value", arg)
			}
			dataDir = args[i+1]
			i++
		case strings.HasPrefix(arg, "--config="):
			dataDir = strings.TrimPrefix(arg, "--config=")
		case strings.HasPrefix(arg, "-c="):
			dataDir = strings.TrimPrefix(arg, "-c=")
		case strings.HasPrefix(arg, "-"):
			return fmt.Errorf("unknown cloudflare-redirect option %q", arg)
		default:
			if actionSet {
				return fmt.Errorf("unexpected cloudflare-redirect argument %q", arg)
			}
			action = arg
			actionSet = true
		}
	}
	return cloudflareredirect.Command(context.Background(), dataDir, action, nil)
}

func printCloudflareRedirectUsage() {
	fmt.Print(`Usage:
  msf cloudflare-redirect start
  msf cloudflare-redirect stop
  msf cloudflare-redirect scan
  msf cloudflare-redirect apply
  msf cloudflare-redirect status

Options:
  -c, --config PATH   Override the MSF data directory when auto-discovery is not enough.

Notes:
  The command auto-discovers the MSF data directory from MSF_DATA_DIR, Unraid config,
  systemd service config, and common install paths.
`)
}

func defaultCloudflareRedirectDataDir() string {
	if v := os.Getenv("MSF_DATA_DIR"); strings.TrimSpace(v) != "" {
		return v
	}
	if v := os.Getenv("MSM_FREE_DATA_DIR"); strings.TrimSpace(v) != "" {
		return v
	}
	candidates := []string{
		dataDirFromUnraidConfig(),
		dataDirFromSystemdService("msf"),
		dataDirFromSystemdService("msm-free"),
		"/mnt/user/appdata/msf",
		"/opt/msf",
		"/opt/msm-free",
		"/.msf",
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		candidates = append(candidates, filepath.Join(home, ".msf"))
	}
	if cwd, err := os.Getwd(); err == nil && cwd != "" {
		candidates = append(candidates,
			filepath.Join(cwd, ".msf"),
			filepath.Join(cwd, "msf-data"),
			filepath.Join(cwd, "data"),
		)
	}
	candidates = append(candidates, defaultDataDir())
	seen := map[string]bool{}
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		clean := filepath.Clean(candidate)
		if seen[clean] {
			continue
		}
		seen[clean] = true
		if looksLikeMSFDataDir(clean) {
			return clean
		}
	}
	return defaultDataDir()
}

func looksLikeMSFDataDir(path string) bool {
	for _, rel := range []string{
		"configs/cloudflare-redirect/cfyouxuan.yaml",
		"configs/mosdns/config.yaml",
		"configs/app.yaml",
		"database/msf.db",
		"msf.pid",
	} {
		if fileExists(filepath.Join(path, rel)) {
			return true
		}
	}
	return false
}

func dataDirFromUnraidConfig() string {
	b, err := os.ReadFile("/boot/config/plugins/msf/msf.cfg")
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(b), "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), "=")
		if !ok || key != "DATA_DIR" {
			continue
		}
		return strings.Trim(strings.TrimSpace(value), `"'`)
	}
	return ""
}

func dataDirFromSystemdService(service string) string {
	path := filepath.Join(systemdServiceDir, service+".service")
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "Environment=MSF_DATA_DIR=") {
			return strings.Trim(strings.TrimPrefix(line, "Environment=MSF_DATA_DIR="), `"'`)
		}
		if strings.HasPrefix(line, "ExecStart=") {
			if dataDir := dataDirFromExecStart(line); dataDir != "" {
				return dataDir
			}
		}
	}
	return ""
}

func dataDirFromExecStart(line string) string {
	return argFromExecStart(line, "--config", "-c")
}

func hostFromSystemdService(service string) string {
	for _, line := range systemdServiceLines(service) {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "ExecStart=") {
			return argFromExecStart(line, "--host")
		}
	}
	return ""
}

func portFromSystemdService(service string) int {
	for _, line := range systemdServiceLines(service) {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "ExecStart=") {
			continue
		}
		portText := argFromExecStart(line, "--port", "-p")
		if portText == "" {
			return 0
		}
		port, _ := strconv.Atoi(portText)
		return port
	}
	return 0
}

func systemdServiceLines(service string) []string {
	path := filepath.Join(systemdServiceDir, service+".service")
	b, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	return strings.Split(string(b), "\n")
}

func argFromExecStart(line string, names ...string) string {
	fields := strings.Fields(strings.TrimPrefix(line, "ExecStart="))
	for i, field := range fields {
		for _, name := range names {
			if field == name {
				if i+1 < len(fields) {
					return strings.Trim(fields[i+1], `"'`)
				}
				return ""
			}
			if strings.HasPrefix(field, name+"=") {
				return strings.Trim(strings.TrimPrefix(field, name+"="), `"'`)
			}
		}
	}
	return ""
}

func runtimePIDFile(dataDir string) string {
	return filepath.Join(dataDir, "msf.pid")
}

func stopRuntime(dataDir string, wait bool, timeout time.Duration, force bool) error {
	pidFile := runtimePIDFile(dataDir)
	b, err := os.ReadFile(pidFile)
	if err != nil {
		return errors.New("msf is not running")
	}
	pid, _ := strconv.Atoi(stringTrim(string(b)))
	if pid <= 0 {
		return errors.New("invalid pid file")
	}
	if !processAlive(pid) {
		removeRuntimePIDFiles(dataDir)
		return errors.New("stale pid file found")
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	if err := proc.Signal(syscall.SIGTERM); err != nil {
		return err
	}
	if !wait {
		fmt.Printf("sent stop signal to msf pid=%d\n", pid)
		return nil
	}
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	deadline := time.Now().Add(timeout)
	for processAlive(pid) {
		if time.Now().After(deadline) {
			if force {
				_ = proc.Signal(syscall.SIGKILL)
				break
			}
			return fmt.Errorf("timed out waiting for msf pid=%d to stop", pid)
		}
		time.Sleep(200 * time.Millisecond)
	}
	removeRuntimePIDFiles(dataDir)
	fmt.Printf("msf stopped pid=%d\n", pid)
	return nil
}

func printStatus(dataDir, serviceName string) error {
	fmt.Printf("msf %s\n", version)
	fmt.Printf("data: %s\n", dataDir)
	pid := runtimePID(dataDir)
	running := pid > 0 && processAlive(pid)
	if running {
		fmt.Printf("app: running pid=%d\n", pid)
	} else {
		fmt.Println("app: stopped")
	}
	if systemdUnitExists(serviceName) {
		fmt.Printf("systemd: %s\n", strings.TrimSpace(commandOutput("systemctl", "is-active", serviceName)))
	}
	app, err := server.New(serverOptions(dataDir))
	if err == nil {
		defer app.Close()
		for _, st := range app.Services.List() {
			state := "stopped"
			if st.Running {
				state = fmt.Sprintf("running pid=%d", st.PID)
			} else if !st.Installed {
				state = "not-installed"
			}
			fmt.Printf("%s: %s\n", st.Name, state)
		}
	}
	if !running && !strings.Contains(commandOutput("systemctl", "is-active", serviceName), "active") {
		return errors.New("msf is not running")
	}
	return nil
}

func restartRuntime(dataDir, host string, port int, serviceName string, timeout time.Duration, force bool) error {
	if systemdUnitExists(serviceName) {
		cmd := exec.Command("systemctl", "restart", serviceName)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			return err
		}
		fmt.Printf("restarted %s via systemd\n", serviceName)
		return nil
	}
	_ = stopRuntime(dataDir, true, timeout, force)
	return startDetached(dataDir, host, port)
}

func startDetached(dataDir, host string, port int) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(dataDir, "logs"), 0755); err != nil {
		return err
	}
	logPath := filepath.Join(dataDir, "logs", "msf.cli.log")
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	cmd := exec.Command(exe, "serve", "--config", dataDir, "--host", host, "--port", strconv.Itoa(port))
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	if err := cmd.Start(); err != nil {
		_ = logFile.Close()
		return err
	}
	if err := cmd.Process.Release(); err != nil {
		_ = logFile.Close()
		return err
	}
	fmt.Printf("started msf in background, log=%s\n", logPath)
	return nil
}

func printLogs(dataDir, serviceName, service string, lines int) error {
	if lines <= 0 {
		lines = 100
	}
	service = normalizeCLIService(service)
	if service == "msf" && commandExists("journalctl") && systemdUnitExists(serviceName) {
		cmd := exec.Command("journalctl", "-u", serviceName, "-n", strconv.Itoa(lines), "--no-pager")
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		return cmd.Run()
	}
	paths := cliLogPaths(dataDir, service)
	found := false
	for _, path := range paths {
		if !fileExists(path) {
			continue
		}
		found = true
		fmt.Printf("==> %s <==\n", path)
		for _, line := range tailFile(path, lines) {
			fmt.Println(line)
		}
	}
	if !found {
		return fmt.Errorf("no log files found for %s", service)
	}
	return nil
}

func runDoctor(dataDir, serviceName string) error {
	fmt.Printf("msf doctor\n")
	fmt.Printf("version: %s\n", version)
	fmt.Printf("data: %s\n", dataDir)
	fmt.Printf("root: %t\n", os.Geteuid() == 0)
	if systemdUnitExists(serviceName) {
		fmt.Printf("systemd %s: %s\n", serviceName, strings.TrimSpace(commandOutput("systemctl", "is-active", serviceName)))
	} else {
		fmt.Printf("systemd %s: not-installed\n", serviceName)
	}
	app, err := server.New(serverOptions(dataDir))
	if err != nil {
		return err
	}
	defer app.Close()
	for _, dir := range []string{"configs/mosdns", "configs/mihomo", "configs/network", "logs", "database", "data/binaries"} {
		path := filepath.Join(dataDir, dir)
		status := "ok"
		if _, err := os.Stat(path); err != nil {
			status = err.Error()
		}
		fmt.Printf("dir %-24s %s\n", dir, status)
	}
	for _, st := range app.Services.List() {
		status := st.Status
		if !st.Installed {
			status = "not-installed"
		}
		fmt.Printf("service %-8s %-13s pid=%d binary=%s\n", st.Name, status, st.PID, st.BinaryPath)
	}
	for _, item := range []struct {
		Name string
		Port string
	}{
		{"web", "7777"}, {"mihomo-controller", "9090"}, {"mosdns-api", "9099"}, {"dns", "53"},
		{"http", "7890"}, {"socks", "7891"}, {"mixed", "7892"}, {"tproxy", "7896"}, {"redirect", "7877"},
	} {
		fmt.Printf("port %-18s :%-5s %s\n", item.Name, item.Port, portStatus(item.Port))
	}
	for _, name := range []string{"nft", "ip", "ss"} {
		if commandExists(name) {
			fmt.Printf("command %-8s ok\n", name)
		} else {
			fmt.Printf("command %-8s missing\n", name)
		}
	}
	return nil
}

type uninstallOptions struct {
	Prefix          string
	DataDir         string
	DataDirExplicit bool
	ServiceName     string
	AliasName       string
	Purge           bool
	Yes             bool
	KeepData        bool
	Timeout         time.Duration
}

func uninstallRuntime(opts uninstallOptions) error {
	if server.IsDockerRuntime() {
		return errors.New("Docker / Compose installs must be removed from Docker, Compose, or your container manager; remove the container and its volume there")
	}
	if isUnraidRuntime() {
		return errors.New("on Unraid, remove msf from the WebGUI plugin page; application data is kept under /mnt/user/appdata/msf")
	}
	if isFnOSFPKRuntime() {
		return errors.New("fnOS FPK installs must be removed from fnOS / 飞牛应用中心 or the FPK package manager")
	}
	if currentEUID() != 0 {
		return errors.New("uninstall must be run as root")
	}
	if opts.Prefix == "" {
		opts.Prefix = "/usr/local"
	}
	if opts.ServiceName == "" {
		opts.ServiceName = "msf"
	}
	opts.DataDir = resolveUninstallDataDir(opts)
	if opts.Timeout <= 0 {
		opts.Timeout = 15 * time.Second
	}
	purge, err := resolveUninstallPurge(opts)
	if err != nil {
		return err
	}

	_ = stopOwnedRuntimeProcesses(opts.DataDir, opts.Timeout)
	_ = stopRuntime(opts.DataDir, true, opts.Timeout, true)
	servicePath := filepath.Join(systemdServiceDir, opts.ServiceName+".service")
	if commandExists("systemctl") && fileExists(servicePath) {
		_ = runQuiet("systemctl", "stop", opts.ServiceName)
		_ = runQuiet("systemctl", "disable", opts.ServiceName)
		if err := os.Remove(servicePath); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		_ = runQuiet("systemctl", "daemon-reload")
		_ = runQuiet("systemctl", "reset-failed", opts.ServiceName)
	} else {
		_ = stopRuntime(opts.DataDir, true, opts.Timeout, true)
	}
	_ = stopOwnedRuntimeProcesses(opts.DataDir, opts.Timeout)

	binDest := filepath.Join(opts.Prefix, "bin", "msf")
	if err := os.Remove(binDest); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if opts.AliasName != "" && opts.AliasName != "msf" {
		removeAliasIfOwned(filepath.Join(opts.Prefix, "bin", opts.AliasName), binDest)
	}

	if purge {
		if err := safeRemoveAll(opts.DataDir); err != nil {
			return err
		}
		fmt.Printf("removed msf binary, service, and data directory: %s\n", opts.DataDir)
		return nil
	}
	fmt.Printf("removed msf binary and service\n")
	fmt.Printf("kept data directory: %s\n", opts.DataDir)
	return nil
}

func resolveUninstallDataDir(opts uninstallOptions) string {
	if opts.DataDirExplicit && strings.TrimSpace(opts.DataDir) != "" {
		return opts.DataDir
	}
	if opts.ServiceName == "" {
		opts.ServiceName = "msf"
	}
	if dataDir := dataDirFromSystemdService(opts.ServiceName); strings.TrimSpace(dataDir) != "" {
		return dataDir
	}
	if strings.TrimSpace(opts.DataDir) != "" {
		return opts.DataDir
	}
	return defaultDataDir()
}

func resolveUninstallPurge(opts uninstallOptions) (bool, error) {
	if opts.Purge && opts.KeepData {
		return false, errors.New("--purge and --keep-data cannot be used together")
	}
	if opts.KeepData {
		return false, nil
	}
	if opts.Purge {
		if opts.Yes {
			return true, nil
		}
		if !uninstallInputIsTerminal() {
			return false, errors.New("refusing to purge data directory in non-interactive mode without --yes")
		}
		return confirmRemoveDataDir(opts.DataDir)
	}
	if !uninstallInputIsTerminal() {
		fmt.Fprintf(uninstallStdout, "non-interactive uninstall: keeping data directory %s; pass --purge --yes to remove it\n", opts.DataDir)
		return false, nil
	}
	return confirmRemoveDataDir(opts.DataDir)
}

func confirmRemoveDataDir(dataDir string) (bool, error) {
	fmt.Fprintf(uninstallStdout, "Remove MSF data directory %s? This deletes configs, database, logs, components, and zashboard. [y/N]: ", dataDir)
	line, err := bufio.NewReader(uninstallStdin).ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return false, err
	}
	switch strings.ToLower(strings.TrimSpace(line)) {
	case "y", "yes":
		return true, nil
	default:
		return false, nil
	}
}

func defaultInputIsTerminal() bool {
	info, err := os.Stdin.Stat()
	return err == nil && (info.Mode()&os.ModeCharDevice) != 0
}

func stopOwnedRuntimeProcesses(dataDir string, timeout time.Duration) error {
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	var errs []string
	for _, spec := range ownedRuntimeSpecs(dataDir) {
		if err := stopPIDFileProcess(spec.Name, spec.PIDFile, timeout); err != nil {
			errs = append(errs, err.Error())
		}
	}
	for _, proc := range ownedComponentProcesses(dataDir) {
		if err := terminateProcess(proc.PID, timeout); err != nil {
			errs = append(errs, fmt.Sprintf("%s pid=%d: %v", proc.Name, proc.PID, err))
		}
	}
	if len(errs) > 0 {
		return errors.New(strings.Join(errs, "; "))
	}
	return nil
}

type ownedRuntimeSpec struct {
	Name    string
	PIDFile string
}

func ownedRuntimeSpecs(dataDir string) []ownedRuntimeSpec {
	return []ownedRuntimeSpec{
		{Name: "mihomo", PIDFile: filepath.Join(dataDir, "data", "mihomo.pid")},
		{Name: "mosdns", PIDFile: filepath.Join(dataDir, "data", "mosdns.pid")},
	}
}

func stopPIDFileProcess(name, pidFile string, timeout time.Duration) error {
	pid := readIntFile(pidFile)
	if pid <= 0 {
		_ = os.Remove(pidFile)
		return nil
	}
	if !processAlive(pid) {
		_ = os.Remove(pidFile)
		return nil
	}
	if err := terminateProcess(pid, timeout); err != nil {
		return fmt.Errorf("%s pid=%d: %w", name, pid, err)
	}
	_ = os.Remove(pidFile)
	return nil
}

type ownedProcess struct {
	Name string
	PID  int
	Exe  string
}

func ownedComponentProcesses(dataDir string) []ownedProcess {
	if runtime.GOOS != "linux" {
		return nil
	}
	entries, err := os.ReadDir(procRoot)
	if err != nil {
		return nil
	}
	roots := []struct {
		Name string
		Dir  string
	}{
		{Name: "mihomo", Dir: filepath.Join(dataDir, "data", "binaries", "mihomo")},
		{Name: "mosdns", Dir: filepath.Join(dataDir, "data", "binaries", "mosdns")},
	}
	var out []ownedProcess
	currentPID := os.Getpid()
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		pid, err := strconv.Atoi(entry.Name())
		if err != nil || pid <= 0 || pid == currentPID {
			continue
		}
		exe, err := os.Readlink(filepath.Join(procRoot, entry.Name(), "exe"))
		if err != nil {
			continue
		}
		exe = strings.TrimSuffix(exe, " (deleted)")
		for _, root := range roots {
			if pathWithin(exe, root.Dir) {
				out = append(out, ownedProcess{Name: root.Name, PID: pid, Exe: exe})
				break
			}
		}
	}
	return out
}

func terminateProcess(pid int, timeout time.Duration) error {
	if pid <= 0 || !processAlive(pid) {
		return nil
	}
	_ = syscall.Kill(-pid, syscall.SIGTERM)
	_ = syscall.Kill(pid, syscall.SIGTERM)
	deadline := time.Now().Add(timeout)
	for processAlive(pid) {
		if time.Now().After(deadline) {
			_ = syscall.Kill(-pid, syscall.SIGKILL)
			_ = syscall.Kill(pid, syscall.SIGKILL)
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if processAlive(pid) {
		return fmt.Errorf("process did not exit")
	}
	return nil
}

func readIntFile(path string) int {
	b, err := os.ReadFile(path)
	if err != nil {
		return 0
	}
	n, _ := strconv.Atoi(stringTrim(string(b)))
	return n
}

func pathWithin(path, root string) bool {
	if strings.TrimSpace(path) == "" || strings.TrimSpace(root) == "" {
		return false
	}
	pathAbs, err := filepath.Abs(path)
	if err != nil {
		return false
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	pathClean := filepath.Clean(pathAbs)
	rootClean := filepath.Clean(rootAbs)
	return pathClean == rootClean || strings.HasPrefix(pathClean, rootClean+string(filepath.Separator))
}

type updateOptions struct {
	Repo            string
	URL             string
	Prefix          string
	DataDir         string
	DataDirExplicit bool
	Host            string
	HostExplicit    bool
	Port            int
	PortExplicit    bool
	ServiceName     string
}

func updateRuntime(opts updateOptions) error {
	if server.IsDockerRuntime() {
		return errors.New(server.DockerUpdateDisabledReason())
	}
	if isUnraidRuntime() {
		return errors.New("on Unraid, update msf from the WebGUI plugin page instead of the Linux tarball updater")
	}
	if isFnOSFPKRuntime() {
		return errors.New("fnOS FPK installs must be updated from fnOS / 飞牛应用中心 or the FPK package manager; the Linux tarball updater would create a separate /opt/msf install")
	}
	if currentEUID() != 0 {
		return errors.New("update must be run as root")
	}
	opts.DataDir = resolveUpdateDataDir(opts)
	opts.Host = resolveUpdateHost(opts)
	opts.Port = resolveUpdatePort(opts)
	if opts.Repo == "" {
		opts.Repo = defaultGitHubRepo()
	}
	archiveName := selfUpdateArchiveName(runtime.GOOS, runtime.GOARCH)
	if opts.URL == "" {
		opts.URL = "https://github.com/" + opts.Repo + "/releases/latest/download/" + archiveName
	}
	parsedURL, err := url.ParseRequestURI(opts.URL)
	if err != nil {
		return fmt.Errorf("invalid update URL: %w", err)
	}
	if base := filepath.Base(parsedURL.Path); base != "." && base != "/" && base != "" {
		archiveName = base
	}
	tmp, err := os.MkdirTemp("", "msf-update-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)
	archivePath := filepath.Join(tmp, archiveName)
	downloadApp, appErr := server.New(serverOptions(opts.DataDir))
	if appErr == nil {
		defer downloadApp.Close()
		effectiveURL := downloadApp.EffectiveDownloadURL(opts.URL)
		if effectiveURL != opts.URL {
			fmt.Printf("downloading %s\n", effectiveURL)
			fmt.Printf("source URL: %s\n", opts.URL)
		} else {
			fmt.Printf("downloading %s\n", opts.URL)
		}
		if err := downloadApp.DownloadFile(opts.URL, archivePath, nil); err != nil {
			return err
		}
	} else {
		fmt.Printf("downloading %s\n", opts.URL)
		fmt.Printf("warning: failed to load msf download settings, using direct download: %v\n", appErr)
		if err := downloadFile(opts.URL, archivePath); err != nil {
			return err
		}
	}
	if err := extractTarGZ(archivePath, tmp); err != nil {
		return err
	}
	installScript, err := findFile(tmp, "install.sh")
	if err != nil {
		return err
	}
	args := []string{installScript, "--prefix", opts.Prefix, "--data-dir", opts.DataDir, "--service-name", opts.ServiceName}
	if strings.TrimSpace(opts.Host) != "" {
		args = append(args, "--host", opts.Host)
	}
	if opts.Port > 0 {
		args = append(args, "--port", strconv.Itoa(opts.Port))
	}
	cmd := exec.Command("sh", args...)
	cmd.Dir = filepath.Dir(installScript)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	fmt.Printf("running installer from %s\n", filepath.Dir(installScript))
	return cmd.Run()
}

func resolveUpdateDataDir(opts updateOptions) string {
	if opts.DataDirExplicit && strings.TrimSpace(opts.DataDir) != "" {
		return opts.DataDir
	}
	if opts.ServiceName == "" {
		opts.ServiceName = "msf"
	}
	if dataDir := dataDirFromSystemdService(opts.ServiceName); strings.TrimSpace(dataDir) != "" {
		return dataDir
	}
	if strings.TrimSpace(opts.DataDir) != "" {
		return opts.DataDir
	}
	return defaultDataDir()
}

func resolveUpdateHost(opts updateOptions) string {
	if opts.HostExplicit && strings.TrimSpace(opts.Host) != "" {
		return opts.Host
	}
	if opts.ServiceName == "" {
		opts.ServiceName = "msf"
	}
	if host := hostFromSystemdService(opts.ServiceName); strings.TrimSpace(host) != "" {
		return host
	}
	if strings.TrimSpace(opts.Host) != "" {
		return opts.Host
	}
	return "0.0.0.0"
}

func resolveUpdatePort(opts updateOptions) int {
	if opts.PortExplicit && opts.Port > 0 {
		return opts.Port
	}
	if opts.ServiceName == "" {
		opts.ServiceName = "msf"
	}
	if port := portFromSystemdService(opts.ServiceName); port > 0 {
		return port
	}
	if opts.Port > 0 {
		return opts.Port
	}
	return 7777
}

type serviceOptions struct {
	Prefix      string
	DataDir     string
	Host        string
	Port        int
	ServiceName string
}

func serviceCommand(action string, opts serviceOptions) error {
	if server.IsDockerRuntime() && (action == "install" || action == "uninstall" || action == "remove") {
		return errors.New("Docker containers do not use systemd service install/uninstall; update or remove the container instead")
	}
	if isFnOSFPKRuntime() && (action == "install" || action == "uninstall" || action == "remove") {
		return errors.New("fnOS FPK installs must be managed from fnOS / 飞牛应用中心 or the FPK package manager")
	}
	switch action {
	case "install":
		return installSystemdService(opts)
	case "uninstall", "remove":
		return removeSystemdService(opts.ServiceName)
	case "status":
		if !systemdUnitExists(opts.ServiceName) {
			return fmt.Errorf("systemd service %s is not installed", opts.ServiceName)
		}
		cmd := exec.Command("systemctl", "status", opts.ServiceName, "--no-pager")
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		return cmd.Run()
	default:
		return errors.New("usage: msf service install|uninstall|status")
	}
}

func installSystemdService(opts serviceOptions) error {
	if currentEUID() != 0 {
		return errors.New("service install must be run as root")
	}
	if isUnraidRuntime() {
		return errors.New("on Unraid, use /etc/rc.d/rc.msf and the WebGUI plugin page instead of systemd service install")
	}
	if isFnOSFPKRuntime() {
		return errors.New("on fnOS FPK installs, manage msf from fnOS / 飞牛应用中心 or the FPK package manager")
	}
	if opts.ServiceName == "" {
		opts.ServiceName = "msf"
	}
	binDest := filepath.Join(opts.Prefix, "bin", "msf")
	if !fileExists(binDest) {
		if exe, err := os.Executable(); err == nil {
			binDest = exe
		}
	}
	if err := os.MkdirAll(opts.DataDir, 0755); err != nil {
		return err
	}
	servicePath := filepath.Join(systemdServiceDir, opts.ServiceName+".service")
	body := fmt.Sprintf(`[Unit]
Description=msf service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=%s
Environment=MSF_DATA_DIR=%s
ExecStart=%s serve --config %s --host %s --port %d
Restart=on-failure
RestartSec=2
TimeoutStopSec=30
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
`, opts.DataDir, opts.DataDir, binDest, opts.DataDir, opts.Host, opts.Port)
	if err := os.WriteFile(servicePath, []byte(body), 0644); err != nil {
		return err
	}
	if err := runVisible("systemctl", "daemon-reload"); err != nil {
		return err
	}
	if err := runVisible("systemctl", "enable", opts.ServiceName); err != nil {
		return err
	}
	fmt.Printf("installed systemd service: %s\n", opts.ServiceName)
	return nil
}

func selfUpdateArchiveName(goos, goarch string) string {
	if goos == "" {
		goos = "linux"
	}
	if goarch == "" {
		goarch = "amd64"
	}
	return fmt.Sprintf("msf-%s-%s.tar.gz", goos, goarch)
}

func removeSystemdService(serviceName string) error {
	if currentEUID() != 0 {
		return errors.New("service uninstall must be run as root")
	}
	if isUnraidRuntime() {
		return errors.New("on Unraid, remove msf from the WebGUI plugin page instead of systemd service uninstall")
	}
	if isFnOSFPKRuntime() {
		return errors.New("on fnOS FPK installs, remove msf from fnOS / 飞牛应用中心 or the FPK package manager")
	}
	servicePath := filepath.Join(systemdServiceDir, serviceName+".service")
	_ = runQuiet("systemctl", "stop", serviceName)
	_ = runQuiet("systemctl", "disable", serviceName)
	if err := os.Remove(servicePath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	_ = runQuiet("systemctl", "daemon-reload")
	fmt.Printf("removed systemd service: %s\n", serviceName)
	return nil
}

func licenseCommand(action string) error {
	switch action {
	case "status", "":
		fmt.Println("license: free/unlocked")
		return nil
	case "fingerprint":
		host, _ := os.Hostname()
		sum := sha256.Sum256([]byte(host + "|" + defaultDataDir()))
		fmt.Println(hex.EncodeToString(sum[:]))
		return nil
	case "activate", "deactivate", "bind", "unbind", "info":
		fmt.Println("license: free/unlocked; commercial license commands are not required in msf")
		return nil
	default:
		return errors.New("usage: msf license status|fingerprint")
	}
}

func removeRuntimePIDFiles(dataDir string) {
	_ = os.Remove(filepath.Join(dataDir, "msf.pid"))
}

func removeAliasIfOwned(aliasPath, binPath string) {
	target, err := os.Readlink(aliasPath)
	if err != nil {
		return
	}
	if target == binPath || target == filepath.Base(binPath) {
		_ = os.Remove(aliasPath)
	}
}

func commandExists(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func runQuiet(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Stdout = nil
	cmd.Stderr = nil
	return cmd.Run()
}

func safeRemoveAll(path string) error {
	clean := filepath.Clean(path)
	switch clean {
	case "", ".", "/", "/opt", "/usr", "/usr/local", "/mnt", "/mnt/user", "/mnt/cache":
		return fmt.Errorf("refusing to purge unsafe data directory: %s", path)
	}
	return os.RemoveAll(clean)
}

func runtimePID(dataDir string) int {
	b, err := os.ReadFile(runtimePIDFile(dataDir))
	if err != nil {
		return 0
	}
	pid, _ := strconv.Atoi(stringTrim(string(b)))
	return pid
}

func systemdUnitExists(serviceName string) bool {
	return commandExists("systemctl") && fileExists(filepath.Join(systemdServiceDir, serviceName+".service"))
}

func commandOutput(name string, args ...string) string {
	out, err := exec.Command(name, args...).CombinedOutput()
	if err != nil {
		return strings.TrimSpace(string(out))
	}
	return strings.TrimSpace(string(out))
}

func normalizeCLIService(service string) string {
	switch strings.ToLower(strings.TrimSpace(service)) {
	case "", "app", "msf", "web", "server":
		return "msf"
	case "proxy", "clash":
		return "mihomo"
	default:
		return strings.ToLower(strings.TrimSpace(service))
	}
}

func cliLogPaths(dataDir, service string) []string {
	switch normalizeCLIService(service) {
	case "mosdns":
		return []string{
			filepath.Join(dataDir, "logs", "mosdns.out.log"),
			filepath.Join(dataDir, "logs", "mosdns.err.log"),
			filepath.Join(dataDir, "logs", "mosdns.log"),
			filepath.Join(dataDir, "configs", "logs", "mosdns.log"),
		}
	case "mihomo":
		return []string{
			filepath.Join(dataDir, "logs", "mihomo.out.log"),
			filepath.Join(dataDir, "logs", "mihomo.err.log"),
			filepath.Join(dataDir, "logs", "mihomo.log"),
		}
	default:
		return []string{
			filepath.Join(dataDir, "logs", "msf.log"),
			filepath.Join(dataDir, "logs", "msf.unraid.log"),
			filepath.Join(dataDir, "logs", "msf.cli.log"),
		}
	}
}

func tailFile(path string, n int) []string {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	lines := strings.Split(strings.ReplaceAll(string(b), "\r\n", "\n"), "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	if n > 0 && len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return lines
}

func portStatus(port string) string {
	conn, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", port), 500*time.Millisecond)
	if err != nil {
		return "closed"
	}
	_ = conn.Close()
	return "open"
}

func downloadFile(rawURL, dest string) error {
	client := &http.Client{Timeout: 5 * time.Minute}
	res, err := client.Get(rawURL)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("download failed: HTTP %d", res.StatusCode)
	}
	out, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, res.Body)
	return err
}

func extractTarGZ(archivePath, dest string) error {
	f, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	base, _ := filepath.Abs(dest)
	for {
		hdr, err := tr.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		target := filepath.Join(dest, filepath.Clean(hdr.Name))
		abs, _ := filepath.Abs(target)
		if abs != base && !strings.HasPrefix(abs, base+string(filepath.Separator)) {
			return fmt.Errorf("archive path escapes destination: %s", hdr.Name)
		}
		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(abs, os.FileMode(hdr.Mode)); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(abs), 0755); err != nil {
				return err
			}
			out, err := os.OpenFile(abs, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, os.FileMode(hdr.Mode))
			if err != nil {
				return err
			}
			if _, err := io.Copy(out, tr); err != nil {
				_ = out.Close()
				return err
			}
			if err := out.Close(); err != nil {
				return err
			}
		}
	}
}

func findFile(root, name string) (string, error) {
	var found string
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || found != "" {
			return err
		}
		if !d.IsDir() && d.Name() == name {
			found = path
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if found == "" {
		return "", fmt.Errorf("%s not found under %s", name, root)
	}
	return found, nil
}

func runVisible(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func defaultGitHubRepo() string {
	if v := strings.TrimSpace(os.Getenv("MSF_GITHUB_REPO")); v != "" {
		return v
	}
	return "scoltzero/msf"
}

func isUnraidRuntime() bool {
	if fileExists("/etc/unraid-version") || fileExists("/usr/local/sbin/emhttp") || fileExists("/boot/config/plugins") {
		return true
	}
	if strings.Contains(strings.ToLower(os.Getenv("UNRAID_VERSION")), "unraid") {
		return true
	}
	return false
}

func isFnOSFPKRuntime() bool {
	for _, key := range []string{"MSF_RUNTIME", "MSF_PACKAGE_RUNTIME", "MSF_PACKAGE_TYPE", "FNOS_RUNTIME", "FNOS_PACKAGE_TYPE"} {
		value := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
		if value == "fnos" || value == "fpk" || value == "fnos-fpk" || strings.Contains(value, "fnos") || strings.Contains(value, "fpk") {
			return true
		}
	}
	return fileExists("/etc/fnos-release") ||
		fileExists("/etc/feiniu-release") ||
		fileExists("/etc/fnOS-release") ||
		fileExists("/usr/local/fnos") ||
		fileExists("/var/packages/msf")
}

func processAlive(pid int) bool {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	if proc.Signal(syscall.Signal(0)) != nil {
		return false
	}
	if runtime.GOOS == "linux" && processZombie(pid) {
		return false
	}
	return true
}

func processZombie(pid int) bool {
	b, err := os.ReadFile(filepath.Join(procRoot, strconv.Itoa(pid), "stat"))
	if err != nil {
		return false
	}
	fields := strings.Fields(string(b))
	return len(fields) > 2 && fields[2] == "Z"
}

func stringTrim(s string) string {
	for len(s) > 0 && (s[0] == '\n' || s[0] == '\r' || s[0] == ' ' || s[0] == '\t') {
		s = s[1:]
	}
	for len(s) > 0 {
		last := s[len(s)-1]
		if last != '\n' && last != '\r' && last != ' ' && last != '\t' {
			break
		}
		s = s[:len(s)-1]
	}
	return s
}
