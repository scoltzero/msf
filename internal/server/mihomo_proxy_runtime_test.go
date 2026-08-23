package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"gopkg.in/yaml.v3"
)

func installTestMihomoBinary(t *testing.T, app *App, body string) {
	t.Helper()
	bin := filepath.Join(app.DataDir, "data/binaries/mihomo/mihomo")
	if err := os.MkdirAll(filepath.Dir(bin), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bin, []byte("#!/bin/sh\n"+body), 0755); err != nil {
		t.Fatal(err)
	}
}

func TestMihomoProxyRuntimeRoutesAndTargetedDisconnect(t *testing.T) {
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")
	var mu sync.Mutex
	var calls []string
	controller := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		calls = append(calls, r.Method+" "+r.URL.EscapedPath())
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasPrefix(r.URL.EscapedPath(), "/group/") && strings.HasSuffix(r.URL.EscapedPath(), "/delay"):
			_ = json.NewEncoder(w).Encode(map[string]any{"香港 01": 42, "香港/02": 88})
		case strings.Contains(r.URL.EscapedPath(), "/providers/proxies/") && strings.HasSuffix(r.URL.EscapedPath(), "/healthcheck"):
			if r.Method != http.MethodGet {
				t.Error("provider healthcheck must use GET")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"delay": 37})
		case strings.Contains(r.URL.EscapedPath(), "/providers/proxies/"):
			if r.Method != http.MethodPut {
				t.Error("provider update must use PUT")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"updated": true})
		case r.URL.Path == "/connections" && r.Method == http.MethodGet:
			_ = json.NewEncoder(w).Encode(map[string]any{"connections": []any{
				map[string]any{"id": "c1", "chains": []string{"Proxy", "node"}},
				map[string]any{"id": "c2", "chains": []string{"Proxy"}},
				map[string]any{"id": "c3", "chains": []string{"ProxyFoo"}},
			}})
		case r.URL.Path == "/connections/c2" && r.Method == http.MethodDelete:
			w.WriteHeader(http.StatusInternalServerError)
		case strings.HasPrefix(r.URL.Path, "/connections/") && r.Method == http.MethodDelete:
			_ = json.NewEncoder(w).Encode(map[string]any{"closed": true})
		default:
			http.NotFound(w, r)
		}
	}))
	defer controller.Close()
	app.setSetting("mihomo_controller_endpoint", controller.URL)

	group := requestJSON(t, app, http.MethodGet, "/api/v1/mihomo/proxy-groups/%E8%8A%82%2F%E7%82%B9%2F%E7%94%B2/delay?url=https%3A%2F%2Fexample.com%2F204&timeout=1000", token, nil)
	if group.Code != http.StatusOK || !strings.Contains(group.Body.String(), `"group":"节/点/甲"`) || !strings.Contains(group.Body.String(), `"香港 01":42`) {
		t.Fatalf("group delay mismatch: status=%d body=%s", group.Code, group.Body.String())
	}
	provider := requestJSON(t, app, http.MethodGet, "/api/v1/mihomo/proxy-providers/%E6%9C%BA%E5%9C%BA%2F%E7%94%B2/proxies/%E9%A6%99%E6%B8%AF%2F01/delay", token, nil)
	if provider.Code != http.StatusOK || !strings.Contains(provider.Body.String(), `"delay":37`) || !strings.Contains(provider.Body.String(), `"provider":"机场/甲"`) {
		t.Fatalf("provider delay mismatch: status=%d body=%s", provider.Code, provider.Body.String())
	}
	update := requestJSON(t, app, http.MethodPost, "/api/v1/mihomo/proxy-providers/%E6%9C%BA%E5%9C%BA%2F%E7%94%B2/update", token, nil)
	if update.Code != http.StatusOK || !strings.Contains(update.Body.String(), `"operation":"update"`) {
		t.Fatalf("provider update mismatch: status=%d body=%s", update.Code, update.Body.String())
	}
	health := requestJSON(t, app, http.MethodPost, "/api/v1/mihomo/proxy-providers/%E6%9C%BA%E5%9C%BA%2F%E7%94%B2/healthcheck", token, nil)
	if health.Code != http.StatusOK || !strings.Contains(health.Body.String(), `"operation":"healthcheck"`) {
		t.Fatalf("provider healthcheck mismatch: status=%d body=%s", health.Code, health.Body.String())
	}
	close := requestJSON(t, app, http.MethodDelete, "/api/v1/mihomo/proxies/Proxy/connections", token, nil)
	if close.Code != http.StatusOK || !strings.Contains(close.Body.String(), `"matched":2`) || !strings.Contains(close.Body.String(), `"closed":1`) || !strings.Contains(close.Body.String(), `"failed_ids":["c2"]`) {
		t.Fatalf("targeted disconnect mismatch: status=%d body=%s", close.Code, close.Body.String())
	}
	mu.Lock()
	defer mu.Unlock()
	for _, call := range calls {
		if strings.Contains(call, "/connections/c3") {
			t.Fatalf("non-matching chain was closed: calls=%v", calls)
		}
	}
}

