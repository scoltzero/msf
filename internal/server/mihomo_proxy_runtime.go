package server

// Runtime and editor APIs used by the Mihomo proxy page live in this file so
// that the legacy panel handlers can keep their response shapes.  The
// handlers deliberately go through the controller adapter instead of
// returning a synthetic success response when Mihomo is unavailable.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

const (
	defaultMihomoProxyTestURL = "https://www.gstatic.com/generate_204"
	defaultMihomoProxyTimeout = 5000
	minMihomoProxyTimeout     = 1000
	maxMihomoProxyTimeout     = 120000
	mihomoProxyTimeoutMargin  = 500 * time.Millisecond
)

type mihomoMutationSnapshot map[string]*string

func (a *App) captureMihomoMutationSnapshot(includeManual bool) (mihomoMutationSnapshot, error) {
	rels := []string{mihomoActiveConfigRelPath}
	if rel, ok := a.appliedMihomoUserConfigRel(); ok {
		rels = append(rels, rel)
	}
	if includeManual {
		rels = append(rels, "configs/mihomo/proxy_providers/msf_manual.yaml")
	}
	snapshot := make(mihomoMutationSnapshot, len(rels))
	for _, rel := range rels {
		content, err := a.readTextFile(rel)
		if err == nil {
			copy := content
			snapshot[rel] = &copy
			continue
		}
		if os.IsNotExist(err) {
			snapshot[rel] = nil
			continue
		}
		return nil, err
	}
	return snapshot, nil
}

func (a *App) restoreMihomoMutationSnapshot(snapshot mihomoMutationSnapshot) error {
	files := map[string]string{}
	remove := make([]string, 0)
	for rel, content := range snapshot {
		if content == nil {
			remove = append(remove, rel)
		} else {
			files[rel] = *content
		}
	}
	return a.replaceGeneratedConfigFiles(files, remove)
}

func (a *App) applyMihomoConfigMutation(ctx context.Context, includeManual bool, mutate func() error) (bool, error) {
	snapshot, err := a.captureMihomoMutationSnapshot(includeManual)
	if err != nil {
		return false, fmt.Errorf("create rollback snapshot: %w", err)
	}
	if err := mutate(); err != nil {
		if rollbackErr := a.restoreMihomoMutationSnapshot(snapshot); rollbackErr != nil {
			return false, fmt.Errorf("write failed: %v; rollback failed: %w", err, rollbackErr)
		}
		return false, err
	}
	if !a.Services.Status("mihomo").Installed {
		return false, nil
	}
	status, restartErr := a.Services.Restart(ctx, "mihomo")
	if restartErr == nil && status.Running {
		restartErr = a.probeMihomoConfigController(ctx)
		if restartErr == nil {
			return true, nil
		}
	}
	if restartErr == nil {
		restartErr = fmt.Errorf("mihomo is not running after restart")
	}
	if rollbackErr := a.restoreMihomoMutationSnapshot(snapshot); rollbackErr != nil {
		return false, fmt.Errorf("restart failed: %v; rollback failed: %w", restartErr, rollbackErr)
	}
	_, recoveryErr := a.Services.Restart(ctx, "mihomo")
	if recoveryErr != nil {
		return false, fmt.Errorf("restart failed: %v; old configuration restored but recovery restart failed: %w", restartErr, recoveryErr)
	}
	return false, fmt.Errorf("restart failed, old configuration restored: %w", restartErr)
}

func (a *App) probeMihomoConfigController(ctx context.Context) error {
	deadline := time.Now().Add(4 * time.Second)
	var lastErr error
	for {
		if _, ok, err := a.mihomoControllerJSON(http.MethodGet, "/configs", nil); ok {
			return nil
		} else {
			lastErr = err
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("controller /configs probe failed: %w", lastErr)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(150 * time.Millisecond):
		}
	}
}

func mihomoPathSegment(value string) string {
	return url.PathEscape(value)
}

func mihomoDelayQuery(r *http.Request, withDefaults bool) string {
	q := r.URL.Query()
	if withDefaults {
		if strings.TrimSpace(q.Get("url")) == "" {
			q.Set("url", defaultMihomoProxyTestURL)
		}
		if strings.TrimSpace(q.Get("timeout")) == "" {
			q.Set("timeout", strconv.Itoa(defaultMihomoProxyTimeout))
		}
	}
	if raw := strings.TrimSpace(q.Get("timeout")); raw != "" {
		q.Set("timeout", strconv.Itoa(normalizeMihomoProxyTimeout(raw)))
	}
	return q.Encode()
}

