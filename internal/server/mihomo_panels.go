package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

func (a *App) handleProxyOverview(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": a.proxySnapshot()})
}

func (a *App) proxySnapshot() map[string]any {
	mihomo := a.mihomoSnapshot()
	mosdns := a.Services.Status("mosdns")
	return map[string]any{
		"core":     "mihomo",
		"mihomo":   mihomo,
		"mosdns":   mosdns,
		"services": map[string]any{"mihomo": mihomo["service"], "mosdns": mosdns},
		"ports":    mihomo["ports"],
		"healthy":  mihomo["controller_available"],
		"mode":     mihomo["mode"],
	}
}

func (a *App) mihomoSnapshot() map[string]any {
	return a.mihomoOverviewSnapshot()
}

func (a *App) mihomoFullSnapshot() map[string]any {
	cfg := a.mihomoConfigMap()
	service := a.Services.Status("mihomo")
	controllerCfg := a.mihomoControllerConfig()
	connections := a.mihomoConnectionsPayload(nil)
	traffic := a.mihomoTrafficFromConnections(connections, time.Now())
	proxies := a.mihomoProxiesPayload(nil)
	rules := a.mihomoRulesRuntime(nil)
	providers := a.mihomoProvidersPayload()
	version := a.mihomoVersion()
	if raw, ok, _ := a.mihomoControllerJSON(http.MethodGet, "/version", nil); ok {
		if m, ok := raw.(map[string]any); ok {
			version = firstNonEmpty(stringMapValue(m, "version"), stringMapValue(m, "premium"), version)
		}
	}
	ports := mihomoPortsFromConfig(cfg)
	transparentHealth := mihomoTransparentPortHealth(service, ports)
	health := map[string]any{
		"controller": a.tcpPortOpen("127.0.0.1", ports["controller"]),
		"http":       a.tcpPortOpen("127.0.0.1", ports["http"]),
		"socks":      a.tcpPortOpen("127.0.0.1", ports["socks"]),
		"mixed":      a.tcpPortOpen("127.0.0.1", ports["mixed"]),
		"redir":      transparentHealth["redir"],
		"tproxy":     transparentHealth["tproxy"],
	}
	proxyProviders := anyMapSlice(providers["proxy_providers"])
	proxyProviderCount := len(proxyProviders)
	if proxyProviderCount == 0 {
		if proxyProviderPayload, ok := providers["proxy"].(map[string]any); ok {
			proxyProviderCount = len(anyMapSlice(proxyProviderPayload["runtime_items"]))
		}
	}
	snapshot := map[string]any{
		"service":              service,
		"status":               service.Status,
		"running":              service.Running,
		"installed":            service.Installed,
		"pid":                  service.PID,
		"cpu":                  service.CPU,
		"memory":               service.Memory,
		"uptime":               service.Uptime,
		"version":              version,
		"mode":                 firstNonEmpty(stringMapValue(controllerCfg, "mode"), stringMapValue(cfg, "mode"), "rule"),
		"log_level":            firstNonEmpty(stringMapValue(controllerCfg, "log-level"), stringMapValue(cfg, "log-level"), "info"),
		"allow_lan":            boolMapValue(controllerCfg, "allow-lan", boolMapValue(cfg, "allow-lan", true)),
		"external_controller":  a.mihomoControllerBase(),
		"controller_available": controllerCfg != nil,
		"ui_url":               "/ui/",
		"ports":                ports,
		"health":               health,
		"traffic":              traffic,
		"connections":          connections,
		"connection_count":     connections["total"],
		"proxies":              proxies,
		"proxy_group_count":    len(anyMapSlice(proxies["groups"])),
		"proxy_count":          len(anyMapSlice(proxies["proxy_list"])),
		"rules":                rules,
		"rule_count":           rules["total"],
		"providers":            providers,
		"proxy_provider_count": proxyProviderCount,
		"rule_provider_count":  len(anyMapSlice(providers["rule_providers"])),
		"config":               map[string]any{"path": "configs/mihomo/config.yaml", "active": a.setting("mihomo.active_config", "config.yaml")},
	}
	stats := mihomoStatsFromSnapshot(snapshot)
	snapshot["stats"] = stats
	snapshot["uploadSpeed"] = stats["uploadSpeed"]
	snapshot["downloadSpeed"] = stats["downloadSpeed"]
	snapshot["upload_speed"] = stats["upload_speed"]
	snapshot["download_speed"] = stats["download_speed"]
	snapshot["uploadTotal"] = stats["uploadTotal"]
	snapshot["downloadTotal"] = stats["downloadTotal"]
	snapshot["upload_total"] = stats["upload_total"]
	snapshot["download_total"] = stats["download_total"]
	snapshot["activeConnections"] = stats["activeConnections"]
	snapshot["active_connections"] = stats["active_connections"]
	return snapshot
}

func (a *App) mihomoOverviewSnapshot() map[string]any {
	cfg := a.mihomoConfigMap()
	service := a.Services.Status("mihomo")
	controllerCfg := a.mihomoControllerConfig()
	connections := a.mihomoConnectionsSummary()
	traffic := a.mihomoTrafficFromConnections(connections, time.Now())
	version := a.mihomoVersion()
	if raw, ok, _ := a.mihomoControllerJSON(http.MethodGet, "/version", nil); ok {
		if m, ok := raw.(map[string]any); ok {
			version = firstNonEmpty(stringMapValue(m, "version"), stringMapValue(m, "premium"), version)
		}
	}
	ports := mihomoPortsFromConfig(cfg)
	transparentHealth := mihomoTransparentPortHealth(service, ports)
	health := map[string]any{
		"controller": a.tcpPortOpen("127.0.0.1", ports["controller"]),
		"http":       a.tcpPortOpen("127.0.0.1", ports["http"]),
		"socks":      a.tcpPortOpen("127.0.0.1", ports["socks"]),
		"mixed":      a.tcpPortOpen("127.0.0.1", ports["mixed"]),
		"redir":      transparentHealth["redir"],
		"tproxy":     transparentHealth["tproxy"],
	}
	counts := mihomoLocalConfigCounts(cfg)
	snapshot := map[string]any{
		"service":              service,
		"status":               service.Status,
		"running":              service.Running,
		"installed":            service.Installed,
		"pid":                  service.PID,
		"cpu":                  service.CPU,
		"memory":               service.Memory,
		"uptime":               service.Uptime,
		"version":              version,
		"mode":                 firstNonEmpty(stringMapValue(controllerCfg, "mode"), stringMapValue(cfg, "mode"), "rule"),
		"log_level":            firstNonEmpty(stringMapValue(controllerCfg, "log-level"), stringMapValue(cfg, "log-level"), "info"),
		"allow_lan":            boolMapValue(controllerCfg, "allow-lan", boolMapValue(cfg, "allow-lan", true)),
		"external_controller":  a.mihomoControllerBase(),
		"controller_available": controllerCfg != nil,
		"ui_url":               "/ui/",
		"zashboard_url":        "/ui/",
		"ports":                ports,
		"health":               health,
		"traffic":              traffic,
		"connections":          connections,
		"connection_count":     connections["total"],
		"proxy_group_count":    counts["proxy_group_count"],
		"proxy_count":          counts["proxy_count"],
		"rule_count":           counts["rule_count"],
		"proxy_provider_count": counts["proxy_provider_count"],
		"rule_provider_count":  counts["rule_provider_count"],
		"config":               map[string]any{"path": "configs/mihomo/config.yaml", "active": a.setting("mihomo.active_config", "config.yaml")},
		"lightweight":          true,
	}
	stats := mihomoStatsFromSnapshot(snapshot)
	snapshot["stats"] = stats
	snapshot["uploadSpeed"] = stats["uploadSpeed"]
	snapshot["downloadSpeed"] = stats["downloadSpeed"]
	snapshot["upload_speed"] = stats["upload_speed"]
	snapshot["download_speed"] = stats["download_speed"]
	snapshot["uploadTotal"] = stats["uploadTotal"]
	snapshot["downloadTotal"] = stats["downloadTotal"]
	snapshot["upload_total"] = stats["upload_total"]
	snapshot["download_total"] = stats["download_total"]
	snapshot["activeConnections"] = stats["activeConnections"]
	snapshot["active_connections"] = stats["active_connections"]
	return snapshot
}

func mihomoLocalConfigCounts(cfg map[string]any) map[string]any {
	return map[string]any{
		"proxy_group_count":    anyLen(cfg["proxy-groups"]),
		"proxy_count":          anyLen(cfg["proxies"]),
		"rule_count":           anyLen(cfg["rules"]),
		"proxy_provider_count": anyLen(cfg["proxy-providers"]),
		"rule_provider_count":  anyLen(cfg["rule-providers"]),
	}
}

