package cloudflareredirect

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const testMosDNSConfig = `log:
  level: warn

include:
  - "sub_config/adguard.yaml"
  - "sub_config/rule_set.yaml"
  - "sub_config/cache.yaml"

plugins:
  - tag: sequence_6666
    type: sequence
    args:
      - exec: $rewrite
      - matches: fast_mark 39
        exec:
          - $sequence_local
          - tag_setter 指定客户端直连
          - exit
      - matches: qtype 1
        exec: $sequence_ipv4

  - tag: sequence_requery
    type: sequence
    args:
      - exec: $rewrite
      - matches: fast_mark 39
        exec:
          - $sequence_local
          - tag_setter 指定客户端直连
          - exit
      - matches: qtype 1
        exec: $sequence_ipv4
`

func TestApplyInjectsOnlyDirectClientBranch(t *testing.T) {
	dataDir := t.TempDir()
	writeTestMosDNSConfig(t, dataDir)
	cfg := Config{
		Enabled: true,
		Scan: ScanConfig{
			IPv6: FamilyScanConfig{Enabled: TriFalse},
		},
		Rules: RulesConfig{Manual: []string{"example.com"}},
		Apply: ApplyConfig{TTL: 60, RewriteA: true, RewriteAAAA: TriFalse, RestartMosDNS: TriFalse},
	}
	st := State{
		BestIPv4: []ScanResult{{IP: "1.1.1.1", Family: "ipv4", LatencyMS: 10, ScannedAt: time.Now()}},
	}
	result, err := Apply(testContext(t), dataDir, cfg, st)
	if err != nil {
		t.Fatal(err)
	}
	if result.DomainCount != 1 || result.IPv4Count != 1 || result.IPv6Count != 0 {
		t.Fatalf("unexpected apply result: %#v", result)
	}
	rule, err := os.ReadFile(RulePath(dataDir))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(rule), "domain:example.com 1.1.1.1") {
		t.Fatalf("generated rule mismatch:\n%s", string(rule))
	}
	subConfig, err := os.ReadFile(SubConfigPath(dataDir))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(subConfig), "matches: qtype 1") || !strings.Contains(string(subConfig), "matches: qtype 28") {
		t.Fatalf("cloudflare redirect sequence must guard A/AAAA separately:\n%s", string(subConfig))
	}
	config, err := os.ReadFile(MosDNSConfigPath(dataDir))
	if err != nil {
		t.Fatal(err)
	}
	text := string(config)
	if strings.Count(text, "$sequence_cloudflare_redirect") != 2 {
		t.Fatalf("cloudflare sequence should be injected once per direct branch:\n%s", text)
	}
	if strings.Index(text, "- $sequence_cloudflare_redirect") > strings.Index(text, "- $sequence_local") {
		t.Fatalf("cloudflare redirect should run before sequence_local:\n%s", text)
	}
	if strings.Contains(text, "$sequence_cloudflare_redirect\n      - matches: qtype") {
		t.Fatalf("cloudflare redirect leaked into non-direct branch:\n%s", text)
	}
}

func TestApplyInjectionIsIdempotentAndStopRemovesMarkers(t *testing.T) {
	dataDir := t.TempDir()
	writeTestMosDNSConfig(t, dataDir)
	cfg := Config{
		Enabled: true,
		Scan:    ScanConfig{IPv6: FamilyScanConfig{Enabled: TriFalse}},
		Rules:   RulesConfig{Manual: []string{"example.com"}},
		Apply:   ApplyConfig{RewriteA: true, RewriteAAAA: TriFalse, RestartMosDNS: TriFalse},
	}
	st := State{BestIPv4: []ScanResult{{IP: "1.1.1.1", Family: "ipv4"}}}
	if _, err := Apply(testContext(t), dataDir, cfg, st); err != nil {
		t.Fatal(err)
	}
	if _, err := Apply(testContext(t), dataDir, cfg, st); err != nil {
		t.Fatal(err)
	}
	config, err := os.ReadFile(MosDNSConfigPath(dataDir))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(config), "$sequence_cloudflare_redirect") != 2 {
		t.Fatalf("injection should be idempotent:\n%s", string(config))
	}
	if err := RemoveInjection(testContext(t), dataDir, false); err != nil {
		t.Fatal(err)
	}
	config, err = os.ReadFile(MosDNSConfigPath(dataDir))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(config), "msf-cloudflare-redirect") || strings.Contains(string(config), "$sequence_cloudflare_redirect") {
		t.Fatalf("stop should remove injected markers:\n%s", string(config))
	}
	if _, err := os.Stat(ConfigPath(dataDir)); !os.IsNotExist(err) {
		t.Fatalf("RemoveInjection must not create or delete user config, stat err=%v", err)
	}
}

