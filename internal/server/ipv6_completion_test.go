package server

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNormalizeFakeIPPrefixFamiliesAndCanonicalForm(t *testing.T) {
	if got, err := normalizeFakeIPPrefix("fd12:3456:789a::1234/48", true); err != nil || got != "fd12:3456:789a::/48" {
		t.Fatalf("canonical IPv6 prefix got=%q err=%v", got, err)
	}
	if got, err := normalizeFakeIPPrefix("29.9.8.7/8", false); err != nil || got != "29.0.0.0/8" {
		t.Fatalf("canonical IPv4 prefix got=%q err=%v", got, err)
	}
	for _, test := range []struct {
		value string
		ipv6  bool
	}{
		{value: "28.0.0.0/8", ipv6: true},
		{value: "f2b0::/18", ipv6: false},
		{value: "192.168.1.0/24", ipv6: false},
		{value: "fe80::/64", ipv6: true},
		{value: "fd00::1/128", ipv6: true},
	} {
		if _, err := normalizeFakeIPPrefix(test.value, test.ipv6); err == nil {
			t.Fatalf("normalizeFakeIPPrefix(%q, %t) should fail", test.value, test.ipv6)
		}
	}
}

func TestIPv6GeneratedArtifactsSharePrefixAndDisableDataPlane(t *testing.T) {
	app := newTestApp(t)
	enabled := SetupConfig{
		SelectedInterface: "eth0",
		EnableIPv6:        true,
		FakeIPRangeV6:     "fd12:3456:789a::99/48",
		LinuxProxyMode:    "tun",
		ProxyCore:         "mihomo",
		MosDNSEnabled:     true,
	}
	enabled.defaults()
	mihomo := app.renderMihomoYAML(enabled)
	for _, want := range []string{"ipv6: true", "fake-ip-range6: fd12:3456:789a::/48", "- fd12:3456:789a::/48"} {
		if !strings.Contains(mihomo, want) {
			t.Fatalf("enabled Mihomo config missing %q", want)
		}
	}

	disabled := enabled
	disabled.EnableIPv6 = false
	mihomo = app.renderMihomoYAML(disabled)
	if strings.Contains(mihomo, "- fd12:3456:789a::/48") {
		t.Fatal("IPv6-disabled Mihomo TUN config retained the IPv6 FakeIP route")
	}
	if !strings.Contains(mihomo, "fake-ip-range6: fd12:3456:789a::/48") {
		t.Fatal("IPv6-disabled Mihomo config should preserve the configured prefix")
	}
	network := app.renderNetworkYAML(disabled)
	if strings.Contains(network, "fake_ipv6") || !strings.Contains(network, "enable: false") {
		t.Fatalf("IPv6-disabled network.yaml still activates IPv6:\n%s", network)
	}
	nft := app.renderNFT(disabled)
	for _, forbidden := range []string{"fake_ipv6", "dns_ipv6", "ip6 ", "f2b0::", "fd12:3456:789a::"} {
		if strings.Contains(nft, forbidden) {
			t.Fatalf("IPv6-disabled nftables config retained %q:\n%s", forbidden, nft)
		}
	}
	mosdns := app.renderMosDNSYAML(disabled)
	if count := strings.Count(mosdns, "IPv6 数据面关闭时显式返回真实 AAAA"); count != 2 {
		t.Fatalf("real AAAA bypass count=%d, want 2", count)
	}
	if strings.Contains(mosdns, "sequence_client") || strings.Contains(mosdns, "forward_priority_core") {
		t.Fatal("client entry must not forward through a localhost wrapper that loses the original client IP")
	}
	if strings.Count(mosdns, "entry: sequence_6666") != 2 {
		t.Fatal("only the public UDP/TCP :53 entries should enter sequence_6666 directly")
	}
	for _, want := range []string{"switch6 'A'", `listen: ":53"`, "fast_accel: true", "exec: prefer_ipv4", "exec: prefer_ipv6"} {
		if !strings.Contains(mosdns, want) {
			t.Fatalf("MosDNS direct client sequence missing %q", want)
		}
	}
	if strings.Count(mosdns, "exec: prefer_ipv4") != 2 || strings.Count(mosdns, "exec: prefer_ipv6") != 2 {
		t.Fatal("IPv4/IPv6 preference must execute inline in both primary MosDNS sequences")
	}
	priorityIndex := strings.Index(mosdns, "exec: prefer_ipv4")
	clientExitIndex := strings.Index(mosdns, "matches: fast_mark 39")
	bypassIndex := strings.Index(mosdns, "IPv6 数据面关闭时显式返回真实 AAAA")
	cacheIndex := strings.Index(mosdns, "#web ui中选择泄露版")
	if priorityIndex < 0 || clientExitIndex < 0 || priorityIndex > clientExitIndex {
		t.Fatal("resolution priority must run before client-specific branches can exit")
	}
	if bypassIndex < clientExitIndex || cacheIndex < bypassIndex {
		t.Fatal("real AAAA fallback must run after priority/client routing and before cache routing")
	}
}

