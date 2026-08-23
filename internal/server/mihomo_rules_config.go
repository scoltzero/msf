package server

// The rules configuration domain deliberately lives outside the HTTP handlers.
// It owns the mode/authority decision and the small, targeted YAML mutation
// needed by the rules page.  Handlers should only decode the request and map
// the returned error code to their response shape.

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"reflect"
	"strings"

	"gopkg.in/yaml.v3"
)

const (
	mihomoRulesConfigRulesKey     = "rules"
	mihomoRulesConfigProvidersKey = "rule-providers"
)

// mihomoRulesConfigError is intentionally small and package-private.  A
// handler can use mihomoRulesConfigErrorCode to expose a stable machine error
// without having to duplicate the domain checks.
type mihomoRulesConfigError struct {
	Code    string
	Message string
}

func (e *mihomoRulesConfigError) Error() string {
	if e == nil {
		return ""
	}
	if e.Message == "" {
		return e.Code
	}
	return e.Code + ": " + e.Message
}

func mihomoRulesConfigErrorf(code, format string, args ...any) error {
	return &mihomoRulesConfigError{Code: code, Message: fmt.Sprintf(format, args...)}
}

// mihomoRulesConfigErrorCode returns a stable error code for HTTP adapters.
// The empty string means that err was not produced by this domain.
func mihomoRulesConfigErrorCode(err error) string {
	var domainErr *mihomoRulesConfigError
	if errors.As(err, &domainErr) {
		return domainErr.Code
	}
	return ""
}

// mihomoRulesConfigPayload reads the authoritative source for the current
// mode.  In generated mode the generated runtime config is a read-only view;
// in custom mode the applied user YAML is authoritative for rules editing.
func (a *App) mihomoRulesConfigPayload(r *http.Request) (map[string]any, error) {
	mode := a.mihomoConfigMode()
	source := mihomoActiveConfigRelPath
	if mode == "custom" {
		applied, ok := a.appliedMihomoUserConfigRel()
		if !ok {
			return nil, mihomoRulesConfigErrorf("custom_config_missing", "custom Mihomo mode has no applied user config")
		}
		source = applied
	}
	content, err := a.readTextFile(source)
	if err != nil {
		return nil, mihomoRulesConfigErrorf("rules_config_read_failed", "read %s: %v", source, err)
	}
	cfg, err := mihomoRulesConfigMap(content)
	if err != nil {
		return nil, mihomoRulesConfigErrorf("rules_config_invalid", "parse %s: %v", source, err)
	}
	authority := a.mihomoConfigModePayload()
	// Keep the runtime panel response available to the page while making the
	// persistence source explicit.  mihomoRulesRuntime never mutates config.
	return map[string]any{
		"rules":                   cfg[mihomoRulesConfigRulesKey],
		"rule-providers":          cfg[mihomoRulesConfigProvidersKey],
		"yaml":                    content,
		"runtime":                 a.mihomoRulesRuntime(r),
		"runtime_config":          a.mihomoConfigMap()[mihomoRulesConfigRulesKey],
		"runtime_rule-providers":  a.mihomoConfigMap()[mihomoRulesConfigProvidersKey],
		"mode":                    mode,
		"source":                  source,
		"read_only":               mode != "custom",
		"can_edit_rules":          mode == "custom",
		"can_edit_rule_providers": mode == "custom",
		"config_authority":        authority,
	}, nil
}

// validateMihomoRulesConfigRequest builds and validates a candidate without
// writing a file, changing settings, updating a provider, or restarting the
// service.  It is suitable for the rules page's "校验配置" action.
func (a *App) validateMihomoRulesConfigRequest(req map[string]any) mihomoConfigValidation {
	_, advanced := mihomoRulesAdvancedContent(req)
	_, userContent, runtimeContent, err := a.mihomoRulesConfigCandidates(req, !advanced, false)
	if err != nil {
		return mihomoConfigValidation{Valid: false, Error: err.Error()}
	}
	for _, content := range []string{userContent, runtimeContent} {
		validation := a.validateMihomoConfigContent(content)
		if !validation.Valid {
			return validation
		}
		cfg, parseErr := mihomoRulesConfigMap(content)
		if parseErr != nil {
			return mihomoConfigValidation{Valid: false, Error: parseErr.Error()}
		}
		if structuralErr := validateMihomoRulesConfigStructure(cfg); structuralErr != nil {
			return mihomoConfigValidation{Valid: false, Error: structuralErr.Error()}
		}
	}
	return mihomoConfigValidation{Valid: true}
}