func mihomoStatsFromSnapshot(snapshot map[string]any) map[string]any {
	traffic, _ := snapshot["traffic"].(map[string]any)
	connections, _ := snapshot["connections"].(map[string]any)
	connectionItems := anyMapSlice(connections["connections"])
	activeConnections := intAny(connections["active_count"], len(connectionItems))
	if activeConnections == 0 && len(connectionItems) > 0 {
		activeConnections = len(connectionItems)
	}
	downloadSpeed := numericMapValue(traffic, "down")
	if downloadSpeed == 0 {
		downloadSpeed = numericMapValue(traffic, "download")
	}
	uploadSpeed := numericMapValue(traffic, "up")
	if uploadSpeed == 0 {
		uploadSpeed = numericMapValue(traffic, "upload")
	}
	downloadTotal := numericMapValue(connections, "downloadTotal")
	if downloadTotal == 0 {
		downloadTotal = numericMapValue(connections, "download_total")
	}
	uploadTotal := numericMapValue(connections, "uploadTotal")
	if uploadTotal == 0 {
		uploadTotal = numericMapValue(connections, "upload_total")
	}
	proxyProviderCount := intAny(snapshot["proxy_provider_count"], 0)
	ruleProviderCount := intAny(snapshot["rule_provider_count"], 0)
	ruleCount := intAny(snapshot["rule_count"], 0)
	proxyGroupCount := intAny(snapshot["proxy_group_count"], 0)
	proxyCount := intAny(snapshot["proxy_count"], 0)
	stats := map[string]any{
		"status":               snapshot["status"],
		"running":              snapshot["running"],
		"version":              snapshot["version"],
		"pid":                  snapshot["pid"],
		"cpu":                  numericAny(snapshot["cpu"]),
		"cpu_percent":          numericAny(snapshot["cpu"]),
		"memory":               numericAny(snapshot["memory"]),
		"memory_bytes":         numericAny(snapshot["memory"]),
		"uptime":               snapshot["uptime"],
		"traffic":              traffic,
		"connections":          connections,
		"connection_count":     activeConnections,
		"connections_count":    activeConnections,
		"activeConnections":    activeConnections,
		"active_connections":   activeConnections,
		"downloadSpeed":        downloadSpeed,
		"download_speed":       downloadSpeed,
		"down":                 downloadSpeed,
		"uploadSpeed":          uploadSpeed,
		"upload_speed":         uploadSpeed,
		"up":                   uploadSpeed,
		"downloadTotal":        downloadTotal,
		"download_total":       downloadTotal,
		"uploadTotal":          uploadTotal,
		"upload_total":         uploadTotal,
		"proxyProviderCount":   proxyProviderCount,
		"proxy_provider_count": proxyProviderCount,
		"ruleProviderCount":    ruleProviderCount,
		"rule_provider_count":  ruleProviderCount,
		"ruleCount":            ruleCount,
		"rule_count":           ruleCount,
		"proxyGroupCount":      proxyGroupCount,
		"proxy_group_count":    proxyGroupCount,
		"proxyCount":           proxyCount,
		"proxy_count":          proxyCount,
		"controller_available": snapshot["controller_available"],
		"health":               snapshot["health"],
		"ports":                snapshot["ports"],
	}
	return stats
}

func (a *App) mihomoControllerBase() string {
	base := strings.TrimRight(a.setting("mihomo_controller_endpoint", ""), "/")
	if base == "" {
		cfg := a.mihomoConfigMap()
		controller := firstNonEmpty(stringMapValue(cfg, "external-controller"), "127.0.0.1:9090")
		controller = strings.TrimSpace(controller)
		if strings.HasPrefix(controller, ":") {
			controller = "127.0.0.1" + controller
		}
		if strings.HasPrefix(controller, "0.0.0.0:") {
			controller = "127.0.0.1:" + strings.TrimPrefix(controller, "0.0.0.0:")
		}
		if !strings.Contains(controller, "://") {
			controller = "http://" + controller
		}
		base = strings.TrimRight(controller, "/")
	}
	if _, err := url.ParseRequestURI(base); err != nil {
		return "http://127.0.0.1:9090"
	}
	return base
}

func (a *App) mihomoControllerURL(path string) string {
	if path == "" {
		return a.mihomoControllerBase()
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return a.mihomoControllerBase() + path
}

func (a *App) mihomoSecret() string {
	if secret := a.setting("mihomo_controller_secret", ""); secret != "" {
		return secret
	}
	return stringMapValue(a.mihomoConfigMap(), "secret")
}

func (a *App) mihomoControllerJSON(method, path string, body []byte) (any, bool, error) {
	return a.mihomoControllerJSONWithTimeout(method, path, body, 1500*time.Millisecond)
}

type mihomoControllerHTTPError struct {
	StatusCode int
	Message    string
}

func (e *mihomoControllerHTTPError) Error() string {
	message := strings.TrimSpace(e.Message)
	if message == "" {
		return fmt.Sprintf("mihomo controller http %d", e.StatusCode)
	}
	return fmt.Sprintf("mihomo controller http %d: %s", e.StatusCode, message)
}

func mihomoControllerErrorMessage(body []byte) string {
	var payload map[string]any
	if json.Unmarshal(body, &payload) == nil {
		for _, key := range []string{"message", "error"} {
			if value := strings.TrimSpace(fmt.Sprint(payload[key])); value != "" && value != "<nil>" {
				return value
			}
		}
	}
	return strings.TrimSpace(string(body))
}

func (a *App) mihomoControllerJSONWithTimeout(method, path string, body []byte, timeout time.Duration) (any, bool, error) {
	client := &http.Client{Timeout: timeout}
	req, err := http.NewRequest(method, a.mihomoControllerURL(path), bytes.NewReader(body))
	if err != nil {
		return nil, false, err
	}
	if len(body) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}
	if secret := a.mihomoSecret(); secret != "" {
		req.Header.Set("Authorization", "Bearer "+secret)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, false, err
	}
	defer resp.Body.Close()
	responseBody, readErr := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if readErr != nil {
		return nil, false, readErr
	}
	if resp.StatusCode >= 300 {
		return nil, false, &mihomoControllerHTTPError{StatusCode: resp.StatusCode, Message: mihomoControllerErrorMessage(responseBody)}
	}
	if len(responseBody) == 0 {
		return map[string]any{"ok": true}, true, nil
	}
	var raw any
	if err := json.Unmarshal(responseBody, &raw); err != nil {
		return map[string]any{"ok": true}, true, nil
	}
	return raw, true, nil
}

func (a *App) mihomoControllerMap(path string) (map[string]any, bool) {
	raw, ok, _ := a.mihomoControllerJSON(http.MethodGet, path, nil)
	if !ok {
		return nil, false
	}
	switch v := raw.(type) {
	case map[string]any:
		return v, true
	default:
		return map[string]any{"data": v}, true
	}
}

func (a *App) mihomoControllerConfig() map[string]any {
	if cfg, ok := a.mihomoControllerMap("/configs"); ok {
		return cfg
	}
	return nil
}

func (a *App) mihomoConfigMap() map[string]any {
	cfg := map[string]any{}
	_ = readYAMLFile(filepath.Join(a.DataDir, "configs/mihomo/config.yaml"), &cfg)
	return cfg
}

func mihomoPortsFromConfig(cfg map[string]any) map[string]int {
	ports := map[string]int{
		"http": 7890, "socks": 7891, "mixed": 7892, "redir": 7877, "tproxy": 7896, "dns": 6666, "controller": 9090,
	}
	ports["http"] = intMapValue(cfg, "port", ports["http"])
	ports["socks"] = intMapValue(cfg, "socks-port", ports["socks"])
	ports["mixed"] = intMapValue(cfg, "mixed-port", ports["mixed"])
	ports["redir"] = intMapValue(cfg, "redir-port", ports["redir"])
	ports["tproxy"] = intMapValue(cfg, "tproxy-port", ports["tproxy"])
	if dns, ok := cfg["dns"].(map[string]any); ok {
		ports["dns"] = portFromListen(firstNonEmpty(stringMapValue(dns, "listen"), "0.0.0.0:6666"), ports["dns"])
	}
	ports["controller"] = portFromListen(firstNonEmpty(stringMapValue(cfg, "external-controller"), "127.0.0.1:9090"), ports["controller"])
	return ports
}

const mihomoTrafficCacheTTL = 2 * time.Second

const mihomoTrafficMinSampleInterval = 750 * time.Millisecond

type mihomoTrafficTotalsSample struct {
	At            time.Time
	DownloadTotal float64
	UploadTotal   float64
	DownloadRate  float64
	UploadRate    float64
}

func (a *App) mihomoTrafficFromConnections(connections map[string]any, now time.Time) map[string]any {
	if !boolMapValue(connections, "available", true) {
		return a.mihomoTrafficCachedPayload()
	}
	if cached, ok := a.cachedMihomoTraffic(); ok && stringMapValue(cached, "source") == "traffic" {
		return cached
	}
	payload := a.deriveMihomoTrafficFromTotals(
		numericMapValue(connections, "downloadTotal"),
		numericMapValue(connections, "uploadTotal"),
		now,
	)
	a.storeMihomoTraffic(payload)
	return payload
}