func normalizeMihomoProxyTimeout(raw string) int {
	timeout, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return defaultMihomoProxyTimeout
	}
	if timeout < minMihomoProxyTimeout {
		return minMihomoProxyTimeout
	}
	if timeout > maxMihomoProxyTimeout {
		return maxMihomoProxyTimeout
	}
	return timeout
}

func mihomoProxyTestControllerTimeout(raw string) time.Duration {
	timeout := defaultMihomoProxyTimeout
	if strings.TrimSpace(raw) != "" {
		timeout = normalizeMihomoProxyTimeout(raw)
	}
	return time.Duration(timeout)*time.Millisecond + mihomoProxyTimeoutMargin
}

func mihomoRequestProxyTestControllerTimeout(r *http.Request) time.Duration {
	return mihomoProxyTestControllerTimeout(r.URL.Query().Get("timeout"))
}

func mihomoAppendQuery(path, query string) string {
	if strings.TrimSpace(query) == "" {
		return path
	}
	return path + "?" + query
}

func (a *App) handleMihomoProxyGroupDelay(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "proxy group name required")
		return
	}
	path := "/group/" + mihomoPathSegment(name) + "/delay"
	path = mihomoAppendQuery(path, mihomoDelayQuery(r, true))
	raw, ok, err := a.mihomoControllerJSONWithTimeout(http.MethodGet, path, nil, mihomoRequestProxyTestControllerTimeout(r))
	if !ok {
		// A running controller that does not implement this endpoint is a
		// supported Mihomo downgrade path; let the browser run scoped tests.
		if mihomoHTTPStatus(err) == http.StatusNotFound {
			writeJSON(w, http.StatusOK, map[string]any{
				"success": false,
				"error":   "group_delay_unsupported",
				"message": "当前 Mihomo 不支持策略组测速，请改用逐节点测速",
				"data": map[string]any{
					"group":     name,
					"delays":    map[string]any{},
					"supported": false,
				},
			})
			return
		}
		writeMihomoProxyTestError(w, err)
		return
	}
	delays := mihomoDelayValues(raw)
	if len(delays) == 0 {
		if item, ok := raw.(map[string]any); ok {
			if delay, ok := mihomoDelayAny(item["delay"]); ok {
				delays[name] = delay
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"group":     name,
			"delays":    delays,
			"tested_at": time.Now().UTC().Format(time.RFC3339Nano),
			"supported": true,
			"raw":       raw,
		},
	})
}

func (a *App) handleMihomoProviderProxyDelay(w http.ResponseWriter, r *http.Request) {
	provider := r.PathValue("provider")
	proxy := r.PathValue("proxy")
	if provider == "" || proxy == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "provider and proxy names required")
		return
	}
	path := "/providers/proxies/" + mihomoPathSegment(provider) + "/" + mihomoPathSegment(proxy) + "/healthcheck"
	path = mihomoAppendQuery(path, mihomoDelayQuery(r, false))
	raw, ok, err := a.mihomoControllerJSONWithTimeout(http.MethodGet, path, nil, mihomoRequestProxyTestControllerTimeout(r))
	if !ok {
		writeMihomoProxyTestError(w, err)
		return
	}
	data := map[string]any{
		"provider":  provider,
		"proxy":     proxy,
		"delay":     mihomoDelayValue(raw),
		"tested_at": time.Now().UTC().Format(time.RFC3339Nano),
		"raw":       raw,
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": data})
}

func (a *App) handleMihomoProxyProviderHealthcheck(w http.ResponseWriter, r *http.Request) {
	a.writeMihomoProviderRuntimeAction(w, r, r.PathValue("name"), "healthcheck")
}

