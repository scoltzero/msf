package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

var setupApplyProxyNetworkState = func(a *App, ctx context.Context, cfg SetupConfig) error {
	if runtime.GOOS != "linux" {
		return nil
	}
	if shouldRestoreNFT(cfg) {
		_, err := a.applyNFT(ctx)
		return err
	}
	_, err := a.clearNFT(ctx)
	return err
}

func (a *App) handleSetupCheck(w http.ResponseWriter, r *http.Request) {
	initialized := a.IsInitialized()
	missing := []string{}
	var existing map[string]any
	if initialized {
		if cfg, ok := a.latestSetupConfig(); ok {
			cfg.defaults()
			a.applyMihomoProviderFieldsFromEffectiveConfig(&cfg)
			missing = a.setupMissingComponentsForConfig(cfg)
			existing = setupConfigPayload(cfg, true)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success":            true,
		"is_initialized":     initialized,
		"needs_recovery":     initialized && len(missing) > 0,
		"needs_download":     len(missing) > 0,
		"download_component": missing,
		"existing_config":    existing,
	})
}

func (a *App) handleSetupSystemInfo(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"system": map[string]any{
			"os":        runtime.GOOS,
			"arch":      runtime.GOARCH,
			"hostname":  hostname(),
			"local_ips": localIPs(),
		},
		"cpu": map[string]any{
			"model":           cpuModel(),
			"cores":           runtime.NumCPU(),
			"supportsAMD64v3": supportsAMD64v3(),
			"amd64v3_status":  amd64v3Status(),
		},
	})
}

func (a *App) handleSetupNetworkInterfaces(w http.ResponseWriter, r *http.Request) {
	ifaces, _ := net.Interfaces()
	var out []map[string]any
	for _, iface := range ifaces {
		addrs, _ := iface.Addrs()
		var ips []string
		for _, addr := range addrs {
			ips = append(ips, addr.String())
		}
		ip := primaryInterfaceIP(ips)
		out = append(out, map[string]any{
			"name":        iface.Name,
			"index":       iface.Index,
			"mac":         iface.HardwareAddr.String(),
			"flags":       iface.Flags.String(),
			"is_up":       iface.Flags&net.FlagUp != 0,
			"is_loopback": iface.Flags&net.FlagLoopback != 0,
			"addresses":   ips,
			"ip":          ip,
			"primary_ip":  ip,
			"speed":       interfaceSpeed(iface.Name),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "interfaces": out, "data": out})
}

func (a *App) handleSetupPrivilege(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"is_root": os.Geteuid() == 0,
		"uid":     os.Geteuid(),
		"runtime": map[string]any{
			"docker":              IsDockerRuntime(),
			"docker_network_mode": DockerNetworkMode(),
		},
		"message": "MosDNS 53 port and TUN/nftables require root on Linux",
	})
}

func (a *App) handleSetupPreflight(w http.ResponseWriter, r *http.Request) {
	timezone := strings.TrimSpace(r.URL.Query().Get("timezone"))
	if timezone == "" {
		timezone = "Asia/Shanghai"
	}
	proxyMode := strings.TrimSpace(r.URL.Query().Get("linux_proxy_mode"))
	result := a.buildSetupPreflight(r.Context(), timezone, false, proxyMode)
	writeJSON(w, http.StatusOK, result)
}

