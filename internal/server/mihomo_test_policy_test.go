package server

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

const issue22Providers = `mode: rule
proxy-providers:
  airport:
    type: http
    url: https://subscription.example/a
    path: ./proxy_providers/custom.yaml
    interval: 7200
    filter: keep-me
    future-option: {enabled: false}
    health-check:
      enable: false
      url: https://health.example/a
      interval: 777
      timeout: 2345
      lazy: false
      expected-status: '204'
  local-file:
    type: file
    path: ./proxy_providers/local.yaml
  inline:
    type: inline
    payload: []
`

func issue22ProviderMap(t *testing.T, content string) map[string]map[string]any {
	t.Helper()
	var cfg map[string]any
	if err := yaml.Unmarshal([]byte(content), &cfg); err != nil {
		t.Fatal(err)
	}
	return normalizeConfigProviders(cfg["proxy-providers"])
}

func TestIssue22ProviderLifecyclePreservesFullDefinitions(t *testing.T) {
	for _, mode := range []string{"generated", "custom"} {
		for _, operation := range []string{"startup", "regenerate"} {
			t.Run(mode+"/"+operation, func(t *testing.T) {
				app := newTestApp(t)
				cfg := SetupConfig{SubscriptionURLs: "airport|https://subscription.example/a", SelectedInterface: "eth0"}
				cfg.defaults()
				if _, err := app.insertSetupSnapshot(cfg, false); err != nil {
					t.Fatal(err)
				}
				active := mihomoActiveConfigRelPath
				applied := "configs/mihomo/user_configs/applied.yaml"
				inactive := "configs/mihomo/user_configs/inactive.yaml"
				for _, rel := range []string{active, applied, inactive} {
					if err := app.writeTextFileDirect(rel, issue22Providers); err != nil {
						t.Fatal(err)
					}
				}
				app.setMihomoConfigMode(mode)
				if mode == "custom" {
					app.setSetting(mihomoAppliedUserConfigKey, applied)
				}
				if operation == "startup" {
					app.applyMihomoProviderFieldsFromEffectiveConfig(&cfg)
					if err := app.ensureSetupProviderArtifacts(cfg); err != nil {
						t.Fatal(err)
					}
				} else if err := app.writeGeneratedConfigs(cfg); err != nil {
					t.Fatal(err)
				}
				targets := []string{active}
				if mode == "custom" {
					targets = append(targets, applied)
				}
				for _, rel := range targets {
					got, err := app.readTextFile(rel)
					if err != nil || !reflect.DeepEqual(issue22ProviderMap(t, got), issue22ProviderMap(t, issue22Providers)) {
						t.Fatalf("%s lost provider configuration: %v\n%s", rel, err, got)
					}
				}
				got, _ := app.readTextFile(inactive)
				if got != issue22Providers {
					t.Fatal("inactive user config changed")
				}
			})
		}
	}
}

func TestIssue22SetupEditsOnlyOwnChangedSubscriptionFields(t *testing.T) {
	old := SetupConfig{SubscriptionURLs: "airport|https://subscription.example/a"}
	next := old
	next.SubscriptionURLs = "airport|https://subscription.example/b\nnew|https://subscription.example/new"
	text, err := reconcileMihomoSetupProviders(issue22Providers, next, &old)
	if err != nil {
		t.Fatal(err)
	}
	providers := issue22ProviderMap(t, text)
	expected := issue22ProviderMap(t, issue22Providers)["airport"]
	expected["url"] = "https://subscription.example/b"
	if !reflect.DeepEqual(providers["airport"], expected) || providers["new"] == nil || providers["local-file"] == nil || providers["inline"] == nil {
		t.Fatalf("unexpected reconciliation: %#v", providers)
	}
	text, err = reconcileMihomoSetupProviders(issue22Providers, SetupConfig{}, &old)
	if err != nil {
		t.Fatal(err)
	}
	providers = issue22ProviderMap(t, text)
	if providers["airport"] != nil || providers["local-file"] == nil || providers["inline"] == nil {
		t.Fatalf("explicit removal affected custom providers: %#v", providers)
	}
	// A manually edited URL that diverges from the previous setup is protected.
	text, err = reconcileMihomoSetupProviders(strings.ReplaceAll(issue22Providers, "subscription.example/a", "subscription.example/user"), SetupConfig{}, &old)
	if err != nil || issue22ProviderMap(t, text)["airport"] == nil {
		t.Fatal("diverged user provider was deleted")
	}
}