// saveMihomoRulesConfig applies one complete rules/rule-providers draft.  It
// only accepts custom mode, uses applied user YAML as the authority, writes
// both the applied and runtime copies in one mutation, and delegates restart /
// rollback semantics to the shared applyMihomoConfigMutation implementation.
func (a *App) saveMihomoRulesConfig(ctx context.Context, req map[string]any, username string) (map[string]any, error) {
	if a.mihomoConfigMode() != "custom" {
		return nil, mihomoRulesConfigErrorf("default_config_requires_user_config", "default Mihomo config is read-only; apply a custom user config before editing rules")
	}
	userRel, userContent, runtimeContent, err := a.mihomoRulesConfigCandidates(req, true, true)
	if err != nil {
		return nil, err
	}
	for _, content := range []string{userContent, runtimeContent} {
		validation := a.validateMihomoConfigContent(content)
		if !validation.Valid {
			return nil, mihomoRulesConfigErrorf("rules_config_validation_failed", "%s", validation.Error)
		}
		cfg, parseErr := mihomoRulesConfigMap(content)
		if parseErr != nil {
			return nil, mihomoRulesConfigErrorf("rules_config_validation_failed", "%v", parseErr)
		}
		if structuralErr := validateMihomoRulesConfigStructure(cfg); structuralErr != nil {
			return nil, mihomoRulesConfigErrorf("rules_config_validation_failed", "%v", structuralErr)
		}
	}

	// applyMihomoConfigMutation captures both files before mutate, writes them
	// atomically, restarts at most once, probes the controller, and restores all
	// captured files when writing/restart/probing fails.
	restarted, applyErr := a.applyMihomoConfigMutation(ctx, false, func() error {
		files := map[string]string{
			mihomoActiveConfigRelPath: runtimeContent,
			userRel:                   userContent,
		}
		if err := a.replaceGeneratedConfigFiles(files, nil); err != nil {
			return err
		}
		return nil
	})
	if applyErr != nil {
		return nil, applyErr
	}

	userCfg, _ := mihomoRulesConfigMap(userContent)
	return map[string]any{
		"rules":            userCfg[mihomoRulesConfigRulesKey],
		"rule-providers":   userCfg[mihomoRulesConfigProvidersKey],
		"path":             userRel,
		"runtime_path":     mihomoActiveConfigRelPath,
		"restarted":        restarted,
		"restart_required": !restarted,
		"mode":             a.mihomoConfigModePayload(),
		"files_consistent": mihomoRulesSectionsEqual(userContent, runtimeContent),
	}, nil
}

