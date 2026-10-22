package server

import (
	"fmt"
	"net/http"
	"strings"

	"gopkg.in/yaml.v3"
)

// Generated group structure remains read-only. This endpoint owns exactly the
// test URL and inheritance mode and cannot change members, type or routing.
func (a *App) handleMihomoProxyGroupTestPolicyPut(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(r) {
		writeError(w, http.StatusForbidden, "admin_required", "仅管理员可以修改测速设置")
		return
	}
	var req map[string]any
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	for key := range req {
		if key != "mode" && key != "url" {
			writeError(w, http.StatusBadRequest, "bad_request", "此接口仅允许修改测速网址和继承模式")
			return
		}
	}
	mode, u := stringMapValue(req, "mode"), strings.TrimSpace(stringMapValue(req, "url"))
	if (mode != "inherit" && mode != "override") || (mode == "override" && !validMihomoTestURL(u)) {
		writeError(w, http.StatusBadRequest, "bad_request", "请填写有效的测速网址和继承模式")
		return
	}
	a.configApplyMu.Lock()
	defer a.configApplyMu.Unlock()
	restarted, err := a.applyMihomoConfigMutation(r.Context(), false, func() error {
		content, _, err := a.mihomoEffectiveConfigContent()
		if err != nil {
			return err
		}
		var cfg map[string]any
		if err := yaml.Unmarshal([]byte(content), &cfg); err != nil {
			return err
		}
		found := false
		for _, raw := range anySlice(cfg["proxy-groups"]) {
			g := mihomoMapValueMap(raw)
			if stringMapValue(g, "name") == r.PathValue("name") {
				g[mihomoGroupTestURLModeKey] = mode
				if mode == "override" {
					g["url"] = u
				}
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("策略组不存在")
		}
		b, err := yaml.Marshal(map[string]any{"proxy-groups": cfg["proxy-groups"]})
		if err != nil {
			return err
		}
		patched := replaceTopLevelYAMLBlock(content, "proxy-groups", string(b))
		var check map[string]any
		if err := yaml.Unmarshal([]byte(patched), &check); err != nil {
			return err
		}
		files := map[string]string{mihomoActiveConfigRelPath: patched}
		if rel, ok := a.appliedMihomoUserConfigRel(); ok {
			files[rel] = patched
		}
		for rel, replacement := range files {
			if old, readErr := a.readTextFile(rel); readErr == nil && old != replacement {
				a.createConfigHistory("mihomo", rel, old, "backup before group test URL update", firstNonEmpty(currentUsername(r), "system"))
			}
		}
		return a.replaceGeneratedConfigFiles(files, nil)
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, "write_failed", err.Error())
		return
	}
	a.audit(currentUser(r), "mihomo.group_test_policy.update", "mihomo", r.PathValue("name"), true, "")
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "restarted": restarted})
}

// Keep URL-only exceptions when other setup settings regenerate the template.
func preserveGeneratedMihomoGroupTestPolicies(current, generated string) (string, error) {
	var old, next map[string]any
	if err := yaml.Unmarshal([]byte(current), &old); err != nil {
		return "", err
	}
	if err := yaml.Unmarshal([]byte(generated), &next); err != nil {
		return "", err
	}
	policies := map[string]map[string]any{}
	for _, raw := range anySlice(old["proxy-groups"]) {
		g := mihomoMapValueMap(raw)
		if mode := stringMapValue(g, mihomoGroupTestURLModeKey); mode == "inherit" || mode == "override" {
			policies[stringMapValue(g, "name")] = g
		}
	}
	changed := false
	for _, raw := range anySlice(next["proxy-groups"]) {
		g := mihomoMapValueMap(raw)
		if p, ok := policies[stringMapValue(g, "name")]; ok {
			if g[mihomoGroupTestURLModeKey] != p[mihomoGroupTestURLModeKey] || stringMapValue(g, "url") != stringMapValue(p, "url") {
				g[mihomoGroupTestURLModeKey] = p[mihomoGroupTestURLModeKey]
				if value, exists := p["url"]; exists {
					g["url"] = value
				}
				changed = true
			}
		}
	}
	if !changed {
		return generated, nil
	}
	b, err := yaml.Marshal(map[string]any{"proxy-groups": next["proxy-groups"]})
	if err != nil {
		return "", err
	}
	return replaceTopLevelYAMLBlock(generated, "proxy-groups", string(b)), nil
}
