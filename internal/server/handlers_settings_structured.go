package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

func (a *App) handleSettingsStructuredGet(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(r) {
		writeError(w, http.StatusForbidden, "forbidden", "admin required")
		return
	}
	data := a.structuredSettingsPayload()
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": data})
}

func (a *App) handleSettingsStructuredPut(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(r) {
		writeError(w, http.StatusForbidden, "forbidden", "admin required")
		return
	}
	a.configApplyMu.Lock()
	defer a.configApplyMu.Unlock()
	var req map[string]any
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	cfg, initialized, setupExists := a.latestSetupConfigForSettingsRaw()
	previous := cfg
	if cfg.Username == "" {
		if u := currentUser(r); u != nil {
			cfg.Username = u.Username
			cfg.Email = u.Email
		}
	}
	if cfg.Username == "" {
		cfg.Username = "root"
	}
	setupChanged := false
	restartRequired := false
	regenerateRequired := false
	providerSyncRequired := false
	if raw, ok := settingsMap(req["appearance"]); ok {
		if err := a.applyStructuredAppearance(raw); err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
	}
	if raw, ok := settingsMap(req["settings"]); ok {
		if err := a.applyStructuredGenericSettings(raw); err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
	}
	for _, section := range []string{"system", "mosdns", "mihomo", "setup"} {
		raw, ok := settingsMap(req[section])
		if !ok {
			continue
		}
		changed, restart, regen, err := a.applyStructuredSetupSection(&cfg, section, raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
		setupChanged = setupChanged || changed
		restartRequired = restartRequired || restart
		regenerateRequired = regenerateRequired || regen
		if section == "mihomo" || section == "setup" {
			providerSyncRequired = providerSyncRequired || setupPatchTouchesMihomoProviders(raw)
		}
	}
	if setupChanged {
		if err := normalizeFakeIPPrefixes(&cfg); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_fake_ip_range", err.Error())
			return
		}
		if err := validateSetupProxyMode(cfg); err != nil {
			writeError(w, http.StatusBadRequest, "unsupported_proxy_mode", err.Error())
			return
		}
		if err := a.writeGeneratedConfigs(cfg); err != nil {
			writeError(w, http.StatusInternalServerError, "config_error", err.Error())
			return
		}
		if err := a.ensureProxyModeConsistency(cfg, false); err != nil {
			if setupExists {
				_ = a.writeGeneratedConfigs(previous)
			}
			writeError(w, http.StatusConflict, "proxy_mode_mismatch", err.Error())
			return
		}
		setupID, err := a.insertSetupSnapshot(cfg, initialized)
		if err != nil {
			if setupExists {
				_ = a.writeGeneratedConfigs(previous)
			}
			writeError(w, http.StatusInternalServerError, "db_error", err.Error())
			return
		}
		if providerSyncRequired && a.mihomoConfigMode() == "custom" {
			if err := a.syncMihomoProxyProvidersFromSetupConfig(cfg, currentUsername(r)); err != nil {
				_, _ = a.DB.Exec(`delete from system_setups where id=?`, setupID)
				if setupExists {
					_ = a.writeGeneratedConfigs(previous)
				}
				writeError(w, http.StatusInternalServerError, "config_error", err.Error())
				return
			}
		}
		if initialized {
			a.SetConfiguredRuntimeDesired(cfg)
			var cacheTx *fakeIPCacheInvalidation
			rollbackSetup := func() {
				_, _ = a.DB.Exec(`delete from system_setups where id=?`, setupID)
				a.SetConfiguredRuntimeDesired(previous)
				_ = a.writeGeneratedConfigs(previous)
				_ = setupApplyProxyNetworkState(a, r.Context(), previous)
				_ = cacheTx.rollback(r.Context(), a)
			}
			if setupExists && fakeIPPrefixChanged(previous, cfg) {
				cacheTx, err = a.beginFakeIPCacheInvalidation(r.Context())
				if err != nil {
					rollbackSetup()
					writeError(w, http.StatusConflict, "fake_ip_cache_flush_failed", err.Error())
					return
				}
			}
			if err := setupApplyProxyNetworkState(a, r.Context(), cfg); err != nil {
				rollbackSetup()
				writeError(w, http.StatusInternalServerError, "network_apply_failed", err.Error())
				return
			}
			if restartRequired || regenerateRequired {
				for _, name := range managedServiceNames() {
					if a.Services.Status(name).Running {
						if _, err := a.Services.Restart(r.Context(), name); err != nil {
							rollbackSetup()
							writeError(w, http.StatusInternalServerError, "service_restart_failed", err.Error())
							return
						}
					}
				}
			}
			if err := cacheTx.commit(); err != nil {
				rollbackSetup()
				writeError(w, http.StatusInternalServerError, "fake_ip_cache_commit_failed", err.Error())
				return
			}
		}
	}
	data := a.structuredSettingsPayload()
	data["restart_required"] = restartRequired
	data["regenerate_required"] = regenerateRequired
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "saved": setupChanged, "generated": setupChanged, "network_applied": initialized && setupChanged, "restart_required": restartRequired, "regenerate_required": regenerateRequired, "data": data})
}

