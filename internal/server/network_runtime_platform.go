package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

var (
	applyPlatformNetwork   = defaultApplyPlatformNetwork
	restorePlatformNetwork = defaultRestorePlatformNetwork
	platformNetworkStatus  = defaultPlatformNetworkStatus
	darwinNetworkCommand   = runDarwinNetworkCommand
)

type darwinDNSBackup struct {
	Service   string   `json:"service"`
	Device    string   `json:"device"`
	Automatic bool     `json:"automatic"`
	Servers   []string `json:"servers,omitempty"`
}

type darwinNetworkBackup struct {
	Version           int               `json:"version"`
	Applied           bool              `json:"applied"`
	SelectedInterface string            `json:"selected_interface"`
	RouteInterface    string            `json:"route_interface"`
	IPv4Forwarding    string            `json:"ipv4_forwarding"`
	DNS               []darwinDNSBackup `json:"dns"`
	CapturedAt        string            `json:"captured_at"`
}

type darwinNetworkService struct {
	Name     string
	Device   string
	Disabled bool
}

func defaultApplyPlatformNetwork(ctx context.Context, a *App, cfg SetupConfig) error {
	if IsMacOSRuntime() {
		return a.applyDarwinNetwork(ctx, cfg)
	}
	switch runtime.GOOS {
	case "linux":
		if shouldRestoreNFT(cfg) {
			_, err := a.applyNFT(ctx)
			return err
		}
		if os.Geteuid() == 0 {
			_, err := a.clearNFT(ctx)
			return err
		}
	}
	return nil
}

func defaultRestorePlatformNetwork(ctx context.Context, a *App, cfg SetupConfig) error {
	if IsMacOSRuntime() {
		return a.restoreDarwinNetwork(ctx)
	}
	switch runtime.GOOS {
	case "linux":
		if os.Geteuid() == 0 {
			_, err := a.clearNFT(ctx)
			return err
		}
	}
	return nil
}

func defaultPlatformNetworkStatus(ctx context.Context, a *App) map[string]any {
	if IsMacOSRuntime() {
		return a.darwinNetworkStatus(ctx)
	}
	switch runtime.GOOS {
	case "linux":
		return map[string]any{
			"kind": "linux",
			"nft":  a.nftStatus(),
		}
	default:
		return map[string]any{"kind": runtime.GOOS, "supported": false}
	}
}

func (a *App) applyDarwinNetwork(ctx context.Context, cfg SetupConfig) error {
	if os.Geteuid() != 0 {
		return errors.New("macOS TUN 后台必须以 root LaunchDaemon 运行")
	}
	cfg.defaults()
	routeInterface, err := waitForDarwinFakeIPRoute(ctx, cfg)
	if err != nil {
		return err
	}
	backup, err := a.readDarwinNetworkBackup()
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("读取 macOS 网络快照: %w", err)
	}
	if os.IsNotExist(err) || !backup.Applied {
		backup, err = a.captureDarwinNetworkBackup(ctx, cfg, routeInterface)
		if err != nil {
			return err
		}
		if err := a.writeDarwinNetworkBackup(backup); err != nil {
			return fmt.Errorf("保存 macOS 网络快照: %w", err)
		}
	}

	if _, err := darwinNetworkCommand(ctx, "/usr/sbin/sysctl", "-w", "net.inet.ip.forwarding=1"); err != nil {
		_ = a.restoreDarwinNetwork(ctx)
		return fmt.Errorf("启用 macOS IPv4 转发: %w", err)
	}
	for _, dns := range backup.DNS {
		if _, err := darwinNetworkCommand(ctx, "/usr/sbin/networksetup", "-setdnsservers", dns.Service, "127.0.0.1"); err != nil {
			_ = a.restoreDarwinNetwork(ctx)
			return fmt.Errorf("设置 %s DNS: %w", dns.Service, err)
		}
	}
	return nil
}

func (a *App) captureDarwinNetworkBackup(ctx context.Context, cfg SetupConfig, routeInterface string) (darwinNetworkBackup, error) {
	services, err := listDarwinNetworkServices(ctx)
	if err != nil {
		return darwinNetworkBackup{}, err
	}
	selected := strings.TrimSpace(cfg.SelectedInterface)
	defaultInterface, _ := darwinDefaultRouteInterface(ctx)
	devices := uniqueStrings([]string{selected, defaultInterface})
	backups := make([]darwinDNSBackup, 0, len(devices))
	for _, device := range devices {
		if device == "" {
			continue
		}
		service, ok := darwinServiceForDevice(services, device)
		if !ok {
			continue
		}
		dns, err := getDarwinDNSBackup(ctx, service)
		if err != nil {
			return darwinNetworkBackup{}, err
		}
		backups = append(backups, dns)
	}
	if len(backups) == 0 {
		return darwinNetworkBackup{}, fmt.Errorf("无法将网卡 %q 映射到 macOS 网络服务", firstNonEmpty(selected, defaultInterface))
	}
	forwarding, err := darwinNetworkCommand(ctx, "/usr/sbin/sysctl", "-n", "net.inet.ip.forwarding")
	if err != nil {
		return darwinNetworkBackup{}, fmt.Errorf("读取 macOS IPv4 转发状态: %w", err)
	}
	return darwinNetworkBackup{
		Version:           1,
		Applied:           true,
		SelectedInterface: selected,
		RouteInterface:    routeInterface,
		IPv4Forwarding:    strings.TrimSpace(string(forwarding)),
		DNS:               backups,
		CapturedAt:        nowString(),
	}, nil
}