func TestCustomMihomoRepairsOnlyManagedIPv6Artifacts(t *testing.T) {
	app := newTestApp(t)
	cfg := SetupConfig{
		SelectedInterface: "eth0",
		EnableIPv6:        false,
		LinuxProxyMode:    "nft",
		ProxyCore:         "mihomo",
		MosDNSEnabled:     true,
	}
	cfg.defaults()
	custom := app.renderMihomoYAML(cfg)
	writeFactoryResetTestFile(t, app, mihomoActiveConfigRelPath, custom, 0o644)
	app.setMihomoConfigMode("custom")
	stale := cfg
	stale.EnableIPv6 = true
	writeFactoryResetTestFile(t, app, "configs/network/network.yaml", app.renderNetworkYAML(stale), 0o644)
	writeFactoryResetTestFile(t, app, "configs/network/network.nft", app.renderNFT(stale), 0o644)

	if err := app.ensureProxyModeConsistency(cfg, true); err != nil {
		t.Fatalf("repair managed custom-mode artifacts: %v", err)
	}
	body, err := os.ReadFile(filepath.Join(app.DataDir, mihomoActiveConfigRelPath))
	if err != nil || string(body) != custom {
		t.Fatalf("custom Mihomo config changed: err=%v", err)
	}
	network, err := os.ReadFile(filepath.Join(app.DataDir, "configs/network/network.yaml"))
	if err != nil || strings.Contains(string(network), "fake_ipv6") {
		t.Fatalf("managed network IPv6 state was not repaired: err=%v\n%s", err, network)
	}
	nft, err := os.ReadFile(filepath.Join(app.DataDir, "configs/network/network.nft"))
	if err != nil || strings.Contains(string(nft), "ip6 ") || strings.Contains(string(nft), "fake_ipv6") {
		t.Fatalf("managed nft IPv6 state was not repaired: err=%v\n%s", err, nft)
	}
}

