package server

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

type setupPreflightResult struct {
	Success       bool                `json:"success"`
	DNS53         setupDNS53Status    `json:"dns53"`
	Timezone      setupTimezoneStatus `json:"timezone"`
	ReservedPorts []setupPortCheck    `json:"reserved_ports"`
	Blocking      bool                `json:"blocking"`
	Warnings      []string            `json:"warnings"`
	Errors        []string            `json:"errors,omitempty"`
}

type setupDNS53Status struct {
	Status       string              `json:"status"`
	Message      string              `json:"message"`
	Remediated   bool                `json:"remediated"`
	Blockers     []setupPortListener `json:"blockers,omitempty"`
	CanRemediate bool                `json:"can_remediate"`
}

type setupTimezoneStatus struct {
	Current     string `json:"current"`
	Target      string `json:"target"`
	NeedsChange bool   `json:"needs_change"`
	Valid       bool   `json:"valid"`
	Message     string `json:"message"`
}

type setupPortCheck struct {
	Port      int                 `json:"port"`
	Protocol  string              `json:"protocol"`
	Service   string              `json:"service"`
	Status    string              `json:"status"`
	Message   string              `json:"message,omitempty"`
	Listeners []setupPortListener `json:"listeners,omitempty"`
}

type setupPortListener struct {
	Port     int    `json:"port"`
	Protocol string `json:"protocol"`
	Address  string `json:"address,omitempty"`
	PID      int    `json:"pid,omitempty"`
	Process  string `json:"process,omitempty"`
	Source   string `json:"source,omitempty"`
}

type setupReservedPort struct {
	Port    int
	Service string
}

var (
	setupCommandOutput = func(ctx context.Context, timeout time.Duration, name string, args ...string) ([]byte, error) {
		cmdCtx, cancel := context.WithTimeout(ctx, timeout)
		defer cancel()
		return exec.CommandContext(cmdCtx, name, args...).CombinedOutput()
	}
	setupLookPath  = exec.LookPath
	setupGeteuid   = os.Geteuid
	setupProbePort = probeSetupPort
)

func (a *App) buildSetupPreflight(ctx context.Context, targetTimezone string, autoRemediateDNS bool) setupPreflightResult {
	targetTimezone = strings.TrimSpace(targetTimezone)
	if targetTimezone == "" {
		targetTimezone = "Asia/Shanghai"
	}
	result := setupPreflightResult{Success: true}
	result.Timezone = setupTimezonePreflight(ctx, targetTimezone)
	if !result.Timezone.Valid {
		result.Blocking = true
		result.Errors = append(result.Errors, result.Timezone.Message)
	}
	if runtime.GOOS == "linux" && setupGeteuid() != 0 {
		result.Blocking = true
		result.Errors = append(result.Errors, "MosDNS 53 端口和 nftables 需要 root 权限")
	}

	listeners := collectSetupPortListeners(ctx, setupAllCheckedPorts())
	result.DNS53 = setupDNS53Preflight(ctx, listeners, autoRemediateDNS)
	if result.DNS53.Status == "blocked" {
		result.Blocking = true
		result.Errors = append(result.Errors, result.DNS53.Message)
	}
	if result.DNS53.Remediated {
		listeners = collectSetupPortListeners(ctx, setupAllCheckedPorts())
	}

	result.ReservedPorts = setupReservedPortChecks(ctx, listeners)
	for _, item := range result.ReservedPorts {
		if item.Status != "occupied" {
			continue
		}
		result.Warnings = append(result.Warnings, fmt.Sprintf("%s/%d 已被占用：%s", item.Protocol, item.Port, item.Service))
	}
	result.Success = !result.Blocking
	return result
}

func setupTimezonePreflight(ctx context.Context, target string) setupTimezoneStatus {
	out := setupTimezoneStatus{Target: target, Valid: true}
	if _, err := time.LoadLocation(target); err != nil {
		out.Valid = false
		out.Message = "无效时区：" + target
		return out
	}
	out.Current = currentHostTimezone(ctx)
	out.NeedsChange = out.Current != "" && out.Current != target
	if out.NeedsChange {
		out.Message = fmt.Sprintf("宿主机时区 %s 将同步为 %s", out.Current, target)
	} else if out.Current == "" {
		out.Message = "无法读取宿主机当前时区，初始化时会尝试设置"
	} else {
		out.Message = "宿主机时区已匹配"
	}
	return out
}