func (a *App) deriveMihomoTrafficFromTotals(downloadTotal, uploadTotal float64, now time.Time) map[string]any {
	a.mihomoTrafficTotalsMu.Lock()
	last := a.mihomoTrafficTotalsLast
	downloadRate, uploadRate := float64(0), float64(0)
	if !last.At.IsZero() && now.After(last.At) {
		elapsed := now.Sub(last.At).Seconds()
		if elapsed < mihomoTrafficMinSampleInterval.Seconds() {
			downloadRate = last.DownloadRate
			uploadRate = last.UploadRate
			a.mihomoTrafficTotalsMu.Unlock()
			return mihomoTrafficRatePayload(uploadRate, downloadRate, uploadTotal, downloadTotal, "connections")
		}
		if downloadTotal >= last.DownloadTotal {
			downloadRate = (downloadTotal - last.DownloadTotal) / elapsed
		}
		if uploadTotal >= last.UploadTotal {
			uploadRate = (uploadTotal - last.UploadTotal) / elapsed
		}
	}
	a.mihomoTrafficTotalsLast = mihomoTrafficTotalsSample{
		At:            now,
		DownloadTotal: downloadTotal,
		UploadTotal:   uploadTotal,
		DownloadRate:  downloadRate,
		UploadRate:    uploadRate,
	}
	a.mihomoTrafficTotalsMu.Unlock()
	return mihomoTrafficRatePayload(uploadRate, downloadRate, uploadTotal, downloadTotal, "connections")
}

func mihomoTrafficRatePayload(uploadRate, downloadRate, uploadTotal, downloadTotal float64, source string) map[string]any {
	return map[string]any{
		"up":             uploadRate,
		"down":           downloadRate,
		"upload":         uploadRate,
		"download":       downloadRate,
		"uploadTotal":    uploadTotal,
		"downloadTotal":  downloadTotal,
		"upload_total":   uploadTotal,
		"download_total": downloadTotal,
		"source":         source,
		"raw":            map[string]any{},
	}
}

func (a *App) mihomoTrafficPayload() map[string]any {
	payload, ok := a.fetchMihomoTrafficPayloadResult()
	if !ok {
		a.mihomoTrafficMu.Lock()
		cached := cloneAnyMap(a.mihomoTrafficCache)
		hasCached := a.mihomoTrafficCache != nil
		a.mihomoTrafficMu.Unlock()
		if hasCached {
			return cached
		}
		return zeroMihomoTrafficPayload()
	}
	a.storeMihomoTraffic(payload)
	return payload
}

func (a *App) mihomoTrafficCachedPayload() map[string]any {
	a.mihomoTrafficMu.Lock()
	hasCached := a.mihomoTrafficCache != nil && !a.mihomoTrafficAt.IsZero()
	stale := hasCached && time.Since(a.mihomoTrafficAt) > mihomoTrafficCacheTTL
	cached := cloneAnyMap(a.mihomoTrafficCache)
	refresh := (!hasCached || stale) && !a.mihomoTrafficRefreshing
	if refresh {
		a.mihomoTrafficRefreshing = true
	}
	a.mihomoTrafficMu.Unlock()
	if refresh {
		go a.refreshMihomoTrafficCache()
	}
	if hasCached {
		return cached
	}
	return zeroMihomoTrafficPayload()
}

func (a *App) refreshMihomoTrafficCache() {
	payload, ok := a.fetchMihomoTrafficPayloadResult()
	a.mihomoTrafficMu.Lock()
	defer a.mihomoTrafficMu.Unlock()
	if ok {
		a.mihomoTrafficCache = cloneAnyMap(payload)
		a.mihomoTrafficAt = time.Now()
	}
	a.mihomoTrafficRefreshing = false
}

func (a *App) cachedMihomoTraffic() (map[string]any, bool) {
	a.mihomoTrafficMu.Lock()
	defer a.mihomoTrafficMu.Unlock()
	if a.mihomoTrafficCache == nil || a.mihomoTrafficAt.IsZero() || time.Since(a.mihomoTrafficAt) > mihomoTrafficCacheTTL {
		return nil, false
	}
	return cloneAnyMap(a.mihomoTrafficCache), true
}

func (a *App) storeMihomoTraffic(payload map[string]any) {
	a.mihomoTrafficMu.Lock()
	defer a.mihomoTrafficMu.Unlock()
	a.mihomoTrafficCache = cloneAnyMap(payload)
	a.mihomoTrafficAt = time.Now()
}

func (a *App) fetchMihomoTrafficPayloadResult() (map[string]any, bool) {
	if raw, ok := a.mihomoControllerMap("/traffic"); ok {
		return map[string]any{
			"up":       numericMapValue(raw, "up"),
			"down":     numericMapValue(raw, "down"),
			"upload":   numericMapValue(raw, "up"),
			"download": numericMapValue(raw, "down"),
			"source":   "traffic",
			"raw":      raw,
		}, true
	}
	if raw, ok := a.mihomoControllerMap("/connections"); ok {
		return a.deriveMihomoTrafficFromTotals(
			numericMapValue(raw, "downloadTotal"),
			numericMapValue(raw, "uploadTotal"),
			time.Now(),
		), true
	}
	return nil, false
}

func zeroMihomoTrafficPayload() map[string]any {
	return map[string]any{"up": 0, "down": 0, "upload": 0, "download": 0, "raw": map[string]any{}}
}

func cloneAnyMap(in map[string]any) map[string]any {
	out := make(map[string]any, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func (a *App) mihomoConnectionsSummary() map[string]any {
	raw, ok := a.mihomoControllerMap("/connections")
	if !ok {
		return map[string]any{
			"available": false, "total": 0, "active_count": 0, "downloadTotal": 0, "uploadTotal": 0, "download_total": 0, "upload_total": 0,
		}
	}
	total := len(anySlice(raw["connections"]))
	return map[string]any{
		"available":      true,
		"total":          total,
		"active_count":   total,
		"downloadTotal":  numericMapValue(raw, "downloadTotal"),
		"uploadTotal":    numericMapValue(raw, "uploadTotal"),
		"download_total": numericMapValue(raw, "downloadTotal"),
		"upload_total":   numericMapValue(raw, "uploadTotal"),
	}
}

func (a *App) mihomoConnectionsPayload(r *http.Request) map[string]any {
	raw, available := a.mihomoControllerMap("/connections")
	if !available {
		raw = map[string]any{"connections": []any{}, "downloadTotal": 0, "uploadTotal": 0}
	}
	connections := normalizeMihomoConnectionList(anySlice(raw["connections"]))
	filtered := filterMihomoConnections(connections, r)
	page, limit := 1, len(filtered)
	if r != nil {
		page = queryInt(r, "page", 1)
		limit = queryInt(r, "page_size", queryInt(r, "limit", len(filtered)))
	}
	if limit <= 0 {
		limit = 100
	}
	total := len(filtered)
	start := (page - 1) * limit
	if start > total {
		start = total
	}
	end := start + limit
	if end > total {
		end = total
	}
	items := filtered[start:end]
	return map[string]any{
		"available":      available,
		"connections":    items,
		"items":          items,
		"total":          total,
		"active_count":   len(connections),
		"downloadTotal":  numericMapValue(raw, "downloadTotal"),
		"uploadTotal":    numericMapValue(raw, "uploadTotal"),
		"download_total": numericMapValue(raw, "downloadTotal"),
		"upload_total":   numericMapValue(raw, "uploadTotal"),
		"pagination": map[string]any{
			"page": page, "limit": limit, "page_size": limit, "total": total, "total_pages": (total + limit - 1) / limit,
		},
		"raw": raw,
	}
}

func normalizeMihomoConnectionList(items []any) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for i, item := range items {
		conn, ok := item.(map[string]any)
		if !ok {
			continue
		}
		metadata, _ := conn["metadata"].(map[string]any)
		chains := stringSlice(conn["chains"])
		host := firstNonEmpty(stringMapValue(metadata, "host"), stringMapValue(metadata, "destinationIP"), stringMapValue(metadata, "destinationPort"))
		id := firstNonEmpty(stringMapValue(conn, "id"), fmt.Sprintf("conn-%d", i+1))
		normalized := map[string]any{
			"id":               id,
			"host":             host,
			"network":          strings.ToLower(firstNonEmpty(stringMapValue(metadata, "network"), stringMapValue(metadata, "netWork"))),
			"type":             stringMapValue(metadata, "type"),
			"inbound":          stringMapValue(metadata, "type"),
			"source_ip":        stringMapValue(metadata, "sourceIP"),
			"source_port":      stringMapValue(metadata, "sourcePort"),
			"destination_ip":   stringMapValue(metadata, "destinationIP"),
			"destination_port": stringMapValue(metadata, "destinationPort"),
			"process":          firstNonEmpty(stringMapValue(metadata, "process"), stringMapValue(metadata, "processPath")),
			"rule":             stringMapValue(conn, "rule"),
			"rule_payload":     stringMapValue(conn, "rulePayload"),
			"chains":           chains,
			"chain":            strings.Join(chains, " / "),
			"download":         numericMapValue(conn, "download"),
			"upload":           numericMapValue(conn, "upload"),
			"start":            stringMapValue(conn, "start"),
			"metadata":         metadata,
			"raw":              conn,
		}
		out = append(out, normalized)
	}
	return out
}

func filterMihomoConnections(items []map[string]any, r *http.Request) []map[string]any {
	if r == nil {
		return items
	}
	q := r.URL.Query()
	search := strings.ToLower(strings.TrimSpace(firstNonEmpty(q.Get("search"), q.Get("q"), q.Get("keyword"), q.Get("host"))))
	network := strings.ToLower(strings.TrimSpace(firstNonEmpty(q.Get("network"), q.Get("protocol"))))
	inbound := strings.TrimSpace(q.Get("inbound"))
	rule := strings.TrimSpace(q.Get("rule"))
	chain := strings.TrimSpace(q.Get("chain"))
	filtered := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if search != "" && !strings.Contains(strings.ToLower(strings.Join([]string{
			stringMapValue(item, "host"),
			stringMapValue(item, "source_ip"),
			stringMapValue(item, "destination_ip"),
			stringMapValue(item, "process"),
			stringMapValue(item, "rule"),
			stringMapValue(item, "chain"),
		}, " ")), search) {
			continue
		}
		if network != "" && network != "all" && stringMapValue(item, "network") != network {
			continue
		}
		if inbound != "" && inbound != "all" && stringMapValue(item, "inbound") != inbound {
			continue
		}
		if rule != "" && !strings.EqualFold(stringMapValue(item, "rule"), rule) {
			continue
		}
		if chain != "" && !strings.Contains(stringMapValue(item, "chain"), chain) {
			continue
		}
		filtered = append(filtered, item)
	}
	sortMihomoRows(filtered, q.Get("sort"), q.Get("sort_order"))
	return filtered
}