// mihomoRulesConfigCandidates returns the proposed applied-user and runtime
// YAML content.  structured controls the anchor/alias safety boundary, while
// requireCustom is used by save (validation can also inspect generated mode).
func (a *App) mihomoRulesConfigCandidates(req map[string]any, structured, requireCustom bool) (string, string, string, error) {
	if requireCustom && a.mihomoConfigMode() != "custom" {
		return "", "", "", mihomoRulesConfigErrorf("default_config_requires_user_config", "default Mihomo config is read-only; apply a custom user config before editing rules")
	}
	userRel := mihomoActiveConfigRelPath
	if a.mihomoConfigMode() == "custom" {
		applied, ok := a.appliedMihomoUserConfigRel()
		if !ok {
			return "", "", "", mihomoRulesConfigErrorf("custom_config_missing", "custom Mihomo mode has no applied user config")
		}
		userRel = applied
	}
	userContent, err := a.readTextFile(userRel)
	if err != nil {
		return "", "", "", mihomoRulesConfigErrorf("rules_config_read_failed", "read %s: %v", userRel, err)
	}
	runtimeContent, err := a.readTextFile(mihomoActiveConfigRelPath)
	if err != nil {
		return "", "", "", mihomoRulesConfigErrorf("rules_config_read_failed", "read %s: %v", mihomoActiveConfigRelPath, err)
	}
	userDoc, err := parseMihomoRulesYAML(userContent)
	if err != nil {
		return "", "", "", mihomoRulesConfigErrorf("rules_config_invalid", "parse %s: %v", userRel, err)
	}
	runtimeDoc, err := parseMihomoRulesYAML(runtimeContent)
	if err != nil {
		return "", "", "", mihomoRulesConfigErrorf("rules_config_invalid", "parse %s: %v", mihomoActiveConfigRelPath, err)
	}

	advancedContent, advanced := mihomoRulesAdvancedContent(req)
	var rulesNode, providersNode *yaml.Node
	if advanced {
		advancedDoc, parseErr := parseMihomoRulesYAML(advancedContent)
		if parseErr != nil {
			return "", "", "", mihomoRulesConfigErrorf("rules_config_invalid", "parse candidate YAML: %v", parseErr)
		}
		rulesNode = cloneMihomoYAMLNode(mihomoRulesTopLevelValue(advancedDoc, mihomoRulesConfigRulesKey))
		providersNode = cloneMihomoYAMLNode(mihomoRulesTopLevelValue(advancedDoc, mihomoRulesConfigProvidersKey))
		if rulesNode == nil && providersNode == nil {
			return "", "", "", mihomoRulesConfigErrorf("rules_config_invalid", "candidate YAML must contain rules or rule-providers")
		}
	} else {
		// Structured forms can safely edit only ordinary sections.  Anchors,
		// aliases and merge keys are retained by YAML ASTs but are not safe to
		// replace from a map-shaped JSON draft, so direct the user to YAML mode.
		if structured {
			for _, doc := range []*yaml.Node{userDoc, runtimeDoc} {
				for _, section := range []string{mihomoRulesConfigRulesKey, mihomoRulesConfigProvidersKey} {
					if node := mihomoRulesTopLevelValue(doc, section); node != nil && mihomoRulesYAMLNodeHasAlias(node) {
						return "", "", "", mihomoRulesConfigErrorf("rules_config_yaml_anchors", "section %s contains a YAML anchor, alias, or merge key; use YAML editor", section)
					}
				}
			}
		}
		baseCfg, cfgErr := mihomoRulesConfigMap(userContent)
		if cfgErr != nil {
			return "", "", "", mihomoRulesConfigErrorf("rules_config_invalid", "%v", cfgErr)
		}
		if rawRules, present := mihomoRulesRequestValue(req, mihomoRulesConfigRulesKey); present {
			rules, normalizeErr := normalizeMihomoRulesText(rawRules)
			if normalizeErr != nil {
				return "", "", "", mihomoRulesConfigErrorf("rules_config_validation_failed", "%v", normalizeErr)
			}
			rulesNode, err = mihomoRulesYAMLNodeFromValue(rules)
			if err != nil {
				return "", "", "", mihomoRulesConfigErrorf("rules_config_invalid", "marshal rules: %v", err)
			}
		}
		if rawProviders, present := mihomoRulesRequestValue(req, mihomoRulesConfigProvidersKey); present {
			incoming := mihomoRulesStringMap(rawProviders)
			if incoming == nil && rawProviders != nil {
				return "", "", "", mihomoRulesConfigErrorf("rules_config_validation_failed", "rule-providers must be an object")
			}
			current := mihomoRulesStringMap(baseCfg[mihomoRulesConfigProvidersKey])
			merged := make(map[string]any, len(incoming))
			// A complete structured draft is a collection replacement: providers
			// omitted by the editor are intentionally removed.  Each retained
			// provider, however, is recursively merged with its old object so
			// unknown/future fields cannot be lost.
			for name, value := range incoming {
				if value == nil {
					continue
				}
				if patch := mihomoRulesStringMap(value); patch != nil {
					if old := mihomoRulesStringMap(current[name]); old != nil {
						merged[name] = mergeMihomoMaps(old, patch)
					} else {
						merged[name] = cloneMihomoValue(patch)
					}
				} else {
					merged[name] = cloneMihomoValue(value)
				}
			}
			providersNode, err = mihomoRulesYAMLNodeFromValue(merged)
			if err != nil {
				return "", "", "", mihomoRulesConfigErrorf("rules_config_invalid", "marshal rule-providers: %v", err)
			}
		}
	}

	if rulesNode == nil && providersNode == nil {
		return "", "", "", mihomoRulesConfigErrorf("rules_config_validation_failed", "rules or rule-providers draft is required")
	}
	for _, doc := range []*yaml.Node{userDoc, runtimeDoc} {
		if rulesNode != nil {
			mihomoRulesSetTopLevelValue(doc, mihomoRulesConfigRulesKey, cloneMihomoYAMLNode(rulesNode))
		}
		if providersNode != nil {
			mihomoRulesSetTopLevelValue(doc, mihomoRulesConfigProvidersKey, cloneMihomoYAMLNode(providersNode))
		}
	}
	userCandidate, err := marshalMihomoRulesYAML(userDoc)
	if err != nil {
		return "", "", "", mihomoRulesConfigErrorf("rules_config_invalid", "marshal %s: %v", userRel, err)
	}
	runtimeCandidate, err := marshalMihomoRulesYAML(runtimeDoc)
	if err != nil {
		return "", "", "", mihomoRulesConfigErrorf("rules_config_invalid", "marshal %s: %v", mihomoActiveConfigRelPath, err)
	}
	return userRel, userCandidate, runtimeCandidate, nil
}

