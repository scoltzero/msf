package server

import (
	"context"
	"fmt"
	"log"
	"runtime"
	"strings"
)

const nftDesiredKey = "network.nft.enabled"

type RuntimeRestoreReport struct {
	Initialized bool            `json:"initialized"`
	Services    []ServiceStatus `json:"services,omitempty"`
	NFT         map[string]any  `json:"nft,omitempty"`
	Errors      []string        `json:"errors,omitempty"`
}

func (a *App) SetConfiguredRuntimeDesired(cfg SetupConfig) {
	cfg.defaults()
	a.Services.setDesired("mihomo", strings.EqualFold(cfg.ProxyCore, "mihomo"))
	a.Services.setDesired("mosdns", cfg.MosDNSEnabled)
	a.setSetting(nftDesiredKey, boolSetting(shouldRestoreNFT(cfg)))
	if a.setting(networkRuntimeDesiredKey, "") == "" {
		a.persistNetworkRuntimeDesired(runtimeStateEnabled)
	}
}

func (a *App) RestoreConfiguredRuntime(ctx context.Context) RuntimeRestoreReport {
	a.networkRuntimeMu.Lock()
	defer a.networkRuntimeMu.Unlock()
	if phase, _ := a.operations.status(); phase != resetPhaseIdle {
		return RuntimeRestoreReport{Errors: []string{"system factory reset is in progress"}}
	}
	report := RuntimeRestoreReport{Initialized: a.IsInitialized()}
	if !report.Initialized {
		return report
	}
	cfg, ok := a.latestSetupConfig()
	if !ok {
		report.Errors = append(report.Errors, "initialized setup config is missing")
		return report
	}
	if err := a.migrateLegacyMosDNSConfig(); err != nil {
		report.Errors = append(report.Errors, "failed to migrate legacy MosDNS entries: "+err.Error())
		return report
	}
	migrated, err := a.migrateSetupProxyModeForRuntime(&cfg)
	if err != nil {
		report.Errors = append(report.Errors, err.Error())
		return report
	}
	if migrated && a.mihomoConfigMode() != "custom" {
		if err := a.writeGeneratedConfigs(cfg); err != nil {
			report.Errors = append(report.Errors, "failed to regenerate migrated runtime config: "+err.Error())
			return report
		}
	}
	if err := validateSetupProxyMode(cfg); err != nil {
		report.Errors = append(report.Errors, err.Error())
		return report
	}
	if !shouldRestoreNFT(cfg) && runtime.GOOS == "linux" {
		output, err := a.clearNFT(ctx)
		status := a.nftStatus()
		if output != "" {
			status["output"] = output
		}
		report.NFT = status
		if err != nil {
			report.Errors = append(report.Errors, "failed to clear nftables for TUN mode: "+err.Error())
			return report
		}
	}
	// Custom Mihomo content is protected by target validation; repairGenerated
	// may still refresh MSF-managed network and nftables artifacts around it.
	if err := a.ensureProxyModeConsistency(cfg, true); err != nil {
		report.Errors = append(report.Errors, err.Error())
		return report
	}
	a.applyMihomoProviderFieldsFromEffectiveConfig(&cfg)
	if err := a.ensureSetupProviderArtifacts(cfg); err != nil {
		report.Errors = append(report.Errors, "failed to sync setup providers: "+err.Error())
	}
	a.backfillConfiguredRuntimeDesired()
	a.setSetting(nftDesiredKey, boolSetting(shouldRestoreNFT(cfg)))
	if err := a.validateProxyModeRuntimeState(cfg); err != nil {
		report.Errors = append(report.Errors, err.Error())
		return report
	}
	desired := a.networkRuntimeDesired()
	if desired == runtimeStateStopped {
		if err := restorePlatformNetwork(ctx, a, cfg); err != nil {
			report.Errors = append(report.Errors, "failed to restore platform network: "+err.Error())
		}
		report.Services = a.Services.List()
		return report
	}
	report.Errors = append(report.Errors, a.Services.StartEnabled(ctx)...)
	report.Services = a.Services.List()
	if err := applyPlatformNetwork(ctx, a, cfg); err != nil {
		msg := "failed to restore platform network: " + err.Error()
		report.Errors = append(report.Errors, msg)
		log.Print(msg)
	} else {
		mode := "rule"
		if desired == runtimeStateDirect {
			mode = "direct"
		}
		if err := a.setMihomoRuntimeMode(mode); err != nil {
			report.Errors = append(report.Errors, err.Error())
		}
	}
	if runtime.GOOS == "linux" {
		report.NFT = a.nftStatus()
	}
	return report
}