func (a *App) restoreDarwinNetwork(ctx context.Context) error {
	backup, err := a.readDarwinNetworkBackup()
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("读取 macOS 网络快照: %w", err)
	}
	var errs []error
	for _, dns := range backup.DNS {
		args := []string{"-setdnsservers", dns.Service}
		if dns.Automatic || len(dns.Servers) == 0 {
			args = append(args, "Empty")
		} else {
			args = append(args, dns.Servers...)
		}
		if _, err := darwinNetworkCommand(ctx, "/usr/sbin/networksetup", args...); err != nil {
			errs = append(errs, fmt.Errorf("恢复 %s DNS: %w", dns.Service, err))
		}
	}
	forwarding := strings.TrimSpace(backup.IPv4Forwarding)
	if forwarding != "0" && forwarding != "1" {
		forwarding = "0"
	}
	if _, err := darwinNetworkCommand(ctx, "/usr/sbin/sysctl", "-w", "net.inet.ip.forwarding="+forwarding); err != nil {
		errs = append(errs, fmt.Errorf("恢复 macOS IPv4 转发: %w", err))
	}
	if len(errs) == 0 {
		_ = os.Remove(a.darwinNetworkBackupPath())
	}
	return errors.Join(errs...)
}

func (a *App) darwinNetworkStatus(ctx context.Context) map[string]any {
	status := map[string]any{
		"kind":            "darwin-tun",
		"supported":       true,
		"is_root":         os.Geteuid() == 0,
		"dns_applied":     false,
		"ipv4_forwarding": false,
		"route_ready":     false,
	}
	backup, err := a.readDarwinNetworkBackup()
	if err == nil {
		status["snapshot_present"] = true
		status["selected_interface"] = backup.SelectedInterface
		status["dns_services"] = backup.DNS
		status["captured_at"] = backup.CapturedAt
		applied := len(backup.DNS) > 0
		for _, dns := range backup.DNS {
			out, commandErr := darwinNetworkCommand(ctx, "/usr/sbin/networksetup", "-getdnsservers", dns.Service)
			if commandErr != nil || !darwinDNSContainsLocalhost(string(out)) {
				applied = false
				break
			}
		}
		status["dns_applied"] = applied
	} else {
		status["snapshot_present"] = false
	}
	if out, commandErr := darwinNetworkCommand(ctx, "/usr/sbin/sysctl", "-n", "net.inet.ip.forwarding"); commandErr == nil {
		status["ipv4_forwarding"] = strings.TrimSpace(string(out)) == "1"
	}
	if cfg, ok := a.latestSetupConfig(); ok {
		cfg.defaults()
		if iface, commandErr := darwinFakeIPRouteInterface(ctx, cfg); commandErr == nil {
			status["route_interface"] = iface
			status["route_ready"] = strings.HasPrefix(iface, "utun")
		}
	}
	status["ready"] = isTruthy(fmtAny(status["dns_applied"])) &&
		isTruthy(fmtAny(status["route_ready"])) &&
		isTruthy(fmtAny(status["ipv4_forwarding"]))
	return status
}

func (a *App) darwinNetworkBackupPath() string {
	return filepath.Join(a.DataDir, "configs/network/darwin-state.json")
}

func (a *App) readDarwinNetworkBackup() (darwinNetworkBackup, error) {
	var backup darwinNetworkBackup
	body, err := os.ReadFile(a.darwinNetworkBackupPath())
	if err != nil {
		return backup, err
	}
	if err := json.Unmarshal(body, &backup); err != nil {
		return backup, err
	}
	return backup, nil
}

func (a *App) writeDarwinNetworkBackup(backup darwinNetworkBackup) error {
	path := a.darwinNetworkBackupPath()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	body, err := json.MarshalIndent(backup, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".darwin-state-*.json")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if _, err := tmp.Write(body); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Chmod(0600); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}