func (a *App) mihomoProxiesPayload(r *http.Request) map[string]any {
	rawProxies, ok := a.mihomoControllerMap("/proxies")
	if !ok {
		rawProxies = map[string]any{"proxies": map[string]any{}}
	}
	rawProviders, ok := a.mihomoControllerMap("/providers/proxies")
	if !ok {
		rawProviders = map[string]any{"providers": map[string]any{}}
	}
	rawProxies = mergeMihomoProviderProxies(rawProxies, rawProviders)
	proxyMap, groups, proxies := normalizeMihomoProxies(rawProxies, a.mihomoProxyGroupOrder())
	pagePolicy, groupPolicies, _ := a.mihomoTestPolicyData()
	a.attachMihomoTestPolicies(groups)
	if r != nil {
		search := strings.ToLower(strings.TrimSpace(firstNonEmpty(r.URL.Query().Get("search"), r.URL.Query().Get("q"))))
		if search != "" {
			proxies = filterMihomoProxyList(proxies, search)
			groups = filterMihomoProxyList(groups, search)
			proxyMap = filterMihomoProxyMap(proxyMap, search)
		}
	}
	return map[string]any{
		"groups":            groups,
		"proxy_groups":      groups,
		"proxy_list":        proxies,
		"nodes":             proxies,
		"proxies":           proxyMap,
		"providers":         normalizeProviderMap(rawProviders["providers"]),
		"raw":               rawProxies,
		"test_policy":       pagePolicy,
		"group_test_policy": groupPolicies,
		"config_authority":  a.mihomoConfigModePayload(),
	}
}

func mergeMihomoProviderProxies(rawProxies, rawProviders map[string]any) map[string]any {
	merged := map[string]any{}
	if proxyMap, ok := rawProxies["proxies"].(map[string]any); ok {
		for name, proxy := range proxyMap {
			merged[name] = proxy
		}
	}

	providers := normalizeProviderMap(rawProviders["providers"])
	names := make([]string, 0, len(providers))
	for name, provider := range providers {
		if providerVehicleType(provider) == "compatible" {
			continue
		}
		names = append(names, name)
	}
	sort.Strings(names)
	for _, providerName := range names {
		for _, proxy := range anyMapSlice(providers[providerName]["proxies"]) {
			name := stringMapValue(proxy, "name")
			if name == "" {
				continue
			}
			if _, exists := merged[name]; exists {
				continue
			}
			item := make(map[string]any, len(proxy)+1)
			for key, value := range proxy {
				item[key] = value
			}
			if firstNonEmpty(stringMapValue(item, "provider"), stringMapValue(item, "providerName"), stringMapValue(item, "provider-name")) == "" {
				item["provider-name"] = providerName
			}
			merged[name] = item
		}
	}

	out := make(map[string]any, len(rawProxies)+1)
	for key, value := range rawProxies {
		out[key] = value
	}
	out["proxies"] = merged
	return out
}

func (a *App) mihomoProxyGroupOrder() map[string]int {
	cfg := a.mihomoConfigMap()
	out := map[string]int{}
	for index, item := range anySlice(cfg["proxy-groups"]) {
		if group, ok := item.(map[string]any); ok {
			name := stringMapValue(group, "name")
			if name != "" {
				out[name] = index
			}
		}
	}
	return out
}

func normalizeMihomoProxies(raw map[string]any, groupOrder map[string]int) (map[string]any, []map[string]any, []map[string]any) {
	proxyMap, _ := raw["proxies"].(map[string]any)
	byName := map[string]any{}
	var groups []map[string]any
	var proxies []map[string]any
	groupTypes := map[string]bool{"Selector": true, "URLTest": true, "Fallback": true, "LoadBalance": true, "Relay": true}
	for name, value := range proxyMap {
		item, ok := value.(map[string]any)
		if !ok {
			continue
		}
		all := stringSlice(item["all"])
		order, hasOrder := groupOrder[firstNonEmpty(stringMapValue(item, "name"), name)]
		if !hasOrder {
			order = 100000
		}
		row := map[string]any{
			"name":          firstNonEmpty(stringMapValue(item, "name"), name),
			"type":          stringMapValue(item, "type"),
			"now":           stringMapValue(item, "now"),
			"all":           all,
			"all_count":     len(all),
			"order":         order,
			"config_order":  order,
			"udp":           boolMapValue(item, "udp", false),
			"delay":         latestProxyDelay(item),
			"history":       item["history"],
			"icon":          stringMapValue(item, "icon"),
			"hidden":        boolMapValue(item, "hidden", false),
			"alive":         boolMapValue(item, "alive", true),
			"provider":      firstNonEmpty(stringMapValue(item, "provider"), stringMapValue(item, "providerName"), stringMapValue(item, "provider-name")),
			"provider_name": firstNonEmpty(stringMapValue(item, "providerName"), stringMapValue(item, "provider-name"), stringMapValue(item, "provider")),
			"raw":           item,
		}
		if row["provider_name"] != "" {
			row["provider-name"] = row["provider_name"]
		}
		byName[stringMapValue(row, "name")] = row
		if groupTypes[stringMapValue(item, "type")] || len(stringSlice(item["all"])) > 0 {
			groups = append(groups, row)
		} else {
			proxies = append(proxies, row)
		}
	}
	sort.Slice(groups, func(i, j int) bool {
		oi, _ := groups[i]["order"].(int)
		oj, _ := groups[j]["order"].(int)
		if oi != oj {
			return oi < oj
		}
		return stringMapValue(groups[i], "name") < stringMapValue(groups[j], "name")
	})
	sort.Slice(proxies, func(i, j int) bool { return stringMapValue(proxies[i], "name") < stringMapValue(proxies[j], "name") })
	return byName, groups, proxies
}

func (a *App) mihomoRulesRuntime(r *http.Request) map[string]any {
	raw, ok := a.mihomoControllerMap("/rules")
	// Keep controller availability separate from the (valid) empty-list case.
	// A missing controller must never look like a running controller with zero
	// rules to callers rendering the runtime page.
	if !ok {
		raw = map[string]any{"rules": []any{}}
	}
	rules := normalizeMihomoRules(mihomoRulesFromControllerRaw(raw))
	if r != nil {
		q := r.URL.Query()
		search := strings.ToLower(strings.TrimSpace(firstNonEmpty(q.Get("search"), q.Get("q"), q.Get("keyword"))))
		typ := strings.TrimSpace(q.Get("type"))
		proxy := strings.TrimSpace(q.Get("proxy"))
		provider := strings.TrimSpace(q.Get("provider"))
		filtered := make([]map[string]any, 0, len(rules))
		for _, rule := range rules {
			if search != "" && !strings.Contains(strings.ToLower(strings.Join([]string{
				stringMapValue(rule, "type"), stringMapValue(rule, "payload"), stringMapValue(rule, "proxy"), stringMapValue(rule, "provider"),
			}, " ")), search) {
				continue
			}
			if typ != "" && typ != "all" && !strings.EqualFold(stringMapValue(rule, "type"), typ) {
				continue
			}
			if proxy != "" && proxy != "all" && stringMapValue(rule, "proxy") != proxy {
				continue
			}
			if provider != "" && provider != "all" && stringMapValue(rule, "provider") != provider {
				continue
			}
			filtered = append(filtered, rule)
		}
		rules = filtered
		// The controller's order is the matching order.  Never apply the old
		// default id-desc sort (or any client supplied sort) here; filtering and
		// pagination below must only slice the original sequence.
	}
	page, limit := 1, len(rules)
	if r != nil {
		page = queryInt(r, "page", 1)
		limit = queryInt(r, "page_size", queryInt(r, "limit", len(rules)))
	}
	if limit <= 0 {
		limit = 200
	}
	total := len(rules)
	start := (page - 1) * limit
	if start > total {
		start = total
	}
	end := start + limit
	if end > total {
		end = total
	}
	items := rules[start:end]
	capabilities := mihomoRuleCapabilities(raw, rules, ok)
	result := map[string]any{
		"available":            ok,
		"controller_available": ok,
		"source":               "controller",
		"rules":                items,
		"items":                items,
		"total":                total,
		"raw":                  raw,
		"capabilities":         capabilities,
		"pagination":           map[string]any{"page": page, "limit": limit, "page_size": limit, "total": total, "total_pages": (total + limit - 1) / limit},
	}
	if !ok {
		result["error"] = "controller_unavailable"
		result["message"] = "mihomo controller unavailable"
	}
	return result
}