func (a *App) handleSetupGetConfig(w http.ResponseWriter, r *http.Request) {
	row := a.DB.QueryRow(`select username,email,timezone,web_port,amd64v3_enabled,selected_interface,mihomo_core_type,auto_set_dns,dns_on,dns_off,enable_ipv6,fake_ip_range_v4,fake_ip_range_v6,linux_proxy_mode,nft_proxy_policy,proxy_core,mos_dns_enabled,subscription_urls,mihomo_proxies,github_proxy_enabled,github_https_proxy,github_http_proxy,github_socks5_proxy,github_accelerator_enabled,github_accelerator_url,is_initialized from system_setups order by id desc limit 1`)
	var cfg SetupConfig
	var initialized bool
	err := row.Scan(&cfg.Username, &cfg.Email, &cfg.Timezone, &cfg.WebPort, &cfg.AMD64v3Enabled, &cfg.SelectedInterface, &cfg.MihomoCoreType, &cfg.AutoSetDNS, &cfg.DNSOn, &cfg.DNSOff, &cfg.EnableIPv6, &cfg.FakeIPRangeV4, &cfg.FakeIPRangeV6, &cfg.LinuxProxyMode, &cfg.NFTProxyPolicy, &cfg.ProxyCore, &cfg.MosDNSEnabled, &cfg.SubscriptionURLs, &cfg.MihomoProxies, &cfg.GitHubProxyEnabled, &cfg.GitHubHTTPSProxy, &cfg.GitHubHTTPProxy, &cfg.GitHubSocks5Proxy, &cfg.GitHubAcceleratorEnabled, &cfg.GitHubAcceleratorURL, &initialized)
	if err != nil {
		cfg.defaults()
	}
	cfg.defaults()
	if cfg.SelectedInterface == "" {
		cfg.SelectedInterface = defaultSetupInterface()
	}
	a.applyMihomoProviderFieldsFromEffectiveConfig(&cfg)
	payload := setupConfigPayload(cfg, initialized)
	response := map[string]any{"success": true, "config": payload, "data": payload, "is_initialized": initialized}
	for key, value := range payload {
		response[key] = value
	}
	writeJSON(w, http.StatusOK, response)
}

func (a *App) handleSetupPutConfig(w http.ResponseWriter, r *http.Request) {
	var cfg SetupConfig
	meta, err := decodeSetupConfigRequestWithMeta(r, &cfg)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	existing, _, hasExisting := a.latestSetupConfigForSettings()
	if hasExisting {
		preserveMissingGitHubDownloadFields(&cfg, meta, existing)
	}
	cfg.defaults()
	if err := validateSetupProxyMode(cfg); err != nil {
		writeError(w, http.StatusBadRequest, "unsupported_proxy_mode", err.Error())
		return
	}
	if hasExisting {
		existing.defaults()
		if a.mihomoConfigMode() == "custom" && !strings.EqualFold(existing.LinuxProxyMode, cfg.LinuxProxyMode) {
			content, readErr := os.ReadFile(filepath.Join(a.DataDir, mihomoActiveConfigRelPath))
			conflictErr := readErr
			if conflictErr == nil {
				conflictErr = a.validateMihomoContentForTargetProxyMode(cfg, content)
			}
			if conflictErr != nil {
				writeError(w, http.StatusConflict, "custom_config_mode_conflict", "restore the generated Mihomo config or manually update the active custom config for the target proxy mode before retrying: "+conflictErr.Error())
				return
			}
		}
		if !strings.EqualFold(existing.LinuxProxyMode, cfg.LinuxProxyMode) && isTUNProxyMode(cfg.LinuxProxyMode) {
			tunStatus := setupTunPreflight(cfg.LinuxProxyMode)
			if !tunStatus.Available {
				writeError(w, http.StatusConflict, "tun_preflight_failed", tunStatus.Message)
				return
			}
		}
	}
	if cfg.Username == "" {
		cfg.Username = "root"
	}
	if err := applyHostTimezone(r.Context(), cfg.Timezone); err != nil {
		writeError(w, http.StatusConflict, "timezone_error", err.Error())
		return
	}
	if err := a.writeGeneratedConfigs(cfg); err != nil {
		writeError(w, http.StatusInternalServerError, "config_error", err.Error())
		return
	}
	if err := a.ensureProxyModeConsistency(cfg, false); err != nil {
		writeError(w, http.StatusConflict, "proxy_mode_mismatch", err.Error())
		return
	}
	setupID, err := a.insertInitializedSetup(cfg)
	if err != nil {
		if hasExisting {
			_ = a.writeGeneratedConfigs(existing)
		}
		writeError(w, http.StatusInternalServerError, "setup_error", err.Error())
		return
	}
	a.SetConfiguredRuntimeDesired(cfg)
	if err := a.validateProxyModeRuntimeState(cfg); err != nil {
		_, _ = a.DB.Exec(`delete from system_setups where id=?`, setupID)
		if hasExisting {
			a.SetConfiguredRuntimeDesired(existing)
			_ = a.writeGeneratedConfigs(existing)
		} else {
			a.Services.setDesired("mihomo", false)
			a.Services.setDesired("mosdns", false)
			a.setSetting(nftDesiredKey, "false")
		}
		writeError(w, http.StatusConflict, "proxy_mode_mismatch", err.Error())
		return
	}
	if err := setupApplyProxyNetworkState(a, r.Context(), cfg); err != nil {
		_, _ = a.DB.Exec(`delete from system_setups where id=?`, setupID)
		if hasExisting {
			a.SetConfiguredRuntimeDesired(existing)
			_ = a.writeGeneratedConfigs(existing)
			_ = setupApplyProxyNetworkState(a, r.Context(), existing)
		} else {
			a.Services.setDesired("mihomo", false)
			a.Services.setDesired("mosdns", false)
			a.setSetting(nftDesiredKey, "false")
		}
		writeError(w, http.StatusInternalServerError, "network_apply_failed", err.Error())
		return
	}
	restarted := []string{}
	for _, name := range managedServiceNames() {
		st := a.Services.Status(name)
		if st.Running {
			if _, err := a.Services.Restart(r.Context(), name); err == nil {
				restarted = append(restarted, name)
			}
		}
	}
	missing := a.setupMissingComponentsForConfig(cfg)
	payload := setupConfigPayload(cfg, true)
	response := map[string]any{
		"success":                  true,
		"config":                   payload,
		"data":                     payload,
		"restarted_services":       restarted,
		"needs_download":           len(missing) > 0,
		"download_component":       missing,
		"network_reapply_required": false,
		"network_applied":          runtime.GOOS == "linux",
		"effective_proxy_mode":     cfg.LinuxProxyMode,
		"tun":                      setupTunPreflight(cfg.LinuxProxyMode),
	}
	for key, value := range payload {
		response[key] = value
	}
	writeJSON(w, http.StatusOK, response)
}