func TestMosDNSOverridesRenderIntoRuntimeYAML(t *testing.T) {
	app := newTestApp(t)
	app.storeJSONSetting("mosdns_overrides", map[string]any{"ecs": "2001:4860:4860::8888"})
	app.storeJSONSetting("mosdns_upstream_overrides", map[string]any{
		"foreign": []any{map[string]any{
			"enabled":   true,
			"protocol":  "https",
			"addr":      "https://dns.example/dns-query",
			"dial_addr": "203.0.113.53",
		}},
	})
	cfg := SetupConfig{SelectedInterface: "eth0", EnableIPv6: true, ProxyCore: "mihomo", MosDNSEnabled: true}
	cfg.defaults()
	if err := app.writeGeneratedConfigs(cfg); err != nil {
		t.Fatal(err)
	}
	foreign, err := os.ReadFile(filepath.Join(app.DataDir, "configs/mosdns/sub_config/forward_nocn.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(foreign), "https://dns.example/dns-query") || strings.Contains(string(foreign), "https://1.1.1.1/dns-query") {
		t.Fatalf("foreign upstream override was not rendered:\n%s", foreign)
	}
	ecs, err := os.ReadFile(filepath.Join(app.DataDir, "configs/mosdns/sub_config/forward_nocn_ecs.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(ecs), "exec: ecs 2001:4860:4860::8888") {
		t.Fatalf("ECS override was not rendered:\n%s", ecs)
	}
}

func TestSetupConfigPatchPreservesFakeIPRanges(t *testing.T) {
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")
	first := requestJSON(t, app, http.MethodPut, "/api/v1/setup/config", token, map[string]any{
		"username":           "root",
		"selected_interface": "eth0",
		"proxy_core":         "mihomo",
		"mos_dns_enabled":    true,
		"enable_ipv6":        false,
		"fake_ip_range_v4":   "29.9.8.7/8",
		"fake_ip_range_v6":   "fd12:3456:789a::99/48",
	})
	if first.Code != http.StatusOK {
		t.Fatalf("initial config status=%d body=%s", first.Code, first.Body.String())
	}
	patch := requestJSON(t, app, http.MethodPut, "/api/v1/setup/config", token, map[string]any{"timezone": "Asia/Shanghai"})
	if patch.Code != http.StatusOK {
		t.Fatalf("partial config status=%d body=%s", patch.Code, patch.Body.String())
	}
	cfg, ok := app.latestSetupConfig()
	if !ok || cfg.FakeIPRangeV4 != "29.0.0.0/8" || cfg.FakeIPRangeV6 != "fd12:3456:789a::/48" || cfg.EnableIPv6 {
		t.Fatalf("partial update changed preserved network fields: %#v", cfg)
	}
}

func TestMosDNSPrioritySwitchesAreMutuallyExclusive(t *testing.T) {
	app := newTestApp(t)
	app.setMosDNSSwitchState("switch8", true)
	app.setMosDNSSwitchState("switch10", true)
	switches := app.mosDNSSwitchMap()
	if switches["switch8"] || !switches["switch10"] {
		t.Fatalf("priority switches should be mutually exclusive: %#v", switches)
	}
}

func TestLegacyMosDNSConfigMigratesWithoutUnusedLoopbackHops(t *testing.T) {
	app := newTestApp(t)
	legacy := `plugins:
  - tag: forward_priority_core
    type: forward
    args:
      upstreams:
        - addr: "udp://127.0.0.1:5656"

  - tag: sequence_client
    type: sequence
    args:
      - exec: $forward_priority_core
#对外服务器
  - tag: udp_all
    type: udp_server
    args:
      entry: sequence_client
      listen: ":53"
  - tag: sequence_6666
    type: sequence
    args:
      - matches: fast_mark 6                #向上游请求ddns域名，无过期缓存
        exec: $domestic
      - matches:                            #web ui中选择泄露版（默认），用cache_all，否则用cache_all_noleak
        exec: $cache_all
  - tag: sequence_requery
    type: sequence
    args:
      - matches: fast_mark 6                #向上游请求ddns域名，无过期缓存
        exec: $domestic
      - matches:                            #web ui中选择泄露版（默认），用cache_all，否则用cache_all_noleak
        exec: $cache_all

  - tag: forward_all_in
    type: forward
    args:
      concurrent: 1
      upstreams:
        - addr: "udp://127.0.0.1:5656"

  - tag: udp_main
    type: udp_server
    args:
      entry: sequence_6666
      listen: 127.0.0.1:5656

  - tag: tcp_main
    type: tcp_server
    args:
      entry: sequence_6666
      listen: 127.0.0.1:5656
      idle_timeout: 720
`
	if err := app.writeTextFile("configs/mosdns/config.yaml", legacy); err != nil {
		t.Fatal(err)
	}
	if err := app.writeTextFile("configs/mosdns/sub_config/forward_2.yaml", "stale\n"); err != nil {
		t.Fatal(err)
	}
	if err := app.migrateLegacyMosDNSConfig(); err != nil {
		t.Fatal(err)
	}
	got, err := app.readTextFile("configs/mosdns/config.yaml")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(got, "sequence_client") || strings.Contains(got, "forward_priority_core") || strings.Contains(got, "127.0.0.1:5656") || strings.Contains(got, "forward_all_in") || strings.Contains(got, "tag: udp_main") || strings.Contains(got, "tag: tcp_main") {
		t.Fatalf("deprecated localhost wrapper remains after migration:\n%s", got)
	}
	if !strings.Contains(got, "entry: sequence_6666") {
		t.Fatalf("direct MosDNS entry missing after migration:\n%s", got)
	}
	if strings.Count(got, "exec: prefer_ipv4") != 2 || strings.Count(got, "exec: prefer_ipv6") != 2 {
		t.Fatalf("inline IPv4/IPv6 preference was not restored during migration:\n%s", got)
	}
	if _, err := os.Stat(filepath.Join(app.DataDir, "configs/mosdns/sub_config/forward_2.yaml")); !os.IsNotExist(err) {
		t.Fatalf("stale forward_2.yaml was not removed, err=%v", err)
	}
}

func TestMosDNSPriorityAPIUpdatesBothSwitchesAtomically(t *testing.T) {
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")
	for _, test := range []struct {
		priority string
		ipv4     bool
		ipv6     bool
	}{
		{priority: "auto"},
		{priority: "ipv4", ipv4: true},
		{priority: "ipv6", ipv6: true},
	} {
		res := requestJSON(t, app, http.MethodPut, "/api/v1/mosdns/system/priority", token, map[string]any{"priority": test.priority})
		if res.Code != http.StatusOK {
			t.Fatalf("priority %s status=%d body=%s", test.priority, res.Code, res.Body.String())
		}
		switches := app.mosDNSSwitchMap()
		if switches["switch8"] != test.ipv4 || switches["switch10"] != test.ipv6 || (switches["switch8"] && switches["switch10"]) {
			t.Fatalf("priority %s produced invalid switches: %#v", test.priority, switches)
		}
	}
	res := requestJSON(t, app, http.MethodPut, "/api/v1/mosdns/system/priority", token, map[string]any{"priority": "invalid"})
	if res.Code != http.StatusBadRequest {
		t.Fatalf("invalid priority status=%d body=%s", res.Code, res.Body.String())
	}
}

func TestPartialIPv6SavesPreserveDatabaseProviderFields(t *testing.T) {
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")
	initial := requestJSON(t, app, http.MethodPut, "/api/v1/setup/config", token, map[string]any{
		"username":           "root",
		"selected_interface": "eth0",
		"proxy_core":         "mihomo",
		"mos_dns_enabled":    true,
		"enable_ipv6":        false,
		"subscription_urls":  "https://example.com/sub",
		"mihomo_proxies":     "- name: manual-node\n  type: socks5\n  server: 127.0.0.1\n  port: 1080",
	})
	if initial.Code != http.StatusOK {
		t.Fatalf("initial config status=%d body=%s", initial.Code, initial.Body.String())
	}
	active := filepath.Join(app.DataDir, mihomoActiveConfigRelPath)
	if err := os.WriteFile(active, []byte("ipv6: false\ndns:\n  ipv6: false\nproxy-providers: {}\nproxies: []\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	partial := requestJSON(t, app, http.MethodPut, "/api/v1/setup/config", token, map[string]any{"enable_ipv6": false})
	if partial.Code != http.StatusOK {
		t.Fatalf("partial setup status=%d body=%s", partial.Code, partial.Body.String())
	}
	cfg, _, ok := app.latestSetupConfigForSettingsRaw()
	if !ok || cfg.SubscriptionURLs != "https://example.com/sub" || !strings.Contains(cfg.MihomoProxies, "manual-node") {
		t.Fatalf("setup partial save lost DB provider fields: %#v", cfg)
	}

	if err := os.WriteFile(active, []byte("ipv6: false\ndns:\n  ipv6: false\nproxy-providers: {}\nproxies: []\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	structured := requestJSON(t, app, http.MethodPut, "/api/v1/settings/structured", token, map[string]any{"mosdns": map[string]any{"enable_ipv6": false}})
	if structured.Code != http.StatusOK {
		t.Fatalf("partial structured status=%d body=%s", structured.Code, structured.Body.String())
	}
	cfg, _, ok = app.latestSetupConfigForSettingsRaw()
	if !ok || cfg.SubscriptionURLs != "https://example.com/sub" || !strings.Contains(cfg.MihomoProxies, "manual-node") {
		t.Fatalf("structured partial save lost DB provider fields: %#v", cfg)
	}

	clear := requestJSON(t, app, http.MethodPut, "/api/v1/setup/config", token, map[string]any{
		"subscription_urls": "",
		"mihomo_proxies":    "",
	})
	if clear.Code != http.StatusOK {
		t.Fatalf("explicit provider clear status=%d body=%s", clear.Code, clear.Body.String())
	}
	cfg, _, ok = app.latestSetupConfigForSettingsRaw()
	if !ok || cfg.SubscriptionURLs != "" || cfg.MihomoProxies != "" {
		t.Fatalf("explicit provider clear was not persisted: %#v", cfg)
	}
}

func TestFakeIPCacheQuarantineCommitAndRollback(t *testing.T) {
	app := newTestApp(t)
	cache := filepath.Join(app.DataDir, "configs", "mihomo", "cache.db")
	if err := os.MkdirAll(filepath.Dir(cache), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cache, []byte("old-cache"), 0o644); err != nil {
		t.Fatal(err)
	}
	tx := &fakeIPCacheInvalidation{OriginallyRunning: map[string]bool{}}
	if err := app.quarantineFakeIPCacheFiles(tx, []string{cache}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(cache); !os.IsNotExist(err) {
		t.Fatalf("cache was not quarantined: %v", err)
	}
	if err := tx.restoreServiceFiles("mihomo", app); err != nil {
		t.Fatal(err)
	}
	if body, err := os.ReadFile(cache); err != nil || string(body) != "old-cache" {
		t.Fatalf("cache rollback failed: body=%q err=%v", body, err)
	}

	if err := app.quarantineFakeIPCacheFiles(tx, []string{cache}); err != nil {
		t.Fatal(err)
	}
	if err := tx.commit(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(tx.Root); !os.IsNotExist(err) {
		t.Fatalf("cache backup remained after commit: %v", err)
	}
	if err := tx.rollback(context.Background(), app); err != nil {
		t.Fatal(err)
	}
}