func (a *App) writeMihomoProviderRuntimeAction(w http.ResponseWriter, r *http.Request, name, operation string) {
	if strings.TrimSpace(name) == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "provider name required")
		return
	}
	method := http.MethodPut
	path := "/providers/proxies/" + mihomoPathSegment(name)
	controllerTimeout := 1500 * time.Millisecond
	if operation == "healthcheck" {
		method = http.MethodGet
		path += "/healthcheck"
		controllerTimeout = mihomoProxyTestControllerTimeout("")
		// A body is only a per-run override.  It never changes the persisted
		// provider health-check policy.
		if r.Body != nil {
			body, _ := io.ReadAll(io.LimitReader(r.Body, 64<<10))
			var override map[string]any
			if json.Unmarshal(body, &override) == nil {
				q := url.Values{}
				if value := strings.TrimSpace(fmt.Sprint(override["url"])); value != "" && value != "<nil>" {
					q.Set("url", value)
				}
				if value := strings.TrimSpace(fmt.Sprint(override["timeout"])); value != "" && value != "<nil>" {
					q.Set("timeout", strconv.Itoa(normalizeMihomoProxyTimeout(value)))
					controllerTimeout = mihomoProxyTestControllerTimeout(value)
				}
				path = mihomoAppendQuery(path, q.Encode())
			}
		}
	}
	raw, ok, err := a.mihomoControllerJSONWithTimeout(method, path, nil, controllerTimeout)
	if !ok {
		if operation == "healthcheck" {
			writeMihomoProxyTestError(w, err)
		} else {
			writeMihomoControllerError(w, err)
		}
		return
	}
	// Keep a small, stable operation marker while retaining every controller
	// field.  `healthcheck` is kept as a compatibility alias for older clients
	// that only rendered the previous combined action response.
	data := map[string]any{"operation": operation}
	if item, ok := raw.(map[string]any); ok {
		for key, value := range item {
			data[key] = value
		}
	}
	if operation == "healthcheck" {
		data["healthcheck"] = true
	} else {
		data["updated"] = true
		data["healthcheck"] = true
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": data})
}

func (a *App) handleMihomoProxyGroupConnectionsClose(w http.ResponseWriter, r *http.Request) {
	group := r.PathValue("group")
	if group == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "proxy group name required")
		return
	}
	raw, ok, err := a.mihomoControllerJSON(http.MethodGet, "/connections", nil)
	if !ok {
		writeMihomoControllerError(w, err)
		return
	}
	connections := mihomoConnectionMaps(raw)
	failed := make([]string, 0)
	matched, closed := 0, 0
	for index, connection := range connections {
		if !mihomoConnectionHasExactChain(connection, group) {
			continue
		}
		matched++
		id := firstNonEmpty(stringMapValue(connection, "id"), fmt.Sprintf("conn-%d", index+1))
		if id == "" {
			failed = append(failed, id)
			continue
		}
		path := "/connections/" + mihomoPathSegment(id)
		if _, ok, _ := a.mihomoControllerJSON(http.MethodDelete, path, nil); ok {
			closed++
		} else {
			failed = append(failed, id)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"group":      group,
			"matched":    matched,
			"closed":     closed,
			"failed_ids": failed,
		},
	})
}

func mihomoConnectionMaps(raw any) []map[string]any {
	if item, ok := raw.(map[string]any); ok {
		return anyMapSlice(item["connections"])
	}
	return anyMapSlice(raw)
}

func mihomoConnectionHasExactChain(connection map[string]any, group string) bool {
	for _, chain := range stringSlice(connection["chains"]) {
		if chain == group {
			return true
		}
	}
	return false
}

func mihomoHTTPStatus(err error) int {
	if err == nil {
		return 0
	}
	var controllerErr *mihomoControllerHTTPError
	if errors.As(err, &controllerErr) {
		return controllerErr.StatusCode
	}
	const prefix = "mihomo controller http "
	message := err.Error()
	if !strings.HasPrefix(message, prefix) {
		return 0
	}
	status, _ := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(message, prefix)))
	return status
}

func writeMihomoProxyTestError(w http.ResponseWriter, err error) {
	status := http.StatusBadGateway
	code := "proxy_test_failed"
	payload := map[string]any{
		"success": false,
		"error":   code,
		"message": errString(err, "mihomo proxy test failed"),
	}
	var netErr interface{ Timeout() bool }
	if errors.As(err, &netErr) && netErr.Timeout() {
		status = http.StatusGatewayTimeout
		payload["error"] = "proxy_test_timeout"
	}
	if upstreamStatus := mihomoHTTPStatus(err); upstreamStatus != 0 {
		payload["upstream_status"] = upstreamStatus
	}
	writeJSON(w, status, payload)
}

func writeMihomoControllerError(w http.ResponseWriter, err error) {
	writeJSON(w, http.StatusBadGateway, map[string]any{
		"success": false,
		"error":   "controller_unavailable",
		"message": errString(err, "mihomo controller unavailable"),
	})
}