func mihomoRulesAdvancedContent(req map[string]any) (string, bool) {
	for _, key := range []string{"yaml_content", "yaml", "content", "config"} {
		if value, ok := req[key]; ok {
			if content, ok := value.(string); ok && strings.TrimSpace(content) != "" {
				if key == "config" && !isTruthy(fmtAny(req["yaml_mode"])) && !isTruthy(fmtAny(req["advanced"])) {
					// A map-shaped config field is a structured envelope; only a
					// string is treated as the advanced YAML channel.
					continue
				}
				return content, true
			}
		}
	}
	return "", false
}

func mihomoRulesRequestValue(req map[string]any, section string) (any, bool) {
	if value, ok := req[section]; ok {
		return value, true
	}
	for _, key := range []string{strings.ReplaceAll(section, "-", "_"), "ruleProviders", "rulesText"} {
		if section == mihomoRulesConfigRulesKey && key == "ruleProviders" {
			continue
		}
		if section == mihomoRulesConfigProvidersKey && key == "rulesText" {
			continue
		}
		if value, ok := req[key]; ok {
			return value, true
		}
	}
	return nil, false
}

func normalizeMihomoRulesText(raw any) ([]any, error) {
	result := make([]any, 0)
	appendLine := func(value string) {
		// Only truly blank lines (including whitespace-only editor lines) are
		// discarded.  Non-empty values are never trimmed or case-normalized.
		if strings.TrimSpace(value) != "" {
			result = append(result, value)
		}
	}
	switch value := raw.(type) {
	case string:
		value = strings.ReplaceAll(value, "\r\n", "\n")
		value = strings.ReplaceAll(value, "\r", "\n")
		for _, line := range strings.Split(value, "\n") {
			appendLine(line)
		}
	case []string:
		for _, line := range value {
			appendLine(line)
		}
	case []any:
		for _, line := range value {
			if text, ok := line.(string); ok {
				appendLine(text)
				continue
			}
			if line == nil {
				continue
			}
			return nil, fmt.Errorf("rule entries must be strings")
		}
	case nil:
		return result, nil
	default:
		return nil, fmt.Errorf("rules must be a multiline string or array of strings")
	}
	return result, nil
}

func mihomoRulesConfigMap(content string) (map[string]any, error) {
	var cfg map[string]any
	if err := yaml.Unmarshal([]byte(content), &cfg); err != nil {
		return nil, err
	}
	if cfg == nil {
		return nil, fmt.Errorf("config must be a YAML object")
	}
	return cfg, nil
}

func parseMihomoRulesYAML(content string) (*yaml.Node, error) {
	var doc yaml.Node
	decoder := yaml.NewDecoder(strings.NewReader(content))
	if err := decoder.Decode(&doc); err != nil {
		return nil, err
	}
	var extra yaml.Node
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return nil, fmt.Errorf("multiple YAML documents are not supported")
		}
		return nil, err
	}
	if len(doc.Content) != 1 || doc.Content[0].Kind != yaml.MappingNode {
		return nil, fmt.Errorf("config must be a YAML object")
	}
	return &doc, nil
}

