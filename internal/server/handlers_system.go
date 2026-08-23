package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
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
	memUsed := uint64(0)
	if mem["MemTotal"] >= mem["MemAvailable"] {
		memUsed = mem["MemTotal"] - mem["MemAvailable"]
	}
	network := a.monitorNetworkSnapshot(now)
	point := map[string]any{
		"time":             now.Format(time.RFC3339),
		"timestamp":        now.Unix(),
		"cpu_percent":      sampleCPUPercent(),
		"memory_percent":   percent(memUsed, mem["MemTotal"]),
		"network":          network,
		"download_speed":   network["download_speed"],
		"upload_speed":     network["upload_speed"],
		"connections":      network["connections"],
		"connection_count": network["connection_count"],
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": []any{point}})
}

func (a *App) handleMonitorStats(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": a.monitorPayload()})
}

func (a *App) handleDiagnostics(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusMethodNotAllowed, map[string]any{
		"success": false,
		"error":   "diagnostics are one-shot; use POST /api/v1/system/diagnostics/run",
	})
}

func (a *App) handleDiagnosticsRun(w http.ResponseWriter, r *http.Request) {
	if !strings.Contains(strings.ToLower(r.Header.Get("Accept")), "application/x-ndjson") {
		writeJSON(w, http.StatusOK, a.runLocalLoopDiagnostics(r.Context(), nil))
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "stream_unavailable", "streaming is unavailable")
		return
	}
	w.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	encoder := json.NewEncoder(w)
	_ = encoder.Encode(map[string]any{"type": "run_started", "scope": "local_host_loop"})
	flusher.Flush()
	result := a.runLocalLoopDiagnostics(r.Context(), func(check localLoopCheck) {
		_ = encoder.Encode(map[string]any{"type": "check_completed", "check": check})
		flusher.Flush()
	})
	_ = encoder.Encode(map[string]any{"type": "run_completed", "result": result})
	flusher.Flush()
}

func (a *App) handleDiagnosticsDownload(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusGone, map[string]any{"success": false, "error": "diagnostic results are temporary; download the current result from the browser"})
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
		international = a.probeInternationalExit()
	}()
	wg.Wait()
	return domestic, international
}