func mihomoDelayValues(raw any) map[string]any {
	if m, ok := raw.(map[string]any); ok {
		for _, key := range []string{"delays", "proxies", "data"} {
			if nested, ok := m[key]; ok {
				if values := mihomoDelayValues(nested); len(values) > 0 {
					return values
				}
			}
		}
		values := map[string]any{}
		for key, value := range m {
			if key == "delay" || key == "tested_at" || key == "supported" {
				continue
			}
			if _, ok := mihomoDelayAny(value); ok {
				values[key] = value
			}
		}
		if len(values) > 0 {
			return values
		}
		if name := stringMapValue(m, "name"); name != "" {
			if value, ok := mihomoDelayAny(m["delay"]); ok {
				return map[string]any{name: value}
			}
		}
	}
	return map[string]any{}
}

func mihomoDelayValue(raw any) any {
	if m, ok := raw.(map[string]any); ok {
		for _, key := range []string{"delay", "meanDelay", "mean_delay", "latency"} {
			if value, exists := m[key]; exists {
				if parsed, ok := mihomoDelayAny(value); ok {
					return parsed
				}
				return value
			}
		}
		if nested, exists := m["data"]; exists {
			return mihomoDelayValue(nested)
		}
	}
	return raw
}

func mihomoDelayAny(value any) (any, bool) {
	switch v := value.(type) {
	case int:
		return v, true
	case int8:
		return v, true
	case int16:
		return v, true
	case int32:
		return v, true
	case int64:
		return v, true
	case uint:
		return v, true
	case uint8:
		return v, true
	case uint16:
		return v, true
	case uint32:
		return v, true
	case uint64:
		return v, true
	case float32:
		return v, true
	case float64:
		return v, true
	case json.Number:
		if n, err := v.Float64(); err == nil {
			return n, true
		}
	case string:
		if n, err := strconv.ParseFloat(strings.TrimSpace(v), 64); err == nil {
			return n, true
		}
	}
	return nil, false
}

func cloneMihomoValue(value any) any {
	switch v := value.(type) {
	case map[string]any:
		return cloneMihomoMap(v)
	case []any:
		out := make([]any, len(v))
		for i, item := range v {
			out[i] = cloneMihomoValue(item)
		}
		return out
	case []map[string]any:
		out := make([]map[string]any, len(v))
		for i, item := range v {
			out[i] = cloneMihomoMap(item)
		}
		return out
	default:
		return value
	}
}

func cloneMihomoMap(value map[string]any) map[string]any {
	out := make(map[string]any, len(value))
	for key, item := range value {
		out[key] = cloneMihomoValue(item)
	}
	return out
}

func mergeMihomoMaps(base, patch map[string]any) map[string]any {
	out := cloneMihomoMap(base)
	for key, value := range patch {
		if left, ok := out[key].(map[string]any); ok {
			if right, ok := value.(map[string]any); ok {
				out[key] = mergeMihomoMaps(left, right)
				continue
			}
		}
		out[key] = cloneMihomoValue(value)
	}
	return out
}

func (a *App) updateMihomoProxyProviderCollection(req map[string]any) error {
	cfg := a.mihomoConfigMap()
	current := normalizeConfigProviders(cfg["proxy-providers"])
	incoming := req
	if value, ok := req["proxy-providers"]; ok {
		incoming = mihomoMapValueMap(value)
	}
	if incoming == nil {
		incoming = map[string]any{}
	}
	merged := map[string]map[string]any{}
	for name, value := range incoming {
		item := mihomoMapValueMap(value)
		if item == nil {
			continue
		}
		if old, exists := current[name]; exists {
			item = mergeMihomoMaps(old, item)
		}
		normalized, err := normalizeProviderRequest(name, item, "proxy-providers")
		if err != nil {
			return err
		}
		item = normalized
		item["name"] = name
		merged[name] = item
	}
	cfg["proxy-providers"] = providerConfigMap(merged)
	return a.writeMihomoConfigMap(cfg, "proxy-providers")
}

func mihomoMapValueMap(value any) map[string]any {
	switch v := value.(type) {
	case map[string]any:
		return v
	case map[any]any:
		out := make(map[string]any, len(v))
		for key, item := range v {
			out[fmt.Sprint(key)] = item
		}
		return out
	default:
		return nil
	}
}