func TestIssue22NoopStartupPreservesAnchorsAndSyncValidatesAllTargets(t *testing.T) {
	app := newTestApp(t)
	source := `proxy-providers:
  airport:
    type: http
    url: https://subscription.example/a
    health-check: &health
      url: https://health.example/a
      enable: false
x-user-health: *health
`
	applied := "configs/mihomo/user_configs/anchors.yaml"
	app.setMihomoConfigMode("custom")
	app.setSetting(mihomoAppliedUserConfigKey, applied)
	for _, rel := range []string{mihomoActiveConfigRelPath, applied} {
		if err := app.writeTextFileDirect(rel, source); err != nil {
			t.Fatal(err)
		}
	}
	cfg := SetupConfig{SubscriptionURLs: "airport|https://subscription.example/a"}
	if err := app.ensureSetupProviderArtifacts(cfg); err != nil {
		t.Fatal(err)
	}
	for _, rel := range []string{mihomoActiveConfigRelPath, applied} {
		got, _ := app.readTextFile(rel)
		if got != source {
			t.Fatal("no-op sync rewrote YAML anchors or formatting")
		}
	}
	if err := app.writeTextFileDirect(mihomoActiveConfigRelPath, issue22Providers); err != nil {
		t.Fatal(err)
	}
	// Updating just this block would break an alias in the applied file. The
	// operation must fail before either target is modified.
	cfg.SubscriptionURLs += "\nnew|https://subscription.example/new"
	if err := app.ensureSetupProviderArtifacts(cfg); err == nil {
		t.Fatal("expected validation failure for external provider-block alias")
	}
	got, _ := app.readTextFile(mihomoActiveConfigRelPath)
	if got != issue22Providers {
		t.Fatal("failed second target validation changed active config")
	}
}

func TestIssue22PanelURLSurvivesStartup(t *testing.T) {
	app := newTestApp(t)
	admin := tokenForRole(t, app, "admin")
	if err := app.writeTextFileDirect(mihomoActiveConfigRelPath, issue22Providers); err != nil {
		t.Fatal(err)
	}
	res := requestJSON(t, app, http.MethodPatch, "/api/v1/mihomo/proxy-providers/airport", admin, map[string]any{"health-check": map[string]any{"url": "https://health.example/panel"}})
	if res.Code != http.StatusOK {
		t.Fatalf("panel save: %d %s", res.Code, res.Body.String())
	}
	cfg := SetupConfig{}
	app.applyMihomoProviderFieldsFromEffectiveConfig(&cfg)
	if err := app.ensureSetupProviderArtifacts(cfg); err != nil {
		t.Fatal(err)
	}
	p := normalizeConfigProviders(app.mihomoConfigMap()["proxy-providers"])["airport"]
	if stringMapValue(mihomoMapValueMap(p["health-check"]), "url") != "https://health.example/panel" || stringMapValue(p, "filter") != "keep-me" {
		t.Fatalf("panel policy lost after startup: %#v", p)
	}
}

