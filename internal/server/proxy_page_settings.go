package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

const proxyPageSettingsKey = "mihomo.proxy_page.settings.v3"

var proxyPageBooleans = []string{
	"groupProxiesByProvider", "hideUnavailable", "showHiddenProxies", "manageHiddenGroups",
	"autoDisconnectOnSwitch", "displayFinalOutbound", "disableProxiesPageTextSelect",
	"doubleColumn", "displayGlobalByMode",
}

var proxyPageNumbers = map[string][2]float64{
	"minProxyCardWidth": {96, 640}, "delayTimeoutMs": {1000, 120000},
	"delayLowMs": {0, 60000}, "delayHighMs": {0, 120000},
	"proxyGroupIconSize": {12, 64}, "proxyGroupIconMargin": {0, 32},
}

var proxyPageEnums = map[string][]string{
	"sortBy":           {"default", "name-asc", "name-desc", "delay-asc", "delay-desc", "type"},
	"nodeNameDisplay":  {"truncate", "wrap"},
	"proxyPreviewType": {"auto", "dots", "bar"},
	"proxyCardSize":    {"compact", "comfortable"},
}

func validateProxyPageSettings(value map[string]any) error {
	// A complete v3 snapshot avoids partial writes dropping unrelated fields.
	optional := 0
	for _, key := range []string{"delayTestOverrideEnabled", "delayTestOverrideUrl"} {
		if _, ok := value[key]; ok {
			optional++
		}
	}
	if len(value) != 1+len(proxyPageBooleans)+len(proxyPageNumbers)+len(proxyPageEnums)+3+optional {
		return fmt.Errorf("expected a complete v3 proxy page settings snapshot")
	}
	if value["version"] != float64(3) {
		return fmt.Errorf("unsupported proxy page settings version")
	}
	for _, key := range proxyPageBooleans {
		if _, ok := value[key].(bool); !ok {
			return fmt.Errorf("%s must be a boolean", key)
		}
	}
	for key, bounds := range proxyPageNumbers {
		n, ok := value[key].(float64)
		if !ok || n < bounds[0] || n > bounds[1] {
			return fmt.Errorf("%s is out of range", key)
		}
	}
	for key, choices := range proxyPageEnums {
		text, ok := value[key].(string)
		if !ok || !oneOf(text, choices...) {
			return fmt.Errorf("invalid %s", key)
		}
	}
	testURL, ok := value["delayTestUrl"].(string)
	if !ok || !validMihomoTestURL(testURL) {
		return fmt.Errorf("delayTestUrl must be an HTTP(S) URL")
	}
	if raw, exists := value["delayTestOverrideEnabled"]; exists {
		if _, ok := raw.(bool); !ok {
			return fmt.Errorf("delayTestOverrideEnabled must be a boolean")
		}
	}
	if raw, exists := value["delayTestOverrideUrl"]; exists {
		u, ok := raw.(string)
		if !ok || (u != "" && !validMihomoTestURL(u)) {
			return fmt.Errorf("delayTestOverrideUrl must be an HTTP(S) URL or empty")
		}
	}
	if boolMapValue(value, "delayTestOverrideEnabled", false) && !validMihomoTestURL(stringMapValue(value, "delayTestOverrideUrl")) {
		return fmt.Errorf("开启全局覆盖前请填写有效的 HTTP(S) 测速 URL")
	}
	for _, key := range []string{"groupOrder", "hiddenGroups"} {
		items, ok := value[key].([]any)
		if !ok || len(items) > 2048 {
			return fmt.Errorf("invalid %s", key)
		}
		for _, item := range items {
			text, ok := item.(string)
			if !ok || strings.TrimSpace(text) == "" || len(text) > 512 {
				return fmt.Errorf("invalid %s item", key)
			}
		}
	}
	return nil
}

func (a *App) handleProxyPageSettingsGet(w http.ResponseWriter, r *http.Request) {
	value, exists := a.settingValue(proxyPageSettingsKey)
	if !exists {
		writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": nil})
		return
	}
	var settings map[string]any
	if err := json.Unmarshal([]byte(value), &settings); err != nil {
		writeError(w, http.StatusInternalServerError, "settings_error", "invalid stored proxy page settings")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": settings})
}

func (a *App) handleProxyPageSettingsPut(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(r) {
		writeError(w, http.StatusForbidden, "admin_required", "仅管理员可以修改代理页面设置")
		return
	}
	defer r.Body.Close()
	var settings map[string]any
	decoder := json.NewDecoder(io.LimitReader(r.Body, 64*1024+1))
	if err := decoder.Decode(&settings); err != nil || settings == nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid proxy page settings")
		return
	}
	if err := validateProxyPageSettings(settings); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	value, err := json.Marshal(settings)
	if err != nil || len(value) > 64*1024 {
		writeError(w, http.StatusBadRequest, "bad_request", "proxy page settings too large")
		return
	}
	if err := a.saveProxyPageSettings(r.Context(), settings, false); err != nil {
		writeError(w, http.StatusConflict, "settings_error", err.Error())
		return
	}
	a.audit(currentUser(r), "settings.proxy_page.update", "settings", "", true, "")
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": settings})
}

// Import the browser snapshot at most once. Unlike PUT, this cannot overwrite
// another admin's preferences if they initialized the instance first.
func (a *App) handleProxyPageSettingsImport(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(r) {
		writeError(w, http.StatusForbidden, "admin_required", "仅管理员可以迁移代理页面设置")
		return
	}
	defer r.Body.Close()
	var settings map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 64*1024+1)).Decode(&settings); err != nil || settings == nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid proxy page settings")
		return
	}
	if err := validateProxyPageSettings(settings); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	value, _ := json.Marshal(settings)
	if len(value) > 64*1024 {
		writeError(w, http.StatusBadRequest, "bad_request", "proxy page settings too large")
		return
	}
	if err := a.saveProxyPageSettings(r.Context(), settings, true); err != nil {
		writeError(w, http.StatusConflict, "settings_error", err.Error())
		return
	}
	a.handleProxyPageSettingsGet(w, r)
}