func (a *App) mihomoTestPolicyData() (map[string]any, map[string]map[string]any, map[string]map[string]any) {
	page := map[string]any{"url": defaultMihomoProxyTestURL, "timeout_ms": defaultMihomoProxyTimeout, "source": "page-fallback", "persisted": false}
	groups := map[string]map[string]any{}
	providers := map[string]map[string]any{}
	cfg := a.mihomoConfigMap()
	for _, item := range anySlice(cfg["proxy-groups"]) {
		group := mihomoMapValueMap(item)
		if group == nil {
			continue
		}
		name := stringMapValue(group, "name")
		if name == "" {
			continue
		}
		policy := map[string]any{"url": defaultMihomoProxyTestURL, "timeout_ms": defaultMihomoProxyTimeout, "source": "page-fallback", "persisted": false}
		if u := strings.TrimSpace(stringMapValue(group, "url")); u != "" {
			policy["url"], policy["source"], policy["source_name"], policy["persisted"] = u, "group-config", name, true
		}
		if timeout := firstNumericMapValue(group, "timeout", "timeout_ms"); timeout > 0 {
			policy["timeout_ms"] = int(timeout)
		}
		for _, key := range []string{"interval", "lazy"} {
			if value, ok := group[key]; ok {
				policy[key] = value
			}
		}
		groups[name] = policy
	}
	for name, provider := range normalizeConfigProviders(cfg["proxy-providers"]) {
		policy := map[string]any{"url": defaultMihomoProxyTestURL, "timeout_ms": defaultMihomoProxyTimeout, "source": "page-fallback", "persisted": false}
		if health := mihomoMapValueMap(provider["health-check"]); health != nil {
			if u := strings.TrimSpace(stringMapValue(health, "url")); u != "" {
				policy["url"], policy["source"], policy["source_name"], policy["persisted"] = u, "provider-config", name, true
			}
			for _, key := range []string{"enable", "interval", "lazy", "timeout"} {
				if value, ok := health[key]; ok {
					policy[key] = value
				}
			}
			if timeout := firstNumericMapValue(health, "timeout", "timeout_ms"); timeout > 0 {
				policy["timeout_ms"] = int(timeout)
			}
		}
		providers[name] = policy
	}
	return page, groups, providers
}

func (a *App) attachMihomoTestPolicies(groups []map[string]any) {
	_, policies, _ := a.mihomoTestPolicyData()
	for _, item := range groups {
		if policy, ok := policies[stringMapValue(item, "name")]; ok {
			item["test_policy"] = policy
		}
	}
}

func (a *App) attachMihomoProviderTestPolicies(items []map[string]any) {
	_, _, policies := a.mihomoTestPolicyData()
	for _, item := range items {
		if policy, ok := policies[stringMapValue(item, "name")]; ok {
			item["test_policy"] = policy
		}
	}
}

func (a *App) handleMihomoProxyConfigValidate(w http.ResponseWriter, r *http.Request) {
	var req map[string]any
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if strings.EqualFold(strings.TrimSpace(stringMapValue(req, "scope")), "rules") {
		validation := a.validateMihomoRulesConfigRequest(req)
		resp := map[string]any{"success": true, "valid": validation.Valid, "warnings": validation.Warnings, "data": validation}
		if !validation.Valid {
			resp["error"] = validation.Error
		}
		writeJSON(w, http.StatusOK, resp)
		return
	}
	content, err := a.mihomoCandidateConfigContent(req)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"success": true, "valid": false, "data": mihomoConfigValidation{Valid: false, Error: err.Error()}})
		return
	}
	validation := a.validateMihomoCandidateContent(r.Context(), content)
	resp := map[string]any{"success": true, "valid": validation.Valid, "warnings": validation.Warnings, "data": validation}
	if !validation.Valid {
		resp["error"] = validation.Error
	}
	writeJSON(w, http.StatusOK, resp)
}

func (a *App) validateMihomoCandidateContent(ctx context.Context, content string) mihomoConfigValidation {
	validation := a.validateMihomoConfigContent(content)
	if !validation.Valid {
		return validation
	}
	var cfg map[string]any
	if err := yaml.Unmarshal([]byte(content), &cfg); err != nil {
		return mihomoConfigValidation{Valid: false, Error: err.Error(), Warnings: validation.Warnings}
	}
	if err := validateMihomoCandidateStructure(cfg); err != nil {
		return mihomoConfigValidation{Valid: false, Error: err.Error(), Warnings: validation.Warnings}
	}
	if err := a.testMihomoCandidateWithCore(ctx, content); err != nil {
		return mihomoConfigValidation{Valid: false, Error: err.Error(), Warnings: validation.Warnings}
	}
	return validation
}