func currentHostTimezone(ctx context.Context) string {
	if runtime.GOOS == "linux" {
		if _, err := setupLookPath("timedatectl"); err == nil {
			if out, err := setupCommandOutput(ctx, 3*time.Second, "timedatectl", "show", "-p", "Timezone", "--value"); err == nil {
				if value := strings.TrimSpace(string(out)); value != "" {
					return value
				}
			}
		}
		if b, err := os.ReadFile("/etc/timezone"); err == nil {
			if value := strings.TrimSpace(string(b)); value != "" {
				return value
			}
		}
		if target, err := os.Readlink("/etc/localtime"); err == nil {
			if idx := strings.Index(target, "/zoneinfo/"); idx >= 0 {
				return strings.TrimPrefix(target[idx+len("/zoneinfo/"):], "/")
			}
		}
	}
	if loc := time.Now().Location(); loc != nil {
		if name := loc.String(); name != "" && name != "Local" {
			return name
		}
	}
	return ""
}

func applyHostTimezone(ctx context.Context, target string) error {
	target = strings.TrimSpace(target)
	if target == "" {
		target = "Asia/Shanghai"
	}
	loc, err := time.LoadLocation(target)
	if err != nil {
		return fmt.Errorf("invalid timezone %q: %w", target, err)
	}
	if runtime.GOOS == "linux" {
		if setupGeteuid() != 0 {
			return errors.New("setting host timezone requires root")
		}
		if _, err := setupLookPath("timedatectl"); err == nil {
			if out, err := setupCommandOutput(ctx, 10*time.Second, "timedatectl", "set-timezone", target); err != nil {
				return fmt.Errorf("timedatectl set-timezone failed: %s", strings.TrimSpace(string(out)))
			}
		} else {
			zonePath := filepath.Join("/usr/share/zoneinfo", filepath.FromSlash(target))
			if _, err := os.Stat(zonePath); err != nil {
				return fmt.Errorf("timezone data not found: %s", zonePath)
			}
			_ = os.Remove("/etc/localtime")
			if err := os.Symlink(zonePath, "/etc/localtime"); err != nil {
				return fmt.Errorf("update /etc/localtime failed: %w", err)
			}
			if err := os.WriteFile("/etc/timezone", []byte(target+"\n"), 0644); err != nil {
				return fmt.Errorf("update /etc/timezone failed: %w", err)
			}
		}
	}
	_ = os.Setenv("TZ", target)
	time.Local = loc
	return nil
}

func setupDNS53Preflight(ctx context.Context, listeners []setupPortListener, autoRemediate bool) setupDNS53Status {
	blockers := dns53Blockers(listeners)
	if len(blockers) == 0 {
		return setupDNS53Status{Status: "ok", Message: "53 端口可用"}
	}
	canRemediate := allSystemdResolvedStub(blockers)
	status := setupDNS53Status{
		Status:       "blocked",
		Message:      "53 端口已被占用",
		Blockers:     blockers,
		CanRemediate: canRemediate,
	}
	if !canRemediate {
		status.Message = "53 端口被未知进程占用，请先释放后再初始化"
		return status
	}
	if !autoRemediate {
		status.Message = "53 端口被 systemd-resolved DNS stub 占用，初始化时可自动修复"
		return status
	}
	if err := remediateSystemdResolvedStub(ctx); err != nil {
		status.Message = "systemd-resolved DNS stub 自动修复失败：" + err.Error()
		return status
	}
	after := collectSetupPortListeners(ctx, []int{53})
	if remaining := filterListeners(after, 53, ""); len(remaining) > 0 {
		status.Blockers = remaining
		status.Message = "systemd-resolved 已尝试修复，但 53 端口仍被占用"
		return status
	}
	status.Status = "remediated"
	status.Message = "已关闭 systemd-resolved DNS stub 并释放 53 端口"
	status.Remediated = true
	status.Blockers = nil
	return status
}

func dns53Blockers(listeners []setupPortListener) []setupPortListener {
	blockers := filterListeners(listeners, 53, "")
	if len(blockers) > 0 || runtime.GOOS != "linux" || setupGeteuid() != 0 {
		return blockers
	}
	for _, proto := range []string{"tcp", "udp"} {
		if err := setupProbePort(proto, 53); err != nil {
			blockers = append(blockers, setupPortListener{Port: 53, Protocol: proto, Address: "0.0.0.0:53", Process: "unknown", Source: "bind_probe"})
		}
	}
	return blockers
}