type setupConfigRequestMeta struct {
	GitHubProxyEnabled       bool
	GitHubHTTPSProxy         bool
	GitHubHTTPProxy          bool
	GitHubSocks5Proxy        bool
	GitHubAcceleratorEnabled bool
	GitHubAcceleratorURL     bool
	SubscriptionURLs         bool
	MihomoProxies            bool
	LinuxProxyMode           bool
}

func preserveMissingGitHubDownloadFields(cfg *SetupConfig, meta setupConfigRequestMeta, existing SetupConfig) {
	if !meta.GitHubProxyEnabled {
		cfg.GitHubProxyEnabled = existing.GitHubProxyEnabled
	}
	if !meta.GitHubHTTPSProxy {
		cfg.GitHubHTTPSProxy = existing.GitHubHTTPSProxy
	}
	if !meta.GitHubHTTPProxy {
		cfg.GitHubHTTPProxy = existing.GitHubHTTPProxy
	}
	if !meta.GitHubSocks5Proxy {
		cfg.GitHubSocks5Proxy = existing.GitHubSocks5Proxy
	}
	if !meta.GitHubAcceleratorEnabled {
		cfg.GitHubAcceleratorEnabled = existing.GitHubAcceleratorEnabled
	}
	if !meta.GitHubAcceleratorURL {
		cfg.GitHubAcceleratorURL = existing.GitHubAcceleratorURL
	}
	if !meta.SubscriptionURLs {
		cfg.SubscriptionURLs = existing.SubscriptionURLs
	}
	if !meta.MihomoProxies {
		cfg.MihomoProxies = existing.MihomoProxies
	}
	if !meta.LinuxProxyMode {
		cfg.LinuxProxyMode = existing.LinuxProxyMode
	}
}