func mihomoRulesFromControllerRaw(raw map[string]any) []any {
	if raw == nil {
		return nil
	}
	if rules := anySlice(raw["rules"]); rules != nil {
		return rules
	}
	for _, key := range []string{"data", "result"} {
		if nested, ok := raw[key].(map[string]any); ok {
			if rules := anySlice(nested["rules"]); rules != nil {
				return rules
			}
		}
	}
	return nil
}

func normalizeMihomoRules(items []any) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for i, item := range items {
		switch v := item.(type) {
		case map[string]any:
			row := normalizeMihomoRuleMap(v, i)
			out = append(out, row)
		case string:
			parts := strings.Split(v, ",")
			row := map[string]any{"id": fmt.Sprintf("%d", i+1), "index": i + 1, "raw": v, "disabled": false}
			if len(parts) > 0 {
				row["type"] = strings.TrimSpace(parts[0])
			}
			if len(parts) > 1 {
				row["payload"] = strings.TrimSpace(parts[1])
			}
			if len(parts) > 2 {
				row["proxy"] = strings.TrimSpace(parts[2])
			}
			out = append(out, row)
		}
	}
	return out
}

// normalizeMihomoRuleMap preserves controller fields while exposing a stable
// compatibility shape for older Mihomo versions.  The controller's index and
// id/uuid are authoritative; the positional fallback is only used when a
// legacy controller omitted both fields.
func normalizeMihomoRuleMap(v map[string]any, position int) map[string]any {
	index := mihomoRuleIndex(v, position)
	id := firstNonEmpty(
		stringMapValue(v, "id"),
		stringMapValue(v, "ruleId"),
		stringMapValue(v, "rule_id"),
		stringMapValue(v, "uuid"),
		stringMapValue(v, "ruleUUID"),
		stringMapValue(v, "rule_uuid"),
		fmt.Sprintf("%d", index),
	)
	typ := firstNonEmpty(stringMapValue(v, "type"), stringMapValue(v, "ruleType"), stringMapValue(v, "rule_type"))
	payload := firstNonEmpty(stringMapValue(v, "payload"), stringMapValue(v, "rulePayload"), stringMapValue(v, "rule_payload"))
	target := firstNonEmpty(stringMapValue(v, "proxy"), stringMapValue(v, "adapter"), stringMapValue(v, "target"))
	row := map[string]any{
		"id":              id,
		"index":           index,
		"type":            typ,
		"type_name":       typ,
		"normalized_type": strings.ToLower(strings.TrimSpace(typ)),
		"payload":         payload,
		"proxy":           target,
		"target":          target,
		"provider":        firstNonEmpty(stringMapValue(v, "provider"), stringMapValue(v, "providerName"), stringMapValue(v, "provider_name")),
		"disabled":        mihomoRuleDisabled(v),
		"raw":             v,
	}
	if uuid := firstNonEmpty(stringMapValue(v, "uuid"), stringMapValue(v, "UUID"), stringMapValue(v, "ruleUUID"), stringMapValue(v, "rule_uuid")); uuid != "" {
		row["uuid"] = uuid
	}
	if size, ok := mihomoNumericField(v, "size", "ruleSize", "rule_size"); ok {
		row["size"] = size
	}
	// Newer controllers put counters in extra/stats, while older snapshots
	// expose them directly.  Flatten both spellings without dropping the raw
	// nested object.
	stats := map[string]any{}
	for _, key := range []string{"extra", "stats", "statistics", "stat"} {
		if nested, ok := v[key].(map[string]any); ok {
			if len(stats) == 0 {
				stats = nested
			} else {
				for k, value := range nested {
					if _, exists := stats[k]; !exists {
						stats[k] = value
					}
				}
			}
		}
	}
	if len(stats) > 0 {
		row["extra"] = stats
	}
	if hit, ok := mihomoNumericField(v, "hitCount", "hit_count", "hits"); !ok {
		hit, ok = mihomoNumericField(stats, "hitCount", "hit_count", "hits")
		if ok {
			row["hit_count"] = hit
			row["hitCount"] = hit
		}
	} else {
		row["hit_count"] = hit
		row["hitCount"] = hit
	}
	if miss, ok := mihomoNumericField(v, "missCount", "miss_count", "misses"); !ok {
		miss, ok = mihomoNumericField(stats, "missCount", "miss_count", "misses")
		if ok {
			row["miss_count"] = miss
			row["missCount"] = miss
		}
	} else {
		row["miss_count"] = miss
		row["missCount"] = miss
	}
	if hitAt := firstNonEmpty(
		stringMapValue(v, "hitAt"), stringMapValue(v, "hit_at"), stringMapValue(v, "lastHitAt"), stringMapValue(v, "last_hit_at"),
		stringMapValue(stats, "hitAt"), stringMapValue(stats, "hit_at"), stringMapValue(stats, "lastHitAt"), stringMapValue(stats, "last_hit_at"),
	); hitAt != "" {
		row["hit_at"] = hitAt
		row["hitAt"] = hitAt
		row["last_hit_at"] = hitAt
	}
	if missAt := firstNonEmpty(
		stringMapValue(v, "missAt"), stringMapValue(v, "miss_at"), stringMapValue(v, "lastMissAt"), stringMapValue(v, "last_miss_at"),
		stringMapValue(stats, "missAt"), stringMapValue(stats, "miss_at"), stringMapValue(stats, "lastMissAt"), stringMapValue(stats, "last_miss_at"),
	); missAt != "" {
		row["miss_at"] = missAt
		row["missAt"] = missAt
		row["last_miss_at"] = missAt
	}
	return row
}

func mihomoRuleIndex(v map[string]any, position int) int {
	for _, key := range []string{"index", "position", "order"} {
		if value, ok := mihomoIntField(v, key); ok {
			return value
		}
	}
	return position + 1
}

func mihomoIntField(m map[string]any, key string) (int, bool) {
	if m == nil {
		return 0, false
	}
	value, ok := m[key]
	if !ok {
		return 0, false
	}
	switch n := value.(type) {
	case int:
		return n, true
	case int8:
		return int(n), true
	case int16:
		return int(n), true
	case int32:
		return int(n), true
	case int64:
		return int(n), true
	case uint:
		return int(n), true
	case uint8:
		return int(n), true
	case uint16:
		return int(n), true
	case uint32:
		return int(n), true
	case uint64:
		return int(n), true
	case float64:
		return int(n), true
	case json.Number:
		i, err := n.Int64()
		return int(i), err == nil
	case string:
		i, err := strconv.Atoi(strings.TrimSpace(n))
		return i, err == nil
	default:
		return 0, false
	}
}

func mihomoNumericField(m map[string]any, keys ...string) (float64, bool) {
	if m == nil {
		return 0, false
	}
	for _, key := range keys {
		if _, exists := m[key]; !exists {
			continue
		}
		return numericMapValue(m, key), true
	}
	return 0, false
}

func mihomoRuleDisabled(v map[string]any) bool {
	for _, key := range []string{"disabled", "isDisabled", "is_disabled"} {
		if value, exists := v[key]; exists {
			return boolAny(value, false)
		}
	}
	for _, key := range []string{"enabled", "isEnabled", "is_enabled"} {
		if value, exists := v[key]; exists {
			return !boolAny(value, true)
		}
	}
	return false
}

func boolAny(value any, fallback bool) bool {
	switch v := value.(type) {
	case bool:
		return v
	case string:
		if parsed, err := strconv.ParseBool(strings.TrimSpace(v)); err == nil {
			return parsed
		}
	case json.Number:
		return v.String() != "0"
	case float64:
		return v != 0
	case int:
		return v != 0
	}
	return fallback
}

