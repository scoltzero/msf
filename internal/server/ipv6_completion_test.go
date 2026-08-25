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
	if err := app.installMosDNSBundle(context.Background(), writeMosDNSBundleFixture(t, completeMosDNSBundleFixture()), "eth0"); err != nil {
		t.Fatal(err)
	}
	app.storeJSONSetting("mosdns_overrides", map[string]any{"ecs": "2001:4860:4860::8888"})
	app.storeJSONSetting("mosdns_upstream_overrides", map[string]any{
		"foreign": []any{map[string]any{
			"enabled":   true,
			"protocol":  "https",
			"addr":      "https://dns.example/dns-query",
			"dial_addr": "203.0.113.53",
		}},
		"foreign_fakeip": []any{map[string]any{
			"enabled":  true,
			"protocol": "udp",
			"addr":     "127.0.0.1:9555",
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
	fakeIP, err := os.ReadFile(filepath.Join(app.DataDir, "configs/mosdns/sub_config/forward_1.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(fakeIP), "127.0.0.1:9555") || strings.Contains(string(fakeIP), "127.0.0.1:9333") {
		t.Fatalf("foreign FakeIP upstream override was not rendered:\n%s", fakeIP)
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
