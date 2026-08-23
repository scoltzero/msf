package server

import (
	"bytes"
	"fmt"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

// restoreMihomoGeneratedConfig rebuilds the active config from the current
// embedded default template only when the user explicitly requests a default
// restore. User-owned proxy providers and manual nodes are merged back into
// that fresh template.
func (a *App) restoreMihomoGeneratedConfig(cfg *SetupConfig) (bool, error) {
	if cfg == nil {
		return false, nil
	}
	cfg.defaults()
	normalizeSetupInterfaceForRuntime(cfg)

	currentContent, readErr := a.readTextFile(mihomoActiveConfigRelPath)
	if readErr != nil && !os.IsNotExist(readErr) {
		return false, fmt.Errorf("read current generated Mihomo config: %w", readErr)
	}

	// The database is the normal source for manual nodes. Reading the current
	// generated provider file as a fallback also protects nodes created by an
	// older version before provider fields were synchronized into setup data.
	if currentContent != "" {
		var current map[string]any
		if err := yaml.Unmarshal([]byte(currentContent), &current); err != nil {
			return false, fmt.Errorf("parse current generated Mihomo config before upgrade: %w", err)
		}
		providers := normalizeConfigProviders(current["proxy-providers"])
		if manual := a.mihomoManualProxiesFromProviders(providers, cfg.MihomoProxies); strings.TrimSpace(manual) != "" {
			cfg.MihomoProxies = manual
		}
		if len(anySlice(current["proxies"])) > 0 {
			merged, err := mergeMihomoManualNodes(cfg.MihomoProxies, current["proxies"])
			if err != nil {
				return false, fmt.Errorf("preserve inline Mihomo nodes: %w", err)
			}
			cfg.MihomoProxies = merged
		}
	}

	providersYAML, err := a.mergedGeneratedMihomoProxyProviders(currentContent, *cfg)
	if err != nil {
		return false, err
	}
	content := replaceMihomoProxyProviders(a.renderMihomoYAML(*cfg), providersYAML)
	var parsed map[string]any
	if err := yaml.Unmarshal([]byte(content), &parsed); err != nil {
		return false, fmt.Errorf("validate refreshed generated Mihomo config: %w", err)
	}

	files := map[string]string{mihomoActiveConfigRelPath: content}
	remove := []string{}
	manualRel := "configs/mihomo/proxy_providers/msf_manual.yaml"
	if manual := renderMihomoManualProviderYAML(cfg.MihomoProxies); strings.TrimSpace(manual) != "" {
		var manualParsed map[string]any
		if err := yaml.Unmarshal([]byte(manual), &manualParsed); err != nil {
			return false, fmt.Errorf("validate refreshed Mihomo manual nodes: %w", err)
		}
		files[manualRel] = manual
	} else {
		remove = append(remove, manualRel)
	}

	changed := currentContent != content
	if !changed {
		manualPath, pathErr := a.safePath(manualRel)
		if pathErr != nil {
			return false, pathErr
		}
		desired, hasManual := files[manualRel]
		currentManual, manualErr := os.ReadFile(manualPath)
		switch {
		case hasManual:
			changed = manualErr != nil || !bytes.Equal(currentManual, []byte(desired))
		case manualErr == nil:
			changed = true
		case !os.IsNotExist(manualErr):
			return false, manualErr
		}
	}
	if err := a.replaceGeneratedConfigFiles(files, remove); err != nil {
		return false, err
	}
	return changed, nil
}

func mergeMihomoManualNodes(existing string, inline any) (string, error) {
	combined := make([]any, 0)
	if rendered := renderMihomoManualProviderYAML(existing); strings.TrimSpace(rendered) != "" {
		var parsed map[string]any
		if err := yaml.Unmarshal([]byte(rendered), &parsed); err != nil {
			return "", err
		}
		combined = append(combined, anySlice(parsed["proxies"])...)
	}
	combined = append(combined, anySlice(inline)...)

	merged := make([]any, 0, len(combined))
	indexByName := map[string]int{}
	for _, raw := range combined {
		name := stringMapValue(mihomoMapValueMap(raw), "name")
		if name != "" {
			if index, exists := indexByName[name]; exists {
				merged[index] = raw
				continue
			}
			indexByName[name] = len(merged)
		}
		merged = append(merged, raw)
	}
	b, err := yaml.Marshal(map[string]any{"proxies": merged})
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func (a *App) mergedGeneratedMihomoProxyProviders(currentContent string, cfg SetupConfig) (string, error) {
	baseYAML := renderProxyProvidersYAML(parseSubscriptionProviders(cfg.SubscriptionURLs), hasMihomoManualProxies(cfg.MihomoProxies))
	var base map[string]any
	if err := yaml.Unmarshal([]byte(baseYAML), &base); err != nil {
		return "", fmt.Errorf("parse persisted Mihomo proxy providers: %w", err)
	}
	providers := normalizeConfigProviders(base["proxy-providers"])
	if currentContent != "" {
		var current map[string]any
		if err := yaml.Unmarshal([]byte(currentContent), &current); err != nil {
			return "", fmt.Errorf("parse current Mihomo proxy providers: %w", err)
		}
		// Current generated definitions win so custom provider fields survive a
		// default-template upgrade. Database-backed providers fill any gaps.
		for name, provider := range normalizeConfigProviders(current["proxy-providers"]) {
			providers[name] = provider
		}
	}
	b, err := yaml.Marshal(map[string]any{"proxy-providers": providerConfigMap(providers)})
	if err != nil {
		return "", fmt.Errorf("render preserved Mihomo proxy providers: %w", err)
	}
	return string(b), nil
}
