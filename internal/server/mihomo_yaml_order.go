package server

import (
	"fmt"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// mihomoDefaultTopLevelOrder mirrors runtime_templates/mihomo/config.yaml. Keep
// proxy-providers out of this list: it is deliberately emitted last even when
// a custom config contains additional top-level extensions.
var mihomoDefaultTopLevelOrder = []string{
	"FilterHK", "FilterSG", "FilterJP", "FilterKR", "FilterUS", "FilterTW", "FilterEU", "FilterOther",
	"FilterVIP", "FilterBIG", "FilterGame", "FilterAll",
	"DomainMrs", "DomainText", "domainYaml", "IPcidrMrs", "IPcidrText", "ClassicalText", "ClassicalYaml", "UrlTest",
	"mode", "log-level", "unified-delay", "tcp-concurrent", "interface-name", "ipv6", "udp",
	"port", "socks-port", "mixed-port", "redir-port", "tproxy-port",
	"geodata-mode", "geodata-loader", "geo-auto-update", "geo-update-interval", "find-process-mode",
	"bind-address", "allow-lan", "routing-mark", "external-controller", "secret",
	"external-ui", "external-ui-url", "geox-url", "profile", "tun", "sniffer", "dns",
	"proxies", "proxy-groups", "rule-providers", "rules",
}

func moveTopLevelYAMLBlockToEnd(content, key string) string {
	lines := strings.SplitAfter(content, "\n")
	start := -1
	end := len(lines)
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if start < 0 {
			if !strings.HasPrefix(line, " ") && !strings.HasPrefix(line, "\t") && strings.HasPrefix(trimmed, key+":") {
				start = i
			}
			continue
		}
		if trimmed != "" && !strings.HasPrefix(line, " ") && !strings.HasPrefix(line, "\t") {
			end = i
			break
		}
	}
	if start < 0 || end == len(lines) {
		return content
	}
	block := strings.TrimRight(strings.Join(lines[start:end], ""), "\n")
	remaining := strings.TrimRight(strings.Join(append(append([]string{}, lines[:start]...), lines[end:]...), ""), "\n")
	return remaining + "\n" + block + "\n"
}

func marshalMihomoConfigMap(cfg map[string]any) ([]byte, error) {
	root := &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
	seen := make(map[string]bool, len(cfg))
	appendValue := func(key string) error {
		value, ok := cfg[key]
		if !ok || seen[key] {
			return nil
		}
		node, err := mihomoRulesYAMLNodeFromValue(value)
		if err != nil {
			return fmt.Errorf("marshal Mihomo section %s: %w", key, err)
		}
		root.Content = append(root.Content,
			&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: key},
			node,
		)
		seen[key] = true
		return nil
	}
	for _, key := range mihomoDefaultTopLevelOrder {
		if err := appendValue(key); err != nil {
			return nil, err
		}
	}
	unknown := make([]string, 0)
	for key := range cfg {
		if !seen[key] && key != "proxy-providers" {
			unknown = append(unknown, key)
		}
	}
	sort.Strings(unknown)
	for _, key := range unknown {
		if err := appendValue(key); err != nil {
			return nil, err
		}
	}
	if err := appendValue("proxy-providers"); err != nil {
		return nil, err
	}
	doc := &yaml.Node{Kind: yaml.DocumentNode, Content: []*yaml.Node{root}}
	return yaml.Marshal(doc)
}

func orderMihomoTopLevelYAML(doc *yaml.Node) {
	if doc == nil || len(doc.Content) != 1 || doc.Content[0].Kind != yaml.MappingNode {
		return
	}
	root := doc.Content[0]
	pairs := make(map[string][]*yaml.Node, len(root.Content)/2)
	keys := make([]string, 0, len(root.Content)/2)
	for i := 0; i+1 < len(root.Content); i += 2 {
		key := root.Content[i].Value
		if _, exists := pairs[key]; !exists {
			keys = append(keys, key)
		}
		pairs[key] = []*yaml.Node{root.Content[i], root.Content[i+1]}
	}
	ordered := make([]*yaml.Node, 0, len(root.Content))
	appendPair := func(key string) {
		if pair, ok := pairs[key]; ok {
			ordered = append(ordered, pair...)
			delete(pairs, key)
		}
	}
	for _, key := range mihomoDefaultTopLevelOrder {
		appendPair(key)
	}
	// Preserve the relative order of custom extension fields.
	for _, key := range keys {
		if key != "proxy-providers" {
			appendPair(key)
		}
	}
	appendPair("proxy-providers")
	root.Content = ordered
}