func TestMihomoRuntimeURLOverlayIsReversibleAndScoped(t *testing.T) {
	app := newTestApp(t)
	app.setMihomoConfigMode("custom")
	source := issue22Providers + `proxy-groups:
  - name: Inherited
    type: url-test
    url: https://health.example/template
    x-msf-test-url-mode: inherit
    interval: 90
    proxies: [DIRECT]
  - name: Explicit
    type: url-test
    url: https://health.example/group
    x-msf-test-url-mode: override
    proxies: [DIRECT]
`
	if err := app.writeTextFileDirect(mihomoActiveConfigRelPath, source); err != nil {
		t.Fatal(err)
	}
	settings := completeProxyPageSettings()
	settings["delayTestOverrideEnabled"] = true
	settings["delayTestOverrideUrl"] = "https://health.example/global"
	for _, enabled := range []bool{true, false, true} {
		settings["delayTestOverrideEnabled"] = enabled
		b, _ := json.Marshal(settings)
		app.setSetting(proxyPageSettingsKey, string(b))
		if err := app.prepareMihomoRuntimeConfig(); err != nil {
			t.Fatal(err)
		}
		text, _ := app.readTextFile(mihomoRuntimeConfigRelPath)
		var runtime map[string]any
		if err := yaml.Unmarshal([]byte(text), &runtime); err != nil {
			t.Fatal(err)
		}
		health := mihomoMapValueMap(issue22ProviderMap(t, text)["airport"]["health-check"])
		want := "https://health.example/a"
		if enabled {
			want = "https://health.example/global"
		}
		if stringMapValue(health, "url") != want || boolMapValue(health, "enable", true) || firstNumericMapValue(health, "interval") != 777 || firstNumericMapValue(health, "timeout") != 2345 {
			t.Fatalf("overlay changed non-URL fields: %#v", health)
		}
		groups := anySlice(runtime["proxy-groups"])
		inherited := mihomoMapValueMap(groups[0])
		wantInherited := "https://health.example/template"
		if enabled {
			wantInherited = "https://health.example/global"
		}
		if stringMapValue(inherited, "url") != wantInherited || stringMapValue(mihomoMapValueMap(groups[1]), "url") != "https://health.example/group" {
			t.Fatalf("group precedence violated: %#v", groups)
		}
		if strings.Contains(text, mihomoGroupTestURLModeKey) {
			t.Fatal("editor metadata leaked into runtime groups")
		}
		unchanged, _ := app.readTextFile(mihomoActiveConfigRelPath)
		if unchanged != source {
			t.Fatal("runtime overlay rewrote source")
		}
	}
	spec, err := app.Services.spec("mihomo")
	if err != nil || spec.Args[len(spec.Args)-1] != filepath.Join(app.DataDir, mihomoRuntimeConfigRelPath) {
		t.Fatalf("service does not consume rendered policy: %#v %v", spec, err)
	}
	// Settings survive a fresh App reading the same durable database.
	app2, err := New(Options{DataDir: app.DataDir, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	defer app2.Close()
	if app2.mihomoTestURLSettings().Override != "https://health.example/global" {
		t.Fatal("override did not survive App reopen")
	}
}

func TestMihomoLegacyGeneratedGroupsInheritWithoutGuessingCustomIntent(t *testing.T) {
	app := newTestApp(t)
	cfg := SetupConfig{}
	cfg.defaults()
	legacy := strings.ReplaceAll(app.renderMihomoYAML(cfg), "x-msf-test-url-mode: inherit, ", "")
	for _, mode := range []string{"generated", "custom"} {
		app.setMihomoConfigMode(mode)
		text, err := app.renderMihomoRuntimeTestPolicy(legacy, mihomoTestURLSettings{Fallback: defaultMihomoProxyTestURL, Override: "https://health.example/global"})
		if err != nil {
			t.Fatal(err)
		}
		var rendered map[string]any
		if err := yaml.Unmarshal([]byte(text), &rendered); err != nil {
			t.Fatal(err)
		}
		checked := 0
		for _, raw := range anySlice(rendered["proxy-groups"]) {
			g := mihomoMapValueMap(raw)
			if stringMapValue(g, "type") != "url-test" {
				continue
			}
			want := defaultMihomoProxyTestURL
			if mode == "generated" {
				want = "https://health.example/global"
			}
			if stringMapValue(g, "url") != want {
				t.Fatalf("legacy %s group URL = %q, want %q", mode, stringMapValue(g, "url"), want)
			}
			checked++
		}
		if checked == 0 {
			t.Fatal("test fixture has no native automatic groups")
		}
	}
}

func TestMihomoURLPolicySettingsValidationAndLegacySaves(t *testing.T) {
	app := newTestApp(t)
	admin := tokenForRole(t, app, "admin")
	path := "/api/v1/settings/proxy-page"
	settings := completeProxyPageSettings()
	settings["delayTestOverrideEnabled"] = true
	settings["delayTestOverrideUrl"] = "ftp://invalid.example/"
	if res := requestJSON(t, app, http.MethodPut, path, admin, settings); res.Code != http.StatusBadRequest {
		t.Fatal("invalid override accepted")
	}
	settings["delayTestOverrideUrl"] = "https://health.example/global"
	if res := requestJSON(t, app, http.MethodPut, path, admin, settings); res.Code != http.StatusOK {
		t.Fatalf("save failed: %s", res.Body.String())
	}
	if res := requestJSON(t, app, http.MethodPut, path, admin, completeProxyPageSettings()); res.Code != http.StatusOK {
		t.Fatalf("legacy save failed: %s", res.Body.String())
	}
	if app.mihomoTestURLSettings().Override != "https://health.example/global" {
		t.Fatal("legacy appearance save erased overlay")
	}
}

func TestGeneratedGroupTestURLOnlyEndpointPreservesStructureAndRegeneration(t *testing.T) {
	app := newTestApp(t)
	admin := tokenForRole(t, app, "admin")
	viewer := tokenForRole(t, app, "viewer")
	cfg := SetupConfig{}
	cfg.defaults()
	if err := app.writeTextFileDirect(mihomoActiveConfigRelPath, app.renderMihomoYAML(cfg)); err != nil {
		t.Fatal(err)
	}
	before := app.mihomoConfigMap()
	path := "/api/v1/mihomo/proxy-groups/AI/test-policy"
	body := map[string]any{"mode": "override", "url": "https://health.example/ai"}
	if res := requestJSON(t, app, http.MethodPut, path, viewer, body); res.Code != http.StatusForbidden {
		t.Fatal("viewer can edit generated group policy")
	}
	if res := requestJSON(t, app, http.MethodPut, path, admin, map[string]any{"mode": "override", "url": "https://health.example/ai", "type": "fallback"}); res.Code != http.StatusBadRequest {
		t.Fatal("URL-only endpoint accepted a structural change")
	}
	if res := requestJSON(t, app, http.MethodPut, path, admin, body); res.Code != http.StatusOK {
		t.Fatalf("generated policy save failed: %d %s", res.Code, res.Body.String())
	}
	if app.mihomoConfigMode() != "generated" {
		t.Fatal("URL-only change converted generated config to custom")
	}
	// All fields except the requested URL and mode remain semantically identical.
	for _, raw := range anySlice(before["proxy-groups"]) {
		g := mihomoMapValueMap(raw)
		if stringMapValue(g, "name") == "AI" {
			g["url"] = body["url"]
			g[mihomoGroupTestURLModeKey] = body["mode"]
		}
	}
	if !reflect.DeepEqual(before, app.mihomoConfigMap()) {
		t.Fatal("URL-only endpoint changed unrelated configuration")
	}
	if err := app.writeGeneratedConfigs(cfg); err != nil {
		t.Fatal(err)
	}
	_, groups, _ := app.mihomoTestPolicyData()
	if stringMapValue(groups["AI"], "url") != "https://health.example/ai" || boolMapValue(groups["AI"], "inherit", true) {
		t.Fatal("generated group exception was lost during regeneration")
	}
	if res := requestJSON(t, app, http.MethodPut, path, admin, map[string]any{"mode": "inherit"}); res.Code != http.StatusOK {
		t.Fatal("could not return generated group to inheritance")
	}
	_, groups, _ = app.mihomoTestPolicyData()
	if !boolMapValue(groups["AI"], "inherit", false) {
		t.Fatal("generated group still treated as explicit override")
	}
}

func TestMihomoURLPolicyRestartFailureRestoresSettingsAndRuntime(t *testing.T) {
	app := newTestApp(t)
	if err := app.writeTextFileDirect(mihomoActiveConfigRelPath, issue22Providers); err != nil {
		t.Fatal(err)
	}
	// The running fake core rejects only the new URL, so rollback can restart.
	installTestMihomoBinary(t, app, `
config=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-f" ]; then shift; config="$1"; break; fi
  shift
done
if grep -q 'health.example/rejected' "$config"; then echo 'policy-rejected' >&2; exit 1; fi
trap 'exit 0' TERM
while :; do sleep 1; done
`)
	if _, err := app.Services.Start(context.Background(), "mihomo"); err != nil {
		t.Fatal(err)
	}
	settings := completeProxyPageSettings()
	settings["delayTestOverrideEnabled"] = true
	settings["delayTestOverrideUrl"] = "https://health.example/rejected"
	err := app.saveProxyPageSettings(context.Background(), settings, false)
	if err == nil || !strings.Contains(err.Error(), "original policy restored") {
		t.Fatalf("expected rollback error, got %v", err)
	}
	if app.mihomoTestURLSettings().Override != "" || !app.Services.Status("mihomo").Running {
		t.Fatal("original running policy was not restored")
	}
	runtime, _ := os.ReadFile(filepath.Join(app.DataDir, mihomoRuntimeConfigRelPath))
	if strings.Contains(string(runtime), "health.example/rejected") {
		t.Fatal("rejected overlay survived rollback")
	}
}