func TestRunApplyDisabledRemovesExistingInjection(t *testing.T) {
	dataDir := t.TempDir()
	writeTestMosDNSConfig(t, dataDir)
	enabled := Config{
		Enabled: true,
		Scan:    ScanConfig{IPv6: FamilyScanConfig{Enabled: TriFalse}},
		Rules:   RulesConfig{Manual: []string{"example.com"}},
		Apply:   ApplyConfig{RewriteA: true, RewriteAAAA: TriFalse, RestartMosDNS: TriFalse},
	}
	st := State{BestIPv4: []ScanResult{{IP: "1.1.1.1", Family: "ipv4"}}}
	if _, err := Apply(testContext(t), dataDir, enabled, st); err != nil {
		t.Fatal(err)
	}
	if err := EnsureDefaultConfig(dataDir); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(ConfigPath(dataDir), []byte("enabled: false\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := RunApply(testContext(t), dataDir); err != nil {
		t.Fatal(err)
	}
	config, err := os.ReadFile(MosDNSConfigPath(dataDir))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(config), "$sequence_cloudflare_redirect") {
		t.Fatalf("disabled apply should remove injection:\n%s", string(config))
	}
}

func TestApplyWithNoDomainsRemovesExistingInjection(t *testing.T) {
	dataDir := t.TempDir()
	writeTestMosDNSConfig(t, dataDir)
	enabled := Config{
		Enabled: true,
		Scan:    ScanConfig{IPv6: FamilyScanConfig{Enabled: TriFalse}},
		Rules:   RulesConfig{Manual: []string{"example.com"}},
		Apply:   ApplyConfig{RewriteA: true, RewriteAAAA: TriFalse, RestartMosDNS: TriFalse},
	}
	st := State{BestIPv4: []ScanResult{{IP: "1.1.1.1", Family: "ipv4"}}}
	if _, err := Apply(testContext(t), dataDir, enabled, st); err != nil {
		t.Fatal(err)
	}
	empty := enabled
	empty.Rules.Manual = nil
	_, err := Apply(testContext(t), dataDir, empty, st)
	if err == nil || !strings.Contains(err.Error(), "no redirect domains configured") {
		t.Fatalf("expected no-domain error, got %v", err)
	}
	config, err := os.ReadFile(MosDNSConfigPath(dataDir))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(config), "$sequence_cloudflare_redirect") {
		t.Fatalf("no-domain apply should remove injection:\n%s", string(config))
	}
	state, err := LoadState(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if state.Injected || state.DomainCount != 0 || !strings.Contains(state.LastError, "no redirect domains configured") {
		t.Fatalf("state should explain no-domain apply: %#v", state)
	}
}

func TestStatusHintsExplainDisabledAndPendingApply(t *testing.T) {
	dataDir := t.TempDir()
	if err := EnsureDefaultConfig(dataDir); err != nil {
		t.Fatal(err)
	}
	cfg, err := LoadConfig(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	disabledHints := statusHints(dataDir, cfg, State{}, false)
	if len(disabledHints) == 0 || !strings.Contains(disabledHints[0], "enabled=false") {
		t.Fatalf("disabled hints should explain enabled=false: %v", disabledHints)
	}
	cfg.Enabled = true
	pendingHints := statusHints(dataDir, cfg, State{BestIPv4: []ScanResult{{IP: "1.1.1.1"}}}, true)
	joined := strings.Join(pendingHints, "\n")
	if !strings.Contains(joined, "not injected") || !strings.Contains(joined, "domain_count=0") {
		t.Fatalf("pending hints should explain missing injection and domains: %v", pendingHints)
	}
}

func writeTestMosDNSConfig(t *testing.T, dataDir string) {
	t.Helper()
	path := MosDNSConfigPath(dataDir)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(testMosDNSConfig), 0o644); err != nil {
		t.Fatal(err)
	}
}
