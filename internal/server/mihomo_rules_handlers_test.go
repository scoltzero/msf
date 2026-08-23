package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestMihomoRulesConfigGeneratedRoutesAreReadOnly(t *testing.T) {
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")

	get := requestJSON(t, app, http.MethodGet, "/api/v1/mihomo/rules-config", token, nil)
	if get.Code != http.StatusOK {
		t.Fatalf("generated rules config GET failed: status=%d body=%s", get.Code, get.Body.String())
	}
	var getBody map[string]any
	if err := json.Unmarshal(get.Body.Bytes(), &getBody); err != nil {
		t.Fatal(err)
	}
	data, ok := getBody["data"].(map[string]any)
	if !ok {
		t.Fatalf("generated GET missing data: %s", get.Body.String())
	}
	if data["read_only"] != true || data["can_edit_rules"] != false || data["can_edit_rule_providers"] != false {
		t.Fatalf("generated authority flags mismatch: %#v", data)
	}
	if data["source"] != mihomoActiveConfigRelPath || data["rules"] == nil {
		t.Fatalf("generated GET should expose generated YAML source/rules: %#v", data)
	}

	before, err := app.readTextFile(mihomoActiveConfigRelPath)
	if err != nil {
		t.Fatal(err)
	}
	put := requestJSON(t, app, http.MethodPut, "/api/v1/mihomo/rules-config", token, map[string]any{
		"rules": []any{"MATCH,DIRECT"},
	})
	if put.Code != http.StatusBadRequest || !strings.Contains(put.Body.String(), "default_config_requires_user_config") {
		t.Fatalf("generated rules config PUT should be rejected: status=%d body=%s", put.Code, put.Body.String())
	}
	after, err := app.readTextFile(mihomoActiveConfigRelPath)
	if err != nil {
		t.Fatal(err)
	}
	if before != after || app.mihomoConfigMode() != "generated" {
		t.Fatal("generated rules PUT changed config or mode")
	}
}

func TestMihomoRulesConfigCustomPutUsesAppliedAuthorityAndSyncsRuntime(t *testing.T) {
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")
	content := testMihomoConfigYAML("DIRECT") + `
rule-providers: {}
other-section:
  preserve: true
`
	const userRel = "configs/mihomo/user_configs/route-rules.yaml"
	if err := app.writeTextFile(userRel, content); err != nil {
		t.Fatal(err)
	}
	if err := app.writeTextFile(mihomoActiveConfigRelPath, content); err != nil {
		t.Fatal(err)
	}
	app.setMihomoConfigMode("custom")
	app.setSetting(mihomoAppliedUserConfigKey, userRel)

	put := requestJSON(t, app, http.MethodPut, "/api/v1/mihomo/rules-config", token, map[string]any{
		"rules": "  DOMAIN-SUFFIX,Example.COM,DIRECT  \n\nMATCH,DIRECT\n",
	})
	if put.Code != http.StatusOK || !strings.Contains(put.Body.String(), `"success":true`) {
		t.Fatalf("custom rules config PUT failed: status=%d body=%s", put.Code, put.Body.String())
	}
	user, err := app.readTextFile(userRel)
	if err != nil {
		t.Fatal(err)
	}
	runtime, err := app.readTextFile(mihomoActiveConfigRelPath)
	if err != nil {
		t.Fatal(err)
	}
	if !mihomoRulesSectionsEqual(user, runtime) {
		t.Fatalf("applied/runtime rule sections diverged:\nuser=%s\nruntime=%s", user, runtime)
	}
	for _, stored := range []string{user, runtime} {
		var cfg map[string]any
		if err := yaml.Unmarshal([]byte(stored), &cfg); err != nil {
			t.Fatal(err)
		}
		rules := anySlice(cfg["rules"])
		if len(rules) != 2 || rules[0] != "  DOMAIN-SUFFIX,Example.COM,DIRECT  " || rules[1] != "MATCH,DIRECT" {
			t.Fatalf("rules text was not preserved/blank lines not removed: %#v", rules)
		}
		if stringMapValue(mihomoRulesStringMap(cfg["other-section"]), "preserve") != "true" {
			t.Fatalf("non-target section was not retained: %#v", cfg["other-section"])
		}
	}
}

func TestMihomoRulesConfigValidateRouteDoesNotWriteAndRejectsAnchors(t *testing.T) {
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")
	content := testMihomoConfigYAML("DIRECT") + `
rule-providers:
  defaults: &provider_defaults
    type: http
    url: https://example.com/rules.yaml
  anchored:
    <<: *provider_defaults
`
	const userRel = "configs/mihomo/user_configs/anchored-route.yaml"
	if err := app.writeTextFile(userRel, content); err != nil {
		t.Fatal(err)
	}
	if err := app.writeTextFile(mihomoActiveConfigRelPath, content); err != nil {
		t.Fatal(err)
	}
	app.setMihomoConfigMode("custom")
	app.setSetting(mihomoAppliedUserConfigKey, userRel)
	beforeUser, err := app.readTextFile(userRel)
	if err != nil {
		t.Fatal(err)
	}
	beforeRuntime, err := app.readTextFile(mihomoActiveConfigRelPath)
	if err != nil {
		t.Fatal(err)
	}

	validate := requestJSON(t, app, http.MethodPost, "/api/v1/mihomo/proxy-config/validate", token, map[string]any{
		"scope": "rules",
		"rules": []any{"MATCH,DIRECT"},
	})
	if validate.Code != http.StatusOK || !strings.Contains(validate.Body.String(), `"valid":false`) || !strings.Contains(validate.Body.String(), "rules_config_yaml_anchors") {
		t.Fatalf("rules validation should reject structured anchor draft: status=%d body=%s", validate.Code, validate.Body.String())
	}
	afterUser, err := app.readTextFile(userRel)
	if err != nil {
		t.Fatal(err)
	}
	afterRuntime, err := app.readTextFile(mihomoActiveConfigRelPath)
	if err != nil {
		t.Fatal(err)
	}
	if beforeUser != afterUser || beforeRuntime != afterRuntime {
		t.Fatal("rules validation route modified configuration")
	}
}

func TestMihomoRulePatchRouteReachesController(t *testing.T) {
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")
	var calls []string
	controller := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.Method+" "+r.URL.Path)
		if r.Method != http.MethodPatch || r.URL.Path != "/rules/rule-1" {
			http.NotFound(w, r)
			return
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body["disabled"] != true {
			http.Error(w, "bad patch", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"disabled": true})
	}))
	defer controller.Close()
	app.setSetting("mihomo_controller_endpoint", controller.URL)

	patch := requestJSON(t, app, http.MethodPatch, "/api/v1/mihomo/rules/rule-1", token, map[string]any{"disabled": true})
	if patch.Code != http.StatusOK || !strings.Contains(patch.Body.String(), `"success":true`) || !strings.Contains(patch.Body.String(), `"disabled":true`) {
		t.Fatalf("rule PATCH route/controller adapter failed: status=%d body=%s calls=%v", patch.Code, patch.Body.String(), calls)
	}
	if !reflect.DeepEqual(calls, []string{"PATCH /rules/rule-1"}) {
		t.Fatalf("default PATCH should not request connections: calls=%v", calls)
	}
}