func (a *App) testMihomoCandidateWithCore(ctx context.Context, content string) error {
	spec, err := a.Services.spec("mihomo")
	if err != nil {
		return err
	}
	if _, err := os.Stat(spec.Binary); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return fmt.Errorf("inspect Mihomo binary: %w", err)
	}
	tmpDir := filepath.Join(a.DataDir, "data", "tmp")
	if err := os.MkdirAll(tmpDir, 0700); err != nil {
		return fmt.Errorf("prepare Mihomo validation directory: %w", err)
	}
	tmp, err := os.CreateTemp(tmpDir, ".msf-mihomo-candidate-*.yaml")
	if err != nil {
		return fmt.Errorf("create Mihomo validation file: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err := tmp.Chmod(0600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.WriteString(content); err != nil {
		tmp.Close()
		return fmt.Errorf("write Mihomo validation file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return err
	}

	testCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(testCtx, spec.Binary, "-t", "-d", spec.Dir, "-f", tmpPath)
	cmd.Dir = spec.Dir
	output, runErr := cmd.CombinedOutput()
	text := strings.TrimSpace(string(output))
	failedOutput := strings.Contains(strings.ToLower(text), "level=fatal") || strings.Contains(text, "Parse config error")
	if runErr == nil && !failedOutput {
		return nil
	}
	if testCtx.Err() != nil {
		return fmt.Errorf("Mihomo configuration test timed out: %w", testCtx.Err())
	}
	lines := strings.Split(text, "\n")
	if len(lines) > 12 {
		lines = lines[len(lines)-12:]
	}
	message := strings.TrimSpace(strings.Join(lines, "\n"))
	if message == "" {
		message = runErr.Error()
	}
	return fmt.Errorf("Mihomo configuration test failed: %s", message)
}

func (a *App) mihomoCandidateConfigContent(req map[string]any) (string, error) {
	if content := strings.TrimSpace(stringMapValue(req, "content")); content != "" {
		return content, nil
	}
	base := a.mihomoConfigMap()
	scope := strings.ToLower(strings.TrimSpace(firstNonEmpty(stringMapValue(req, "scope"), stringMapValue(req, "section"))))
	draft := req["draft"]
	if draft == nil {
		draft = req["config"]
	}
	if draft == nil {
		draft = req["value"]
	}
	if scope == "" {
		if _, ok := req["proxy-groups"]; ok {
			scope = "proxy-groups"
			draft = req["proxy-groups"]
		} else if _, ok := req["proxy_groups"]; ok {
			scope = "proxy-groups"
			draft = req["proxy_groups"]
		} else if _, ok := req["proxy-providers"]; ok {
			scope = "proxy-providers"
			draft = req["proxy-providers"]
		} else if _, ok := req["proxy_providers"]; ok {
			scope = "proxy-providers"
			draft = req["proxy_providers"]
		}
	}
	if scope == "" {
		if value, ok := draft.(string); ok && strings.TrimSpace(value) != "" {
			return value, nil
		}
		return "", fmt.Errorf("candidate config content or scope is required")
	}
	section := strings.ReplaceAll(scope, "_", "-")
	if section == "manual-proxies" {
		content := ""
		if object := mihomoMapValueMap(draft); object != nil {
			content = firstNonEmpty(stringMapValue(object, "content"), stringMapValue(object, "input"), stringMapValue(object, "yaml"), stringMapValue(object, "links"))
		} else if value, ok := draft.(string); ok {
			content = value
		}
		validation := validateMihomoManualProxyContent(content)
		if !validation.Valid {
			return "", fmt.Errorf("%s", validation.Error)
		}
		base["proxies"] = mihomoManualProxyMaps(content)
		b, err := marshalMihomoConfigMap(base)
		if err != nil {
			return "", err
		}
		return string(b), nil
	}
	if object := mihomoMapValueMap(draft); object != nil {
		for _, key := range []string{section, strings.ReplaceAll(section, "-", "_"), "groups", "providers", "proxies"} {
			if value, ok := object[key]; ok {
				draft = value
				break
			}
		}
	}
	if draft == nil {
		draft = req[section]
	}
	if draft == nil {
		return "", fmt.Errorf("draft is required for %s", scope)
	}
	base[section] = draft
	b, err := marshalMihomoConfigMap(base)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func mihomoManualProxyMaps(content string) []map[string]any {
	input := strings.TrimSpace(content)
	if input == "" {
		return nil
	}
	if strings.HasPrefix(input, "proxies:") || strings.HasPrefix(input, "- ") {
		candidate := input
		if strings.HasPrefix(input, "- ") {
			candidate = "proxies:\n" + indentYAML(input, 2)
		}
		var cfg map[string]any
		if yaml.Unmarshal([]byte(candidate), &cfg) == nil {
			return anyMapSlice(cfg["proxies"])
		}
		return nil
	}
	return parseMihomoManualProxyLinks(input)
}

func validateMihomoCandidateStructure(cfg map[string]any) error {
	proxies := map[string]bool{}
	if raw := mihomoMapValueMap(cfg["proxies"]); raw != nil {
		for name := range raw {
			proxies[name] = true
		}
	} else {
		for _, item := range anySlice(cfg["proxies"]) {
			if name := strings.TrimSpace(stringMapValue(mihomoMapValueMap(item), "name")); name != "" {
				proxies[name] = true
			}
		}
	}
	providers := map[string]bool{}
	for name := range normalizeConfigProviders(cfg["proxy-providers"]) {
		providers[name] = true
	}
	groups := map[string]map[string]any{}
	for _, raw := range anySlice(cfg["proxy-groups"]) {
		group := mihomoMapValueMap(raw)
		if group == nil {
			continue
		}
		name := strings.TrimSpace(stringMapValue(group, "name"))
		if name == "" {
			return fmt.Errorf("proxy group name is required")
		}
		if _, exists := groups[name]; exists {
			return fmt.Errorf("duplicate proxy group name: %s", name)
		}
		groups[name] = group
	}
	for name, group := range groups {
		for _, member := range stringSlice(group["proxies"]) {
			if proxies[member] || mihomoBuiltinProxyName(member) {
				continue
			}
			if _, exists := groups[member]; exists {
				continue
			}
			return fmt.Errorf("proxy group %s references unknown proxy %s", name, member)
		}
		for _, provider := range stringSlice(group["use"]) {
			if !providers[provider] {
				return fmt.Errorf("proxy group %s references unknown provider %s", name, provider)
			}
		}
	}
	visiting, visited := map[string]bool{}, map[string]bool{}
	var visit func(string) error
	visit = func(name string) error {
		if visiting[name] {
			return fmt.Errorf("proxy group cycle detected at %s", name)
		}
		if visited[name] {
			return nil
		}
		visiting[name] = true
		for _, member := range stringSlice(groups[name]["proxies"]) {
			if _, nested := groups[member]; nested {
				if err := visit(member); err != nil {
					return err
				}
			}
		}
		delete(visiting, name)
		visited[name] = true
		return nil
	}
	for name := range groups {
		if err := visit(name); err != nil {
			return err
		}
	}
	if raw := anySlice(cfg["proxies"]); len(raw) > 0 {
		seen := map[string]bool{}
		for _, item := range raw {
			name := stringMapValue(mihomoMapValueMap(item), "name")
			if name == "" {
				continue
			}
			if seen[name] {
				return fmt.Errorf("duplicate proxy name: %s", name)
			}
			seen[name] = true
		}
	}
	return nil
}

func mihomoBuiltinProxyName(name string) bool {
	switch strings.ToUpper(strings.TrimSpace(name)) {
	case "DIRECT", "REJECT", "REJECT-DROP", "PASS", "COMPATIBLE", "GLOBAL":
		return true
	default:
		return false
	}
}

func (a *App) handleMihomoManualProxiesGet(w http.ResponseWriter, r *http.Request) {
	cfg, _, _ := a.latestSetupConfigForSettingsRaw()
	content := strings.TrimSpace(cfg.MihomoProxies)
	if file, err := a.readTextFile("configs/mihomo/proxy_providers/msf_manual.yaml"); err == nil && content == "" {
		content = strings.TrimSpace(file)
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": a.mihomoManualProxyPayload(content)})
}

func (a *App) handleMihomoManualProxiesPut(w http.ResponseWriter, r *http.Request) {
	var req map[string]any
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	content := firstNonEmpty(stringMapValue(req, "content"), stringMapValue(req, "input"), stringMapValue(req, "mihomo_proxies"), stringMapValue(req, "mihomoProxies"))
	if content == "" && req["proxies"] != nil {
		if b, err := yaml.Marshal(map[string]any{"proxies": req["proxies"]}); err == nil {
			content = string(b)
		}
	}
	validation := validateMihomoManualProxyContent(content)
	if !validation.Valid {
		writeJSON(w, http.StatusOK, map[string]any{"success": false, "error": validation.Error, "data": validation})
		return
	}
	cfg, initialized, setupExists := a.latestSetupConfigForSettingsRaw()
	cfg.MihomoProxies = content
	restart := !strings.EqualFold(r.URL.Query().Get("restart"), "false")
	var applyErr error
	restarted := false
	if restart {
		restarted, applyErr = a.applyMihomoConfigMutation(r.Context(), true, func() error {
			return a.syncMihomoProxyProvidersFromSetupConfig(cfg, currentUsername(r))
		})
	} else {
		snapshot, snapshotErr := a.captureMihomoMutationSnapshot(true)
		if snapshotErr != nil {
			applyErr = snapshotErr
		} else if applyErr = a.syncMihomoProxyProvidersFromSetupConfig(cfg, currentUsername(r)); applyErr != nil {
			if rollbackErr := a.restoreMihomoMutationSnapshot(snapshot); rollbackErr != nil {
				applyErr = fmt.Errorf("write failed: %v; rollback failed: %w", applyErr, rollbackErr)
			}
		}
	}
	if applyErr != nil {
		writeError(w, http.StatusBadRequest, "write_failed", applyErr.Error())
		return
	}
	if setupExists {
		if _, err := a.insertSetupSnapshot(cfg, initialized); err != nil {
			writeError(w, http.StatusBadRequest, "write_failed", err.Error())
			return
		}
	}
	payload := a.mihomoManualProxyPayload(content)
	payload["restarted"] = restarted
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "restart_required": !restarted, "restarted": restarted, "data": payload})
}

func (a *App) mihomoManualProxyPayload(content string) map[string]any {
	mode := "links"
	input := strings.TrimSpace(content)
	var proxies []map[string]any
	if strings.HasPrefix(input, "proxies:") || strings.HasPrefix(input, "- ") {
		mode = "yaml"
		var cfg map[string]any
		if err := yaml.Unmarshal([]byte(input), &cfg); err == nil {
			proxies = anyMapSlice(cfg["proxies"])
		}
	} else {
		proxies = parseMihomoManualProxyLinks(input)
	}
	names := make([]string, 0, len(proxies))
	for _, proxy := range proxies {
		if name := stringMapValue(proxy, "name"); name != "" {
			names = append(names, name)
		}
	}
	return map[string]any{
		"input_mode": mode,
		"content":    input,
		"source":     input,
		"summary":    map[string]any{"count": len(proxies), "names": names, "proxies": proxies},
		"mode":       a.mihomoConfigModePayload(),
	}
}

func validateMihomoManualProxyContent(content string) mihomoConfigValidation {
	input := strings.TrimSpace(content)
	if input == "" {
		return mihomoConfigValidation{Valid: true}
	}
	if strings.HasPrefix(input, "proxies:") || strings.HasPrefix(input, "- ") {
		candidate := input
		if strings.HasPrefix(input, "- ") {
			candidate = "proxies:\n" + indentYAML(input, 2)
		}
		var cfg map[string]any
		if err := yaml.Unmarshal([]byte(candidate), &cfg); err != nil {
			return mihomoConfigValidation{Valid: false, Error: err.Error()}
		}
		seen := map[string]bool{}
		for _, item := range anyMapSlice(cfg["proxies"]) {
			name := strings.TrimSpace(stringMapValue(item, "name"))
			if name == "" {
				return mihomoConfigValidation{Valid: false, Error: "manual proxy name is required"}
			}
			if seen[name] {
				return mihomoConfigValidation{Valid: false, Error: "duplicate manual proxy name: " + name}
			}
			seen[name] = true
		}
		return mihomoConfigValidation{Valid: true}
	}
	for _, token := range strings.Fields(input) {
		if _, ok := parseMihomoManualProxyLink(token); !ok {
			return mihomoConfigValidation{Valid: false, Error: "unsupported proxy share link: " + token}
		}
	}
	return mihomoConfigValidation{Valid: true}
}