func (a *App) handleSetupInitialize(w http.ResponseWriter, r *http.Request) {
	if a.IsInitialized() {
		writeError(w, http.StatusConflict, "already_initialized", "system is already initialized")
		return
	}
	var cfg SetupConfig
	if err := decodeSetupConfigRequest(r, &cfg); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	cfg.defaults()
	if err := validateSetupProxyMode(cfg); err != nil {
		writeError(w, http.StatusBadRequest, "unsupported_proxy_mode", err.Error())
		return
	}
	if cfg.Username == "" || cfg.Password == "" {
		writeError(w, http.StatusBadRequest, "validation_error", "username and password are required")
		return
	}
	preflight := a.buildSetupPreflight(r.Context(), cfg.Timezone, true, cfg.LinuxProxyMode)
	if preflight.Blocking {
		writeJSON(w, http.StatusConflict, map[string]any{
			"success":   false,
			"error":     "preflight_blocked",
			"message":   strings.Join(preflight.Errors, "; "),
			"preflight": preflight,
		})
		return
	}
	if err := applyHostTimezone(r.Context(), cfg.Timezone); err != nil {
		writeError(w, http.StatusConflict, "timezone_error", err.Error())
		return
	}
	a.prepareUninitializedGeneratedMihomoMode()
	if err := a.EnsureBaseLayout(); err != nil {
		writeError(w, http.StatusInternalServerError, "layout_error", err.Error())
		return
	}
	if err := a.createOrUpdateAdmin(cfg.Username, cfg.Password, cfg.Email); err != nil {
		writeError(w, http.StatusInternalServerError, "user_error", err.Error())
		return
	}
	if err := a.writeGeneratedConfigs(cfg); err != nil {
		writeError(w, http.StatusInternalServerError, "config_error", err.Error())
		return
	}
	if err := a.validateGeneratedProxyModeFiles(cfg); err != nil {
		writeError(w, http.StatusConflict, "proxy_mode_mismatch", err.Error())
		return
	}
	setupID, err := a.insertInitializedSetup(cfg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "setup_error", err.Error())
		return
	}
	a.SetConfiguredRuntimeDesired(cfg)
	if err := a.validateProxyModeRuntimeState(cfg); err != nil {
		_, _ = a.DB.Exec(`delete from system_setups where id=?`, setupID)
		a.Services.setDesired("mihomo", false)
		a.Services.setDesired("mosdns", false)
		a.setSetting(nftDesiredKey, "false")
		writeError(w, http.StatusConflict, "proxy_mode_mismatch", err.Error())
		return
	}
	a.audit(nil, "setup.initialize", "system", cfg.Username, true, "")
	missing := a.setupMissingComponentsForConfig(cfg)
	writeJSON(w, http.StatusOK, map[string]any{
		"success":              true,
		"message":              "initialized",
		"needs_download":       len(missing) > 0,
		"download_component":   missing,
		"effective_proxy_mode": cfg.LinuxProxyMode,
		"tun":                  preflight.TUN,
	})
}

func (a *App) prepareUninitializedGeneratedMihomoMode() {
	a.setSetting(mihomoAppliedUserConfigKey, "")
	a.setSetting(mihomoGeneratedBackupPathKey, mihomoGeneratedBackupRelPath)
	a.setMihomoConfigMode("generated")
	a.setSetting("mihomo.active_config", "config.yaml")
	_ = os.Remove(filepath.Join(a.DataDir, mihomoGeneratedBackupRelPath))
	_ = os.Remove(filepath.Join(a.DataDir, "configs/mihomo/config.yaml.backup"))
}