func marshalMihomoRulesYAML(doc *yaml.Node) (string, error) {
	orderMihomoTopLevelYAML(doc)
	b, err := yaml.Marshal(doc)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func mihomoRulesTopLevelValue(doc *yaml.Node, section string) *yaml.Node {
	if doc == nil || len(doc.Content) != 1 {
		return nil
	}
	root := doc.Content[0]
	if root.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(root.Content); i += 2 {
		if root.Content[i].Kind == yaml.ScalarNode && root.Content[i].Value == section {
			return root.Content[i+1]
		}
	}
	return nil
}

func mihomoRulesSetTopLevelValue(doc *yaml.Node, section string, value *yaml.Node) {
	if doc == nil || value == nil || len(doc.Content) != 1 {
		return
	}
	root := doc.Content[0]
	if root.Kind != yaml.MappingNode {
		return
	}
	for i := 0; i+1 < len(root.Content); i += 2 {
		if root.Content[i].Kind == yaml.ScalarNode && root.Content[i].Value == section {
			root.Content[i+1] = value
			return
		}
	}
	key := &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: section}
	root.Content = append(root.Content, key, value)
}

func cloneMihomoYAMLNode(node *yaml.Node) *yaml.Node {
	return cloneMihomoYAMLNodeWithMap(node, make(map[*yaml.Node]*yaml.Node))
}

func cloneMihomoYAMLNodeWithMap(node *yaml.Node, seen map[*yaml.Node]*yaml.Node) *yaml.Node {
	if node == nil {
		return nil
	}
	if cloned, ok := seen[node]; ok {
		return cloned
	}
	copy := *node
	copy.Content = nil
	copy.Alias = nil
	seen[node] = &copy
	if node.Content != nil {
		copy.Content = make([]*yaml.Node, len(node.Content))
		for i, child := range node.Content {
			copy.Content[i] = cloneMihomoYAMLNodeWithMap(child, seen)
		}
	}
	if node.Alias != nil {
		copy.Alias = cloneMihomoYAMLNodeWithMap(node.Alias, seen)
	}
	return &copy
}

func mihomoRulesYAMLNodeFromValue(value any) (*yaml.Node, error) {
	b, err := yaml.Marshal(value)
	if err != nil {
		return nil, err
	}
	var doc yaml.Node
	if err := yaml.Unmarshal(b, &doc); err != nil {
		return nil, err
	}
	if len(doc.Content) != 1 {
		return nil, fmt.Errorf("empty YAML value")
	}
	return cloneMihomoYAMLNode(doc.Content[0]), nil
}

func mihomoRulesYAMLNodeHasAlias(node *yaml.Node) bool {
	if node == nil {
		return false
	}
	if node.Kind == yaml.AliasNode || node.Anchor != "" {
		return true
	}
	if node.Kind == yaml.MappingNode {
		for i := 0; i+1 < len(node.Content); i += 2 {
			if node.Content[i].Value == "<<" {
				return true
			}
		}
	}
	for _, child := range node.Content {
		if mihomoRulesYAMLNodeHasAlias(child) {
			return true
		}
	}
	return false
}

func mihomoRulesStringMap(value any) map[string]any {
	switch v := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(v))
		for key, item := range v {
			out[key] = mihomoRulesConvertValue(item)
		}
		return out
	case map[any]any:
		out := make(map[string]any, len(v))
		for key, item := range v {
			out[fmt.Sprint(key)] = mihomoRulesConvertValue(item)
		}
		return out
	default:
		return nil
	}
}

func mihomoRulesConvertValue(value any) any {
	switch v := value.(type) {
	case map[string]any:
		return mihomoRulesStringMap(v)
	case map[any]any:
		return mihomoRulesStringMap(v)
	case []any:
		out := make([]any, len(v))
		for i, item := range v {
			out[i] = mihomoRulesConvertValue(item)
		}
		return out
	case []map[string]any:
		out := make([]any, len(v))
		for i, item := range v {
			out[i] = mihomoRulesStringMap(item)
		}
		return out
	default:
		return value
	}
}

