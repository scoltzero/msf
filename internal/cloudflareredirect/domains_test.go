package cloudflareredirect

import "testing"

func TestNormalizeDomainRule(t *testing.T) {
	tests := map[string]string{
		"example.com":                  "domain:example.com",
		"example.com.":                 "domain:example.com",
		"domain:Example.COM.":          "domain:Example.COM",
		"full:www.example.com":         "full:www.example.com",
		"DOMAIN-SUFFIX,cloudflare.com": "domain:cloudflare.com",
		"DOMAIN,www.cloudflare.com":    "full:www.cloudflare.com",
		"DOMAIN-KEYWORD,cloudflare":    "keyword:cloudflare",
		"DOMAIN-REGEX,^.+\\.example$":  "regexp:^.+\\.example$",
		"  example.org # comment":      "domain:example.org",
		"192.0.2.1":                    "",
		"1.1.1.0/24":                   "",
		"domain:":                      "",
		"bad rule with space":          "",
	}
	for in, want := range tests {
		if got := normalizeDomainRule(in); got != want {
			t.Fatalf("normalizeDomainRule(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestLoadDomainsMergesAndDedupesManualRules(t *testing.T) {
	cfg := Config{}
	cfg.Rules.Manual = []string{"example.com", "domain:example.com", "full:www.example.com"}
	got, warnings := LoadDomains(testContext(t), cfg)
	if len(warnings) != 0 {
		t.Fatalf("unexpected warnings: %v", warnings)
	}
	if len(got) != 2 {
		t.Fatalf("domain count = %d, want 2: %v", len(got), got)
	}
}