func (a *App) insertInitializedSetup(cfg SetupConfig) (int64, error) {
	now := time.Now()
	res, err := a.DB.Exec(`insert into system_setups(created_at,updated_at,username,email,timezone,web_port,amd64v3_enabled,selected_interface,mihomo_core_type,auto_set_dns,dns_on,dns_off,enable_ipv6,fake_ip_range_v4,fake_ip_range_v6,linux_proxy_mode,nft_proxy_policy,proxy_core,mos_dns_enabled,subscription_urls,mihomo_proxies,github_proxy_enabled,github_https_proxy,github_http_proxy,github_socks5_proxy,github_accelerator_enabled,github_accelerator_url,is_initialized)
		values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,true)`,
		now, now, cfg.Username, cfg.Email, cfg.Timezone, cfg.WebPort, cfg.AMD64v3Enabled, cfg.SelectedInterface, cfg.MihomoCoreType, cfg.AutoSetDNS, cfg.DNSOn, cfg.DNSOff, cfg.EnableIPv6, cfg.FakeIPRangeV4, cfg.FakeIPRangeV6, cfg.LinuxProxyMode, cfg.NFTProxyPolicy, "mihomo", true, cfg.SubscriptionURLs, cfg.MihomoProxies, cfg.GitHubProxyEnabled, cfg.GitHubHTTPSProxy, cfg.GitHubHTTPProxy, cfg.GitHubSocks5Proxy, cfg.GitHubAcceleratorEnabled, cfg.GitHubAcceleratorURL)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func decodeSetupConfigRequest(r *http.Request, cfg *SetupConfig) error {
	_, err := decodeSetupConfigRequestWithMeta(r, cfg)
	return err
}

func decodeSetupConfigRequestWithMeta(r *http.Request, cfg *SetupConfig) (setupConfigRequestMeta, error) {
	var raw map[string]any
	if err := decodeJSON(r, &raw); err != nil {
		return setupConfigRequestMeta{}, err
	}
	meta := setupConfigRequestMeta{
		GitHubProxyEnabled:       setupHasValue(raw, "github_proxy_enabled", "githubProxyEnabled"),
		GitHubHTTPSProxy:         setupHasValue(raw, "github_https_proxy", "githubHTTPSProxy"),
		GitHubHTTPProxy:          setupHasValue(raw, "github_http_proxy", "githubHTTPProxy"),
		GitHubSocks5Proxy:        setupHasValue(raw, "github_socks5_proxy", "githubSocks5Proxy"),
		GitHubAcceleratorEnabled: setupHasValue(raw, "github_accelerator_enabled", "githubAcceleratorEnabled"),
		GitHubAcceleratorURL:     setupHasValue(raw, "github_accelerator_url", "githubAcceleratorURL"),
		SubscriptionURLs:         setupHasValue(raw, "subscription_urls", "subscriptionURLs"),
		MihomoProxies:            setupHasValue(raw, "mihomo_proxies", "mihomoProxies"),
		LinuxProxyMode:           setupHasValue(raw, "linux_proxy_mode", "linuxProxyMode"),
	}
	cfg.Username = setupString(raw, "username")
	cfg.Password = setupString(raw, "password")
	cfg.ConfirmPassword = setupString(raw, "confirm_password", "confirmPassword")
	cfg.Email = setupString(raw, "email")
	cfg.Timezone = setupString(raw, "timezone")
	cfg.WebPort = setupString(raw, "web_port", "webPort")
	cfg.AMD64v3Enabled = setupBool(raw, false, "amd64v3_enabled", "amd64v3Enabled", "amd64v3")
	cfg.SelectedInterface = setupString(raw, "selected_interface", "selectedInterface")
	cfg.MihomoCoreType = setupString(raw, "mihomo_core_type", "mihomoCoreType")
	cfg.AutoSetDNS = setupBool(raw, true, "auto_set_dns", "autoSetDNS")
	cfg.DNSOn = setupString(raw, "dns_on", "dnsOn")
	cfg.DNSOff = setupString(raw, "dns_off", "dnsOff")
	enableIPv6Default := true
	if IsDockerRuntime() && !setupHasValue(raw, "enable_ipv6", "enableIPv6") {
		enableIPv6Default = false
	}
	cfg.EnableIPv6 = setupBool(raw, enableIPv6Default, "enable_ipv6", "enableIPv6")
	cfg.FakeIPRangeV4 = setupString(raw, "fake_ip_range_v4", "fakeIPRangeV4")
	cfg.FakeIPRangeV6 = setupString(raw, "fake_ip_range_v6", "fakeIPRangeV6")
	cfg.LinuxProxyMode = setupString(raw, "linux_proxy_mode", "linuxProxyMode")
	cfg.NFTProxyPolicy = setupString(raw, "nft_proxy_policy", "nftProxyPolicy")
	cfg.ProxyCore = setupString(raw, "proxy_core", "proxyCore")
	cfg.MosDNSEnabled = setupBool(raw, true, "mos_dns_enabled", "mosdnsEnabled", "mosDNSEnabled")
	if value, ok := setupValue(raw, "subscription_urls", "subscriptionURLs"); ok {
		subscriptions, err := normalizeSubscriptionURLsValue(value)
		if err != nil {
			return meta, err
		}
		cfg.SubscriptionURLs = subscriptions
	}
	cfg.MihomoProxies = setupString(raw, "mihomo_proxies", "mihomoProxies")
	cfg.GitHubProxyEnabled = setupBool(raw, false, "github_proxy_enabled", "githubProxyEnabled")
	cfg.GitHubHTTPSProxy = setupString(raw, "github_https_proxy", "githubHTTPSProxy")
	cfg.GitHubHTTPProxy = setupString(raw, "github_http_proxy", "githubHTTPProxy")
	cfg.GitHubSocks5Proxy = setupString(raw, "github_socks5_proxy", "githubSocks5Proxy")
	cfg.GitHubAcceleratorEnabled = setupBool(raw, false, "github_accelerator_enabled", "githubAcceleratorEnabled")
	cfg.GitHubAcceleratorURL = setupString(raw, "github_accelerator_url", "githubAcceleratorURL")
	return meta, nil
}

func setupValue(raw map[string]any, keys ...string) (any, bool) {
	for _, key := range keys {
		value, ok := raw[key]
		if ok {
			return value, true
		}
	}
	return nil, false
}

func setupHasValue(raw map[string]any, keys ...string) bool {
	_, ok := setupValue(raw, keys...)
	return ok
}

func setupConfigPayload(cfg SetupConfig, initialized bool) map[string]any {
	return map[string]any{
		"username":                   cfg.Username,
		"email":                      cfg.Email,
		"timezone":                   cfg.Timezone,
		"web_port":                   cfg.WebPort,
		"webPort":                    cfg.WebPort,
		"amd64v3_enabled":            cfg.AMD64v3Enabled,
		"amd64v3Enabled":             cfg.AMD64v3Enabled,
		"selected_interface":         cfg.SelectedInterface,
		"selectedInterface":          cfg.SelectedInterface,
		"singbox_core_type":          "",
		"mihomo_core_type":           cfg.MihomoCoreType,
		"mihomoCoreType":             cfg.MihomoCoreType,
		"auto_set_dns":               cfg.AutoSetDNS,
		"autoSetDNS":                 cfg.AutoSetDNS,
		"dns_on":                     cfg.DNSOn,
		"dnsOn":                      cfg.DNSOn,
		"dns_off":                    cfg.DNSOff,
		"dnsOff":                     cfg.DNSOff,
		"enable_ipv6":                cfg.EnableIPv6,
		"enableIPv6":                 cfg.EnableIPv6,
		"fake_ip_range_v4":           cfg.FakeIPRangeV4,
		"fakeIPRangeV4":              cfg.FakeIPRangeV4,
		"fake_ip_range_v6":           cfg.FakeIPRangeV6,
		"fakeIPRangeV6":              cfg.FakeIPRangeV6,
		"linux_proxy_mode":           cfg.LinuxProxyMode,
		"nft_proxy_policy":           cfg.NFTProxyPolicy,
		"proxy_core":                 cfg.ProxyCore,
		"proxyCore":                  cfg.ProxyCore,
		"mos_dns_enabled":            cfg.MosDNSEnabled,
		"mosdnsEnabled":              cfg.MosDNSEnabled,
		"subscription_urls":          cfg.SubscriptionURLs,
		"subscriptionURLs":           cfg.SubscriptionURLs,
		"mihomo_proxies":             cfg.MihomoProxies,
		"mihomoProxies":              cfg.MihomoProxies,
		"github_proxy_enabled":       cfg.GitHubProxyEnabled,
		"github_https_proxy":         cfg.GitHubHTTPSProxy,
		"github_http_proxy":          cfg.GitHubHTTPProxy,
		"github_socks5_proxy":        cfg.GitHubSocks5Proxy,
		"github_accelerator_enabled": cfg.GitHubAcceleratorEnabled,
		"github_accelerator_url":     cfg.GitHubAcceleratorURL,
		"is_initialized":             initialized,
	}
}

func setupString(raw map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := raw[key]; ok {
			return strings.TrimSpace(fmtAny(value))
		}
	}
	return ""
}

