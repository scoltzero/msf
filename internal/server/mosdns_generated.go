package server

import (
	"fmt"
	"net/netip"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

func (a *App) renderMosDNSManagedFiles(cfg SetupConfig) (map[string]string, error) {
	files := map[string]string{}
	overrides := a.jsonSettingWithFileFallback("mosdns_upstream_overrides", "configs/mosdns/upstream_overrides.json", map[string]any{})
	groups, err := normalizeMosDNSUpstreamGroups(overrides)
	if err != nil {
		return nil, err
	}
	targets := map[string]struct {
		rel  string
		tags []string
	}{
		"local":   {rel: "mosdns/sub_config/forward_local.yaml", tags: []string{"domestic"}},
		"foreign": {rel: "mosdns/sub_config/forward_nocn.yaml", tags: []string{"foreign"}},
		"ecs":     {rel: "mosdns/sub_config/forward_nocn_ecs.yaml", tags: []string{"foreignecs"}},
		"fake":    {rel: "mosdns/sub_config/forward_1.yaml", tags: []string{"nocnfake", "cnfake"}},
	}
	for _, target := range targets {
		content, ok := runtimeTemplateText(target.rel)
		if !ok {
			return nil, fmt.Errorf("missing embedded MosDNS template %s", target.rel)
		}
		for _, tag := range target.tags {
			if upstreams, exists := groups[tag]; exists {
				content, err = replaceMosDNSPluginUpstreams(content, tag, upstreams)
				if err != nil {
					return nil, err
				}
			}
		}
		if target.rel == "mosdns/sub_config/forward_nocn_ecs.yaml" {
			content, err = replaceMosDNSECS(content, a.mosDNSECSAddress())
			if err != nil {
				return nil, err
			}
		}
		files["configs/"+target.rel] = content
	}
	fixIP, ok := runtimeTemplateText("mosdns/nft/fixip.txt")
	if !ok {
		return nil, fmt.Errorf("missing embedded MosDNS fixip template")
	}
	fixIP = strings.ReplaceAll(fixIP, defaultFakeIPv4Prefix, fakeIPv4RouteCIDR(cfg.FakeIPRangeV4))
	fixIP = strings.ReplaceAll(fixIP, defaultFakeIPv6Prefix, fakeIPv6RouteCIDR(cfg.FakeIPRangeV6))
	if !cfg.EnableIPv6 {
		lines := strings.Split(fixIP, "\n")
		kept := lines[:0]
		for _, line := range lines {
			if strings.Contains(strings.TrimSpace(line), ":") {
				continue
			}
			kept = append(kept, line)
		}
		fixIP = strings.Join(kept, "\n")
	}
	files["configs/mosdns/nft/fixip.txt"] = fixIP
	return files, nil
}

func normalizeMosDNSUpstreamGroups(raw any) (map[string][]map[string]any, error) {
	root, ok := raw.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("mosdns upstream overrides must be an object")
	}
	out := make(map[string][]map[string]any, len(root))
	for group, value := range root {
		items, ok := value.([]any)
		if !ok {
			continue
		}
		for _, value := range items {
			item, ok := value.(map[string]any)
			if !ok || !isTruthy(fmtAny(item["enabled"])) {
				continue
			}
			protocol := strings.ToLower(strings.TrimSpace(fmtAny(item["protocol"])))
			upstream := map[string]any{}
			if field, exists := item["tag"]; exists {
				if tag := strings.TrimSpace(fmtAny(field)); tag != "" {
					upstream["tag"] = tag
				}
			}
			if protocol == "aliapi" {
				for _, key := range []string{"account_id", "access_key_id", "access_key_secret", "server_addr"} {
					field, exists := item[key]
					if !exists || strings.TrimSpace(fmtAny(field)) == "" {
						return nil, fmt.Errorf("mosdns upstream group %s contains an enabled ALIAPI server without %s", group, key)
					}
				}
				if mask, exists := item["ecs_client_mask"]; exists {
					value, err := strconv.ParseFloat(strings.TrimSpace(fmtAny(mask)), 64)
					if err != nil {
						return nil, fmt.Errorf("mosdns upstream group %s contains an invalid ALIAPI ECS mask", group)
					}
					if value < 0 || value > 128 {
						return nil, fmt.Errorf("mosdns upstream group %s contains an invalid ALIAPI ECS mask", group)
					}
				}
				upstream["type"] = "aliapi"
			}
			for _, key := range []string{"addr", "server_addr", "dial_addr", "socks5", "upstream_query_timeout", "ecs_client_mask"} {
				if field, exists := item[key]; exists && strings.TrimSpace(fmtAny(field)) != "" {
					upstream[key] = field
				}
			}
			if protocol != "aliapi" {
				if _, hasAddr := upstream["addr"]; !hasAddr {
					if _, hasServerAddr := upstream["server_addr"]; !hasServerAddr {
						return nil, fmt.Errorf("mosdns upstream group %s contains an enabled server without an address", group)
					}
				}
			}
			out[group] = append(out[group], upstream)
		}
		if group == "cnfake" && len(out[group]) == 0 {
			delete(out, group)
			continue
		}
		if len(items) > 0 && len(out[group]) == 0 {
			return nil, fmt.Errorf("mosdns upstream group %s must keep at least one enabled server", group)
		}
	}
	return out, nil
}