func validateMihomoRulesConfigStructure(cfg map[string]any) error {
	providers := mihomoRulesStringMap(cfg[mihomoRulesConfigProvidersKey])
	if cfg[mihomoRulesConfigProvidersKey] != nil && providers == nil {
		return fmt.Errorf("rule-providers must be an object")
	}
	for name, value := range providers {
		provider := mihomoRulesStringMap(value)
		if provider == nil {
			return fmt.Errorf("rule provider %s must be an object", name)
		}
		providerType := strings.ToLower(strings.TrimSpace(firstNonEmpty(stringMapValue(provider, "type"), stringMapValue(provider, "vehicleType"))))
		switch providerType {
		case "file":
			if strings.TrimSpace(stringMapValue(provider, "path")) == "" {
				return fmt.Errorf("rule provider %s requires path", name)
			}
		case "http", "https":
			if strings.TrimSpace(stringMapValue(provider, "url")) == "" {
				return fmt.Errorf("rule provider %s requires url", name)
			}
		case "inline", "":
			// Inline providers may use additional Mihomo-specific fields.
		default:
			// Keep forward compatibility with new Mihomo provider types; only
			// reject an explicitly malformed path below.
		}
		if path := strings.TrimSpace(stringMapValue(provider, "path")); path != "" {
			if filepath.IsAbs(path) || strings.HasPrefix(filepath.Clean(path), "..") || strings.Contains(path, "../") || strings.Contains(path, `..\`) {
				return fmt.Errorf("rule provider %s path escapes the allowed directory", name)
			}
		}
	}

	proxyNames := make(map[string]bool)
	for _, item := range anySlice(cfg["proxies"]) {
		if proxy := mihomoRulesStringMap(item); proxy != nil {
			if name := strings.TrimSpace(stringMapValue(proxy, "name")); name != "" {
				proxyNames[name] = true
			}
		}
	}
	groups := make(map[string]bool)
	for _, item := range anySlice(cfg["proxy-groups"]) {
		if group := mihomoRulesStringMap(item); group != nil {
			if name := strings.TrimSpace(stringMapValue(group, "name")); name != "" {
				groups[name] = true
			}
		}
	}
	for builtin := range map[string]struct{}{"DIRECT": {}, "REJECT": {}, "REJECT-DROP": {}, "PASS": {}, "COMPATIBLE": {}, "GLOBAL": {}} {
		proxyNames[builtin] = true
	}

	rulesRaw := cfg[mihomoRulesConfigRulesKey]
	if rulesRaw == nil {
		return nil
	}
	rules := anySlice(rulesRaw)
	if rules == nil {
		return fmt.Errorf("rules must be an array of strings")
	}
	for index, raw := range rules {
		rule, ok := raw.(string)
		if !ok {
			return fmt.Errorf("rule %d must be a string", index+1)
		}
		if strings.TrimSpace(rule) == "" {
			return fmt.Errorf("rule %d is blank", index+1)
		}
		parts := strings.Split(rule, ",")
		typ := strings.ToUpper(strings.TrimSpace(parts[0]))
		if typ == "" {
			return fmt.Errorf("rule %d has an empty type", index+1)
		}
		if (typ == "RULE-SET" || typ == "RULESET") && len(parts) > 1 {
			provider := strings.TrimSpace(parts[1])
			if provider != "" && !mihomoRulesProviderExists(providers, provider) {
				return fmt.Errorf("rule %d references unknown rule provider %s", index+1, provider)
			}
		}
		target := ""
		if typ == "MATCH" && len(parts) > 1 {
			target = strings.TrimSpace(parts[1])
		} else if len(parts) > 2 {
			target = strings.TrimSpace(parts[2])
		}
		if target != "" && !proxyNames[target] && !groups[target] {
			return fmt.Errorf("rule %d references unknown proxy or group %s", index+1, target)
		}
	}
	return nil
}

func mihomoRulesProviderExists(providers map[string]any, name string) bool {
	if _, ok := providers[name]; ok {
		return true
	}
	for key := range providers {
		if strings.EqualFold(key, name) {
			return true
		}
	}
	return false
}

func mihomoRulesSectionsEqual(left, right string) bool {
	leftCfg, leftErr := mihomoRulesConfigMap(left)
	rightCfg, rightErr := mihomoRulesConfigMap(right)
	if leftErr != nil || rightErr != nil {
		return false
	}
	return reflect.DeepEqual(leftCfg[mihomoRulesConfigRulesKey], rightCfg[mihomoRulesConfigRulesKey]) && reflect.DeepEqual(leftCfg[mihomoRulesConfigProvidersKey], rightCfg[mihomoRulesConfigProvidersKey])
}
