package server

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

func (a *App) syncMihomoProxyProvidersFromSetupConfig(cfg SetupConfig, username string) error {
	cfg.defaults()
	if manual := renderMihomoManualProviderYAML(cfg.MihomoProxies); strings.TrimSpace(manual) != "" {
		rel := "configs/mihomo/proxy_providers/msf_manual.yaml"
		if old, err := a.readTextFile(rel); err == nil {
			if old != manual {
				a.createConfigHistory("mihomo", rel, old, "auto backup before Mihomo manual provider sync", firstNonEmpty(username, "system"))
				if err := a.writeTextFileDirect(rel, manual); err != nil {
					return err
				}
			}
		} else if os.IsNotExist(err) {
			if err := a.writeTextFileDirect(rel, manual); err != nil {
				return err
			}
		} else {
			return err
		}
	}
	providersYAML := renderProxyProvidersYAML(parseSubscriptionProviders(cfg.SubscriptionURLs), hasMihomoManualProxies(cfg.MihomoProxies))
	return a.syncMihomoProxyProvidersYAML(providersYAML, username, false)
}

func (a *App) writeMihomoProxyProvidersSection(raw any, username string, syncSetup bool) error {
	providers := providerConfigMap(normalizeConfigProviders(raw))
	if providers == nil {
		providers = map[string]any{}
	}
	b, err := yaml.Marshal(map[string]any{"proxy-providers": providers})
	if err != nil {
		return err
	}
	return a.syncMihomoProxyProvidersYAML(string(b), username, syncSetup)
}

func (a *App) syncMihomoProxyProvidersYAML(providersYAML, username string, syncSetup bool) error {
	if strings.TrimSpace(providersYAML) == "" {
		providersYAML = "proxy-providers: {}\n"
	}
	if err := a.ensureMihomoGeneratedBackup(); err != nil {
		return err
	}
	runtimeContent, err := a.patchMihomoProxyProvidersInFile(mihomoActiveConfigRelPath, providersYAML, username, false)
	if err != nil {
		return err
	}
	if rel, ok := a.appliedMihomoUserConfigRel(); ok {
		if _, err := a.patchMihomoProxyProvidersInFile(rel, providersYAML, username, true); err != nil {
			return err
		}
	}
	if syncSetup {
		return a.syncLatestSetupProviderFieldsFromMihomoContent(runtimeContent)
	}
	return nil
}

func (a *App) patchMihomoProxyProvidersInFile(rel, providersYAML, username string, missingOK bool) (string, error) {
	content, err := a.readTextFile(rel)
	if err != nil {
		if missingOK && os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	patched := replaceMihomoProxyProviders(content, providersYAML)
	if patched == content {
		return patched, nil
	}
	if username == "" {
		username = "system"
	}
	a.createConfigHistory("mihomo", rel, content, "auto backup before Mihomo proxy providers sync", username)
	if err := a.writeTextFileDirect(rel, patched); err != nil {
		return "", err
	}
	return patched, nil
}

func (a *App) applyMihomoProviderFieldsFromEffectiveConfig(cfg *SetupConfig) {
	content, _, err := a.mihomoEffectiveConfigContent()
	if err != nil {
		return
	}
	subscriptions, manual, ok := a.mihomoProviderFieldsFromConfigContent(content, cfg.MihomoProxies)
	if !ok {
		return
	}
	cfg.SubscriptionURLs = subscriptions
	cfg.MihomoProxies = manual
}

func (a *App) mihomoEffectiveConfigContent() (string, string, error) {
	if rel, ok := a.appliedMihomoUserConfigRel(); ok {
		if content, err := a.readTextFile(rel); err == nil {
			return content, rel, nil
		}
	}
	content, err := a.readTextFile(mihomoActiveConfigRelPath)
	return content, mihomoActiveConfigRelPath, err
}

func (a *App) mihomoProviderFieldsFromConfigContent(content, fallbackManual string) (string, string, bool) {
	var cfg map[string]any
	if err := yaml.Unmarshal([]byte(content), &cfg); err != nil {
		return "", "", false
	}
	if cfg == nil {
		return "", "", true
	}
	providers := normalizeConfigProviders(cfg["proxy-providers"])
	return subscriptionURLsFromMihomoProviders(providers), a.mihomoManualProxiesFromProviders(providers, fallbackManual), true
}

func subscriptionURLsFromMihomoProviders(providers map[string]map[string]any) string {
	names := make([]string, 0, len(providers))
	for name := range providers {
		names = append(names, name)
	}
	sort.Strings(names)
	rows := make([]string, 0, len(names))
	for _, name := range names {
		provider := providers[name]
		if name == "msf_manual" {
			continue
		}
		u := strings.TrimSpace(stringMapValue(provider, "url"))
		if u == "" {
			continue
		}
		providerType := strings.ToLower(strings.TrimSpace(stringMapValue(provider, "type")))
		if providerType != "" && providerType != "http" {
			continue
		}
		if row, err := formatSubscriptionURLRow(name, u); err == nil && row != "" {
			rows = append(rows, row)
		}
	}
	return strings.Join(rows, "\n")
}

func (a *App) mihomoManualProxiesFromProviders(providers map[string]map[string]any, fallback string) string {
	fallback = strings.TrimSpace(fallback)
	provider, ok := providers["msf_manual"]
	if !ok {
		for _, candidate := range providers {
			if strings.Contains(strings.ToLower(stringMapValue(candidate, "path")), "msf_manual") {
				provider = candidate
				ok = true
				break
			}
		}
	}
	if !ok {
		return ""
	}
	if fallback != "" {
		return fallback
	}
	providerPath := strings.TrimSpace(firstNonEmpty(stringMapValue(provider, "path"), "./proxy_providers/msf_manual.yaml"))
	rel, ok := mihomoProviderDataRel(providerPath)
	if !ok {
		return fallback
	}
	content, err := a.readTextFile(rel)
	if err != nil {
		return fallback
	}
	return strings.TrimSpace(content)
}

func mihomoProviderDataRel(providerPath string) (string, bool) {
	providerPath = strings.Trim(strings.TrimSpace(providerPath), `"'`)
	if providerPath == "" || filepath.IsAbs(providerPath) {
		return "", false
	}
	providerPath = strings.TrimPrefix(providerPath, "./")
	clean := filepath.ToSlash(filepath.Clean(providerPath))
	if clean == "." || strings.HasPrefix(clean, "../") || clean == ".." {
		return "", false
	}
	if strings.HasPrefix(clean, "configs/mihomo/") {
		return clean, true
	}
	return filepath.ToSlash(filepath.Join("configs/mihomo", clean)), true
}

func (a *App) syncLatestSetupProviderFieldsFromMihomoContent(content string) error {
	cfg, initialized, ok := a.latestSetupConfigForSettingsRaw()
	if !ok {
		return nil
	}
	subscriptions, manual, ok := a.mihomoProviderFieldsFromConfigContent(content, cfg.MihomoProxies)
	if !ok {
		return nil
	}
	if cfg.SubscriptionURLs == subscriptions && strings.TrimSpace(cfg.MihomoProxies) == strings.TrimSpace(manual) {
		return nil
	}
	cfg.SubscriptionURLs = subscriptions
	cfg.MihomoProxies = manual
	return a.insertSetupSnapshot(cfg, initialized)
}

func setupPatchTouchesMihomoProviders(raw map[string]any) bool {
	for _, key := range []string{"subscription_urls", "subscriptionURLs", "mihomo_proxies", "mihomoProxies", "manual_proxies_source"} {
		if _, ok := raw[key]; ok {
			return true
		}
	}
	return false
}