func (a *App) migrateSetupProxyModeForRuntime(cfg *SetupConfig) (bool, error) {
	if cfg == nil {
		return false, nil
	}
	storedMode := strings.TrimSpace(cfg.LinuxProxyMode)
	storedAutoSetDNS := cfg.AutoSetDNS
	storedInterface := strings.TrimSpace(cfg.SelectedInterface)
	cfg.defaults()
	isDocker := IsDockerRuntime()
	isMacOS := IsMacOSRuntime()
	if !isDocker && !isMacOS {
		return false, nil
	}
	cfg.LinuxProxyMode = "tun"
	if isMacOS {
		cfg.AutoSetDNS = true
		normalizeSetupInterfaceForRuntime(cfg)
	}
	modeChanged := !isTUNProxyMode(storedMode)
	dnsChanged := isMacOS && !storedAutoSetDNS
	interfaceChanged := isMacOS && strings.TrimSpace(cfg.SelectedInterface) != storedInterface
	if !modeChanged && !dnsChanged && !interfaceChanged {
		return false, nil
	}
	if _, err := a.DB.Exec(`update system_setups set linux_proxy_mode='tun',auto_set_dns=?,selected_interface=?,updated_at=? where id=(select id from system_setups order by id desc limit 1)`, cfg.AutoSetDNS, cfg.SelectedInterface, nowString()); err != nil {
		platform := "Docker"
		if isMacOS {
			platform = "macOS"
		}
		return false, fmt.Errorf("failed to migrate %s network settings to TUN: %w", platform, err)
	}
	return true, nil
}

func (a *App) backfillConfiguredRuntimeDesired() {
	cfg, ok := a.latestSetupConfig()
	if !ok {
		return
	}
	cfg.defaults()
	if a.setting(serviceDesiredKey("mihomo"), "") == "" {
		a.Services.setDesired("mihomo", strings.EqualFold(cfg.ProxyCore, "mihomo"))
	}
	if a.setting(serviceDesiredKey("mosdns"), "") == "" {
		a.Services.setDesired("mosdns", cfg.MosDNSEnabled)
	}
	if a.setting(nftDesiredKey, "") == "" {
		a.setSetting(nftDesiredKey, boolSetting(shouldRestoreNFT(cfg)))
	}
}

func (a *App) latestSetupConfig() (SetupConfig, bool) {
	row := a.DB.QueryRow(`select username,email,timezone,web_port,amd64v3_enabled,selected_interface,mihomo_core_type,auto_set_dns,dns_on,dns_off,enable_ipv6,fake_ip_range_v4,fake_ip_range_v6,linux_proxy_mode,nft_proxy_policy,proxy_core,mos_dns_enabled,subscription_urls,mihomo_proxies,github_proxy_enabled,github_https_proxy,github_http_proxy,github_socks5_proxy,github_accelerator_enabled,github_accelerator_url from system_setups order by id desc limit 1`)
	var cfg SetupConfig
	err := row.Scan(&cfg.Username, &cfg.Email, &cfg.Timezone, &cfg.WebPort, &cfg.AMD64v3Enabled, &cfg.SelectedInterface, &cfg.MihomoCoreType, &cfg.AutoSetDNS, &cfg.DNSOn, &cfg.DNSOff, &cfg.EnableIPv6, &cfg.FakeIPRangeV4, &cfg.FakeIPRangeV6, &cfg.LinuxProxyMode, &cfg.NFTProxyPolicy, &cfg.ProxyCore, &cfg.MosDNSEnabled, &cfg.SubscriptionURLs, &cfg.MihomoProxies, &cfg.GitHubProxyEnabled, &cfg.GitHubHTTPSProxy, &cfg.GitHubHTTPProxy, &cfg.GitHubSocks5Proxy, &cfg.GitHubAcceleratorEnabled, &cfg.GitHubAcceleratorURL)
	return cfg, err == nil
}

func shouldRestoreNFT(cfg SetupConfig) bool {
	return !IsDockerRuntime() && !IsMacOSRuntime() && isNFTProxyMode(cfg.LinuxProxyMode)
}

func (a *App) currentLinuxProxyMode() string {
	cfg, ok := a.latestSetupConfig()
	if !ok {
		cfg = SetupConfig{}
	}
	cfg.defaults()
	return cfg.LinuxProxyMode
}

func boolSetting(ok bool) string {
	if ok {
		return "true"
	}
	return "false"
}

func (a *App) ensureSetupProviderArtifacts(cfg SetupConfig) error {
	return a.syncMihomoProxyProvidersFromSetupConfig(cfg, "system")
}