func mihomoRuleCapabilities(raw map[string]any, rules []map[string]any, available bool) map[string]any {
	if !available {
		return map[string]any{"rule_toggle": false, "rule_stats": false, "provider_update": false}
	}
	capabilities := map[string]any{}
	for _, key := range []string{"capabilities", "supports", "features"} {
		if nested, ok := raw[key].(map[string]any); ok {
			for k, value := range nested {
				capabilities[k] = value
			}
		}
	}
	if value, exists := raw["rule_toggle"]; exists {
		capabilities["rule_toggle"] = boolAny(value, false)
	}
	if value, exists := raw["rule_stats"]; exists {
		capabilities["rule_stats"] = boolAny(value, false)
	}
	if value, exists := raw["provider_update"]; exists {
		capabilities["provider_update"] = boolAny(value, false)
	}
	if _, exists := capabilities["rule_toggle"]; !exists {
		// Meta-compatible controllers may support PATCH /rules/{index} without
		// echoing disabled/id fields from GET /rules.  A non-empty live rule list
		// is therefore enough to expose the switch as a runtime capability probe.
		// Explicit controller capability flags above still take priority, and a
		// 404/405/501 response makes the client disable the switch again.
		capabilities["rule_toggle"] = len(mihomoRulesFromControllerRaw(raw)) > 0
	}
	if _, exists := capabilities["provider_update"]; !exists {
		capabilities["provider_update"] = true
	}
	if _, exists := capabilities["rule_stats"]; !exists {
		for _, rule := range rules {
			if _, hit := rule["hit_count"]; hit {
				capabilities["rule_stats"] = true
				break
			}
		}
		if _, exists := capabilities["rule_stats"]; !exists {
			capabilities["rule_stats"] = false
		}
	}
	// Keep the API's canonical snake-case keys while retaining any explicit
	// camelCase capability aliases supplied by a newer controller.
	if value, exists := capabilities["ruleToggle"]; exists {
		capabilities["rule_toggle"] = boolAny(value, boolAny(capabilities["rule_toggle"], false))
	}
	if value, exists := capabilities["ruleStats"]; exists {
		capabilities["rule_stats"] = boolAny(value, boolAny(capabilities["rule_stats"], false))
	}
	if value, exists := capabilities["providerUpdate"]; exists {
		capabilities["provider_update"] = boolAny(value, boolAny(capabilities["provider_update"], false))
	}
	return capabilities
}

func firstNumericMapValue(m map[string]any, keys ...string) float64 {
	for _, key := range keys {
		if _, ok := m[key]; ok {
			return numericMapValue(m, key)
		}
	}
	return 0
}

func (a *App) mihomoProvidersPayload() map[string]any {
	proxy := a.mihomoProxyProvidersPayload()
	rule := a.mihomoRuleProvidersPayload()
	return map[string]any{"proxy_providers": proxy["items"], "rule_providers": rule["items"], "proxy": proxy, "rule": rule}
}

func (a *App) mihomoProxyProvidersPayload() map[string]any {
	cfg := a.mihomoConfigMap()
	configProviders := normalizeConfigProviders(cfg["proxy-providers"])
	raw, ok := a.mihomoControllerMap("/providers/proxies")
	runtime := map[string]map[string]any{}
	if ok {
		runtime = normalizeProviderMap(raw["providers"])
	}
	runtimeItems := runtimeProviderItems(runtime, "proxy")
	items := mergeProviders(configProviders, runtime, "proxy")
	a.attachMihomoProviderTestPolicies(items)
	pagePolicy, _, _ := a.mihomoTestPolicyData()
	return map[string]any{"proxy-providers": cfg["proxy-providers"], "items": items, "providers": items, "runtime": runtime, "runtime_items": runtimeItems, "runtime_providers": runtimeItems, "test_policy": pagePolicy, "config_authority": a.mihomoConfigModePayload()}
}

func (a *App) mihomoRuleProvidersPayload() map[string]any {
	cfg := a.mihomoConfigMap()
	configProviders := normalizeConfigProviders(cfg["rule-providers"])
	raw, ok := a.mihomoControllerMap("/providers/rules")
	runtime := map[string]map[string]any{}
	if ok {
		runtime = normalizeProviderMap(raw["providers"])
	}
	runtimeItems := runtimeProviderItems(runtime, "rule")
	items := mergeProviders(configProviders, runtime, "rule")
	for _, item := range items {
		name := stringMapValue(item, "name")
		if state, exists := mihomoRuleProviderRuntimeStates.Load(mihomoRuleProviderRuntimeStateKey(a, name)); exists {
			if runtimeState, ok := state.(mihomoRuleProviderRuntimeState); ok {
				item["using_stale_cache"] = true
				item["stale_cache"] = true
				item["last_update_error"] = runtimeState.Message
				item["last_update_error_code"] = runtimeState.Error
			}
		}
	}
	result := map[string]any{
		"available":            ok,
		"controller_available": ok,
		"source":               "controller",
		"rule-providers":       cfg["rule-providers"],
		"items":                items,
		"providers":            items,
		"runtime":              runtime,
		"runtime_items":        runtimeItems,
		"runtime_providers":    runtimeItems,
		"capabilities":         map[string]any{"provider_update": ok},
	}
	if !ok {
		result["error"] = "controller_unavailable"
		result["message"] = "mihomo controller unavailable"
	}
	return result
}

func (a *App) handleMihomoProxyProviderGet(w http.ResponseWriter, r *http.Request) {
	a.writeMihomoProviderGet(w, r.PathValue("name"), "proxy-providers", "/providers/proxies/")
}

func (a *App) handleMihomoProxyProviderPut(w http.ResponseWriter, r *http.Request) {
	a.writeMihomoProviderUpsert(w, r, r.PathValue("name"), "proxy-providers")
}

func (a *App) handleMihomoProxyProviderDelete(w http.ResponseWriter, r *http.Request) {
	a.writeMihomoProviderDelete(w, r, r.PathValue("name"), "proxy-providers")
}

func (a *App) handleMihomoProxyProviderUpdate(w http.ResponseWriter, r *http.Request) {
	a.writeMihomoProviderRuntimeAction(w, r, r.PathValue("name"), "update")
}

func (a *App) handleMihomoRuleProviders(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": a.mihomoRuleProvidersPayload()})
}

func (a *App) handleMihomoRuleProvidersPut(w http.ResponseWriter, r *http.Request) {
	var req map[string]any
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if err := a.updateMihomoConfigSections(req, "rule-providers"); err != nil {
		writeError(w, http.StatusBadRequest, "write_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "restart_required": true, "data": a.mihomoRuleProvidersPayload()})
}

func (a *App) handleMihomoRuleProviderGet(w http.ResponseWriter, r *http.Request) {
	a.writeMihomoProviderGet(w, r.PathValue("name"), "rule-providers", "/providers/rules/")
}

func (a *App) handleMihomoRuleProviderPut(w http.ResponseWriter, r *http.Request) {
	a.writeMihomoProviderUpsert(w, r, r.PathValue("name"), "rule-providers")
}

func (a *App) handleMihomoRuleProviderDelete(w http.ResponseWriter, r *http.Request) {
	a.writeMihomoProviderDelete(w, r, r.PathValue("name"), "rule-providers")
}

func (a *App) handleMihomoRuleProviderUpdate(w http.ResponseWriter, r *http.Request) {
	a.writeMihomoProviderRuntimeUpdate(w, r.PathValue("name"), "rule")
}

func (a *App) writeMihomoProviderGet(w http.ResponseWriter, name, section, runtimePrefix string) {
	if err := validateMihomoProviderName(name); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	cfgProviders := normalizeConfigProviders(a.mihomoConfigMap()[section])
	item, ok := cfgProviders[name]
	if raw, runtimeOK, _ := a.mihomoControllerJSON(http.MethodGet, runtimePrefix+url.PathEscape(name), nil); runtimeOK {
		item["runtime"] = raw
		ok = true
	}
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "provider not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": item})
}

