package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

const mihomoRuntimeConfigRelPath = "configs/mihomo/msf_runtime.yaml"
const mihomoGroupTestURLModeKey = "x-msf-test-url-mode"

type mihomoTestURLSettings struct {
	Fallback string
	Override string
}

func validMihomoTestURL(value string) bool {
	u, err := url.Parse(value)
	return err == nil && len(value) <= 2048 && u.Hostname() != "" && (u.Scheme == "http" || u.Scheme == "https") && u.User == nil
}

func mihomoTestURLSettingsFromMap(settings map[string]any) mihomoTestURLSettings {
	p := mihomoTestURLSettings{Fallback: defaultMihomoProxyTestURL}
	if u := strings.TrimSpace(stringMapValue(settings, "delayTestUrl")); validMihomoTestURL(u) {
		p.Fallback = u
	}
	if boolMapValue(settings, "delayTestOverrideEnabled", false) {
		if u := strings.TrimSpace(stringMapValue(settings, "delayTestOverrideUrl")); validMihomoTestURL(u) {
			p.Override = u
		}
	}
	return p
}

func (a *App) mihomoTestURLSettings() mihomoTestURLSettings {
	var settings map[string]any
	_ = json.Unmarshal([]byte(a.setting(proxyPageSettingsKey, "{}")), &settings)
	return mihomoTestURLSettingsFromMap(settings)
}

var mihomoTemplateGroupURLsOnce sync.Once
var mihomoTemplateGroupURLs map[string]string

// Only known generated-template groups get legacy inheritance automatically.
// Imported/custom YAML with a URL remains explicit unless marked inherit.
func (a *App) mihomoGroupTestURLMode(group map[string]any) string {
	if mode := stringMapValue(group, mihomoGroupTestURLModeKey); mode == "inherit" || mode == "override" {
		return mode
	}
	u := strings.TrimSpace(stringMapValue(group, "url"))
	if u == "" {
		return "inherit"
	}
	if a.mihomoConfigMode() == "generated" {
		mihomoTemplateGroupURLsOnce.Do(func() {
			mihomoTemplateGroupURLs = map[string]string{}
			text, _ := runtimeTemplateText("mihomo/config.yaml")
			var template map[string]any
			if yaml.Unmarshal([]byte(text), &template) == nil {
				for _, raw := range anySlice(template["proxy-groups"]) {
					g := mihomoMapValueMap(raw)
					mihomoTemplateGroupURLs[stringMapValue(g, "name")] = stringMapValue(g, "url")
				}
			}
		})
		if inherited, exists := mihomoTemplateGroupURLs[stringMapValue(group, "name")]; exists && inherited == u {
			return "inherit"
		}
	}
	return "override"
}

// Render a disposable input for Mihomo. Never write policy overlays into the
// editable config or applied user YAML; disabling the overlay restores originals.
func (a *App) renderMihomoRuntimeTestPolicy(content string, policy mihomoTestURLSettings) (string, error) {
	var cfg map[string]any
	if err := yaml.Unmarshal([]byte(content), &cfg); err != nil {
		return "", err
	}
	if cfg == nil {
		return "", fmt.Errorf("Mihomo config must be an object")
	}
	for _, provider := range normalizeConfigProviders(cfg["proxy-providers"]) {
		delete(provider, "name") // normalizeConfigProviders adds an editor-only name.
		health := mihomoMapValueMap(provider["health-check"])
		if health == nil {
			continue // A URL setting must never create/enable a health checker.
		}
		if policy.Override != "" {
			health["url"] = policy.Override
		} else if strings.TrimSpace(stringMapValue(health, "url")) == "" {
			health["url"] = policy.Fallback
		}
	}
	for _, raw := range anySlice(cfg["proxy-groups"]) {
		group := mihomoMapValueMap(raw)
		if rawMode, exists := group[mihomoGroupTestURLModeKey]; exists {
			mode, ok := rawMode.(string)
			if !ok || (mode != "inherit" && mode != "override") || (mode == "override" && !validMihomoTestURL(strings.TrimSpace(stringMapValue(group, "url")))) {
				return "", fmt.Errorf("proxy group %s has invalid test URL policy", stringMapValue(group, "name"))
			}
		}
		kind := strings.ToLower(stringMapValue(group, "type"))
		if kind == "url-test" || kind == "fallback" || kind == "load-balance" || kind == "smart" {
			if a.mihomoGroupTestURLMode(group) != "override" && policy.Override != "" {
				group["url"] = policy.Override
			} else if strings.TrimSpace(stringMapValue(group, "url")) == "" {
				group["url"] = policy.Fallback
			}
		}
		delete(group, mihomoGroupTestURLModeKey)
	}
	if template := mihomoMapValueMap(cfg["UrlTest"]); template != nil {
		delete(template, mihomoGroupTestURLModeKey)
	}
	b, err := yaml.Marshal(cfg)
	return string(b), err
}