func waitForDarwinFakeIPRoute(ctx context.Context, cfg SetupConfig) (string, error) {
	deadline := time.Now().Add(8 * time.Second)
	for {
		iface, err := darwinFakeIPRouteInterface(ctx, cfg)
		if err == nil && strings.HasPrefix(iface, "utun") {
			return iface, nil
		}
		if time.Now().After(deadline) {
			if err != nil {
				return "", fmt.Errorf("等待 Mihomo TUN 路由: %w", err)
			}
			return "", fmt.Errorf("Fake-IP 路由未进入 utun，当前接口为 %q", iface)
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}
}

func darwinFakeIPRouteInterface(ctx context.Context, cfg SetupConfig) (string, error) {
	prefix, err := netip.ParsePrefix(fakeIPv4RouteCIDR(cfg.FakeIPRangeV4))
	if err != nil {
		return "", err
	}
	probe := prefix.Masked().Addr().Next().String()
	out, err := darwinNetworkCommand(ctx, "/sbin/route", "-n", "get", probe)
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(string(out), "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), ":")
		if ok && strings.TrimSpace(key) == "interface" {
			return strings.TrimSpace(value), nil
		}
	}
	return "", errors.New("route output does not contain an interface")
}

func darwinDefaultRouteInterface(ctx context.Context) (string, error) {
	out, err := darwinNetworkCommand(ctx, "/sbin/route", "-n", "get", "default")
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(string(out), "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), ":")
		if ok && strings.TrimSpace(key) == "interface" {
			return strings.TrimSpace(value), nil
		}
	}
	return "", errors.New("default route output does not contain an interface")
}

func listDarwinNetworkServices(ctx context.Context) ([]darwinNetworkService, error) {
	out, err := darwinNetworkCommand(ctx, "/usr/sbin/networksetup", "-listnetworkserviceorder")
	if err != nil {
		return nil, fmt.Errorf("读取 macOS 网络服务: %w", err)
	}
	lines := strings.Split(string(out), "\n")
	services := make([]darwinNetworkService, 0)
	for i := 0; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])
		closeIndex := strings.Index(line, ") ")
		if !strings.HasPrefix(line, "(") || closeIndex < 0 {
			continue
		}
		name := strings.TrimSpace(line[closeIndex+2:])
		disabled := strings.HasPrefix(name, "*")
		name = strings.TrimSpace(strings.TrimPrefix(name, "*"))
		if i+1 >= len(lines) {
			continue
		}
		detail := strings.TrimSpace(lines[i+1])
		deviceMarker := "Device:"
		deviceIndex := strings.LastIndex(detail, deviceMarker)
		if deviceIndex < 0 {
			continue
		}
		device := strings.TrimSpace(strings.TrimSuffix(detail[deviceIndex+len(deviceMarker):], ")"))
		services = append(services, darwinNetworkService{Name: name, Device: device, Disabled: disabled})
		i++
	}
	return services, nil
}

func darwinServiceForDevice(services []darwinNetworkService, device string) (darwinNetworkService, bool) {
	for _, service := range services {
		if !service.Disabled && service.Device == device && service.Name != "" {
			return service, true
		}
	}
	return darwinNetworkService{}, false
}

func getDarwinDNSBackup(ctx context.Context, service darwinNetworkService) (darwinDNSBackup, error) {
	out, err := darwinNetworkCommand(ctx, "/usr/sbin/networksetup", "-getdnsservers", service.Name)
	if err != nil {
		return darwinDNSBackup{}, fmt.Errorf("读取 %s DNS: %w", service.Name, err)
	}
	text := strings.TrimSpace(string(out))
	backup := darwinDNSBackup{Service: service.Name, Device: service.Device}
	if text == "" || strings.Contains(strings.ToLower(text), "aren't any dns servers") {
		backup.Automatic = true
		return backup, nil
	}
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			backup.Servers = append(backup.Servers, line)
		}
	}
	return backup, nil
}

func darwinDNSContainsLocalhost(text string) bool {
	for _, line := range strings.Split(text, "\n") {
		if strings.TrimSpace(line) == "127.0.0.1" {
			return true
		}
	}
	return false
}

func runDarwinNetworkCommand(ctx context.Context, name string, args ...string) ([]byte, error) {
	commandCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(commandCtx, name, args...).CombinedOutput()
	if commandCtx.Err() != nil {
		return out, commandCtx.Err()
	}
	if err != nil {
		message := strings.TrimSpace(string(out))
		if message != "" {
			return out, fmt.Errorf("%s: %w", message, err)
		}
	}
	return out, err
}

func sortedDarwinServiceNames(items []darwinNetworkService) []string {
	names := make([]string, 0, len(items))
	for _, item := range items {
		if item.Name != "" {
			names = append(names, item.Name)
		}
	}
	sort.Strings(names)
	return names
}