func (a *App) writeMihomoProviderUpsert(w http.ResponseWriter, r *http.Request, name, section string) {
	var req map[string]any
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	providerName := firstNonEmpty(name, stringMapValue(req, "name"), stringMapValue(req, "tag"))
	if providerName != "" {
		if existing, ok := normalizeConfigProviders(a.mihomoConfigMap()[section])[providerName]; ok {
			req = mergeMihomoMaps(existing, req)
		}
	}
	provider, err := normalizeProviderRequest(providerName, req, section)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	restarted, err := a.applyMihomoConfigMutation(r.Context(), false, func() error {
		return a.upsertMihomoProvider(section, providerName, provider)
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, "write_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "restart_required": false, "restarted": restarted, "data": provider, "mode": a.mihomoConfigModePayload()})
}

func (a *App) writeMihomoProviderDelete(w http.ResponseWriter, r *http.Request, name, section string) {
	if strings.TrimSpace(name) == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "provider name required")
		return
	}
	cfg := a.mihomoConfigMap()
	providers := normalizeConfigProviders(cfg[section])
	delete(providers, name)
	cfg[section] = providerConfigMap(providers)
	restarted, err := a.applyMihomoConfigMutation(r.Context(), false, func() error {
		return a.writeMihomoConfigMap(cfg, section)
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, "write_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "restart_required": false, "restarted": restarted, "mode": a.mihomoConfigModePayload()})
}

func (a *App) writeMihomoProviderRuntimeUpdate(w http.ResponseWriter, name, kind string) {
	if strings.TrimSpace(name) == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "provider name required")
		return
	}
	if err := validateMihomoProviderName(name); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if kind == "proxy" {
		// Proxy provider update has a separate healthcheck action.  Keep the
		// existing proxy-page semantics here; rule-provider updates below are
		// deliberately a single, per-name operation and never a collection loop.
		paths := []string{"/providers/proxies/" + url.PathEscape(name) + "/healthcheck", "/providers/proxies/" + url.PathEscape(name)}
		var lastErr error
		for _, path := range paths {
			if raw, ok, err := a.mihomoControllerJSON(http.MethodPut, path, nil); ok {
				writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": raw})
				return
			} else {
				lastErr = err
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"success": false, "warning": errString(lastErr, "mihomo controller unavailable"), "data": map[string]any{"updated": false}})
		return
	}

	result := a.updateMihomoRuleProviderRuntime(name)
	status := http.StatusOK
	if !result.Success && result.Unsupported {
		status = http.StatusNotImplemented
	}
	writeJSON(w, status, map[string]any{"success": result.Success, "error": result.ErrorCode, "message": result.Message, "data": result.Data})
}

func (a *App) upsertMihomoProvider(section, name string, provider map[string]any) error {
	cfg := a.mihomoConfigMap()
	providers := normalizeConfigProviders(cfg[section])
	if existing, ok := providers[name]; ok {
		provider = mergeMihomoMaps(existing, provider)
	}
	provider["name"] = name
	providers[name] = provider
	cfg[section] = providerConfigMap(providers)
	return a.writeMihomoConfigMap(cfg, section)
}

func normalizeProviderRequest(name string, req map[string]any, section string) (map[string]any, error) {
	raw := firstNonEmpty(stringMapValue(req, "value"), stringMapValue(req, "subscription"), stringMapValue(req, "input"))
	if raw != "" && stringMapValue(req, "url") == "" {
		tag, u := parseTaggedURL(raw)
		if name == "" {
			name = tag
		}
		req["url"] = u
	}
	if name == "" {
		return nil, fmt.Errorf("provider name required")
	}
	u := strings.TrimSpace(stringMapValue(req, "url"))
	providerType := strings.ToLower(strings.TrimSpace(firstNonEmpty(stringMapValue(req, "type"), "http")))
	if u == "" && providerType != "file" {
		return nil, fmt.Errorf("provider url required")
	}
	if providerType == "file" && strings.TrimSpace(stringMapValue(req, "path")) == "" {
		return nil, fmt.Errorf("provider path required")
	}
	provider := map[string]any{}
	for k, v := range req {
		if k == "name" || k == "tag" || k == "value" || k == "subscription" || k == "input" {
			continue
		}
		provider[k] = v
	}
	if provider["type"] == nil {
		provider["type"] = providerType
	}
	if provider["url"] == nil && u != "" {
		provider["url"] = u
	}
	if strings.TrimSpace(stringMapValue(provider, "path")) == "" {
		dir := "proxy_providers"
		ext := ".yaml"
		if section == "rule-providers" {
			dir = "rules"
			ext = ".mrs"
			if provider["behavior"] == nil {
				provider["behavior"] = "classical"
			}
			if provider["format"] == nil {
				provider["format"] = "yaml"
				ext = ".yaml"
			}
		}
		provider["path"] = "./" + filepath.ToSlash(filepath.Join(dir, sanitizeProviderName(name)+ext))
	}
	if provider["interval"] == nil {
		provider["interval"] = 86400
	}
	return provider, nil
}

func parseTaggedURL(raw string) (string, string) {
	parts := strings.SplitN(strings.TrimSpace(raw), "|", 2)
	if len(parts) == 2 {
		return strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
	}
	u := strings.TrimSpace(raw)
	parsed, _ := url.Parse(u)
	name := parsed.Hostname()
	if name == "" {
		name = "provider"
	}
	return name, u
}

func sanitizeProviderName(name string) string {
	name = strings.ToLower(strings.TrimSpace(name))
	replacer := strings.NewReplacer("/", "-", "\\", "-", " ", "-", ":", "-", "|", "-")
	name = replacer.Replace(name)
	name = strings.Trim(name, ".-")
	if name == "" {
		return "provider"
	}
	return name
}

func (a *App) writeMihomoConfigMap(cfg map[string]any, sections ...string) error {
	if mihomoConfigSectionsDefaultSafe(sections) {
		return a.writeMihomoProxyProvidersSection(cfg["proxy-providers"], "system", true)
	}
	if err := a.ensureMihomoGeneratedBackup(); err != nil {
		return err
	}
	b, err := marshalMihomoConfigMap(cfg)
	if err != nil {
		return err
	}
	content := string(b)
	files := map[string]string{mihomoActiveConfigRelPath: content}
	if rel, ok := a.appliedMihomoUserConfigRel(); ok {
		if path, pathErr := a.safePath(rel); pathErr == nil {
			if _, statErr := os.Stat(path); statErr == nil {
				files[rel] = content
			} else if !os.IsNotExist(statErr) {
				return statErr
			}
		}
	}
	if err := a.replaceGeneratedConfigFiles(files, nil); err != nil {
		return err
	}
	if a.mihomoConfigMode() != "generated" || !mihomoConfigSectionsDefaultSafe(sections) {
		a.setMihomoConfigMode("custom")
	}
	return nil
}

func (a *App) syncAppliedMihomoUserConfigAs(content, username string) error {
	rel, ok := a.appliedMihomoUserConfigRel()
	if !ok {
		return nil
	}
	path, err := a.safePath(rel)
	if err != nil {
		return err
	}
	if _, err := os.Stat(path); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if username == "" {
		username = "system"
	}
	if old, err := a.readTextFile(rel); err == nil {
		a.createConfigHistory("mihomo", rel, old, "auto backup before applied Mihomo user config sync", username)
	}
	return a.writeTextFileDirect(rel, content)
}

func normalizeConfigProviders(raw any) map[string]map[string]any {
	out := map[string]map[string]any{}
	switch providers := raw.(type) {
	case map[string]any:
		for name, value := range providers {
			if item, ok := value.(map[string]any); ok {
				item["name"] = name
				out[name] = item
			}
		}
	case map[any]any:
		for key, value := range providers {
			name := fmt.Sprint(key)
			if item, ok := value.(map[string]any); ok {
				item["name"] = name
				out[name] = item
			}
		}
	}
	return out
}

func providerConfigMap(providers map[string]map[string]any) map[string]any {
	out := map[string]any{}
	for name, provider := range providers {
		cp := map[string]any{}
		for k, v := range provider {
			if k == "name" || k == "runtime" || k == "source" || k == "provider_type" {
				continue
			}
			cp[k] = v
		}
		out[name] = cp
	}
	return out
}

func normalizeProviderMap(raw any) map[string]map[string]any {
	out := map[string]map[string]any{}
	if providers, ok := raw.(map[string]any); ok {
		for name, value := range providers {
			if item, ok := value.(map[string]any); ok {
				item["name"] = firstNonEmpty(stringMapValue(item, "name"), name)
				out[name] = item
			}
		}
	}
	return out
}

func mergeProviders(config, runtime map[string]map[string]any, kind string) []map[string]any {
	sorted := make([]string, 0, len(config))
	for name := range config {
		sorted = append(sorted, name)
	}
	sort.Strings(sorted)
	items := make([]map[string]any, 0, len(sorted))
	for _, name := range sorted {
		item := map[string]any{"name": name, "provider_type": kind}
		for k, v := range config[name] {
			item[k] = v
		}
		if rt, ok := runtime[name]; ok {
			item["runtime"] = rt
			mergeMihomoProviderRuntimeFields(item, rt)
			item["source"] = "config+controller"
		} else {
			item["source"] = "config"
		}
		items = append(items, item)
	}
	return items
}

func runtimeProviderItems(runtime map[string]map[string]any, kind string) []map[string]any {
	sorted := make([]string, 0, len(runtime))
	for name, item := range runtime {
		if providerVehicleType(item) == "compatible" {
			continue
		}
		sorted = append(sorted, name)
	}
	sort.Strings(sorted)
	items := make([]map[string]any, 0, len(sorted))
	for _, name := range sorted {
		item := map[string]any{"name": name, "provider_type": kind, "source": "controller"}
		for k, v := range runtime[name] {
			item[k] = v
		}
		mergeMihomoProviderRuntimeFields(item, runtime[name])
		items = append(items, item)
	}
	return items
}

