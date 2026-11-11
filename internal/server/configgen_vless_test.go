package server

import (
	"testing"

	"gopkg.in/yaml.v3"
)

func TestManualVLESSRealityMLKEM(t *testing.T) {
	tests := []struct {
		name, query string
		want        any
	}{
		{"true", "&support-x25519mlkem768=true", true},
		{"one", "&support-x25519mlkem768=1", true},
		{"false", "&support-x25519mlkem768=false", false},
		{"zero", "&support-x25519mlkem768=0", false},
		{"absent", "", nil},
		{"empty", "&support-x25519mlkem768=", nil},
		{"invalid", "&support-x25519mlkem768=invalid", nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := "vless://uuid@example.com:443?security=reality&pbk=key&sid=123" + tt.query
			var result struct {
				Proxies []struct {
					Reality map[string]any `yaml:"reality-opts"`
				} `yaml:"proxies"`
			}
			if err := yaml.Unmarshal([]byte(renderMihomoManualProviderYAML(input)), &result); err != nil {
				t.Fatal(err)
			}
			if len(result.Proxies) != 1 {
				t.Fatalf("got %d proxies, want 1", len(result.Proxies))
			}
			reality := result.Proxies[0].Reality
			if reality["public-key"] != "key" || reality["short-id"] != "123" {
				t.Fatalf("existing reality options lost: %#v", reality)
			}
			got, exists := reality["support-x25519mlkem768"]
			if got != tt.want || exists != (tt.want != nil) {
				t.Fatalf("got value %#v (present %v), want %#v", got, exists, tt.want)
			}
		})
	}
	for _, input := range []string{
		"vless://uuid@example.com:443?security=reality&sid=123&support-x25519mlkem768=true",
		"vless://uuid@example.com:443?security=tls&pbk=key&support-x25519mlkem768=true",
	} {
		proxy, ok := parseMihomoManualProxyLink(input)
		if !ok {
			t.Fatalf("failed to parse %q", input)
		}
		if reality, ok := proxy["reality-opts"].(map[string]any); ok {
			if _, exists := reality["support-x25519mlkem768"]; exists {
				t.Fatalf("unexpected ML-KEM option for %q", input)
			}
		}
	}
}