func replaceMosDNSPluginUpstreams(content, tag string, upstreams []map[string]any) (string, error) {
	var validation any
	if err := yaml.Unmarshal([]byte(content), &validation); err != nil {
		return "", err
	}
	lines := strings.SplitAfter(content, "\n")
	tagIndex := -1
	upstreamIndex := -1
	for index, line := range lines {
		if strings.TrimSpace(line) == "- tag: "+tag {
			tagIndex = index
			continue
		}
		if tagIndex >= 0 && index > tagIndex && strings.TrimSpace(line) == "upstreams:" {
			upstreamIndex = index
			break
		}
		if tagIndex >= 0 && index > tagIndex && leadingYAMLSpaces(line) <= leadingYAMLSpaces(lines[tagIndex]) && strings.TrimSpace(line) != "" {
			break
		}
	}
	if upstreamIndex < 0 {
		return "", fmt.Errorf("MosDNS template does not define plugin %s", tag)
	}
	end := upstreamIndex + 1
	baseIndent := leadingYAMLSpaces(lines[upstreamIndex])
	for end < len(lines) {
		trimmed := strings.TrimSpace(lines[end])
		if trimmed != "" && leadingYAMLSpaces(lines[end]) <= baseIndent {
			break
		}
		end++
	}
	body, err := yaml.Marshal(upstreams)
	if err != nil {
		return "", err
	}
	replacement := strings.Repeat(" ", baseIndent) + "upstreams:\n" + indentYAML(strings.TrimRight(string(body), "\n"), baseIndent+2) + "\n"
	return strings.Join(lines[:upstreamIndex], "") + replacement + strings.Join(lines[end:], ""), nil
}

func (a *App) mosDNSECSAddress() string {
	raw := a.jsonSettingWithFileFallback("mosdns_overrides", "configs/mosdns/config_overrides.json", map[string]any{})
	root, _ := raw.(map[string]any)
	value := strings.TrimSpace(fmtAny(root["ecs"]))
	if value == "" {
		return "2408:8214:213::1"
	}
	return value
}

func replaceMosDNSECS(content, ecs string) (string, error) {
	if addr, err := netip.ParseAddr(strings.TrimSpace(ecs)); err != nil || addr.IsUnspecified() || addr.IsMulticast() {
		return "", fmt.Errorf("invalid MosDNS ECS address %q", ecs)
	}
	var validation any
	if err := yaml.Unmarshal([]byte(content), &validation); err != nil {
		return "", err
	}
	lines := strings.SplitAfter(content, "\n")
	found := false
	for index, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "- exec: ecs ") {
			indent := line[:len(line)-len(strings.TrimLeft(line, " \t"))]
			lines[index] = indent + "- exec: ecs " + ecs + "\n"
			found = true
		}
	}
	if !found {
		return "", fmt.Errorf("MosDNS ECS sequence is missing")
	}
	return strings.Join(lines, ""), nil
}

func leadingYAMLSpaces(line string) int {
	return len(line) - len(strings.TrimLeft(line, " "))
}