// mergeMihomoProviderRuntimeFields exposes the commonly consumed runtime
// fields at the item level while retaining the complete controller object in
// item["runtime"]. Unknown/future fields remain available through that raw
// nested value and are never discarded by a config edit.
func mergeMihomoProviderRuntimeFields(item, runtime map[string]any) {
	if item == nil || runtime == nil {
		return
	}
	item["runtime_available"] = true
	if vehicleType := firstNonEmpty(stringMapValue(runtime, "vehicleType"), stringMapValue(runtime, "vehicle_type"), stringMapValue(runtime, "vehicle-type")); vehicleType != "" {
		item["vehicle_type"] = vehicleType
		item["vehicleType"] = vehicleType
	}
	if typ := firstNonEmpty(stringMapValue(runtime, "type"), stringMapValue(runtime, "providerType"), stringMapValue(runtime, "provider_type")); typ != "" {
		item["runtime_type"] = typ
	}
	for _, field := range []struct {
		canonical string
		aliases   []string
	}{
		{"behavior", []string{"behavior"}},
		{"format", []string{"format"}},
		{"updated_at", []string{"updatedAt", "updated_at", "lastUpdated", "last_updated"}},
		{"last_updated_at", []string{"lastUpdatedAt", "last_updated_at"}},
		{"using_stale_cache", []string{"using_stale_cache", "usingStaleCache"}},
		{"last_update_error", []string{"last_update_error", "lastUpdateError"}},
	} {
		for _, alias := range field.aliases {
			if value, exists := runtime[alias]; exists {
				item[field.canonical] = value
				break
			}
		}
	}
	if size, ok := mihomoNumericField(runtime, "size", "bytes", "fileSize", "file_size"); ok {
		item["size"] = size
	}
	if count, ok := mihomoNumericField(runtime, "ruleCount", "rule_count", "count", "rulesCount", "rules_count"); ok {
		item["rule_count"] = count
		item["ruleCount"] = count
	} else if count := anyLen(runtime["rules"]); count > 0 {
		item["rule_count"] = count
		item["ruleCount"] = count
	}
	// Keep the original camelCase timestamp as well as the stable snake_case
	// alias expected by the MSF frontend.
	if updatedAt := firstNonEmpty(stringMapValue(runtime, "updatedAt"), stringMapValue(runtime, "updated_at")); updatedAt != "" {
		item["updatedAt"] = updatedAt
		item["updated_at"] = updatedAt
	}
}

func providerVehicleType(item map[string]any) string {
	return strings.ToLower(strings.TrimSpace(firstNonEmpty(
		stringMapValue(item, "vehicleType"),
		stringMapValue(item, "vehicle_type"),
		stringMapValue(item, "vehicle-type"),
	)))
}

func (a *App) handleMihomoUIConfig(w http.ResponseWriter, r *http.Request) {
	cfg := a.mihomoConfigMap()
	ports := mihomoPortsFromConfig(cfg)
	host := r.Host
	if strings.Contains(host, ":") {
		host, _, _ = net.SplitHostPort(host)
	}
	if host == "" {
		host = "127.0.0.1"
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]any{
		"url":        "/ui/",
		"controller": fmt.Sprintf("http://%s:%d", host, ports["controller"]),
		"host":       host,
		"port":       ports["controller"],
		"secret":     a.mihomoSecret(),
		"zashboard":  "/ui/",
	}})
}

func (a *App) downloadConfigDir(w http.ResponseWriter, rel, filename string) {
	root, err := a.safePath(rel)
	if err != nil {
		writeError(w, http.StatusBadRequest, "path_error", err.Error())
		return
	}
	b, err := zipDir(root)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "zip_failed", err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", "attachment; filename="+filename)
	_, _ = w.Write(b)
}

func (a *App) uploadConfigZip(w http.ResponseWriter, r *http.Request, destRel string) {
	if !strings.Contains(r.Header.Get("Content-Type"), "multipart/form-data") {
		writeError(w, http.StatusBadRequest, "bad_upload", "multipart file required")
		return
	}
	if err := r.ParseMultipartForm(128 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "bad_upload", err.Error())
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_upload", err.Error())
		return
	}
	defer file.Close()
	tmp, err := os.CreateTemp("", "msf-config-*.zip")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "temp_failed", err.Error())
		return
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if _, err := io.Copy(tmp, io.LimitReader(file, 128<<20)); err != nil {
		tmp.Close()
		writeError(w, http.StatusInternalServerError, "upload_failed", err.Error())
		return
	}
	tmp.Close()
	dest, err := a.safePath(destRel)
	if err != nil {
		writeError(w, http.StatusBadRequest, "path_error", err.Error())
		return
	}
	if err := restoreZipToDir(tmpPath, dest); err != nil {
		writeError(w, http.StatusBadRequest, "restore_failed", err.Error())
		return
	}
	if destRel == "configs/mihomo" {
		if err := a.reconcileAppliedMihomoUserConfig(); err != nil {
			writeError(w, http.StatusBadRequest, "restore_failed", err.Error())
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "restart_required": true, "data": map[string]any{"restart_required": true}})
}

func filterMihomoProxyList(items []map[string]any, search string) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if strings.Contains(strings.ToLower(strings.Join([]string{
			stringMapValue(item, "name"), stringMapValue(item, "type"), stringMapValue(item, "now"),
		}, " ")), search) {
			out = append(out, item)
		}
	}
	return out
}

func filterMihomoProxyMap(items map[string]any, search string) map[string]any {
	out := map[string]any{}
	for name, item := range items {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if strings.Contains(strings.ToLower(strings.Join([]string{
			name, stringMapValue(m, "name"), stringMapValue(m, "type"), stringMapValue(m, "now"), stringMapValue(m, "provider_name"),
		}, " ")), search) {
			out[name] = item
		}
	}
	return out
}

func latestProxyDelay(item map[string]any) float64 {
	history := anySlice(item["history"])
	if len(history) == 0 {
		return 0
	}
	last, _ := history[len(history)-1].(map[string]any)
	return numericMapValue(last, "delay")
}

func sortMihomoRows(rows []map[string]any, field, order string) {
	field = firstNonEmpty(field, "id")
	order = strings.ToLower(order)
	sort.SliceStable(rows, func(i, j int) bool {
		if field == "download" || field == "upload" || field == "delay" || field == "id" || field == "index" {
			li := numericMapValue(rows[i], field)
			ri := numericMapValue(rows[j], field)
			if order == "asc" {
				return li < ri
			}
			return li > ri
		}
		lv := stringMapValue(rows[i], field)
		rv := stringMapValue(rows[j], field)
		if order == "asc" {
			return lv < rv
		}
		return lv > rv
	})
}

func anyLen(v any) int {
	switch items := v.(type) {
	case []map[string]any:
		return len(items)
	case []any:
		return len(items)
	case []string:
		return len(items)
	case map[string]any:
		return len(items)
	case map[string]string:
		return len(items)
	default:
		return 0
	}
}

func anyMapSlice(v any) []map[string]any {
	switch items := v.(type) {
	case []map[string]any:
		return items
	case []any:
		out := make([]map[string]any, 0, len(items))
		for _, item := range items {
			if m, ok := item.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	default:
		return nil
	}
}

func stringSlice(v any) []string {
	switch items := v.(type) {
	case []string:
		return items
	case []any:
		out := make([]string, 0, len(items))
		for _, item := range items {
			if s := strings.TrimSpace(fmt.Sprint(item)); s != "" {
				out = append(out, s)
			}
		}
		return out
	case string:
		items = strings.TrimSpace(items)
		if items == "" {
			return nil
		}
		return []string{items}
	default:
		return nil
	}
}

func intMapValue(m map[string]any, key string, fallback int) int {
	switch v := m[key].(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	case string:
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func numericMapValue(m map[string]any, key string) float64 {
	if n, ok := firstNumeric(m, key); ok {
		return n
	}
	return 0
}

func intAny(value any, fallback int) int {
	switch v := value.(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	case json.Number:
		n, err := v.Int64()
		if err == nil {
			return int(n)
		}
	case string:
		n, err := strconv.Atoi(v)
		if err == nil {
			return n
		}
	}
	return fallback
}

func boolMapValue(m map[string]any, key string, fallback bool) bool {
	switch v := m[key].(type) {
	case bool:
		return v
	case string:
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return fallback
}

func portFromListen(listen string, fallback int) int {
	listen = strings.TrimSpace(listen)
	if listen == "" {
		return fallback
	}
	if strings.HasPrefix(listen, ":") {
		listen = "127.0.0.1" + listen
	}
	_, port, err := net.SplitHostPort(listen)
	if err != nil {
		parts := strings.Split(listen, ":")
		port = parts[len(parts)-1]
	}
	if n, err := strconv.Atoi(port); err == nil && n > 0 {
		return n
	}
	return fallback
}

var mihomoTCPPortOpen = func(host string, port int) bool {
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, strconv.Itoa(port)), 200*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

func (a *App) tcpPortOpen(host string, port int) bool {
	if port <= 0 {
		return false
	}
	return mihomoTCPPortOpen(host, port)
}

func errString(err error, fallback string) string {
	if err != nil {
		return err.Error()
	}
	return fallback
}
