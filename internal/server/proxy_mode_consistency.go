package server

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

func validateSetupProxyMode(cfg SetupConfig) error {
	cfg.defaults()
	if IsDockerRuntime() && !isTUNProxyMode(cfg.LinuxProxyMode) {
		return fmt.Errorf("Docker runtime only supports linux_proxy_mode=tun")
	}
	if !isTUNProxyMode(cfg.LinuxProxyMode) && !isNFTProxyMode(cfg.LinuxProxyMode) {
		return fmt.Errorf("unsupported linux_proxy_mode %q", cfg.LinuxProxyMode)
	}
	return nil
}

func (a *App) validateGeneratedProxyModeFiles(cfg SetupConfig) error {
	cfg.defaults()
	if err := validateSetupProxyMode(cfg); err != nil {
		return err
	}
	mihomoContent, err := os.ReadFile(filepath.Join(a.DataDir, mihomoActiveConfigRelPath))
	if err != nil {
		return fmt.Errorf("read Mihomo config: %w", err)
	}
	var mihomo map[string]any
	if err := yaml.Unmarshal(mihomoContent, &mihomo); err != nil {
		return fmt.Errorf("parse Mihomo config: %w", err)
	}
	networkContent, err := os.ReadFile(filepath.Join(a.DataDir, "configs/network/network.yaml"))
	if err != nil {
		return fmt.Errorf("read network config: %w", err)
	}
	var network map[string]any
	if err := yaml.Unmarshal(networkContent, &network); err != nil {
		return fmt.Errorf("parse network config: %w", err)
	}
	return validateProxyModeDocuments(cfg, mihomo, network, fileExists(filepath.Join(a.DataDir, "configs/network/network.nft")))
}

func validateProxyModeDocuments(cfg SetupConfig, mihomo, network map[string]any, nftExists bool) error {
	cfg.defaults()
	if err := validateSetupProxyMode(cfg); err != nil {
		return err
	}
	var problems []string
	tun, tunPresent := mihomo["tun"].(map[string]any)
	tunEnableValue, tunEnablePresent := tun["enable"]
	tunEnabled := tunPresent && tunEnablePresent && isTruthy(fmtAny(tunEnableValue))
	networkMode := strings.ToLower(strings.TrimSpace(fmtAny(network["mode"])))
	if isTUNProxyMode(cfg.LinuxProxyMode) {
		if !tunEnabled {
			problems = append(problems, "tun.enable must be true")
		}
		if strings.ToLower(strings.TrimSpace(fmtAny(tun["stack"]))) != "system" {
			problems = append(problems, "tun.stack must be system")
		}
		for _, key := range []string{"auto-route", "auto-detect-interface"} {
			if !isTruthy(fmtAny(tun[key])) {
				problems = append(problems, "tun."+key+" must be true")
			}
		}
		for _, key := range []string{"route-address", "route-exclude-address"} {
			if !yamlValueHasItems(tun[key]) {
				problems = append(problems, "tun."+key+" must not be empty")
			}
		}
		dns, _ := mihomo["dns"].(map[string]any)
		if !yamlValueHasItems(dns["proxy-server-nameserver"]) {
			problems = append(problems, "dns.proxy-server-nameserver must not be empty")
		}
		for _, key := range []string{"redir-port", "tproxy-port", "routing-mark"} {
			if _, ok := mihomo[key]; ok {
				problems = append(problems, key+" must be absent in TUN mode")
			}
		}
		if networkMode != "tun" {
			problems = append(problems, "network mode must be tun")
		}
		if nftExists {
			problems = append(problems, "network.nft must be absent in TUN mode")
		}
	} else {
		if !tunPresent || !tunEnablePresent {
			problems = append(problems, "tun.enable must be explicitly false in nftables mode")
		} else if tunEnabled {
			problems = append(problems, "tun.enable must be false in nftables mode")
		}
		for _, key := range []string{"redir-port", "tproxy-port", "routing-mark"} {
			if strings.TrimSpace(fmtAny(mihomo[key])) == "" {
				problems = append(problems, key+" must be present in nftables mode")
			}
		}
		if networkMode != "tproxy" {
			problems = append(problems, "network mode must be tproxy")
		}
		if !nftExists {
			problems = append(problems, "network.nft must exist in nftables mode")
		}
	}
	if len(problems) > 0 {
		return fmt.Errorf("proxy mode config mismatch: %s", strings.Join(problems, "; "))
	}
	return nil
}

func (a *App) validateActiveProxyModeIdentity(cfg SetupConfig) error {
	cfg.defaults()
	content, err := os.ReadFile(filepath.Join(a.DataDir, mihomoActiveConfigRelPath))
	if err != nil {
		return err
	}
	if err := a.validateMihomoContentForProxyMode(cfg, content); err != nil {
		return fmt.Errorf("custom Mihomo config mode conflicts with linux_proxy_mode=%s: %w", cfg.LinuxProxyMode, err)
	}
	return nil
}

func (a *App) validateMihomoContentForProxyMode(cfg SetupConfig, content []byte) error {
	var mihomo map[string]any
	if err := yaml.Unmarshal(content, &mihomo); err != nil {
		return err
	}
	networkContent, err := os.ReadFile(filepath.Join(a.DataDir, "configs/network/network.yaml"))
	if err != nil {
		return err
	}
	var network map[string]any
	if err := yaml.Unmarshal(networkContent, &network); err != nil {
		return err
	}
	return validateProxyModeDocuments(cfg, mihomo, network, fileExists(filepath.Join(a.DataDir, "configs/network/network.nft")))
}

func (a *App) validateMihomoContentForTargetProxyMode(cfg SetupConfig, content []byte) error {
	var mihomo map[string]any
	if err := yaml.Unmarshal(content, &mihomo); err != nil {
		return err
	}
	var network map[string]any
	if err := yaml.Unmarshal([]byte(a.renderNetworkYAML(cfg)), &network); err != nil {
		return err
	}
	return validateProxyModeDocuments(cfg, mihomo, network, shouldRestoreNFT(cfg))
}

func (a *App) ensureProxyModeConsistency(cfg SetupConfig, repairGenerated bool) error {
	if a.mihomoConfigMode() == "custom" {
		return a.validateActiveProxyModeIdentity(cfg)
	}
	err := a.validateGeneratedProxyModeFiles(cfg)
	if err == nil || !repairGenerated {
		return err
	}
	if writeErr := a.writeGeneratedConfigs(cfg); writeErr != nil {
		return fmt.Errorf("repair generated proxy mode config: %w", writeErr)
	}
	return a.validateGeneratedProxyModeFiles(cfg)
}

func (a *App) validateProxyModeRuntimeState(cfg SetupConfig) error {
	if err := a.ensureProxyModeConsistency(cfg, false); err != nil {
		return err
	}
	wantNFT := shouldRestoreNFT(cfg)
	gotNFT := a.setting(nftDesiredKey, "false") == "true"
	if wantNFT != gotNFT {
		return fmt.Errorf("network desired state mismatch: linux_proxy_mode=%s nft_desired=%t", cfg.LinuxProxyMode, gotNFT)
	}
	return nil
}

func yamlValueHasItems(value any) bool {
	switch v := value.(type) {
	case []any:
		return len(v) > 0
	case []string:
		return len(v) > 0
	case map[string]any:
		return len(v) > 0
	case string:
		return strings.TrimSpace(v) != ""
	default:
		return value != nil && strings.TrimSpace(fmtAny(value)) != ""
	}
}