func probeDomesticExit() map[string]any {
	client := networkExitHTTPClient(networkExitProbeTimeout, nil)
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

func (a *App) probeInternationalExit() map[string]any {
	proxyURL, err := a.mihomoExitProxyURL()
	if err != nil {
		return exitProbeError("api.ip.sb", "mihomo", err)
	}
	client := networkExitHTTPClient(networkExitProbeTimeout, proxyURL)
	info, err := fetchInternationalExit(client)
	if err != nil {
		return exitProbeError("api.ip.sb", "mihomo", err)
	}
	info["via"] = "mihomo"
	info["proxy"] = proxyURL.String()
	info["success"] = true
	return info
}

func (a *App) mihomoExitProxyURL() (*url.URL, error) {
	cfg := a.mihomoConfigMap()
	port := intMapValue(cfg, "mixed-port", 0)
	if port <= 0 {
		port = intMapValue(cfg, "port", 0)
	}
	if port <= 0 || port > 65535 {
		return nil, fmt.Errorf("mihomo HTTP/mixed proxy port is not configured")
	}
	return url.Parse(fmt.Sprintf("http://127.0.0.1:%d", port))
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

func networkExitHTTPClient(timeout time.Duration, proxyURL *url.URL) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	if proxyURL != nil {
		transport.Proxy = http.ProxyURL(proxyURL)
	}
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
	runNetworkCommandsIgnoringErrors(ctx, &output, 8*time.Second, policyRouteReconcileDeleteCommands())
	enableIPv6 := false
	if cfg, ok := a.latestSetupConfig(); ok {
		cfg.defaults()
		enableIPv6 = cfg.EnableIPv6
	}
	cmds = append(cmds, policyRouteInstallCommands(enableIPv6)...)
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

func policyRouteInstallCommands(enableIPv6 bool) [][]string {
	cmds := [][]string{
		{"ip", "rule", "add", "fwmark", "1", "table", "100"},
		{"ip", "route", "replace", "local", "0.0.0.0/0", "dev", "lo", "table", "100"},
	}
	if enableIPv6 {
		cmds = append(cmds,
			[]string{"ip", "-6", "rule", "add", "fwmark", "1", "table", "100"},
			[]string{"ip", "-6", "route", "replace", "local", "::/0", "dev", "lo", "table", "100"},
		)
	}
	return cmds
}

func policyRouteRouteDeleteCommands() [][]string {
	return [][]string{
		{"ip", "route", "del", "local", "0.0.0.0/0", "dev", "lo", "table", "100"},
		{"ip", "-6", "route", "del", "local", "::/0", "dev", "lo", "table", "100"},
	}
}

func policyRouteReconcileDeleteCommands() [][]string {
	cmds := policyRouteRuleDeleteCommands()
	return append(cmds, policyRouteRouteDeleteCommands()...)
}

func policyRouteClearCommands() [][]string {
	return policyRouteReconcileDeleteCommands()
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
	appearance := a.appearanceSettingsPayload()
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": appearance, "appearance": appearance})
}

func (a *App) handleSettingsAppearancePut(w http.ResponseWriter, r *http.Request) {
	var req map[string]any
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	opacity, hasOpacity, err := validateContentPlateOpacityPayload(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	updates := make(map[string]string, len(req))
	for key, value := range req {
		if key == "" {
			continue
		}
		// The legacy single-value key is read-only migration input. Keep
		// accepting it from older clients, but never create or update it.
		if key == contentPlateOpacityLegacyKey {
			continue
		}
		if hasOpacity {
			if normalized, ok := opacity[key]; ok {
				updates["appearance."+key] = normalized
				continue
			}
		}
		updates["appearance."+key] = fmtAny(value)
	}
	if err := a.writeSettingsAtomic(updates); err != nil {
		writeError(w, http.StatusInternalServerError, "settings_error", err.Error())
		return
	}
	a.audit(currentUser(r), "settings.appearance.update", "settings", "", true, "")
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": req})
}

const (
	contentPlateOpacitySubtleKey  = "content_plate_opacity_subtle"
	contentPlateOpacityRegularKey = "content_plate_opacity_regular"
	contentPlateOpacityStrongKey  = "content_plate_opacity_strong"
	contentPlateOpacityLegacyKey  = "content_plate_opacity"
)

var contentPlateOpacityIntegerPattern = regexp.MustCompile(`^[0-9]+$`)

type contentPlateOpacityRange struct {
	min int
	max int
}

var contentPlateOpacityRanges = map[string]contentPlateOpacityRange{
	contentPlateOpacitySubtleKey:  {min: 20, max: 80},
	contentPlateOpacityRegularKey: {min: 30, max: 90},
	contentPlateOpacityStrongKey:  {min: 40, max: 96},
}

var contentPlateOpacityKeys = []string{
	contentPlateOpacitySubtleKey,
	contentPlateOpacityRegularKey,
	contentPlateOpacityStrongKey,
}

func (a *App) appearanceSettingsPayload() map[string]string {
	opacity := a.appearanceContentPlateOpacity()
	return map[string]string{
		"theme":                       a.setting("appearance.theme", a.setting("theme", "system")),
		"language":                    a.setting("appearance.language", a.setting("language", "zh-CN")),
		"scene":                       a.setting("appearance.scene", a.setting("scene", "dynamic")),
		"quality":                     a.setting("appearance.quality", a.setting("quality", "full")),
		"compact":                     a.setting("appearance.compact", "false"),
		"menu_order":                  a.setting("appearance.menu_order", ""),
		"accent_color":                a.setting("appearance.accent_color", ""),
		contentPlateOpacitySubtleKey:  opacity[contentPlateOpacitySubtleKey],
		contentPlateOpacityRegularKey: opacity[contentPlateOpacityRegularKey],
		contentPlateOpacityStrongKey:  opacity[contentPlateOpacityStrongKey],
	}
}

// validateContentPlateOpacityPayload validates the API-level opacity snapshot.
// The fields are intentionally accepted only as integer percentage strings. If
// any field is present, all three fields must be present and valid before a
// caller writes any setting.
func validateContentPlateOpacityPayload(raw map[string]any) (map[string]string, bool, error) {
	present := make(map[string]any, len(contentPlateOpacityKeys))
	for _, key := range contentPlateOpacityKeys {
		if value, ok := raw[key]; ok {
			present[key] = value
		}
	}
	if len(present) == 0 {
		return nil, false, nil
	}
	if len(present) != len(contentPlateOpacityKeys) {
		missing := make([]string, 0, len(contentPlateOpacityKeys)-len(present))
		for _, key := range contentPlateOpacityKeys {
			if _, ok := present[key]; !ok {
				missing = append(missing, key)
			}
		}
		return nil, true, fmt.Errorf("content plate opacity fields must be provided together; missing %s", strings.Join(missing, ", "))
	}

	values := make(map[string]string, len(contentPlateOpacityKeys))
	numbers := make(map[string]int, len(contentPlateOpacityKeys))
	for _, key := range contentPlateOpacityKeys {
		value, ok := present[key].(string)
		if !ok || !contentPlateOpacityIntegerPattern.MatchString(value) {
			return nil, true, fmt.Errorf("%s must be an integer percentage string", key)
		}
		n, err := strconv.Atoi(value)
		if err != nil {
			return nil, true, fmt.Errorf("%s must be an integer percentage string", key)
		}
		rangeForKey := contentPlateOpacityRanges[key]
		if n < rangeForKey.min || n > rangeForKey.max {
			return nil, true, fmt.Errorf("%s must be between %d and %d", key, rangeForKey.min, rangeForKey.max)
		}
		numbers[key] = n
		values[key] = strconv.Itoa(n)
	}
	if numbers[contentPlateOpacitySubtleKey] > numbers[contentPlateOpacityRegularKey] || numbers[contentPlateOpacityRegularKey] > numbers[contentPlateOpacityStrongKey] {
		return nil, true, fmt.Errorf("content plate opacity must satisfy %s <= %s <= %s", contentPlateOpacitySubtleKey, contentPlateOpacityRegularKey, contentPlateOpacityStrongKey)
	}
	return values, true, nil
}

func (a *App) appearanceContentPlateOpacity() map[string]string {
	raw := make(map[string]any, len(contentPlateOpacityKeys))
	present := 0
	for _, key := range contentPlateOpacityKeys {
		value, ok := a.settingValue("appearance." + key)
		if ok {
			present++
			raw[key] = value
		}
	}
	if present == len(contentPlateOpacityKeys) {
		if values, _, err := validateContentPlateOpacityPayload(raw); err == nil {
			return values
		}
		return defaultContentPlateOpacity()
	}
	if present == 0 {
		if legacy, ok := a.settingValue("appearance." + contentPlateOpacityLegacyKey); ok {
			if regular, err := strconv.Atoi(strings.TrimSpace(legacy)); err == nil {
				return migrateLegacyContentPlateOpacity(regular)
			}
		}
	}
	return defaultContentPlateOpacity()
}

func defaultContentPlateOpacity() map[string]string {
	return map[string]string{
		contentPlateOpacitySubtleKey:  "56",
		contentPlateOpacityRegularKey: "70",
		contentPlateOpacityStrongKey:  "84",
	}
}

func migrateLegacyContentPlateOpacity(regular int) map[string]string {
	// Preserve the raw legacy value as the center of the migration: derive
	// subtle/strong with -14/+14 first, then clamp each tier independently.
	return map[string]string{
		contentPlateOpacitySubtleKey:  strconv.Itoa(clampInt(regular-14, 20, 80)),
		contentPlateOpacityRegularKey: strconv.Itoa(clampInt(regular, 30, 90)),
		contentPlateOpacityStrongKey:  strconv.Itoa(clampInt(regular+14, 40, 96)),
	}
}

func clampInt(value, min, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func (a *App) settingValue(key string) (string, bool) {
	var value string
	if err := a.DB.QueryRow(`select value from settings where key=?`, key).Scan(&value); err != nil {
		return "", false
	}
	return value, true
}

func (a *App) writeSettingsAtomic(updates map[string]string) error {
	if len(updates) == 0 {
		return nil
	}
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	now := time.Now()
	for key, value := range updates {
		if _, err := tx.Exec(`insert or replace into settings(key,value,updated_at) values(?,?,?)`, key, value, now); err != nil {
			_ = tx.Rollback()
			return err
		}
	}
	return tx.Commit()
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
	if runtime.GOOS == "darwin" {
		return readDarwinMemInfo()
	}
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
