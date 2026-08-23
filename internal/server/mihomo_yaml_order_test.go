package server

import (
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestMarshalMihomoConfigMapMatchesDefaultSectionOrder(t *testing.T) {
	cfg := map[string]any{
		"proxy-providers":  map[string]any{"airport": map[string]any{"type": "http"}},
		"rules":            []any{"MATCH,DIRECT"},
		"custom-extension": map[string]any{"enabled": true},
		"mode":             "rule",
		"dns":              map[string]any{"enable": true},
		"proxy-groups":     []any{},
		"rule-providers":   map[string]any{},
	}
	b, err := marshalMihomoConfigMap(cfg)
	if err != nil {
		t.Fatal(err)
	}
	text := string(b)
	keys := []string{"mode:", "dns:", "proxy-groups:", "rule-providers:", "rules:", "custom-extension:", "proxy-providers:"}
	previous := -1
	for _, key := range keys {
		index := strings.Index(text, "\n"+key)
		if strings.HasPrefix(text, key) {
			index = 0
		}
		if index < 0 || index <= previous {
			t.Fatalf("top-level key %s is out of order:\n%s", key, text)
		}
		previous = index
	}
}

func TestOrderMihomoTopLevelYAMLPutsProxyProvidersLast(t *testing.T) {
	var doc yaml.Node
	input := "proxy-providers: {}\nrules:\n  - MATCH,DIRECT\nmode: rule\ncustom: true\n"
	if err := yaml.Unmarshal([]byte(input), &doc); err != nil {
		t.Fatal(err)
	}
	orderMihomoTopLevelYAML(&doc)
	b, err := yaml.Marshal(&doc)
	if err != nil {
		t.Fatal(err)
	}
	text := string(b)
	if !strings.HasSuffix(strings.TrimSpace(text), "proxy-providers: {}") {
		t.Fatalf("proxy-providers should be the final top-level section:\n%s", text)
	}
}

func TestMoveTopLevelYAMLBlockToEndPreservesText(t *testing.T) {
	input := "mode: rule\nproxy-providers:\n  airport:\n    type: http\nrules:\n  - MATCH,DIRECT\n"
	got := moveTopLevelYAMLBlockToEnd(input, "proxy-providers")
	if !strings.Contains(got, "rules:\n  - MATCH,DIRECT") || !strings.HasSuffix(strings.TrimSpace(got), "type: http") {
		t.Fatalf("provider block was not moved intact:\n%s", got)
	}
}