func remediateSystemdResolvedStub(ctx context.Context) error {
	if runtime.GOOS != "linux" {
		return errors.New("systemd-resolved remediation is only supported on Linux")
	}
	if setupGeteuid() != 0 {
		return errors.New("requires root")
	}
	if _, err := setupLookPath("systemctl"); err != nil {
		return errors.New("systemctl not found")
	}
	if err := os.MkdirAll("/etc/systemd/resolved.conf.d", 0755); err != nil {
		return err
	}
	content := "[Resolve]\nDNSStubListener=no\n"
	if err := os.WriteFile("/etc/systemd/resolved.conf.d/10-msf-disable-stub.conf", []byte(content), 0644); err != nil {
		return err
	}
	if _, err := os.Stat("/run/systemd/resolve/resolv.conf"); err == nil {
		replaceResolvConfSymlink("/run/systemd/resolve/resolv.conf")
	}
	if out, err := setupCommandOutput(ctx, 15*time.Second, "systemctl", "restart", "systemd-resolved"); err != nil {
		return fmt.Errorf("restart systemd-resolved failed: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

func replaceResolvConfSymlink(target string) {
	current, err := os.Readlink("/etc/resolv.conf")
	if err == nil && current == target {
		return
	}
	if err == nil || os.IsNotExist(err) {
		_ = os.Remove("/etc/resolv.conf")
		_ = os.Symlink(target, "/etc/resolv.conf")
		return
	}
	backup := fmt.Sprintf("/etc/resolv.conf.msf-backup-%d", time.Now().Unix())
	if renameErr := os.Rename("/etc/resolv.conf", backup); renameErr == nil {
		_ = os.Symlink(target, "/etc/resolv.conf")
		return
	}
	_ = os.Remove("/etc/resolv.conf")
	_ = os.Symlink(target, "/etc/resolv.conf")
}

func setupReservedPortChecks(ctx context.Context, listeners []setupPortListener) []setupPortCheck {
	ports := setupReservedPorts()
	out := make([]setupPortCheck, 0, len(ports)*2)
	for _, item := range ports {
		for _, proto := range []string{"tcp", "udp"} {
			matched := filterListeners(listeners, item.Port, proto)
			check := setupPortCheck{Port: item.Port, Protocol: proto, Service: item.Service, Status: "free"}
			if len(matched) > 0 {
				check.Status = "occupied"
				check.Listeners = matched
				check.Message = "端口已被监听"
			} else if err := setupProbePort(proto, item.Port); err != nil {
				check.Status = "occupied"
				check.Message = err.Error()
			}
			out = append(out, check)
		}
	}
	return out
}

func setupReservedPorts() []setupReservedPort {
	return []setupReservedPort{
		{2222, "MosDNS forward_1"},
		{3333, "MosDNS forward_nocn"},
		{4444, "MosDNS forward_nocn_ecs"},
		{5656, "MosDNS forward_2"},
		{6666, "Mihomo DNS"},
		{8888, "MosDNS for_singbox"},
		{9099, "MosDNS API"},
		{9090, "Mihomo external controller"},
		{7890, "Mihomo HTTP proxy"},
		{7891, "Mihomo SOCKS proxy"},
		{7892, "Mihomo mixed proxy"},
		{7896, "Mihomo TProxy"},
		{7897, "reserved compatibility port"},
		{7877, "Mihomo redirect"},
	}
}

func setupAllCheckedPorts() []int {
	seen := map[int]bool{53: true}
	out := []int{53}
	for _, item := range setupReservedPorts() {
		if !seen[item.Port] {
			out = append(out, item.Port)
			seen[item.Port] = true
		}
	}
	sort.Ints(out)
	return out
}

func collectSetupPortListeners(ctx context.Context, ports []int) []setupPortListener {
	var listeners []setupPortListener
	if out, err := setupCommandOutput(ctx, 5*time.Second, "ss", "-H", "-lntup"); err == nil {
		listeners = append(listeners, parseSSListeners(string(out), "tcp", ports)...)
	}
	if out, err := setupCommandOutput(ctx, 5*time.Second, "ss", "-H", "-lnuap"); err == nil {
		listeners = append(listeners, parseSSListeners(string(out), "udp", ports)...)
	}
	if len(listeners) == 0 {
		for _, port := range ports {
			if out, err := setupCommandOutput(ctx, 3*time.Second, "lsof", "-nP", "-iTCP:"+strconv.Itoa(port), "-sTCP:LISTEN"); err == nil {
				listeners = append(listeners, parseLSOFListeners(string(out), "tcp", port)...)
			}
			if out, err := setupCommandOutput(ctx, 3*time.Second, "lsof", "-nP", "-iUDP:"+strconv.Itoa(port)); err == nil {
				listeners = append(listeners, parseLSOFListeners(string(out), "udp", port)...)
			}
		}
	}
	return dedupeSetupListeners(listeners)
}

func parseSSListeners(output, fallbackProtocol string, ports []int) []setupPortListener {
	portSet := map[int]bool{}
	for _, p := range ports {
		portSet[p] = true
	}
	var out []setupPortListener
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}
		proto := strings.ToLower(fields[0])
		if proto != "tcp" && proto != "udp" {
			proto = fallbackProtocol
		}
		local := ""
		port := 0
		for _, field := range fields[3:] {
			if p, ok := parsePortFromAddress(field); ok && portSet[p] {
				local = field
				port = p
				break
			}
		}
		if port == 0 {
			continue
		}
		process, pid := parseSSProcess(line)
		out = append(out, setupPortListener{Port: port, Protocol: proto, Address: local, PID: pid, Process: process, Source: "ss"})
	}
	return out
}

func parseLSOFListeners(output, protocol string, port int) []setupPortListener {
	var out []setupPortListener
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "COMMAND ") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		pid, _ := strconv.Atoi(fields[1])
		address := fields[len(fields)-1]
		out = append(out, setupPortListener{Port: port, Protocol: protocol, Address: address, PID: pid, Process: fields[0], Source: "lsof"})
	}
	return out
}