func setupBool(raw map[string]any, fallback bool, keys ...string) bool {
	for _, key := range keys {
		value, ok := raw[key]
		if !ok {
			continue
		}
		switch v := value.(type) {
		case bool:
			return v
		case float64:
			return v != 0
		case int:
			return v != 0
		case string:
			if strings.TrimSpace(v) == "" {
				return fallback
			}
			return isTruthy(v)
		default:
			return isTruthy(fmtAny(v))
		}
	}
	return fallback
}

func defaultSetupInterface() string {
	ifaces, _ := net.Interfaces()
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := iface.Addrs()
		var ips []string
		for _, addr := range addrs {
			ips = append(ips, addr.String())
		}
		if primaryInterfaceIP(ips) != "" {
			return iface.Name
		}
	}
	return ""
}

func (a *App) handleSetupActivate(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	report := a.RestoreConfiguredRuntime(ctx)
	if len(report.Errors) > 0 {
		log.Printf("setup activation completed with errors: %s", strings.Join(report.Errors, "; "))
		writeJSON(w, http.StatusConflict, map[string]any{
			"success":            false,
			"error":              "activation_failed",
			"message":            strings.Join(report.Errors, "; "),
			"port_changed":       false,
			"port":               7777,
			"activation_pending": false,
			"runtime":            report,
			"errors":             report.Errors,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success":            true,
		"port_changed":       false,
		"port":               7777,
		"activation_pending": false,
		"runtime":            report,
		"errors":             report.Errors,
	})
}

func (a *App) handleSetupReset(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdmin(r) {
		writeError(w, http.StatusForbidden, "forbidden", "admin required")
		return
	}
	var req struct {
		CurrentPassword  string `json:"current_password"`
		DeleteBinaries   bool   `json:"delete_binaries"`
		DeleteComponents bool   `json:"delete_components"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if !a.resetMu.TryLock() {
		writeError(w, http.StatusConflict, "reset_in_progress", "system factory reset is already in progress")
		return
	}
	defer a.resetMu.Unlock()
	if err := a.validateFactoryResetPassword(currentUser(r), req.CurrentPassword); err != nil {
		if strings.Contains(err.Error(), "required") {
			writeError(w, http.StatusBadRequest, "validation_error", err.Error())
		} else {
			writeError(w, http.StatusUnauthorized, "invalid_credentials", err.Error())
		}
		return
	}
	a.resetInProgress.Store(true)
	defer a.resetInProgress.Store(false)
	a.resetGate.Lock()
	defer a.resetGate.Unlock()

	deleteComponents := req.DeleteComponents || req.DeleteBinaries
	result, err := a.factoryReset(r.Context(), factoryResetOptions{DeleteComponents: deleteComponents})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "factory_reset_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success":               true,
		"factory_reset":         result.FactoryReset,
		"requires_reinitialize": result.RequiresReinitialize,
		"deleted_components":    result.DeletedComponents,
		"retained_components":   result.RetainedComponents,
		"deleted_binaries":      deleteComponents,
	})
}

func (a *App) handleSetupDownload(w http.ResponseWriter, r *http.Request) {
	component := normalizeComponent(r.PathValue("component"))
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	enc := json.NewEncoder(w)
	flusher, _ := w.(http.Flusher)
	emit := func(ev DownloadEvent) {
		fmt.Fprint(w, "data: ")
		_ = enc.Encode(ev)
		fmt.Fprint(w, "\n")
		if flusher != nil {
			flusher.Flush()
		}
	}
	if isTruthy(r.URL.Query().Get("skip_if_exists")) {
		if a.setupComponentInstalled(component) {
			emit(DownloadEvent{Status: "skipped", Progress: 100, Message: component + " already installed"})
			return
		}
	}
	err := a.installSetupComponent(component, emit)
	if err != nil {
		emit(DownloadEvent{Status: "failed", Progress: 0, Message: err.Error()})
	}
}

func (a *App) setupComponentInstalled(component string) bool {
	target := a.componentTarget(component)
	if target == "" {
		return false
	}
	if _, err := os.Stat(target); err != nil {
		return false
	}
	if component == "mihomo" {
		if _, err := os.Stat(a.componentTarget("zashboard")); err != nil {
			return false
		}
	}
	return true
}

func (a *App) setupMissingComponentsForConfig(cfg SetupConfig) []string {
	cfg.defaults()
	missing := []string{}
	if cfg.MosDNSEnabled && !a.setupComponentInstalled("mosdns") {
		missing = append(missing, "mosdns")
	}
	if strings.EqualFold(cfg.ProxyCore, "mihomo") || cfg.ProxyCore == "" {
		if !a.setupComponentInstalled("mihomo") {
			missing = append(missing, "mihomo")
		}
	}
	return missing
}

func (a *App) installSetupComponent(component string, emit func(DownloadEvent)) error {
	if component != "mihomo" {
		return a.installComponent(component, emit)
	}
	if _, err := os.Stat(a.componentTarget("mihomo")); err != nil {
		if err := a.installComponent("mihomo", func(ev DownloadEvent) {
			if ev.Status == "completed" {
				emit(DownloadEvent{Status: "running", Progress: 68, Message: "mihomo installed; preparing zashboard UI"})
				return
			}
			if ev.Progress > 68 {
				ev.Progress = 68
			}
			emit(ev)
		}); err != nil {
			return err
		}
	} else {
		emit(DownloadEvent{Status: "running", Progress: 60, Message: "mihomo already installed"})
	}
	if _, err := os.Stat(a.componentTarget("zashboard")); err == nil {
		emit(DownloadEvent{Status: "completed", Progress: 100, Message: "mihomo and zashboard installed"})
		return nil
	}
	emit(DownloadEvent{Status: "running", Progress: 70, Message: "installing zashboard UI"})
	if err := a.installComponent("zashboard", func(ev DownloadEvent) {
		ev.Progress = 70 + ev.Progress/4
		if ev.Progress > 99 && ev.Status != "completed" {
			ev.Progress = 99
		}
		emit(ev)
	}); err != nil {
		return err
	}
	emit(DownloadEvent{Status: "completed", Progress: 100, Message: "mihomo and zashboard installed"})
	return nil
}

func isTruthy(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "y", "on":
		return true
	default:
		return false
	}
}

func primaryInterfaceIP(addresses []string) string {
	for _, addr := range addresses {
		host := addr
		if strings.Contains(addr, "/") {
			if ip, _, err := net.ParseCIDR(addr); err == nil {
				host = ip.String()
			}
		}
		ip := net.ParseIP(host)
		if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
			continue
		}
		if ip.To4() != nil {
			return ip.String()
		}
	}
	for _, addr := range addresses {
		host := addr
		if strings.Contains(addr, "/") {
			if ip, _, err := net.ParseCIDR(addr); err == nil {
				host = ip.String()
			}
		}
		ip := net.ParseIP(host)
		if ip != nil && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() {
			return ip.String()
		}
	}
	return ""
}

func interfaceSpeed(name string) string {
	if runtime.GOOS != "linux" || name == "" {
		return "unknown"
	}
	b, err := os.ReadFile(filepath.Join("/sys/class/net", name, "speed"))
	if err != nil {
		return "unknown"
	}
	value := strings.TrimSpace(string(b))
	if value == "" || value == "-1" {
		return "unknown"
	}
	return value + " Mbps"
}

func hostname() string {
	h, _ := os.Hostname()
	return h
}

func cpuModel() string {
	if runtime.GOOS != "linux" {
		return runtime.GOARCH
	}
	b, err := os.ReadFile("/proc/cpuinfo")
	if err != nil {
		return runtime.GOARCH
	}
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(strings.ToLower(line), "model name") {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				return strings.TrimSpace(parts[1])
			}
		}
	}
	return runtime.GOARCH
}

func supportsAMD64v3() bool {
	if runtime.GOARCH != "amd64" {
		return false
	}
	b, err := os.ReadFile("/proc/cpuinfo")
	if err != nil {
		return false
	}
	return supportsAMD64v3Flags(string(b))
}

func supportsAMD64v3Flags(cpuInfo string) bool {
	flags := cpuFlags(cpuInfo)
	required := []string{"avx", "avx2", "bmi1", "bmi2", "fma", "lzcnt", "movbe", "xsave"}
	for _, f := range required {
		if f == "lzcnt" && flags["abm"] {
			continue
		}
		if !flags[f] {
			return false
		}
	}
	return true
}

func cpuFlags(cpuInfo string) map[string]bool {
	flags := map[string]bool{}
	for _, line := range strings.Split(cpuInfo, "\n") {
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(strings.ToLower(parts[0]))
		if key != "flags" && key != "features" {
			continue
		}
		for _, flag := range strings.Fields(strings.ToLower(parts[1])) {
			flags[flag] = true
		}
	}
	return flags
}

func amd64v3Status() string {
	if runtime.GOARCH != "amd64" {
		return "unnecessary"
	}
	if supportsAMD64v3() {
		return "supported"
	}
	return "unsupported"
}
