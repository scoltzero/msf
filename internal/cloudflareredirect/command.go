package cloudflareredirect

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func Command(ctx context.Context, dataDir, action string, args []string) error {
	switch action {
	case "", "status":
		return PrintStatus(dataDir)
	case "start":
		return Start(dataDir)
	case "stop":
		return Stop(ctx, dataDir)
	case "scan":
		return RunScan(ctx, dataDir)
	case "apply":
		return RunApply(ctx, dataDir)
	case "run":
		return RunDaemon(ctx, dataDir)
	default:
		return fmt.Errorf("unknown cloudflare-redirect action %q", action)
	}
}

func Start(dataDir string) error {
	cfg, err := LoadConfig(dataDir)
	if err != nil {
		return err
	}
	if pid := readPID(PIDPath(dataDir)); pid > 0 && processAlive(pid) {
		fmt.Printf("cloudflare-redirect already running pid=%d enabled=%t\n", pid, cfg.Enabled)
		if cfg.Enabled {
			fmt.Println("cloudflare-redirect is already running; refreshing scan/apply once now")
			return refreshOnce(context.Background(), dataDir, cfg)
		}
		printStartHints(dataDir, cfg)
		return nil
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(PIDPath(dataDir)), 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(LogPath(dataDir)), 0o755); err != nil {
		return err
	}
	logFile, err := os.OpenFile(LogPath(dataDir), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	cmd := exec.Command(exe, "cloudflare-redirect", "--config", dataDir, "run")
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	if runtime.GOOS != "windows" {
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	}
	if err := cmd.Start(); err != nil {
		_ = logFile.Close()
		return err
	}
	if err := os.WriteFile(PIDPath(dataDir), []byte(strconv.Itoa(cmd.Process.Pid)), 0o644); err != nil {
		_ = logFile.Close()
		return err
	}
	go func() {
		_ = cmd.Wait()
		_ = logFile.Close()
	}()
	time.Sleep(300 * time.Millisecond)
	fmt.Printf("cloudflare-redirect started pid=%d enabled=%t\n", cmd.Process.Pid, cfg.Enabled)
	if cfg.Enabled {
		fmt.Println("daemon will scan and apply immediately; use status to watch results")
	} else {
		printStartHints(dataDir, cfg)
	}
	return nil
}

func Stop(ctx context.Context, dataDir string) error {
	pid := readPID(PIDPath(dataDir))
	if pid > 0 && processAlive(pid) {
		proc, err := os.FindProcess(pid)
		if err == nil {
			_ = proc.Signal(syscall.SIGTERM)
		}
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			if !processAlive(pid) {
				break
			}
			time.Sleep(200 * time.Millisecond)
		}
		if processAlive(pid) && err == nil {
			_ = proc.Signal(syscall.SIGKILL)
		}
	}
	_ = os.Remove(PIDPath(dataDir))
	if err := RemoveInjection(ctx, dataDir, true); err != nil {
		return err
	}
	fmt.Println("cloudflare-redirect stopped and MosDNS injection removed")
	return nil
}

func RunScan(ctx context.Context, dataDir string) error {
	cfg, err := LoadConfig(dataDir)
	if err != nil {
		return err
	}
	st, err := Scan(ctx, dataDir, cfg)
	printScanSummary(st)
	return err
}

func RunApply(ctx context.Context, dataDir string) error {
	cfg, err := LoadConfig(dataDir)
	if err != nil {
		return err
	}
	if !cfg.Enabled {
		if err := RemoveInjection(ctx, dataDir, true); err != nil {
			return err
		}
		fmt.Printf("cloudflare redirect is disabled in %s; skipped apply and removed existing MosDNS injection\n", ConfigPath(dataDir))
		fmt.Println("edit enabled: true and add rules.manual or rules.subscriptions before applying")
		return nil
	}
	st, _ := LoadState(dataDir)
	result, err := Apply(ctx, dataDir, cfg, st)
	if err != nil {
		return err
	}
	fmt.Printf("applied cloudflare redirect: domains=%d ipv4=%d ipv6=%d restarted_mosdns=%t\n", result.DomainCount, result.IPv4Count, result.IPv6Count, result.Restarted)
	return nil
}

func refreshOnce(ctx context.Context, dataDir string, cfg Config) error {
	st, err := Scan(ctx, dataDir, cfg)
	printScanSummary(st)
	if err != nil {
		return err
	}
	result, err := Apply(ctx, dataDir, cfg, st)
	if err != nil {
		return err
	}
	fmt.Printf("applied cloudflare redirect: domains=%d ipv4=%d ipv6=%d restarted_mosdns=%t\n", result.DomainCount, result.IPv4Count, result.IPv6Count, result.Restarted)
	return nil
}

func RunDaemon(ctx context.Context, dataDir string) error {
	if err := os.MkdirAll(filepath.Dir(PIDPath(dataDir)), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(PIDPath(dataDir), []byte(strconv.Itoa(os.Getpid())), 0o644); err != nil {
		return err
	}
	defer os.Remove(PIDPath(dataDir))
	ctx, stop := signalContext(ctx)
	defer stop()
	return daemonLoop(ctx, dataDir)
}

func daemonLoop(ctx context.Context, dataDir string) error {
	const checkInterval = time.Minute
	firstTick := true
	for {
		cfg, err := LoadConfig(dataDir)
		if err != nil {
			recordError(dataDir, err)
		} else if cfg.Enabled {
			st, _ := LoadState(dataDir)
			scanInterval := ParseDuration(cfg.Scan.Interval, 6*time.Hour)
			dueScan := firstTick || st.LastScanAt.IsZero() || time.Since(st.LastScanAt) >= scanInterval
			if dueScan {
				var scanErr error
				st, scanErr = Scan(ctx, dataDir, cfg)
				if scanErr != nil {
					recordError(dataDir, scanErr)
				}
			}
			configChanged := configModifiedAfterApply(dataDir, st)
			needsApply := dueScan || configChanged || !st.Injected
			if needsApply && (len(st.BestIPv4) > 0 || len(st.BestIPv6) > 0) {
				if _, applyErr := Apply(ctx, dataDir, cfg, st); applyErr != nil {
					recordError(dataDir, applyErr)
				}
			}
		} else {
			st, _ := LoadState(dataDir)
			if st.Injected {
				if err := RemoveInjection(ctx, dataDir, true); err != nil {
					recordError(dataDir, err)
				}
			}
		}
		firstTick = false
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(checkInterval):
		}
	}
}

