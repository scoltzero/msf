package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

func (a *App) handleMonitorSystem(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": a.monitorSystemSnapshot()})
}

func (a *App) handleMonitorHardware(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": a.monitorHardwareSnapshot()})
}

func (a *App) handleMonitorResources(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": a.monitorResourceSnapshot()})
}

func (a *App) handleMonitorNetwork(w http.ResponseWriter, r *http.Request) {
	data := a.monitorNetworkSnapshot(time.Now())
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "interfaces": data["local_ips"], "data": data})
}

func (a *App) handleMonitorHistory(w http.ResponseWriter, r *http.Request) {
	mem := readMemInfo()
	now := time.Now()
	point := map[string]any{
		"time":           now.Format(time.RFC3339),
		"timestamp":      now.Unix(),
		"cpu_percent":    sampleCPUPercent(),
		"memory_percent": percent(mem["MemTotal"]-mem["MemAvailable"], mem["MemTotal"]),
		"network":        readNetworkCounters(),
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": []any{point}})
}

func (a *App) handleMonitorStats(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": a.monitorPayload()})
}

func (a *App) handleDiagnostics(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.diagnosticsPayload())
}

func (a *App) handleDiagnosticsRun(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.diagnosticsPayload())
}

func (a *App) handleDiagnosticsDownload(w http.ResponseWriter, r *http.Request) {
	payload := a.diagnosticsPayload()
	b, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "json_error", err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=msf-diagnostics.json")
	_, _ = w.Write(b)
}

func (a *App) diagnosticsPayload() map[string]any {
	configDirOK := dirReadable(filepath.Join(a.DataDir, "configs"))
	configFiles := a.validateConfigFiles()
	deps := dependencyChecks()
	ports := diagnosticPortRows()
	disk := diskUsage(a.DataDir)
	diskOK := diskHealthy(disk)
	permissionsOK := dirWritable(a.DataDir) && dirWritable(filepath.Join(a.DataDir, "logs")) && dirWritable(filepath.Join(a.DataDir, "configs"))
	checks := []map[string]any{
		{"name": "配置目录", "key": "config_dir", "ok": configDirOK, "message": boolMessage(configDirOK, "配置目录存在且可访问", "配置目录缺失或不可访问"), "details": filepath.Join(a.DataDir, "configs")},
		{"name": "配置文件", "key": "config_files", "ok": configFiles["ok"], "message": configFiles["message"], "details": configFiles["details"]},
		{"name": "依赖项", "key": "dependencies", "ok": deps["ok"], "message": deps["message"], "details": deps["details"]},
		{"name": "端口占用", "key": "ports", "ok": true, "message": fmt.Sprintf("已检查 %d 个端口", len(ports)), "details": ports},
		{"name": "磁盘空间", "key": "disk", "ok": diskOK, "message": boolMessage(diskOK, "磁盘空间充足", "磁盘空间不足或无法读取"), "details": disk},
		{"name": "文件权限", "key": "permissions", "ok": permissionsOK, "message": boolMessage(permissionsOK, "具有必要的读写权限", "缺少必要的读写权限"), "details": map[string]any{"data_dir": a.DataDir}},
	}
	summary := diagnosticSummary(checks)
	uiChecks := diagnosticUIChecks(checks)
	overallStatus := diagnosticOverallStatus(uiChecks)
	systemInfo := map[string]any{"os": runtime.GOOS, "arch": runtime.GOARCH, "go_version": runtime.Version(), "cpu_cores": runtime.NumCPU(), "pid": os.Getpid(), "uid": os.Getuid(), "euid": os.Geteuid(), "is_root": fmt.Sprintf("%t", os.Geteuid() == 0), "version": a.Version, "data_dir": a.DataDir}
	data := map[string]any{
		"checks":         uiChecks,
		"raw_checks":     checks,
		"summary":        summary,
		"overall_status": overallStatus,
		"ports":          ports,
		"dependencies":   deps,
		"disk":           disk,
		"network":        readNetworkCounters(),
		"system":         systemInfo,
		"system_info":    systemInfo,
	}
	return map[string]any{"success": true, "checks": uiChecks, "raw_checks": checks, "summary": summary, "overall_status": overallStatus, "system_info": systemInfo, "ports": ports, "data": data}
}

