package server

import (
	"net/http"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestRestoreMihomoGeneratedConfigUpgradesTemplateAndPreservesUserAssets(t *testing.T) {
	app := newTestApp(t)
	cfg := SetupConfig{SelectedInterface: "eth0", EnableIPv6: true, LinuxProxyMode: "nft"}
	cfg.SubscriptionURLs = "database-provider|https://example.com/database.yaml"
	cfg.MihomoProxies = "trojan://password@example.org:443?sni=example.org#database-manual-node"

	legacy := `mode: rule
proxy-groups:
  - {name: 节点选择, type: select, proxies: [全球直连]}
  - {name: 全球直连, type: select, proxies: [DIRECT]}
rules:
  - MATCH,节点选择
proxies:
  - name: active-inline-node
    type: ss
    server: inline.example.org
    port: 8388
    cipher: aes-128-gcm
    password: secret
proxy-providers:
  active-provider:
    type: http
    url: https://example.com/active.yaml
    interval: 7200
    path: ./proxy_providers/custom-active.yaml
    health-check:
      enable: true
      url: https://example.com/check
      interval: 300
`
	if err := app.writeTextFileDirect(mihomoActiveConfigRelPath, legacy); err != nil {
		t.Fatal(err)
	}

	changed, err := app.restoreMihomoGeneratedConfig(&cfg)
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("legacy generated config should be refreshed")
	}
	if app.mihomoConfigMode() != "generated" {
		t.Fatalf("refresh changed config mode to %q", app.mihomoConfigMode())
	}

	content, err := app.readTextFile(mihomoActiveConfigRelPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"name: Proxies", "name: AI", "RULE-SET,AI-Global,AI", "MATCH,Final"} {
		if !strings.Contains(content, want) {
			t.Errorf("refreshed generated config is missing %q", want)
		}
	}
	for _, obsolete := range []string{"name: 节点选择", "MATCH,节点选择"} {
		if strings.Contains(content, obsolete) {
			t.Errorf("refreshed generated config kept obsolete template content %q", obsolete)
		}
	}

	var parsed map[string]any
	if err := yaml.Unmarshal([]byte(content), &parsed); err != nil {
		t.Fatal(err)
	}
	providers := normalizeConfigProviders(parsed["proxy-providers"])
	active := providers["active-provider"]
	if active == nil || stringMapValue(active, "url") != "https://example.com/active.yaml" || stringMapValue(active, "path") != "./proxy_providers/custom-active.yaml" {
		t.Fatalf("active provider was not preserved: %#v", active)
	}
	if got := firstNumericMapValue(active, "interval"); got != 7200 {
		t.Fatalf("active provider interval=%v, want 7200", got)
	}
	health := mihomoMapValueMap(active["health-check"])
	if stringMapValue(health, "url") != "https://example.com/check" || firstNumericMapValue(health, "interval") != 300 {
		t.Fatalf("active provider health-check was not preserved: %#v", health)
	}
	database := providers["database-provider"]
	if database == nil || stringMapValue(database, "url") != "https://example.com/database.yaml" {
		t.Fatalf("database provider was not restored: %#v", database)
	}
	if providers["msf_manual"] == nil {
		t.Fatal("manual node provider was not restored")
	}
	manual, err := app.readTextFile("configs/mihomo/proxy_providers/msf_manual.yaml")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(manual, "name: database-manual-node") || !strings.Contains(manual, "type: trojan") || !strings.Contains(manual, "name: active-inline-node") {
		t.Fatalf("manual nodes were not restored:\n%s", manual)
	}
	if changed, err := app.restoreMihomoGeneratedConfig(&cfg); err != nil {
		t.Fatal(err)
	} else if changed {
		t.Fatal("refreshing an already current generated config should be idempotent")
	}
}