func TestMihomoProxyConfigValidateDoesNotWrite(t *testing.T) {
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")
	before, err := app.readTextFile(mihomoActiveConfigRelPath)
	if err != nil {
		t.Fatal(err)
	}
	res := requestJSON(t, app, http.MethodPost, "/api/v1/mihomo/proxy-config/validate", token, map[string]any{
		"scope": "proxy-groups",
		"draft": []any{map[string]any{"name": "A", "type": "select", "proxies": []string{"DIRECT"}}},
	})
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"valid":true`) {
		t.Fatalf("candidate validation mismatch: status=%d body=%s", res.Code, res.Body.String())
	}
	after, err := app.readTextFile(mihomoActiveConfigRelPath)
	if err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatal("candidate validation modified active config")
	}
}

func TestMihomoCandidateValidationUsesCoreAndReturnsStdout(t *testing.T) {
	app := newTestApp(t)
	installTestMihomoBinary(t, app, "echo 'time=test level=fatal msg=Parse config error: proxy group member not found'\nexit 1\n")
	validation := app.validateMihomoCandidateContent(context.Background(), testMihomoConfigYAML("Runtime"))
	if validation.Valid || !strings.Contains(validation.Error, "proxy group member not found") {
		t.Fatalf("core validation should return stdout fatal, got %+v", validation)
	}
	matches, err := filepath.Glob(filepath.Join(app.DataDir, "data/tmp/.msf-mihomo-candidate-*.yaml"))
	if err != nil || len(matches) != 0 {
		t.Fatalf("candidate validation temp file leaked: matches=%v err=%v", matches, err)
	}
}

func TestMihomoProxyGroupWriteHonoursConfigAuthority(t *testing.T) {
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")
	generated, err := app.readTextFile(mihomoActiveConfigRelPath)
	if err != nil {
		t.Fatal(err)
	}
	denied := requestJSON(t, app, http.MethodPut, "/api/v1/mihomo/proxy-groups-config", token, map[string]any{
		"proxy-groups": []any{map[string]any{"name": "Edited", "type": "select", "proxies": []string{"DIRECT"}}},
	})
	if denied.Code != http.StatusBadRequest || !strings.Contains(denied.Body.String(), "default_config_requires_user_config") {
		t.Fatalf("generated group write should be denied: status=%d body=%s", denied.Code, denied.Body.String())
	}
	if app.mihomoConfigMode() != "generated" {
		t.Fatal("generated group rejection switched config mode")
	}
	custom := testMihomoConfigYAML("Runtime")
	if err := app.writeTextFile("configs/mihomo/user_configs/runtime.yaml", custom); err != nil {
		t.Fatal(err)
	}
	if err := app.writeTextFile(mihomoActiveConfigRelPath, custom); err != nil {
		t.Fatal(err)
	}
	app.setMihomoConfigMode("custom")
	app.setSetting(mihomoAppliedUserConfigKey, "configs/mihomo/user_configs/runtime.yaml")
	invalid := requestJSON(t, app, http.MethodPut, "/api/v1/mihomo/proxy-groups-config", token, map[string]any{
		"proxy-groups": []any{map[string]any{"name": "Expanded", "type": "select", "proxies": []string{"Provider Runtime Node"}}},
	})
	if invalid.Code != http.StatusBadRequest || !strings.Contains(invalid.Body.String(), "references unknown proxy Provider Runtime Node") {
		t.Fatalf("runtime-only member should be rejected before restart: status=%d body=%s", invalid.Code, invalid.Body.String())
	}
	if active, err := app.readTextFile(mihomoActiveConfigRelPath); err != nil || active != custom {
		t.Fatalf("invalid group write changed active config: err=%v", err)
	}
	allowed := requestJSON(t, app, http.MethodPut, "/api/v1/mihomo/proxy-groups-config", token, map[string]any{
		"proxy-groups": []any{map[string]any{"name": "Edited", "type": "select", "proxies": []string{"DIRECT"}}},
	})
	if allowed.Code != http.StatusOK || !strings.Contains(allowed.Body.String(), "Edited") {
		t.Fatalf("custom group write should pass: status=%d body=%s", allowed.Code, allowed.Body.String())
	}
	updated, err := app.readTextFile("configs/mihomo/user_configs/runtime.yaml")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(updated, "Edited") {
		t.Fatalf("applied user YAML was not synchronized: %s", updated)
	}
	if _, err := app.readTextFile(mihomoActiveConfigRelPath); err != nil {
		t.Fatal(err)
	}
	_ = generated
}

func TestMihomoProviderCollectionAndManualProxyPersistence(t *testing.T) {
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")
	put := requestJSON(t, app, http.MethodPut, "/api/v1/mihomo/proxy-providers", token, map[string]any{
		"proxy-providers": map[string]any{
			"airport": map[string]any{
				"url": "https://example.com/new.yaml",
			},
		},
	})
	if put.Code != http.StatusOK {
		t.Fatalf("provider collection save failed: status=%d body=%s", put.Code, put.Body.String())
	}
	cfg := app.mihomoConfigMap()
	provider := normalizeConfigProviders(cfg["proxy-providers"])["airport"]
	if stringMapValue(provider, "url") != "https://example.com/new.yaml" || stringMapValue(provider, "path") == "" {
		t.Fatalf("provider save did not preserve generated fields: %#v", provider)
	}
	manual := requestJSON(t, app, http.MethodPut, "/api/v1/mihomo/manual-proxies?restart=false", token, map[string]any{
		"mode":    "yaml",
		"content": "proxies:\n  - name: manual-a\n    type: socks5\n    server: 127.0.0.1\n    port: 1080\n",
	})
	if manual.Code != http.StatusOK || !strings.Contains(manual.Body.String(), "manual-a") {
		t.Fatalf("manual proxy save failed: status=%d body=%s", manual.Code, manual.Body.String())
	}
	stored, err := app.readTextFile("configs/mihomo/proxy_providers/msf_manual.yaml")
	if err != nil || !strings.Contains(stored, "manual-a") {
		t.Fatalf("manual provider file mismatch: err=%v content=%s", err, stored)
	}
	got := requestJSON(t, app, http.MethodGet, "/api/v1/mihomo/manual-proxies", token, nil)
	if got.Code != http.StatusOK || !strings.Contains(got.Body.String(), `"count":1`) {
		t.Fatalf("manual proxy get mismatch: status=%d body=%s", got.Code, got.Body.String())
	}
}

func TestNormalizeProviderRequestDefaultsBlankProxyProviderPath(t *testing.T) {
	for _, path := range []any{nil, "", "   "} {
		req := map[string]any{"type": "http", "url": "https://example.com/sub.yaml"}
		if path != nil {
			req["path"] = path
		}
		provider, err := normalizeProviderRequest("Home Lab", req, "proxy-providers")
		if err != nil {
			t.Fatal(err)
		}
		if got := stringMapValue(provider, "path"); got != "./proxy_providers/home-lab.yaml" {
			t.Fatalf("blank path %q normalized to %q", path, got)
		}
	}
}

func TestMihomoProviderPatchPreservesUnexposedFields(t *testing.T) {
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")
	cfg := app.mihomoConfigMap()
	cfg["proxy-providers"] = map[string]any{
		"airport": map[string]any{
			"type": "http", "url": "https://example.com/old.yaml", "path": "./proxy_providers/airport.yaml",
			"filter": "keep-me", "exclude-filter": "also-keep", "health-check": map[string]any{"enable": true, "url": "https://health.example/old"},
		},
	}
	if err := app.writeTextFile(mihomoActiveConfigRelPath, mustMarshalMihomoYAML(t, cfg)); err != nil {
		t.Fatal(err)
	}
	patch := requestJSON(t, app, http.MethodPatch, "/api/v1/mihomo/proxy-providers/airport", token, map[string]any{
		"health-check": map[string]any{"url": "https://health.example/new"},
	})
	if patch.Code != http.StatusOK {
		t.Fatalf("provider patch failed: status=%d body=%s", patch.Code, patch.Body.String())
	}
	updated := app.mihomoConfigMap()
	provider := normalizeConfigProviders(updated["proxy-providers"])["airport"]
	if stringMapValue(provider, "filter") != "keep-me" || stringMapValue(provider, "exclude-filter") != "also-keep" {
		t.Fatalf("provider unknown fields were dropped: %#v", provider)
	}
	health := mihomoMapValueMap(provider["health-check"])
	if stringMapValue(health, "url") != "https://health.example/new" || !boolMapValue(health, "enable", false) {
		t.Fatalf("provider health-check fields were not merged: %#v", health)
	}
}

func mustMarshalMihomoYAML(t *testing.T, value any) string {
	t.Helper()
	b, err := yaml.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