func (a *App) structuredSettingsPayload() map[string]any {
	cfg, initialized, setupExists := a.latestSetupConfigForSettings()
	return map[string]any{
		"appearance": a.structuredAppearanceSettings(),
		"system": map[string]any{
			"web_port":           cfg.WebPort,
			"timezone":           cfg.Timezone,
			"jwt_secret_set":     len(a.currentSecret()) > 0,
			"log_level":          a.setting("log_level", "info"),
			"log_retention_days": structuredIntSetting(a.setting("log_retention_days", a.setting("log.retention_days", "7")), 7),
			"restart_required":   false,
			"setup_exists":       setupExists,
			"is_initialized":     initialized,
		},
		"mosdns": map[string]any{
			"enabled":          cfg.MosDNSEnabled,
			"auto_set_dns":     cfg.AutoSetDNS,
			"dns_on":           cfg.DNSOn,
			"dns_off":          cfg.DNSOff,
			"enable_ipv6":      cfg.EnableIPv6,
			"fake_ip_range_v4": cfg.FakeIPRangeV4,
			"fake_ip_range_v6": cfg.FakeIPRangeV6,
			"log_capacity":     a.mosDNSLogCapacityValue(),
			"switches":         a.mosDNSSwitchMap(),
			"upstreams":        a.mosDNSUpstreamSummary(),
		},
		"mihomo": map[string]any{
			"core_type":             cfg.MihomoCoreType,
			"mihomo_core_type":      cfg.MihomoCoreType,
			"proxy_core":            cfg.ProxyCore,
			"linux_proxy_mode":      cfg.LinuxProxyMode,
			"nft_proxy_policy":      cfg.NFTProxyPolicy,
			"subscription_urls":     cfg.SubscriptionURLs,
			"manual_proxies":        strings.TrimSpace(cfg.MihomoProxies) != "",
			"manual_proxies_source": cfg.MihomoProxies,
			"ports":                 a.mihomoConfigPortSummary(),
		},
		"updates": a.structuredUpdateSummary(),
		"backup":  a.structuredBackupSummary(),
	}
}

func (a *App) structuredAppearanceSettings() map[string]string {
	return a.appearanceSettingsPayload()
}

func (a *App) latestSetupConfigForSettings() (SetupConfig, bool, bool) {
	cfg, initialized, setupExists := a.latestSetupConfigForSettingsRaw()
	if setupExists {
		a.applyMihomoProviderFieldsFromEffectiveConfig(&cfg)
	}
	return cfg, initialized, setupExists
}

func (a *App) latestSetupConfigForSettingsRaw() (SetupConfig, bool, bool) {
	row := a.DB.QueryRow(`select username,email,timezone,web_port,amd64v3_enabled,selected_interface,mihomo_core_type,auto_set_dns,dns_on,dns_off,enable_ipv6,fake_ip_range_v4,fake_ip_range_v6,linux_proxy_mode,nft_proxy_policy,proxy_core,mos_dns_enabled,subscription_urls,mihomo_proxies,github_proxy_enabled,github_https_proxy,github_http_proxy,github_socks5_proxy,github_accelerator_enabled,github_accelerator_url,is_initialized from system_setups order by id desc limit 1`)
	var cfg SetupConfig
	var initialized bool
	err := row.Scan(&cfg.Username, &cfg.Email, &cfg.Timezone, &cfg.WebPort, &cfg.AMD64v3Enabled, &cfg.SelectedInterface, &cfg.MihomoCoreType, &cfg.AutoSetDNS, &cfg.DNSOn, &cfg.DNSOff, &cfg.EnableIPv6, &cfg.FakeIPRangeV4, &cfg.FakeIPRangeV6, &cfg.LinuxProxyMode, &cfg.NFTProxyPolicy, &cfg.ProxyCore, &cfg.MosDNSEnabled, &cfg.SubscriptionURLs, &cfg.MihomoProxies, &cfg.GitHubProxyEnabled, &cfg.GitHubHTTPSProxy, &cfg.GitHubHTTPProxy, &cfg.GitHubSocks5Proxy, &cfg.GitHubAcceleratorEnabled, &cfg.GitHubAcceleratorURL, &initialized)
	if err != nil {
		cfg.defaults()
		return cfg, false, false
	}
	applySetupStringDefaults(&cfg)
	if cfg.SelectedInterface == "" {
		cfg.SelectedInterface = defaultSetupInterface()
	}
	return cfg, initialized, true
}