func PrintStatus(dataDir string) error {
	cfg, cfgErr := LoadConfig(dataDir)
	st, stErr := LoadState(dataDir)
	pid := readPID(PIDPath(dataDir))
	running := pid > 0 && processAlive(pid)
	status := map[string]any{
		"running":         running,
		"pid":             pid,
		"config":          ConfigPath(dataDir),
		"state":           StatePath(dataDir),
		"rule":            RulePath(dataDir),
		"mosdns_injected": st.Injected,
		"last_scan_at":    st.LastScanAt,
		"last_apply_at":   st.LastApplyAt,
		"domain_count":    st.DomainCount,
		"best_ipv4":       st.BestIPv4,
		"best_ipv6":       st.BestIPv6,
		"last_error":      st.LastError,
	}
	if cfgErr == nil {
		status["enabled"] = cfg.Enabled
		status["next_scan_at"] = nextScanAt(cfg, st)
		status["hints"] = statusHints(dataDir, cfg, st, running)
	} else {
		status["config_error"] = cfgErr.Error()
	}
	if stErr != nil {
		status["state_error"] = stErr.Error()
	}
	b, _ := json.MarshalIndent(status, "", "  ")
	fmt.Println(string(b))
	if cfgErr != nil {
		return cfgErr
	}
	return nil
}

func printStartHints(dataDir string, cfg Config) {
	st, _ := LoadState(dataDir)
	for _, hint := range statusHints(dataDir, cfg, st, true) {
		fmt.Printf("hint: %s\n", hint)
	}
}

func statusHints(dataDir string, cfg Config, st State, running bool) []string {
	hints := []string{}
	if !cfg.Enabled {
		return append(hints, fmt.Sprintf("enabled=false; scan is allowed, but apply will remove MosDNS injection. Edit %s and set enabled: true to activate.", ConfigPath(dataDir)))
	}
	if !running {
		hints = append(hints, "daemon is not running; use msf cloudflare-redirect start for periodic scan/apply, or run scan/apply manually")
	}
	if len(st.BestIPv4) == 0 && len(st.BestIPv6) == 0 {
		hints = append(hints, "no scanned Cloudflare IPs yet; run msf cloudflare-redirect scan")
	}
	if !st.Injected {
		hints = append(hints, "enabled=true but MosDNS is not injected yet; run msf cloudflare-redirect apply for immediate injection")
	}
	if st.DomainCount == 0 {
		hints = append(hints, "last applied domain_count=0; add rules.manual or enabled rules.subscriptions in cfyouxuan.yaml")
	}
	if configModifiedAfterApply(dataDir, st) && !st.LastApplyAt.IsZero() {
		hints = append(hints, "cfyouxuan.yaml changed after the last apply; run msf cloudflare-redirect apply to apply it immediately")
	}
	return hints
}

func nextScanAt(cfg Config, st State) any {
	if !cfg.Enabled {
		return nil
	}
	interval := ParseDuration(cfg.Scan.Interval, 6*time.Hour)
	if st.LastScanAt.IsZero() {
		return "due now"
	}
	return st.LastScanAt.Add(interval)
}

func configModifiedAfterApply(dataDir string, st State) bool {
	if st.LastApplyAt.IsZero() {
		return false
	}
	info, err := os.Stat(ConfigPath(dataDir))
	if err != nil {
		return false
	}
	return info.ModTime().After(st.LastApplyAt)
}

func printScanSummary(st State) {
	fmt.Printf("scan complete: ipv4=%d ipv6=%d last_scan_at=%s\n", len(st.BestIPv4), len(st.BestIPv6), st.LastScanAt.Format(time.RFC3339))
	for _, result := range st.BestIPv4 {
		fmt.Printf("  ipv4 %s %dms %s %s\n", result.IP, result.LatencyMS, result.Colo, strings.TrimSpace(result.City+" "+result.Region))
	}
	for _, result := range st.BestIPv6 {
		fmt.Printf("  ipv6 %s %dms %s %s\n", result.IP, result.LatencyMS, result.Colo, strings.TrimSpace(result.City+" "+result.Region))
	}
	if st.LastError != "" {
		fmt.Printf("warning: %s\n", st.LastError)
	}
}

func recordError(dataDir string, err error) {
	if err == nil {
		return
	}
	st, _ := LoadState(dataDir)
	st.LastError = err.Error()
	_ = SaveState(dataDir, st)
	_ = appendLog(dataDir, err.Error())
}

func appendLog(dataDir, line string) error {
	path := LogPath(dataDir)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = fmt.Fprintf(f, "%s %s\n", time.Now().Format(time.RFC3339), line)
	return err
}

func signalContext(parent context.Context) (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(parent)
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, os.Interrupt, syscall.SIGTERM)
	go func() {
		select {
		case <-ctx.Done():
		case <-ch:
			cancel()
		}
	}()
	return ctx, func() {
		cancel()
		signal.Stop(ch)
	}
}

func livePID(path string) (int, bool) {
	pid := readPID(path)
	return pid, pid > 0 && processAlive(pid)
}