func (a *App) handleNetworkInfo(w http.ResponseWriter, r *http.Request) {
	content, _ := a.readTextFile("configs/network/network.yaml")
	data := a.networkInfoPayload(content)
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data":    data,
		"config":  content,
		"nft":     data["nft"],
	})
}

func (a *App) networkInfoPayload(content string) map[string]any {
	var cfg map[string]any
	_ = yaml.Unmarshal([]byte(content), &cfg)
	setup, _ := a.latestSetupConfig()
	iface := firstNonEmpty(stringMapValue(cfg, "interface"), setup.SelectedInterface, defaultSetupInterface())
	localIP := primaryIPForInterface(iface)
	if localIP == "" {
		ips := localIPs()
		if len(ips) > 0 {
			localIP = ips[0]
		}
	}
	nftPath := filepath.Join(a.DataDir, "configs/network/network.nft")
	interfaces := networkInterfaceSummaries()
	domesticExit, internationalExit := a.networkExitInfo()
	return map[string]any{
		"config":             content,
		"nft":                fileExists(nftPath),
		"nft_enabled":        fileExists(nftPath),
		"interface":          iface,
		"selected_interface": iface,
		"localIP":            localIP,
		"local_ip":           localIP,
		"localIPs":           localIPs(),
		"local_ips":          localIPs(),
		"interfaces":         interfaces,
		"ipip":               domesticExit,
		"ipsb":               internationalExit,
		"domestic":           domesticExit,
		"international":      internationalExit,
		"china_exit":         domesticExit,
		"global_exit":        internationalExit,
	}
}

const networkExitProbeTimeout = 3500 * time.Millisecond

var ipipTextPattern = regexp.MustCompile(`(?i)(?:当前\s*)?IP[：:\s]+([0-9a-f:.]+)\s+来自于[：:\s]*(.+)`)

func (a *App) networkExitInfo() (map[string]any, map[string]any) {
	var wg sync.WaitGroup
	var domestic map[string]any
	var international map[string]any
	wg.Add(2)
	go func() {
		defer wg.Done()
		domestic = probeDomesticExit()
	}()
	go func() {
		defer wg.Done()
		international = probeInternationalExit()
	}()
	wg.Wait()
	return domestic, international
}

func probeDomesticExit() map[string]any {
	client := networkExitHTTPClient(networkExitProbeTimeout)
	var lastErr error
	for _, endpoint := range []string{"https://myip.ipip.net", "http://myip.ipip.net"} {
		body, err := fetchExitBody(client, endpoint)
		if err != nil {
			lastErr = err
			continue
		}
		info, err := parseIPIPExitText(string(body))
		if err != nil {
			lastErr = err
			continue
		}
		info["source"] = "myip.ipip.net"
		info["via"] = "direct"
		info["success"] = true
		return info
	}
	return exitProbeError("myip.ipip.net", "direct", lastErr)
}

func probeInternationalExit() map[string]any {
	client := networkExitHTTPClient(networkExitProbeTimeout)
	info, err := fetchInternationalExit(client)
	if err != nil {
		return exitProbeError("api.ip.sb", "direct", err)
	}
	info["via"] = "direct"
	info["success"] = true
	return info
}

func fetchInternationalExit(client *http.Client) (map[string]any, error) {
	var lastErr error
	for _, endpoint := range []string{"https://api.ip.sb/geoip", "https://ipinfo.io/json", "https://ifconfig.co/json"} {
		body, err := fetchExitBody(client, endpoint)
		if err != nil {
			lastErr = err
			continue
		}
		var payload map[string]any
		if err := json.Unmarshal(body, &payload); err != nil {
			lastErr = err
			continue
		}
		info := normalizeInternationalExit(payload)
		if info["ip"] == "" && info["location"] == "" {
			lastErr = fmt.Errorf("%s returned incomplete exit data", endpoint)
			continue
		}
		info["source"] = endpoint
		return info, nil
	}
	return nil, lastErr
}

func networkExitHTTPClient(timeout time.Duration) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	return &http.Client{Timeout: timeout, Transport: transport}
}