func TestRestoreMihomoGeneratedConfigRecoversLegacyManualNodeFile(t *testing.T) {
	app := newTestApp(t)
	cfg := SetupConfig{SelectedInterface: "eth0", EnableIPv6: true, LinuxProxyMode: "nft"}
	cfg.MihomoProxies = ""
	legacy := `mode: rule
proxy-groups:
  - {name: 节点选择, type: select, proxies: [DIRECT]}
rules:
  - MATCH,节点选择
proxy-providers:
  msf_manual:
    type: file
    path: ./proxy_providers/msf_manual.yaml
`
	if err := app.writeTextFileDirect(mihomoActiveConfigRelPath, legacy); err != nil {
		t.Fatal(err)
	}
	manual := "proxies:\n  - name: legacy-manual-node\n    type: ss\n    server: example.org\n    port: 8388\n    cipher: aes-128-gcm\n    password: secret\n"
	if err := app.writeTextFileDirect("configs/mihomo/proxy_providers/msf_manual.yaml", manual); err != nil {
		t.Fatal(err)
	}

	if changed, err := app.restoreMihomoGeneratedConfig(&cfg); err != nil {
		t.Fatal(err)
	} else if !changed {
		t.Fatal("legacy generated config should be refreshed")
	}
	if !strings.Contains(cfg.MihomoProxies, "legacy-manual-node") {
		t.Fatalf("legacy manual node file was not recovered into generated state: %q", cfg.MihomoProxies)
	}
	refreshed, err := app.readTextFile("configs/mihomo/proxy_providers/msf_manual.yaml")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(refreshed, "legacy-manual-node") {
		t.Fatalf("legacy manual node was lost:\n%s", refreshed)
	}
}

func TestDefaultConfigIsNotUpgradedWithoutExplicitRestore(t *testing.T) {
	app := newTestApp(t)
	legacy := "mode: rule\nproxy-groups:\n  - {name: 节点选择, type: select, proxies: [DIRECT]}\nrules:\n  - MATCH,节点选择\nproxy-providers: {}\n"
	if err := app.writeTextFileDirect(mihomoActiveConfigRelPath, legacy); err != nil {
		t.Fatal(err)
	}
	if err := app.ensureDefaultConfigs(); err != nil {
		t.Fatal(err)
	}
	after, err := app.readTextFile(mihomoActiveConfigRelPath)
	if err != nil {
		t.Fatal(err)
	}
	if after != legacy {
		t.Fatalf("existing generated config was upgraded without explicit restore:\n%s", after)
	}
}

func TestCustomConfigIsNotUpgradedDuringDefaultInitialization(t *testing.T) {
	app := newTestApp(t)
	custom := "mode: rule\nproxy-groups:\n  - {name: UserOwned, type: select, proxies: [DIRECT]}\nrules:\n  - MATCH,UserOwned\nproxy-providers: {}\n"
	if err := app.writeTextFileDirect(mihomoActiveConfigRelPath, custom); err != nil {
		t.Fatal(err)
	}
	app.setMihomoConfigMode("custom")
	if err := app.ensureDefaultConfigs(); err != nil {
		t.Fatal(err)
	}
	after, err := app.readTextFile(mihomoActiveConfigRelPath)
	if err != nil {
		t.Fatal(err)
	}
	if after != custom {
		t.Fatalf("custom config was upgraded during default initialization:\n%s", after)
	}
}

func TestRestoreDefaultEndpointPreservesCustomInlineNodesAndProviders(t *testing.T) {
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")
	custom := `mode: rule
proxy-groups:
  - {name: UserOwned, type: select, proxies: [inline-node]}
proxies:
  - name: inline-node
    type: ss
    server: example.org
    port: 8388
    cipher: aes-128-gcm
    password: secret
rules:
  - MATCH,UserOwned
proxy-providers:
  custom-provider:
    type: http
    url: https://example.com/custom.yaml
    interval: 7200
    path: ./proxy_providers/custom.yaml
`
	if err := app.writeTextFileDirect(mihomoActiveConfigRelPath, custom); err != nil {
		t.Fatal(err)
	}
	app.setMihomoConfigMode("custom")

	res := requestJSON(t, app, http.MethodPost, "/api/v1/mihomo/config/restore-default?restart=false", token, nil)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"mode":"generated"`) || !strings.Contains(res.Body.String(), `"restored_from":"generated-template"`) {
		t.Fatalf("restore default status=%d body=%s", res.Code, res.Body.String())
	}
	active, err := app.readTextFile(mihomoActiveConfigRelPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"name: Proxies", "RULE-SET,Google,Google", "custom-provider:", "https://example.com/custom.yaml", "msf_manual:"} {
		if !strings.Contains(active, want) {
			t.Errorf("restored default is missing %q:\n%s", want, active)
		}
	}
	if strings.Contains(active, "name: UserOwned") || strings.Contains(active, "MATCH,UserOwned") {
		t.Fatalf("restored default kept custom routing sections:\n%s", active)
	}
	manual, err := app.readTextFile("configs/mihomo/proxy_providers/msf_manual.yaml")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(manual, "name: inline-node") || !strings.Contains(manual, "server: example.org") {
		t.Fatalf("inline node was not preserved as an MSF manual provider:\n%s", manual)
	}
}