func parsePortFromAddress(value string) (int, bool) {
	value = strings.Trim(value, "[]")
	idx := strings.LastIndex(value, ":")
	if idx < 0 || idx == len(value)-1 {
		return 0, false
	}
	raw := strings.Trim(value[idx+1:], "[]")
	if raw == "*" {
		return 0, false
	}
	port, err := strconv.Atoi(raw)
	return port, err == nil
}

var ssProcessPattern = regexp.MustCompile(`"([^"]+)",pid=([0-9]+)`)

func parseSSProcess(line string) (string, int) {
	match := ssProcessPattern.FindStringSubmatch(line)
	if len(match) != 3 {
		return "", 0
	}
	pid, _ := strconv.Atoi(match[2])
	return match[1], pid
}

func dedupeSetupListeners(items []setupPortListener) []setupPortListener {
	seen := map[string]bool{}
	out := make([]setupPortListener, 0, len(items))
	for _, item := range items {
		key := fmt.Sprintf("%s/%d/%s/%d/%s", item.Protocol, item.Port, item.Address, item.PID, item.Process)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, item)
	}
	return out
}

func filterListeners(items []setupPortListener, port int, protocol string) []setupPortListener {
	var out []setupPortListener
	for _, item := range items {
		if item.Port != port {
			continue
		}
		if protocol != "" && item.Protocol != protocol {
			continue
		}
		out = append(out, item)
	}
	return out
}

func allSystemdResolvedStub(items []setupPortListener) bool {
	if len(items) == 0 {
		return false
	}
	for _, item := range items {
		name := strings.ToLower(item.Process)
		if !strings.Contains(name, "systemd-resolve") && !strings.Contains(name, "systemd-resolved") && !strings.Contains(name, "systemd-r") {
			return false
		}
		addr := item.Address
		if addr != "" && !strings.Contains(addr, "127.0.0.53") && !strings.Contains(addr, "127.0.0.54") && !strings.Contains(addr, "[::1]") && !strings.Contains(addr, "localhost") {
			return false
		}
	}
	return true
}

func probeSetupPort(protocol string, port int) error {
	address := "0.0.0.0:" + strconv.Itoa(port)
	if protocol == "tcp" {
		ln, err := net.Listen("tcp", address)
		if err != nil {
			return err
		}
		return ln.Close()
	}
	pc, err := net.ListenPacket("udp", address)
	if err != nil {
		return err
	}
	return pc.Close()
}