func fetchExitBody(client *http.Client, endpoint string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), networkExitProbeTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json,text/plain,*/*")
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; msf/exit-probe)")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("%s returned HTTP %d", endpoint, resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 1<<20))
}

func parseIPIPExitText(text string) (map[string]any, error) {
	text = strings.TrimSpace(text)
	matches := ipipTextPattern.FindStringSubmatch(text)
	if len(matches) < 3 {
		return nil, fmt.Errorf("unexpected ipip response: %s", text)
	}
	ip := strings.TrimSpace(matches[1])
	location := normalizeSpace(matches[2])
	parts := strings.Fields(location)
	info := map[string]any{
		"ip":         ip,
		"public_ip":  ip,
		"address_ip": ip,
		"location":   location,
		"address":    location,
	}
	if len(parts) > 0 {
		info["country"] = parts[0]
	}
	if len(parts) > 1 {
		info["province"] = parts[1]
	}
	if len(parts) > 2 {
		info["city"] = parts[2]
	}
	if len(parts) > 3 {
		info["isp"] = strings.Join(parts[3:], " ")
	}
	return info, nil
}

func normalizeInternationalExit(data map[string]any) map[string]any {
	ip := firstNonEmpty(
		mapStringAny(data, "ip"),
		mapStringAny(data, "query"),
		mapStringAny(data, "address"),
	)
	country := firstNonEmpty(mapStringAny(data, "country"), mapStringAny(data, "country_name"), mapStringAny(data, "country_iso"))
	region := firstNonEmpty(mapStringAny(data, "region"), mapStringAny(data, "region_name"))
	city := mapStringAny(data, "city")
	isp := firstNonEmpty(
		mapStringAny(data, "isp"),
		mapStringAny(data, "organization"),
		mapStringAny(data, "org"),
		mapStringAny(data, "asn_org"),
		mapStringAny(data, "asn_organization"),
	)
	location := normalizeSpace(strings.Join(nonEmptyStrings(country, isp), " "))
	if location == "" {
		location = normalizeSpace(strings.Join(nonEmptyStrings(country, region, city), " "))
	}
	return map[string]any{
		"ip":         ip,
		"public_ip":  ip,
		"address_ip": ip,
		"location":   location,
		"address":    location,
		"country":    country,
		"region":     region,
		"city":       city,
		"isp":        isp,
	}
}

func exitProbeError(source, via string, err error) map[string]any {
	message := "exit probe failed"
	if err != nil {
		message = err.Error()
	}
	return map[string]any{
		"location": "未获取",
		"address":  "未获取",
		"ip":       "",
		"source":   source,
		"via":      via,
		"success":  false,
		"error":    message,
	}
}

func normalizeSpace(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

func mapStringAny(m map[string]any, key string) string {
	value, ok := m[key]
	if !ok || value == nil {
		return ""
	}
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	case float64:
		if v == float64(int64(v)) {
			return strconv.FormatInt(int64(v), 10)
		}
		return strconv.FormatFloat(v, 'f', -1, 64)
	case int:
		return strconv.Itoa(v)
	case int64:
		return strconv.FormatInt(v, 10)
	default:
		return strings.TrimSpace(fmt.Sprint(v))
	}
}

func nonEmptyStrings(values ...string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func primaryIPForInterface(name string) string {
	if name == "" {
		return ""
	}
	iface, err := net.InterfaceByName(name)
	if err != nil {
		return ""
	}
	addrs, _ := iface.Addrs()
	var values []string
	for _, addr := range addrs {
		values = append(values, addr.String())
	}
	return primaryInterfaceIP(values)
}

func networkInterfaceSummaries() []map[string]any {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	out := make([]map[string]any, 0, len(ifaces))
	for _, iface := range ifaces {
		addrs, _ := iface.Addrs()
		var values []string
		for _, addr := range addrs {
			values = append(values, addr.String())
		}
		ip := primaryInterfaceIP(values)
		out = append(out, map[string]any{
			"name":        iface.Name,
			"index":       iface.Index,
			"mac":         iface.HardwareAddr.String(),
			"flags":       iface.Flags.String(),
			"is_up":       iface.Flags&net.FlagUp != 0,
			"is_loopback": iface.Flags&net.FlagLoopback != 0,
			"addresses":   values,
			"ip":          ip,
			"primary_ip":  ip,
		})
	}
	return out
}

func (a *App) handleNFTInfo(w http.ResponseWriter, r *http.Request) {
	content, _ := a.readTextFile("configs/network/network.nft")
	status := a.nftStatus()
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "enabled": fileExists(a.DataDir + "/configs/network/network.nft"), "config": content, "status": status})
}

func (a *App) handleNFTStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": a.nftStatus()})
}

func (a *App) handleNFTApply(w http.ResponseWriter, r *http.Request) {
	output, err := a.applyNFT(r.Context())
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"success": false, "error": err.Error(), "output": output, "data": a.nftStatus()})
		return
	}
	a.setSetting(nftDesiredKey, "true")
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "output": output, "data": a.nftStatus()})
}

func (a *App) applyNFT(ctx context.Context) (string, error) {
	if runtime.GOOS != "linux" {
		return "", fmt.Errorf("nftables is only supported on Linux")
	}
	if os.Geteuid() != 0 {
		return "", fmt.Errorf("root permission is required to apply nftables and policy routing")
	}
	nftPath := filepath.Join(a.DataDir, "configs/network/network.nft")
	if _, err := os.Stat(nftPath); err != nil {
		return "", fmt.Errorf("nftables config is missing: %s", nftPath)
	}
	if err := sanitizeNFTConfigFile(nftPath); err != nil {
		return "", err
	}
	var output bytes.Buffer
	ignoreNetworkCommandError(ctx, &output, 8*time.Second, "nft", "delete", "table", "inet", "msf")
	cmds := [][]string{{"nft", "-f", nftPath}}
	runNetworkCommandsIgnoringErrors(ctx, &output, 8*time.Second, policyRouteRuleDeleteCommands())
	cmds = append(cmds, policyRouteInstallCommands()...)
	for _, args := range cmds {
		if err := runNetworkCommand(ctx, &output, 8*time.Second, args...); err != nil {
			return output.String(), err
		}
	}
	return output.String(), nil
}

func policyRouteRuleDeleteCommands() [][]string {
	const attemptsPerFamily = 16
	var cmds [][]string
	for i := 0; i < attemptsPerFamily; i++ {
		cmds = append(cmds, []string{"ip", "rule", "del", "fwmark", "1", "table", "100"})
	}
	for i := 0; i < attemptsPerFamily; i++ {
		cmds = append(cmds, []string{"ip", "-6", "rule", "del", "fwmark", "1", "table", "100"})
	}
	return cmds
}

func policyRouteInstallCommands() [][]string {
	return [][]string{
		{"ip", "rule", "add", "fwmark", "1", "table", "100"},
		{"ip", "route", "replace", "local", "0.0.0.0/0", "dev", "lo", "table", "100"},
		{"ip", "-6", "rule", "add", "fwmark", "1", "table", "100"},
		{"ip", "-6", "route", "replace", "local", "::/0", "dev", "lo", "table", "100"},
	}
}

func policyRouteClearCommands() [][]string {
	cmds := policyRouteRuleDeleteCommands()
	cmds = append(cmds,
		[]string{"ip", "route", "del", "local", "0.0.0.0/0", "dev", "lo", "table", "100"},
		[]string{"ip", "-6", "route", "del", "local", "::/0", "dev", "lo", "table", "100"},
	)
	return cmds
}

func runNetworkCommand(ctx context.Context, output *bytes.Buffer, timeout time.Duration, args ...string) error {
	if len(args) == 0 {
		return nil
	}
	out, err := combinedOutputWithTimeout(ctx, timeout, args[0], args[1:]...)
	appendCommandOutput(output, out)
	if err != nil {
		return fmt.Errorf("%s: %w", strings.Join(args, " "), err)
	}
	return nil
}

func ignoreNetworkCommandError(ctx context.Context, output *bytes.Buffer, timeout time.Duration, args ...string) {
	if len(args) == 0 {
		return
	}
	out, _ := combinedOutputWithTimeout(ctx, timeout, args[0], args[1:]...)
	appendCommandOutput(output, out)
}

func appendCommandOutput(output *bytes.Buffer, out []byte) {
	if len(out) == 0 {
		return
	}
	output.Write(out)
	if output.Len() > 0 && !bytes.HasSuffix(output.Bytes(), []byte("\n")) {
		output.WriteByte('\n')
	}
}

func runNetworkCommandsIgnoringErrors(ctx context.Context, output *bytes.Buffer, timeout time.Duration, cmds [][]string) {
	for _, args := range cmds {
		ignoreNetworkCommandError(ctx, output, timeout, args...)
	}
}

func sanitizeNFTConfigFile(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	sanitized := stripGlobalNFTRulesetFlush(string(raw))
	if sanitized == string(raw) {
		return nil
	}
	return os.WriteFile(path, []byte(sanitized), info.Mode())
}

func stripGlobalNFTRulesetFlush(text string) string {
	var out strings.Builder
	for _, line := range strings.SplitAfter(text, "\n") {
		if strings.EqualFold(strings.TrimSpace(line), "flush ruleset") {
			continue
		}
		out.WriteString(line)
	}
	return out.String()
}

func (a *App) handleNFTClear(w http.ResponseWriter, r *http.Request) {
	output, err := a.clearNFT(r.Context())
	a.setSetting(nftDesiredKey, "false")
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"success": false, "error": err.Error(), "output": output, "data": a.nftStatus()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "output": output, "data": a.nftStatus()})
}

func (a *App) clearNFT(ctx context.Context) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if runtime.GOOS != "linux" {
		return "", fmt.Errorf("nftables is only supported on Linux")
	}
	if os.Geteuid() != 0 {
		return "", fmt.Errorf("root permission is required to clear nftables and policy routing")
	}
	var output bytes.Buffer
	ignoreNetworkCommandError(ctx, &output, 5*time.Second, "nft", "delete", "table", "inet", "msf")
	runNetworkCommandsIgnoringErrors(ctx, &output, 5*time.Second, policyRouteClearCommands())
	if err := ctx.Err(); err != nil {
		return output.String(), err
	}
	if residual := managedNetworkStateResidual(ctx); len(residual) > 0 {
		return output.String(), fmt.Errorf("managed network state remains after cleanup: %s", strings.Join(residual, "; "))
	}
	return output.String(), nil
}

func managedNetworkStateResidual(ctx context.Context) []string {
	var residual []string
	if _, err := combinedOutputWithTimeout(ctx, 3*time.Second, "nft", "list", "table", "inet", "msf"); err == nil {
		residual = append(residual, "table inet msf")
	}
	for _, check := range []struct {
		args []string
		kind string
	}{
		{args: []string{"rule", "show"}, kind: "IPv4 fwmark rule"},
		{args: []string{"-6", "rule", "show"}, kind: "IPv6 fwmark rule"},
	} {
		if out, err := combinedOutputWithTimeout(ctx, 3*time.Second, "ip", check.args...); err == nil && containsManagedPolicyRule(string(out)) {
			residual = append(residual, check.kind)
		}
	}
	for _, check := range []struct {
		args []string
		kind string
	}{
		{args: []string{"route", "show", "table", "100"}, kind: "IPv4 table 100 local route"},
		{args: []string{"-6", "route", "show", "table", "100"}, kind: "IPv6 table 100 local route"},
	} {
		if out, err := combinedOutputWithTimeout(ctx, 3*time.Second, "ip", check.args...); err == nil && containsManagedLocalRoute(string(out)) {
			residual = append(residual, check.kind)
		}
	}
	return residual
}

func containsManagedPolicyRule(output string) bool {
	for _, line := range strings.Split(strings.ToLower(output), "\n") {
		fields := strings.Fields(line)
		hasMark := false
		hasTable := false
		for index := 0; index+1 < len(fields); index++ {
			switch fields[index] {
			case "fwmark":
				mark := fields[index+1]
				hasMark = mark == "1" || mark == "0x1" || strings.HasPrefix(mark, "0x1/")
			case "lookup", "table":
				hasTable = fields[index+1] == "100"
			}
		}
		if hasMark && hasTable {
			return true
		}
	}
	return false
}

func containsManagedLocalRoute(output string) bool {
	for _, line := range strings.Split(strings.ToLower(output), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "local ") && strings.Contains(line, " dev lo") &&
			(strings.Contains(line, "default") || strings.Contains(line, "0.0.0.0/0") || strings.Contains(line, "::/0")) {
			return true
		}
	}
	return false
}

func (a *App) nftStatus() map[string]any {
	status := map[string]any{"supported": runtime.GOOS == "linux", "is_root": os.Geteuid() == 0, "table_loaded": false, "rule_loaded": false}
	if runtime.GOOS != "linux" {
		return status
	}
	if out, err := combinedOutputWithTimeout(context.Background(), 3*time.Second, "nft", "list", "table", "inet", "msf"); err == nil {
		status["table_loaded"] = true
		status["nft"] = string(out)
	}
	if out, err := combinedOutputWithTimeout(context.Background(), 3*time.Second, "ip", "rule", "show"); err == nil {
		text := string(out)
		status["rule_loaded"] = strings.Contains(text, "fwmark 0x1") && strings.Contains(text, "lookup 100")
		status["ip_rules"] = text
	}
	return status
}

func combinedOutputWithTimeout(ctx context.Context, timeout time.Duration, name string, args ...string) ([]byte, error) {
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(cmdCtx, name, args...)
	out, err := cmd.CombinedOutput()
	if cmdCtx.Err() == context.DeadlineExceeded {
		return out, fmt.Errorf("%s %s timed out after %s", name, strings.Join(args, " "), timeout)
	}
	return out, err
}

func (a *App) handleSettingsGet(w http.ResponseWriter, r *http.Request) {
	rows, err := a.DB.Query(`select key,value from settings`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	settings := map[string]string{}
	for rows.Next() {
		var k, v string
		_ = rows.Scan(&k, &v)
		settings[k] = v
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "settings": settings, "data": settings})
}

func (a *App) handleSettingsPut(w http.ResponseWriter, r *http.Request) {
	var raw map[string]any
	if err := decodeJSON(r, &raw); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	for k, value := range raw {
		v := fmtAny(value)
		_, _ = a.DB.Exec(`insert or replace into settings(key,value,updated_at) values(?,?,?)`, k, v, nowString())
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (a *App) handleSettingsProfileGet(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	if u == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "请提供认证令牌")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": u, "user": u})
}

func (a *App) handleSettingsProfilePut(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	if u == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "请提供认证令牌")
		return
	}
	var req struct {
		Email       string `json:"email"`
		DisplayName string `json:"display_name"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	_, err := a.DB.Exec(`update users set email=?,display_name=?,updated_at=? where id=?`, req.Email, req.DisplayName, time.Now(), u.ID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "update_failed", err.Error())
		return
	}
	updated, _ := a.userByID(u.ID)
	a.audit(u, "settings.profile.update", "settings", "", true, "")
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": updated, "user": updated})
}

func (a *App) handleSettingsAppearanceGet(w http.ResponseWriter, r *http.Request) {
	appearance := map[string]string{
		"theme":        a.setting("appearance.theme", a.setting("theme", "system")),
		"language":     a.setting("appearance.language", a.setting("language", "zh-CN")),
		"compact":      a.setting("appearance.compact", "false"),
		"menu_order":   a.setting("appearance.menu_order", ""),
		"accent_color": a.setting("appearance.accent_color", ""),
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": appearance, "appearance": appearance})
}

func (a *App) handleSettingsAppearancePut(w http.ResponseWriter, r *http.Request) {
	var req map[string]any
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	for key, value := range req {
		if key == "" {
			continue
		}
		a.setSetting("appearance."+key, fmtAny(value))
	}
	a.audit(currentUser(r), "settings.appearance.update", "settings", "", true, "")
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": req})
}

func (a *App) handleLicenseStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]any{
		"edition": "free", "status": "unlocked", "is_pro": true, "features": "all", "message": "msf does not enforce paid licensing",
	}})
}

func (a *App) handleHardwareFingerprint(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "fingerprint": tokenHash(hostname() + runtime.GOOS + runtime.GOARCH)})
}

func (a *App) handleLicenseNoop(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "status": "unlocked"})
}

func readMemInfo() map[string]uint64 {
	out := map[string]uint64{"MemTotal": 0, "MemAvailable": 0}
	b, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return out
	}
	for _, line := range strings.Split(string(b), "\n") {
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		key := strings.TrimSuffix(parts[0], ":")
		if key == "MemTotal" || key == "MemAvailable" {
			v, _ := strconv.ParseUint(parts[1], 10, 64)
			out[key] = v * 1024
		}
	}
	return out
}

func percent(used, total uint64) float64 {
	if total == 0 {
		return 0
	}
	return float64(used) * 100 / float64(total)
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func dirReadable(path string) bool {
	entries, err := os.ReadDir(path)
	return err == nil && entries != nil
}

func dirWritable(path string) bool {
	if err := os.MkdirAll(path, 0755); err != nil {
		return false
	}
	tmp := filepath.Join(path, ".msf-write-test")
	if err := os.WriteFile(tmp, []byte("ok"), 0644); err != nil {
		return false
	}
	_ = os.Remove(tmp)
	return true
}

func (a *App) validateConfigFiles() map[string]any {
	root := filepath.Join(a.DataDir, "configs")
	total := 0
	errors := []map[string]string{}
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if ext != ".yaml" && ext != ".yml" && ext != ".json" {
			return nil
		}
		total++
		b, err := os.ReadFile(path)
		if err != nil {
			errors = append(errors, map[string]string{"path": path, "error": err.Error()})
			return nil
		}
		var decoded any
		if ext == ".json" {
			err = json.Unmarshal(b, &decoded)
		} else {
			err = yaml.Unmarshal(b, &decoded)
		}
		if err != nil {
			errors = append(errors, map[string]string{"path": path, "error": err.Error()})
		}
		return nil
	})
	ok := len(errors) == 0
	return map[string]any{"ok": ok, "message": boolMessage(ok, "配置文件有效", fmt.Sprintf("发现 %d 个配置错误", len(errors))), "details": map[string]any{"total": total, "errors": errors}}
}

func dependencyChecks() map[string]any {
	names := []string{"nft", "ip", "curl", "tar", "unzip", "gzip"}
	var details []map[string]any
	okCount := 0
	for _, name := range names {
		path, err := exec.LookPath(name)
		ok := err == nil
		if ok {
			okCount++
		}
		details = append(details, map[string]any{"name": name, "ok": ok, "path": path})
	}
	allOK := okCount == len(names)
	return map[string]any{"ok": allOK, "message": fmt.Sprintf("依赖检查通过 %d/%d", okCount, len(names)), "details": details}
}

func diagnosticSummary(checks []map[string]any) map[string]any {
	passed := 0
	failed := 0
	warnings := 0
	for _, check := range checks {
		if check["ok"] == true {
			passed++
		} else {
			failed++
		}
	}
	total := len(checks)
	return map[string]any{"total": total, "passed": passed, "failed": failed, "warnings": warnings, "pass_rate": percent(uint64(passed), uint64(total))}
}

func diagnosticUIChecks(checks []map[string]any) []map[string]any {
	rows := make([]map[string]any, 0, len(checks))
	for _, check := range checks {
		ok := check["ok"] == true
		status := "error"
		if ok {
			status = "success"
		}
		key := fmtAny(check["key"])
		if !ok && key == "dependencies" {
			status = "warning"
		}
		rows = append(rows, map[string]any{
			"name":        fmtAny(check["name"]),
			"key":         key,
			"ok":          ok,
			"status":      status,
			"message":     fmtAny(check["message"]),
			"details":     diagnosticDetailsText(check["details"]),
			"raw_details": check["details"],
		})
	}
	return rows
}

func diagnosticOverallStatus(checks []map[string]any) string {
	hasWarning := false
	for _, check := range checks {
		switch fmtAny(check["status"]) {
		case "error":
			return "critical"
		case "warning":
			hasWarning = true
		}
	}
	if hasWarning {
		return "warning"
	}
	return "healthy"
}

func diagnosticDetailsText(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	case []byte:
		return string(v)
	default:
		if b, err := json.MarshalIndent(v, "", "  "); err == nil {
			return string(b)
		}
		return fmtAny(v)
	}
}

func boolMessage(ok bool, good, bad string) string {
	if ok {
		return good
	}
	return bad
}

func diskHealthy(disk map[string]any) bool {
	value, ok := disk["percent"].(float64)
	return disk["ok"] == true && ok && value < 95
}
