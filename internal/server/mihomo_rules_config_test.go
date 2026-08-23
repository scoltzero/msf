package server

import (
	"context"
	"reflect"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestMihomoRulesConfigGeneratedModeIsReadOnly(t *testing.T) {
	app := newTestApp(t)
	before, err := app.readTextFile(mihomoActiveConfigRelPath)
	if err != nil {
		t.Fatal(err)
	}
	result, err := app.saveMihomoRulesConfig(context.Background(), map[string]any{
		"rules": []any{"MATCH,DIRECT"},
	}, "test")
	if err == nil || result != nil || mihomoRulesConfigErrorCode(err) != "default_config_requires_user_config" {
		t.Fatalf("generated rules save should be rejected: result=%#v err=%v code=%q", result, err, mihomoRulesConfigErrorCode(err))
	}
	after, readErr := app.readTextFile(mihomoActiveConfigRelPath)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if before != after || app.mihomoConfigMode() != "generated" {
		t.Fatal("generated rules rejection changed config or mode")
	}
}

func TestMihomoRulesConfigCustomSaveSynchronizesBothFiles(t *testing.T) {
	app := newTestApp(t)
	content := testMihomoConfigYAML("DIRECT") + `
rule-providers:
  keep:
    type: http
    url: https://example.com/rules.yaml
    path: ./rules/keep.yaml
    behavior: domain
    format: yaml
    interval: 3600
    filter: preserve-me
    health-check:
      enable: true
      url: https://health.example/old
other-section:
  untouched:
    - one
`
	if err := app.writeTextFile("configs/mihomo/user_configs/rules.yaml", content); err != nil {
		t.Fatal(err)
	}
	if err := app.writeTextFile(mihomoActiveConfigRelPath, content); err != nil {
		t.Fatal(err)
	}
	app.setMihomoConfigMode("custom")
	app.setSetting(mihomoAppliedUserConfigKey, "configs/mihomo/user_configs/rules.yaml")

	result, err := app.saveMihomoRulesConfig(context.Background(), map[string]any{
		"rules": "  DOMAIN-SUFFIX,Example.COM, DIRECT  \n\nRULE-SET,keep,DIRECT\n",
		"rule-providers": map[string]any{
			"keep": map[string]any{
				"health-check": map[string]any{"url": "https://health.example/new"},
			},
		},
	}, "test")
	if err != nil {
		t.Fatalf("custom rules save failed: %v", err)
	}
	if result == nil || result["files_consistent"] != true {
		t.Fatalf("save result should report consistent files: %#v", result)
	}
	user, err := app.readTextFile("configs/mihomo/user_configs/rules.yaml")
	if err != nil {
		t.Fatal(err)
	}
	runtime, err := app.readTextFile(mihomoActiveConfigRelPath)
	if err != nil {
		t.Fatal(err)
	}
	if !mihomoRulesSectionsEqual(user, runtime) {
		t.Fatalf("target sections diverged:\nuser=%s\nruntime=%s", user, runtime)
	}
	if !strings.Contains(user, "DOMAIN-SUFFIX,Example.COM, DIRECT  ") || strings.Contains(user, "- ''") {
		t.Fatalf("rules should preserve non-empty text and remove only blank lines:\n%s", user)
	}
	if !strings.Contains(user, "untouched:") || !strings.Contains(user, "- one") {
		t.Fatalf("non-target sections were not preserved:\n%s", user)
	}
	var cfg map[string]any
	if err := yaml.Unmarshal([]byte(user), &cfg); err != nil {
		t.Fatal(err)
	}
	providers := mihomoRulesStringMap(cfg["rule-providers"])
	keep := mihomoRulesStringMap(providers["keep"])
	if stringMapValue(keep, "filter") != "preserve-me" || stringMapValue(mihomoRulesStringMap(keep["health-check"]), "url") != "https://health.example/new" {
		t.Fatalf("provider deep merge dropped unknown/nested fields: %#v", keep)
	}
}

func TestMihomoRulesConfigStructuredSaveRejectsAnchors(t *testing.T) {
	app := newTestApp(t)
	content := testMihomoConfigYAML("DIRECT") + `
rule-providers:
  defaults: &provider_defaults
    type: http
    url: https://example.com/rules.yaml
  anchored:
    <<: *provider_defaults
`
	if err := app.writeTextFile("configs/mihomo/user_configs/anchored.yaml", content); err != nil {
		t.Fatal(err)
	}
	if err := app.writeTextFile(mihomoActiveConfigRelPath, content); err != nil {
		t.Fatal(err)
	}
	app.setMihomoConfigMode("custom")
	app.setSetting(mihomoAppliedUserConfigKey, "configs/mihomo/user_configs/anchored.yaml")
	before, err := app.readTextFile(mihomoActiveConfigRelPath)
	if err != nil {
		t.Fatal(err)
	}
	_, err = app.saveMihomoRulesConfig(context.Background(), map[string]any{"rules": []any{"MATCH,DIRECT"}}, "test")
	if err == nil || mihomoRulesConfigErrorCode(err) != "rules_config_yaml_anchors" {
		t.Fatalf("structured anchor save should fail safely: err=%v code=%q", err, mihomoRulesConfigErrorCode(err))
	}
	after, err := app.readTextFile(mihomoActiveConfigRelPath)
	if err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatal("anchor rejection modified runtime config")
	}
}

func TestMihomoRulesConfigAdvancedYAMLPreservesAnchorSemantics(t *testing.T) {
	app := newTestApp(t)
	base := testMihomoConfigYAML("DIRECT")
	initial := base + "\nrule-providers: {}\n"
	if err := app.writeTextFile("configs/mihomo/user_configs/advanced.yaml", initial); err != nil {
		t.Fatal(err)
	}
	if err := app.writeTextFile(mihomoActiveConfigRelPath, base); err != nil {
		t.Fatal(err)
	}
	app.setMihomoConfigMode("custom")
	app.setSetting(mihomoAppliedUserConfigKey, "configs/mihomo/user_configs/advanced.yaml")
	advanced := base + `
rule-providers:
  defaults: &provider_defaults
    type: http
    url: https://example.com/rules.yaml
  anchored:
    <<: *provider_defaults
`
	_, err := app.saveMihomoRulesConfig(context.Background(), map[string]any{
		"yaml_mode": true,
		"content":   advanced,
	}, "test")
	if err != nil {
		t.Fatalf("advanced YAML save should retain anchor semantics: %v", err)
	}
	stored, err := app.readTextFile(mihomoActiveConfigRelPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(stored, "&provider_defaults") || !strings.Contains(stored, "<<: *provider_defaults") {
		t.Fatalf("advanced YAML anchor/merge was not preserved:\n%s", stored)
	}
	var cfg map[string]any
	if err := yaml.Unmarshal([]byte(stored), &cfg); err != nil {
		t.Fatal(err)
	}
	providers := mihomoRulesStringMap(cfg["rule-providers"])
	if !reflect.DeepEqual(mihomoRulesStringMap(providers["defaults"]), mihomoRulesStringMap(providers["anchored"])) {
		t.Fatalf("merged provider semantics changed: %#v", providers)
	}
}
