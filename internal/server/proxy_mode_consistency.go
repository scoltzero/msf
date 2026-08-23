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
	if IsMacOSRuntime() && !isTUNProxyMode(cfg.LinuxProxyMode) {
		return fmt.Errorf("macOS only supports linux_proxy_mode=tun")
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
	if err := validateProxyModeDocuments(cfg, mihomo, network, fileExists(filepath.Join(a.DataDir, "configs/network/network.nft"))); err != nil {
		return err
	}
	return validateIPv6Documents(cfg, mihomo, network)
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

func validateIPv6Documents(cfg SetupConfig, mihomo, network map[string]any) error {
	wantPrefix := fakeIPv6RouteCIDR(cfg.FakeIPRangeV6)
	var problems []string
	if isTruthy(fmtAny(mihomo["ipv6"])) != cfg.EnableIPv6 {
		problems = append(problems, fmt.Sprintf("mihomo ipv6 must be %t", cfg.EnableIPv6))
	}
	dns, _ := mihomo["dns"].(map[string]any)
	if isTruthy(fmtAny(dns["ipv6"])) != cfg.EnableIPv6 {
		problems = append(problems, fmt.Sprintf("mihomo dns.ipv6 must be %t", cfg.EnableIPv6))
	}
	if got := strings.TrimSpace(fmtAny(dns["fake-ip-range6"])); got == "" || fakeIPv6RouteCIDR(got) != wantPrefix {
		problems = append(problems, "mihomo dns.fake-ip-range6 must equal "+wantPrefix)
	}
	tun, _ := mihomo["tun"].(map[string]any)
	hasTunV6Route := yamlValueContains(tun["route-address"], wantPrefix)
	if cfg.EnableIPv6 && isTUNProxyMode(cfg.LinuxProxyMode) && !hasTunV6Route {
		problems = append(problems, "mihomo tun.route-address must contain "+wantPrefix)
	}
	if !cfg.EnableIPv6 && yamlValueContainsIPv6(tun["route-address"]) {
		problems = append(problems, "mihomo tun.route-address must not contain IPv6 routes while IPv6 is disabled")
	}
	networkIPv6, _ := network["ipv6"].(map[string]any)
	if isTruthy(fmtAny(networkIPv6["enable"])) != cfg.EnableIPv6 {
		problems = append(problems, fmt.Sprintf("network ipv6.enable must be %t", cfg.EnableIPv6))
	}
	if cfg.EnableIPv6 && !yamlValueContains(network["fake_ipv6"], wantPrefix) {
		problems = append(problems, "network fake_ipv6 must contain "+wantPrefix)
	}
	if !cfg.EnableIPv6 && yamlValueHasItems(network["fake_ipv6"]) {
		problems = append(problems, "network fake_ipv6 must be absent while IPv6 is disabled")
	}
	if len(problems) > 0 {
		return fmt.Errorf("IPv6 config mismatch: %s", strings.Join(problems, "; "))
	}
	return nil
}

func yamlValueContains(value any, want string) bool {
	for _, item := range yamlStrings(value) {
		if strings.TrimSpace(item) == want {
			return true
		}
	}
	return false
}

func yamlValueContainsIPv6(value any) bool {
	for _, item := range yamlStrings(value) {
		if strings.Contains(item, ":") {
			return true
		}
	}
	return false
}

func yamlStrings(value any) []string {
	switch items := value.(type) {
	case []any:
		out := make([]string, 0, len(items))
		for _, item := range items {
			out = append(out, fmtAny(item))
		}
		return out
	case []string:
		return items
	case string:
		return []string{items}
	default:
		return nil
	}
}

func (a *App) validateActiveRuntimeIdentity(cfg SetupConfig) error {
	content, err := os.ReadFile(filepath.Join(a.DataDir, mihomoActiveConfigRelPath))
	if err != nil {
		return err
	}
	if err := a.validateMihomoContentForProxyMode(cfg, content); err != nil {
		return fmt.Errorf("custom Mihomo config mode conflicts with linux_proxy_mode=%s: %w", cfg.LinuxProxyMode, err)
	}
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
	if err := validateIPv6Documents(cfg, mihomo, network); err != nil {
		return fmt.Errorf("custom Mihomo config mode conflicts with IPv6 settings: %w", err)
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

func (a *App) validateMihomoContentForTargetIPv6(cfg SetupConfig, content []byte) error {
	var mihomo map[string]any
	if err := yaml.Unmarshal(content, &mihomo); err != nil {
		return err
	}
	var network map[string]any
	if err := yaml.Unmarshal([]byte(a.renderNetworkYAML(cfg)), &network); err != nil {
		return err
	}
	return validateIPv6Documents(cfg, mihomo, network)
}

func (a *App) ensureProxyModeConsistency(cfg SetupConfig, repairGenerated bool) error {
	if a.mihomoConfigMode() == "custom" {
		err := a.validateActiveRuntimeIdentity(cfg)
		if err == nil || !repairGenerated {
			return err
		}
		content, readErr := os.ReadFile(filepath.Join(a.DataDir, mihomoActiveConfigRelPath))
		if readErr != nil {
			return readErr
		}
		// Only managed network artifacts may be repaired in custom mode. The
		// user's Mihomo file must already agree with both requested dimensions.
		if targetErr := a.validateMihomoContentForTargetProxyMode(cfg, content); targetErr != nil {
			return fmt.Errorf("custom Mihomo config mode conflicts with linux_proxy_mode=%s: %w", cfg.LinuxProxyMode, targetErr)
		}
		if targetErr := a.validateMihomoContentForTargetIPv6(cfg, content); targetErr != nil {
			return fmt.Errorf("custom Mihomo config mode conflicts with IPv6 settings: %w", targetErr)
		}
		if writeErr := a.writeGeneratedConfigs(cfg); writeErr != nil {
			return fmt.Errorf("repair managed network config for custom Mihomo: %w", writeErr)
		}
		return a.validateActiveRuntimeIdentity(cfg)
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
