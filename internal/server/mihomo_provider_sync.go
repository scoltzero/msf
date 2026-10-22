package server

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

func (a *App) syncMihomoProxyProvidersFromSetupConfig(cfg SetupConfig, username string) error {
	previous, ok := a.latestSetupConfig()
	var before *SetupConfig
	if ok {
		before = &previous
	}
	return a.syncMihomoSetupProviders(cfg, before, username)
}

func (a *App) syncMihomoSetupProviders(cfg SetupConfig, previous *SetupConfig, username string) error {
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
	content, _, err := a.mihomoEffectiveConfigContent()
	if err != nil {
		return err
	}
	providersYAML, err := reconcileMihomoSetupProviders(content, cfg, previous)
	if err != nil {
		return err
	}
	return a.syncMihomoProxyProvidersYAML(providersYAML, username, false)
}

// Only explicit setup differences own existing HTTP subscriptions. All other
// provider fields (including false/zero values and unknown extensions) are user
// configuration. Startup passes no previous setup and never removes providers.
func reconcileMihomoSetupProviders(content string, cfg SetupConfig, previous *SetupConfig) (string, error) {
	var current, defaults map[string]any
	if err := yaml.Unmarshal([]byte(content), &current); err != nil {
		return "", err
	}
	if err := yaml.Unmarshal([]byte(renderProxyProvidersYAML(parseSubscriptionProviders(cfg.SubscriptionURLs), hasMihomoManualProxies(cfg.MihomoProxies))), &defaults); err != nil {
		return "", err
	}
	providers := normalizeConfigProviders(current["proxy-providers"])
	desired := normalizeConfigProviders(defaults["proxy-providers"])
	oldURLs := map[string]string{}
	if previous != nil {
		oldURLs = parseSubscriptionProviders(previous.SubscriptionURLs)
	}
	for name, definition := range desired {
		if existing, ok := providers[name]; ok {
			if previous != nil && name != "msf_manual" && oldURLs[name] != stringMapValue(definition, "url") {
				// A setup edit must not convert a user-owned file/inline provider.
				if kind := strings.ToLower(stringMapValue(existing, "type")); kind == "http" || kind == "" {
					existing["url"] = definition["url"]
				}
			}
			continue
		}
		providers[name] = definition
	}
	if previous != nil {
		for name, oldURL := range oldURLs {
			if _, keep := desired[name]; keep {
				continue
			}
			p := providers[name]
			if p != nil && strings.EqualFold(stringMapValue(p, "type"), "http") && stringMapValue(p, "url") == oldURL {
				delete(providers, name)
			}
		}
		if hasMihomoManualProxies(previous.MihomoProxies) && !hasMihomoManualProxies(cfg.MihomoProxies) {
			delete(providers, "msf_manual")
		}
	}
	b, err := yaml.Marshal(map[string]any{"proxy-providers": providerConfigMap(providers)})
	return string(b), err
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
	rels := []string{mihomoActiveConfigRelPath}
	if rel, ok := a.appliedMihomoUserConfigRel(); ok {
		rels = append(rels, rel)
	}
	files := map[string]string{}
	originals := map[string]string{}
	runtimeContent := ""
	for index, rel := range rels {
		content, err := a.readTextFile(rel)
		if index > 0 && os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		patched, err := mihomoProxyProvidersPatch(content, providersYAML)
		if err != nil {
			return fmt.Errorf("prepare provider update in %s: %w", rel, err)
		}
		if index == 0 {
			runtimeContent = patched
		}
		if patched != content {
			files[rel] = patched
			originals[rel] = content
		}
	}
	// Validate every target before changing either the active or applied source.
	for rel, original := range originals {
		a.createConfigHistory("mihomo", rel, original, "auto backup before Mihomo proxy providers sync", firstNonEmpty(username, "system"))
	}
	if err := a.replaceGeneratedConfigFiles(files, nil); err != nil {
		return err
	}
	if syncSetup {
		return a.syncLatestSetupProviderFieldsFromMihomoContent(runtimeContent)
	}
	return nil
}

func mihomoProxyProvidersPatch(content, providersYAML string) (string, error) {
	var current, desired map[string]any
	if err := yaml.Unmarshal([]byte(content), &current); err != nil {
		return "", err
	}
	if err := yaml.Unmarshal([]byte(providersYAML), &desired); err != nil {
		return "", err
	}
	if reflect.DeepEqual(normalizeConfigProviders(current["proxy-providers"]), normalizeConfigProviders(desired["proxy-providers"])) {
		return content, nil // Preserve comments, anchors and formatting on startup.
	}
	patched := moveTopLevelYAMLBlockToEnd(replaceMihomoProxyProviders(content, providersYAML), "proxy-providers")
	var validated map[string]any
	if err := yaml.Unmarshal([]byte(patched), &validated); err != nil {
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
	_, err := a.insertSetupSnapshot(cfg, initialized)
	return err
}

func setupPatchTouchesMihomoProviders(raw map[string]any) bool {
	for _, key := range []string{"subscription_urls", "subscriptionURLs", "mihomo_proxies", "mihomoProxies", "manual_proxies_source"} {
		if _, ok := raw[key]; ok {
			return true
		}
	}
	return false
}