func (a *App) prepareMihomoRuntimeConfig() error {
	content, err := a.readTextFile(mihomoActiveConfigRelPath)
	if err != nil {
		return err
	}
	rendered, err := a.renderMihomoRuntimeTestPolicy(content, a.mihomoTestURLSettings())
	if err != nil {
		return err
	}
	return a.replaceGeneratedConfigFiles(map[string]string{mihomoRuntimeConfigRelPath: rendered}, nil)
}

// Serialize page saves and roll back both the setting and runtime if the new
// policy cannot start. Appearance-only saves never restart the core.
func (a *App) saveProxyPageSettings(ctx context.Context, settings map[string]any, importOnly bool) error {
	a.configApplyMu.Lock()
	defer a.configApplyMu.Unlock()
	old, existed := a.settingValue(proxyPageSettingsKey)
	if importOnly && existed {
		return nil
	}
	var previous map[string]any
	_ = json.Unmarshal([]byte(old), &previous)
	// An older client saving appearance must not erase an existing overlay.
	for _, key := range []string{"delayTestOverrideEnabled", "delayTestOverrideUrl"} {
		if _, supplied := settings[key]; !supplied {
			if value, ok := previous[key]; ok {
				settings[key] = value
			}
		}
	}
	if boolMapValue(settings, "delayTestOverrideEnabled", false) && !validMihomoTestURL(stringMapValue(settings, "delayTestOverrideUrl")) {
		return fmt.Errorf("开启全局覆盖前请填写有效的 HTTP(S) 测速 URL")
	}
	value, err := json.Marshal(settings)
	if err != nil {
		return err
	}
	changed := mihomoTestURLSettingsFromMap(previous) != mihomoTestURLSettingsFromMap(settings)
	if importOnly {
		result, insertErr := a.DB.Exec(`insert or ignore into settings(key,value,updated_at) values(?,?,CURRENT_TIMESTAMP)`, proxyPageSettingsKey, string(value))
		if insertErr != nil {
			return insertErr
		}
		if affected, _ := result.RowsAffected(); affected == 0 {
			return nil
		}
	} else if err := a.writeSettingsAtomic(map[string]string{proxyPageSettingsKey: string(value)}); err != nil {
		return err
	}
	if !changed || !a.Services.Status("mihomo").Running {
		return nil
	}
	status, restartErr := a.Services.Restart(ctx, "mihomo")
	if restartErr == nil && status.Running {
		restartErr = a.probeMihomoConfigController(ctx)
	}
	if restartErr == nil && status.Running {
		return nil
	}
	if restartErr == nil {
		restartErr = fmt.Errorf("Mihomo is not running after policy update")
	}
	if existed {
		err = a.writeSettingsAtomic(map[string]string{proxyPageSettingsKey: old})
	} else {
		_, err = a.DB.Exec(`delete from settings where key=?`, proxyPageSettingsKey)
	}
	if err != nil {
		return fmt.Errorf("policy apply failed: %v; settings rollback failed: %w", restartErr, err)
	}
	// A closed browser/request must not cancel restoration of the old policy.
	recoveryCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	recovered, recoveryErr := a.Services.Restart(recoveryCtx, "mihomo")
	if recoveryErr == nil && !recovered.Running {
		recoveryErr = fmt.Errorf("Mihomo is not running after recovery")
	}
	if recoveryErr != nil {
		return fmt.Errorf("policy apply failed: %v; original policy restored but recovery failed: %w", restartErr, recoveryErr)
	}
	return fmt.Errorf("policy apply failed; original policy restored: %w", restartErr)
}

func mihomoRuntimeConfigPath(root string) string {
	return filepath.Join(root, mihomoRuntimeConfigRelPath)
}