func (a *App) insertSetupSnapshot(cfg SetupConfig, initialized bool) (int64, error) {
	applySetupStringDefaults(&cfg)
	now := time.Now()
	res, err := a.DB.Exec(`insert into system_setups(created_at,updated_at,username,email,timezone,web_port,amd64v3_enabled,selected_interface,mihomo_core_type,auto_set_dns,dns_on,dns_off,enable_ipv6,fake_ip_range_v4,fake_ip_range_v6,linux_proxy_mode,nft_proxy_policy,proxy_core,mos_dns_enabled,subscription_urls,mihomo_proxies,github_proxy_enabled,github_https_proxy,github_http_proxy,github_socks5_proxy,github_accelerator_enabled,github_accelerator_url,is_initialized)
		values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		now, now, cfg.Username, cfg.Email, cfg.Timezone, cfg.WebPort, cfg.AMD64v3Enabled, cfg.SelectedInterface, cfg.MihomoCoreType, cfg.AutoSetDNS, cfg.DNSOn, cfg.DNSOff, cfg.EnableIPv6, cfg.FakeIPRangeV4, cfg.FakeIPRangeV6, cfg.LinuxProxyMode, cfg.NFTProxyPolicy, cfg.ProxyCore, cfg.MosDNSEnabled, cfg.SubscriptionURLs, cfg.MihomoProxies, cfg.GitHubProxyEnabled, cfg.GitHubHTTPSProxy, cfg.GitHubHTTPProxy, cfg.GitHubSocks5Proxy, cfg.GitHubAcceleratorEnabled, cfg.GitHubAcceleratorURL, initialized)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func applySetupStringDefaults(cfg *SetupConfig) {
	if cfg.Timezone == "" {
		cfg.Timezone = "Asia/Shanghai"
	}
	if cfg.WebPort == "" {
		cfg.WebPort = "7777"
	}
	cfg.MihomoCoreType = normalizeMihomoCoreType(cfg.MihomoCoreType)
	if cfg.DNSOn == "" {
		cfg.DNSOn = "127.0.0.1"
	}
	if cfg.DNSOff == "" {
		cfg.DNSOff = "223.5.5.5"
	}
	if cfg.FakeIPRangeV4 == "" {
		cfg.FakeIPRangeV4 = "28.0.0.0/8"
	}
	if cfg.FakeIPRangeV6 == "" {
		cfg.FakeIPRangeV6 = "f2b0::/18"
	}
	if cfg.LinuxProxyMode == "" {
		if IsDockerRuntime() {
			cfg.LinuxProxyMode = "tun"
		} else {
			cfg.LinuxProxyMode = "nft"
		}
	}
	if cfg.NFTProxyPolicy == "" {
		cfg.NFTProxyPolicy = "direct_default"
	}
	if cfg.ProxyCore == "" || cfg.ProxyCore == "singbox" {
		cfg.ProxyCore = "mihomo"
	}
	if IsMacOSRuntime() {
		cfg.LinuxProxyMode = "tun"
		cfg.AutoSetDNS = true
		normalizeSetupInterfaceForRuntime(cfg)
	}
}

func (a *App) applyStructuredAppearance(raw map[string]any) error {
	opacity, hasOpacity, err := validateContentPlateOpacityPayload(raw)
	if err != nil {
		return err
	}
	updates := make(map[string]string, len(raw))
	for key, value := range raw {
		switch key {
		case "theme":
			v := strings.ToLower(strings.TrimSpace(fmtAny(value)))
			if !oneOf(v, "system", "light", "dark") {
				return fmt.Errorf("invalid theme")
			}
			updates["appearance.theme"] = v
		case "language":
			v := strings.TrimSpace(fmtAny(value))
			if !oneOf(v, "zh-CN", "zh", "en-US", "en") {
				return fmt.Errorf("invalid language")
			}
			updates["appearance.language"] = v
		case "scene":
			v := strings.ToLower(strings.TrimSpace(fmtAny(value)))
			if !oneOf(v, "dynamic", "static", "neutral") {
				return fmt.Errorf("invalid scene")
			}
			updates["appearance.scene"] = v
		case "quality":
			v := strings.ToLower(strings.TrimSpace(fmtAny(value)))
			if !oneOf(v, "full", "balanced", "reduced") {
				return fmt.Errorf("invalid quality")
			}
			updates["appearance.quality"] = v
		case "compact":
			v, err := structuredBoolValue(value)
			if err != nil {
				return fmt.Errorf("invalid compact")
			}
			updates["appearance.compact"] = boolSetting(v)
		case "menu_order", "accent_color":
			updates["appearance."+key] = fmtAny(value)
		case contentPlateOpacitySubtleKey, contentPlateOpacityRegularKey, contentPlateOpacityStrongKey:
			if !hasOpacity {
				return fmt.Errorf("content plate opacity fields must be provided together")
			}
			updates["appearance."+key] = opacity[key]
		default:
			return fmt.Errorf("unsupported appearance key %q", key)
		}
	}
	return a.writeSettingsAtomic(updates)
}

func (a *App) applyStructuredGenericSettings(raw map[string]any) error {
	for key, value := range raw {
		key = strings.TrimSpace(key)
		if key == "" {
			return fmt.Errorf("settings key is required")
		}
		switch key {
		case "log_level":
			v := strings.ToLower(strings.TrimSpace(fmtAny(value)))
			if !oneOf(v, "debug", "info", "warn", "warning", "error") {
				return fmt.Errorf("invalid log_level")
			}
			a.setSetting(key, v)
		case "log_retention_days", "log.retention_days":
			v, err := structuredPositiveInt(value)
			if err != nil {
				return fmt.Errorf("invalid log_retention_days")
			}
			a.setSetting("log_retention_days", strconv.Itoa(v))
		default:
			a.setSetting(key, fmtAny(value))
		}
	}
	return nil
}

func (a *App) applyStructuredSetupSection(cfg *SetupConfig, section string, raw map[string]any) (bool, bool, bool, error) {
	changed := false
	restartRequired := false
	regenerateRequired := false
	for key, value := range raw {
		switch key {
		case "timezone":
			v := strings.TrimSpace(fmtAny(value))
			if _, err := time.LoadLocation(v); err != nil {
				return false, false, false, fmt.Errorf("invalid timezone")
			}
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			err := applyHostTimezone(ctx, v)
			cancel()
			if err != nil {
				return false, false, false, err
			}
			cfg.Timezone = v
			changed = true
			regenerateRequired = true
		case "web_port", "webPort":
			port, err := structuredPort(value)
			if err != nil {
				return false, false, false, fmt.Errorf("invalid web_port")
			}
			cfg.WebPort = strconv.Itoa(port)
			changed = true
			restartRequired = true
		case "log_level":
			if err := a.applyStructuredGenericSettings(map[string]any{"log_level": value}); err != nil {
				return false, false, false, err
			}
		case "log_retention_days":
			if err := a.applyStructuredGenericSettings(map[string]any{"log_retention_days": value}); err != nil {
				return false, false, false, err
			}
		case "auto_set_dns", "autoSetDNS":
			v, err := structuredBoolValue(value)
			if err != nil {
				return false, false, false, fmt.Errorf("invalid auto_set_dns")
			}
			cfg.AutoSetDNS = v
			changed = true
			regenerateRequired = true
		case "dns_on", "dnsOn":
			cfg.DNSOn = strings.TrimSpace(fmtAny(value))
			changed = true
			regenerateRequired = true
		case "dns_off", "dnsOff":
			cfg.DNSOff = strings.TrimSpace(fmtAny(value))
			changed = true
			regenerateRequired = true
		case "enable_ipv6", "enableIPv6":
			v, err := structuredBoolValue(value)
			if err != nil {
				return false, false, false, fmt.Errorf("invalid enable_ipv6")
			}
			cfg.EnableIPv6 = v
			changed = true
			regenerateRequired = true
		case "fake_ip_range_v4", "fakeIPRangeV4":
			prefix, err := normalizeFakeIPPrefix(fmtAny(value), false)
			if err != nil {
				return false, false, false, fmt.Errorf("invalid fake_ip_range_v4: %w", err)
			}
			cfg.FakeIPRangeV4 = prefix
			changed = true
			regenerateRequired = true
		case "fake_ip_range_v6", "fakeIPRangeV6":
			prefix, err := normalizeFakeIPPrefix(fmtAny(value), true)
			if err != nil {
				return false, false, false, fmt.Errorf("invalid fake_ip_range_v6: %w", err)
			}
			cfg.FakeIPRangeV6 = prefix
			changed = true
			regenerateRequired = true
		case "mos_dns_enabled", "mosdnsEnabled", "enabled":
			if section != "mosdns" && key == "enabled" {
				return false, false, false, fmt.Errorf("unsupported setup key %q", key)
			}
			v, err := structuredBoolValue(value)
			if err != nil {
				return false, false, false, fmt.Errorf("invalid mos_dns_enabled")
			}
			cfg.MosDNSEnabled = v
			changed = true
			restartRequired = true
		case "log_capacity":
			if section != "mosdns" {
				return false, false, false, fmt.Errorf("unsupported setup key %q", key)
			}
			capacity, err := structuredPositiveInt(value)
			if err != nil {
				return false, false, false, fmt.Errorf("invalid log_capacity")
			}
			a.setSetting("mosdns_log_capacity", strconv.Itoa(capacity))
			_ = a.writeJSONFile("configs/mosdns/audit_settings.json", map[string]any{"capacity": capacity})
		case "mihomo_core_type", "mihomoCoreType", "core_type":
			v := strings.ToLower(strings.TrimSpace(fmtAny(value)))
			if !oneOf(v, "meta", "mihomo", "smart") {
				return false, false, false, fmt.Errorf("invalid mihomo_core_type")
			}
			cfg.MihomoCoreType = normalizeMihomoCoreType(v)
			changed = true
			regenerateRequired = true
		case "proxy_core", "proxyCore":
			v := strings.ToLower(strings.TrimSpace(fmtAny(value)))
			if v != "mihomo" {
				return false, false, false, fmt.Errorf("invalid proxy_core")
			}
			cfg.ProxyCore = v
			changed = true
			regenerateRequired = true
		case "linux_proxy_mode", "linuxProxyMode":
			v := strings.ToLower(strings.TrimSpace(fmtAny(value)))
			if !oneOf(v, "nft", "nftables", "tproxy", "tun", "redirect", "mixed", "off", "disabled", "none") {
				return false, false, false, fmt.Errorf("invalid linux_proxy_mode")
			}
			cfg.LinuxProxyMode = v
			changed = true
			regenerateRequired = true
		case "nft_proxy_policy", "nftProxyPolicy":
			v := strings.ToLower(strings.TrimSpace(fmtAny(value)))
			if !oneOf(v, "direct_default", "proxy_default") {
				return false, false, false, fmt.Errorf("invalid nft_proxy_policy")
			}
			cfg.NFTProxyPolicy = v
			changed = true
			regenerateRequired = true
		case "subscription_urls", "subscriptionURLs":
			v, err := normalizeSubscriptionURLsValue(value)
			if err != nil {
				return false, false, false, err
			}
			cfg.SubscriptionURLs = v
			changed = true
			regenerateRequired = true
		case "mihomo_proxies", "mihomoProxies", "manual_proxies_source":
			cfg.MihomoProxies = strings.TrimSpace(fmtAny(value))
			changed = true
			regenerateRequired = true
		case "selected_interface", "selectedInterface":
			cfg.SelectedInterface = strings.TrimSpace(fmtAny(value))
			changed = true
			regenerateRequired = true
		default:
			return false, false, false, fmt.Errorf("unsupported setup key %q", key)
		}
	}
	return changed, restartRequired, regenerateRequired, nil
}

func (a *App) mosDNSLogCapacityValue() string {
	capacity := a.setting("mosdns_log_capacity", "")
	if capacity == "" {
		if raw, ok := a.readJSONFile("configs/mosdns/audit_settings.json", map[string]any{"capacity": 100000}).(map[string]any); ok {
			capacity = fmtAny(raw["capacity"])
		}
	}
	if capacity == "" {
		capacity = "100000"
	}
	return capacity
}

func (a *App) mosDNSUpstreamSummary() map[string]any {
	local, _ := a.readTextFile("configs/mosdns/sub_config/forward_local.yaml")
	remote, _ := a.readTextFile("configs/mosdns/sub_config/forward_nocn.yaml")
	return map[string]any{
		"forward_local_configured":  strings.TrimSpace(local) != "",
		"forward_remote_configured": strings.TrimSpace(remote) != "",
		"forward_local_bytes":       len(local),
		"forward_remote_bytes":      len(remote),
	}
}

func (a *App) mihomoConfigPortSummary() map[string]any {
	content, _ := a.readTextFile("configs/mihomo/config.yaml")
	var cfg map[string]any
	_ = yaml.Unmarshal([]byte(content), &cfg)
	return map[string]any{
		"mixed_port":          mapIntValue(cfg, "mixed-port"),
		"redir_port":          mapIntValue(cfg, "redir-port"),
		"tproxy_port":         mapIntValue(cfg, "tproxy-port"),
		"external_controller": fmtAny(cfg["external-controller"]),
	}
}

func (a *App) structuredUpdateSummary() map[string]any {
	components := []map[string]any{}
	for _, component := range []string{"mosdns", "mihomo", "zashboard"} {
		components = append(components, a.componentUpdateState(component))
	}
	return map[string]any{
		"self":       a.selfUpdateState(),
		"components": components,
		"endpoints": map[string]string{
			"self":       "/api/v1/update/status",
			"components": "/api/v1/component-updates",
		},
	}
}

func (a *App) structuredBackupSummary() map[string]any {
	dir, err := a.safePath("backups")
	if err != nil {
		return map[string]any{"count": 0, "latest": nil, "endpoints": backupEndpoints()}
	}
	entries, _ := os.ReadDir(dir)
	count := 0
	var latest map[string]any
	var latestTime time.Time
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".zip") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		count++
		if latest == nil || info.ModTime().After(latestTime) {
			latestTime = info.ModTime()
			latest = map[string]any{"name": entry.Name(), "path": filepath.ToSlash(filepath.Join("backups", entry.Name())), "size": info.Size(), "created_at": info.ModTime().Format(time.RFC3339)}
		}
	}
	return map[string]any{"count": count, "latest": latest, "endpoints": backupEndpoints()}
}

func backupEndpoints() map[string]string {
	return map[string]string{
		"list":     "/api/v1/config/backups",
		"create":   "/api/v1/config/backup",
		"download": "/api/v1/config/backup/download",
		"restore":  "/api/v1/config/restore",
	}
}

func settingsMap(raw any) (map[string]any, bool) {
	if raw == nil {
		return nil, false
	}
	m, ok := raw.(map[string]any)
	return m, ok
}

func structuredBoolValue(v any) (bool, error) {
	switch x := v.(type) {
	case bool:
		return x, nil
	case float64:
		return x != 0, nil
	case int:
		return x != 0, nil
	case string:
		s := strings.ToLower(strings.TrimSpace(x))
		if oneOf(s, "true", "1", "yes", "on", "enabled") {
			return true, nil
		}
		if oneOf(s, "false", "0", "no", "off", "disabled") {
			return false, nil
		}
	}
	return false, errors.New("invalid bool")
}

func structuredPositiveInt(v any) (int, error) {
	n, err := structuredIntValue(v)
	if err != nil || n <= 0 {
		return 0, errors.New("invalid positive integer")
	}
	return n, nil
}

func structuredPort(v any) (int, error) {
	n, err := structuredIntValue(v)
	if err != nil || n < 1 || n > 65535 {
		return 0, errors.New("invalid port")
	}
	return n, nil
}

func structuredIntValue(v any) (int, error) {
	switch x := v.(type) {
	case int:
		return x, nil
	case int64:
		return int(x), nil
	case float64:
		return int(x), nil
	case string:
		return strconv.Atoi(strings.TrimSpace(x))
	default:
		return 0, errors.New("invalid integer")
	}
}

func structuredIntSetting(value string, fallback int) int {
	n, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return fallback
	}
	return n
}

func oneOf(value string, allowed ...string) bool {
	for _, item := range allowed {
		if value == item {
			return true
		}
	}
	return false
}

func mapIntValue(m map[string]any, key string) any {
	if m == nil {
		return nil
	}
	switch v := m[key].(type) {
	case int:
		return v
	case int64:
		return v
	case float64:
		return int(v)
	case string:
		if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil {
			return n
		}
		return v
	default:
		return nil
	}
}
