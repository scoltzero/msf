package server

import (
	"fmt"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

type mihomoDefaultRoutingConfig struct {
	ProxyGroups   []map[string]any          `yaml:"proxy-groups"`
	RuleProviders map[string]map[string]any `yaml:"rule-providers"`
	Rules         []string                  `yaml:"rules"`
}

func TestMihomoDefaultRoutingIsCompleteAndDeduplicated(t *testing.T) {
	content, ok := runtimeTemplateText("mihomo/config.yaml")
	if !ok {
		t.Fatal("embedded Mihomo default config is missing")
	}

	var cfg mihomoDefaultRoutingConfig
	if err := yaml.Unmarshal([]byte(content), &cfg); err != nil {
		t.Fatalf("parse Mihomo default config: %v", err)
	}

	groups := make(map[string]map[string]any, len(cfg.ProxyGroups))
	for _, group := range cfg.ProxyGroups {
		name, _ := group["name"].(string)
		if name == "" {
			t.Fatalf("proxy group without a name: %#v", group)
		}
		if _, exists := groups[name]; exists {
			t.Fatalf("duplicate proxy group %q", name)
		}
		groups[name] = group
	}

	for _, name := range []string{
		"Proxies", "Manual", "Final", "Speedtest", "Direct",
		"Google", "AI", "Game", "Apple", "Microsoft",
		"Netflix", "YouTube", "Disney+", "GlobalMedia", "BiliBili", "Scholar",
		"TikTok", "Spotify", "PT", "Telegram", "Airport",
	} {
		if groups[name] == nil {
			t.Errorf("missing English policy group %q", name)
		}
	}

	hiddenGroups := []string{"高级节点", "游戏节点", "香港节点", "新加坡节点", "韩国节点", "台湾节点", "日本节点", "美国节点", "省流节点"}
	for _, name := range hiddenGroups {
		group := groups[name]
		if group == nil {
			t.Errorf("missing preserved regional/filtered group %q", name)
			continue
		}
		for key, want := range map[string]any{
			"type":                  "url-test",
			"hidden":                true,
			"include-all":           true,
			"include-all-proxies":   true,
			"include-all-providers": true,
		} {
			if got := group[key]; got != want {
				t.Errorf("group %q %s=%#v, want %#v", name, key, got, want)
			}
		}
		if filter, _ := group["filter"].(string); filter == "" {
			t.Errorf("group %q lost its node filter", name)
		}
	}
	for key, want := range map[string]any{
		"include-all":           true,
		"include-all-proxies":   true,
		"include-all-providers": true,
	} {
		if got := groups["Airport"][key]; got != want {
			t.Errorf("Airport %s=%#v, want %#v", key, got, want)
		}
	}

	for _, oldName := range []string{"节点选择", "手动切换", "漏网之鱼", "全球直连", "网络测试", "谷歌服务", "人工智能", "游戏平台", "苹果服务", "微软服务", "PT站点", "机场节点"} {
		if groups[oldName] != nil {
			t.Errorf("obsolete policy group %q remains", oldName)
		}
	}
	for groupName, group := range groups {
		icon, _ := group["icon"].(string)
		if !strings.HasPrefix(icon, "https://") {
			t.Errorf("proxy group %q icon=%q, want an HTTPS icon URL", groupName, icon)
		}
		proxies, _ := group["proxies"].([]any)
		for _, value := range proxies {
			proxyName, _ := value.(string)
			if proxyName != "DIRECT" && groups[proxyName] == nil {
				t.Errorf("proxy group %q references missing group or built-in proxy %q", groupName, proxyName)
			}
		}
	}

	usedProviders := make(map[string]int, len(cfg.RuleProviders))
	validTargets := map[string]bool{"DIRECT": true, "REJECT": true, "REJECT-DROP": true, "PASS": true}
	for name := range groups {
		validTargets[name] = true
	}
	for _, rule := range cfg.Rules {
		parts := strings.Split(rule, ",")
		if len(parts) < 2 {
			t.Errorf("invalid rule %q", rule)
			continue
		}
		var target string
		if parts[0] == "RULE-SET" {
			if len(parts) < 3 {
				t.Errorf("invalid RULE-SET rule %q", rule)
				continue
			}
			provider := parts[1]
			if cfg.RuleProviders[provider] == nil {
				t.Errorf("rule %q references missing provider %q", rule, provider)
			}
			usedProviders[provider]++
			target = parts[2]
		} else {
			target = parts[len(parts)-1]
			if target == "no-resolve" {
				target = parts[len(parts)-2]
			}
		}
		if !validTargets[target] {
			t.Errorf("rule %q targets missing policy %q", rule, target)
		}
	}
	for provider := range cfg.RuleProviders {
		if usedProviders[provider] == 0 {
			t.Errorf("rule provider %q is unused", provider)
		}
	}
	for _, rejected := range []string{"GlobalMedia", "ChinaMax", "Lan", "OpenAI", "Gemini", "AIDomain", "AIChat", "Private"} {
		if cfg.RuleProviders[rejected] != nil {
			t.Errorf("redundant or oversized provider %q should not be in the default config", rejected)
		}
	}

	assertMihomoProviderShape(t, cfg.RuleProviders, "GlobalScholar", "classical", "text")
	for _, provider := range []string{"BiliBili", "Disney", "HBOUSA", "HBOHK", "Bahamut", "MyTVSUPER", "PayPal", "Epic", "Xbox", "PlayStation"} {
		assertMihomoProviderShape(t, cfg.RuleProviders, provider, "classical", "yaml")
	}

	for before, after := range map[string]string{
		"RULE-SET,AI-Global,AI":        "RULE-SET,Google,Google",
		"RULE-SET,YouTube,YouTube":     "RULE-SET,Google,Google",
		"RULE-SET,BiliBili,BiliBili":   "RULE-SET,China-Domain,Direct",
		"RULE-SET,China-Domain,Direct": "MATCH,Final",
		"RULE-SET,ChinaIP,Direct":      "MATCH,Final",
	} {
		if ruleIndex(cfg.Rules, before) >= ruleIndex(cfg.Rules, after) {
			t.Errorf("rule %q must appear before %q", before, after)
		}
	}
	if got := cfg.Rules[len(cfg.Rules)-1]; got != "MATCH,Final" {
		t.Errorf("last rule=%q, want MATCH,Final", got)
	}
}

func assertMihomoProviderShape(t *testing.T, providers map[string]map[string]any, name, behavior, format string) {
	t.Helper()
	provider := providers[name]
	if provider == nil {
		t.Errorf("missing provider %q", name)
		return
	}
	if got := fmt.Sprint(provider["behavior"]); got != behavior {
		t.Errorf("provider %q behavior=%q, want %q", name, got, behavior)
	}
	if got := fmt.Sprint(provider["format"]); got != format {
		t.Errorf("provider %q format=%q, want %q", name, got, format)
	}
}

func ruleIndex(rules []string, prefix string) int {
	for i, rule := range rules {
		if strings.HasPrefix(rule, prefix) {
			return i
		}
	}
	return len(rules)
}
