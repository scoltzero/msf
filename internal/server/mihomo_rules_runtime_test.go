package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestNormalizeMihomoRulesPreservesRuntimeIdentityAndStats(t *testing.T) {
	rows := normalizeMihomoRules([]any{
		map[string]any{
			"id": "rule-a", "uuid": "uuid-a", "index": 7, "type": "RuleSet", "payload": "ai", "proxy": "人工智能", "disabled": true, "size": 12,
			"extra": map[string]any{"hit_count": 3, "missCount": 4, "lastHitAt": "2026-08-09T01:02:03Z", "miss_at": "2026-08-09T01:02:04Z"},
		},
		map[string]any{"rule_id": "rule-b", "position": 8, "ruleType": "DomainSuffix", "rulePayload": "example.com", "adapter": "DIRECT", "enabled": false, "stats": map[string]any{"hits": 9}},
	})
	if len(rows) != 2 {
		t.Fatalf("rows=%#v", rows)
	}
	first, second := rows[0], rows[1]
	if stringMapValue(first, "id") != "rule-a" || stringMapValue(first, "uuid") != "uuid-a" || intAny(first["index"], 0) != 7 {
		t.Fatalf("first identity not preserved: %#v", first)
	}
	if stringMapValue(first, "type") != "RuleSet" || !boolMapValue(first, "disabled", false) || numericMapValue(first, "size") != 12 {
		t.Fatalf("first runtime fields not preserved: %#v", first)
	}
	if numericMapValue(first, "hit_count") != 3 || numericMapValue(first, "miss_count") != 4 || stringMapValue(first, "hit_at") == "" || stringMapValue(first, "miss_at") == "" {
		t.Fatalf("first stats not normalized: %#v", first)
	}
	if stringMapValue(second, "id") != "rule-b" || intAny(second["index"], 0) != 8 || stringMapValue(second, "type") != "DomainSuffix" || !boolMapValue(second, "disabled", false) || numericMapValue(second, "hit_count") != 9 {
		t.Fatalf("second compatibility fields not normalized: %#v", second)
	}
}

func TestMihomoRulesRuntimeKeepsControllerOrderAndAvailability(t *testing.T) {
	app := newTestApp(t)
	defer app.Close()
	controller := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/rules" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"rules": []any{
			map[string]any{"id": "first", "index": 1, "type": "DomainSuffix", "payload": "one"},
			map[string]any{"id": "last", "index": 62, "type": "MATCH", "payload": ""},
		}})
	}))
	defer controller.Close()
	app.setSetting("mihomo_controller_endpoint", controller.URL)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/mihomo/rules?search=", nil)
	payload := app.mihomoRulesRuntime(request)
	items := anyMapSlice(payload["items"])
	if !boolMapValue(payload, "available", false) || len(items) != 2 || stringMapValue(items[0], "id") != "first" || stringMapValue(items[1], "id") != "last" {
		t.Fatalf("controller order changed: %#v", payload)
	}
	filtered := app.mihomoRulesRuntime(httptest.NewRequest(http.MethodGet, "/api/v1/mihomo/rules?search=match&page=1&page_size=1&sort=id", nil))
	filteredItems := anyMapSlice(filtered["items"])
	if len(filteredItems) != 1 || intAny(filteredItems[0]["index"], 0) != 62 {
		t.Fatalf("filter/pagination must retain original index: %#v", filtered)
	}
	empty := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"rules": []any{}})
	}))
	defer empty.Close()
	app.setSetting("mihomo_controller_endpoint", empty.URL)
	availableEmpty := app.mihomoRulesRuntime(nil)
	if !boolMapValue(availableEmpty, "available", false) || intAny(availableEmpty["total"], -1) != 0 {
		t.Fatalf("empty controller response should remain available: %#v", availableEmpty)
	}
	app.setSetting("mihomo_controller_endpoint", "http://127.0.0.1:1")
	unavailable := app.mihomoRulesRuntime(nil)
	if boolMapValue(unavailable, "available", true) || stringMapValue(unavailable, "error") != "controller_unavailable" {
		t.Fatalf("controller failure must not look like empty rules: %#v", unavailable)
	}
}

func TestMihomoRuleCapabilitiesProbeAcrossControllerGenerations(t *testing.T) {
	old := mihomoRuleCapabilities(map[string]any{"rules": []any{
		map[string]any{"type": "DomainSuffix", "payload": "example.com"},
	}}, normalizeMihomoRules([]any{map[string]any{"type": "DomainSuffix", "payload": "example.com"}}), true)
	if !boolMapValue(old, "rule_toggle", false) {
		t.Fatalf("live legacy rule response should expose the runtime toggle probe: %#v", old)
	}
	modernRaw := map[string]any{"rules": []any{
		map[string]any{"id": "r1", "uuid": "u1", "type": "DomainSuffix", "payload": "example.com", "disabled": false},
	}}
	modern := mihomoRuleCapabilities(modernRaw, normalizeMihomoRules(mihomoRulesFromControllerRaw(modernRaw)), true)
	if !boolMapValue(modern, "rule_toggle", false) {
		t.Fatalf("modern id/disabled response should infer toggle support: %#v", modern)
	}
	explicit := mihomoRuleCapabilities(map[string]any{"capabilities": map[string]any{"rule_toggle": true}, "rules": []any{}}, nil, true)
	if !boolMapValue(explicit, "rule_toggle", false) {
		t.Fatalf("explicit capability should take priority: %#v", explicit)
	}
	explicitFalse := mihomoRuleCapabilities(map[string]any{"capabilities": map[string]any{"rule_toggle": false}, "rules": []any{map[string]any{"type": "MATCH"}}}, nil, true)
	if boolMapValue(explicitFalse, "rule_toggle", true) {
		t.Fatalf("explicit unsupported capability should take priority: %#v", explicitFalse)
	}
}

func TestMihomoRulePatchDoesNotReadConnectionsByDefault(t *testing.T) {
	app := newTestApp(t)
	defer app.Close()
	var mu sync.Mutex
	var paths []string
	controller := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		paths = append(paths, r.Method+" "+r.URL.EscapedPath())
		mu.Unlock()
		if r.Method == http.MethodPatch && r.URL.Path == "/rules/rule-1" {
			_ = json.NewEncoder(w).Encode(map[string]any{"disabled": true})
			return
		}
		http.NotFound(w, r)
	}))
	defer controller.Close()
	app.setSetting("mihomo_controller_endpoint", controller.URL)
	result, err := app.patchMihomoRuleRuntime(nil, "rule-1", "", -1, true, false, "", "")
	if err != nil || boolMapValue(result.Data, "disabled", false) != true {
		t.Fatalf("runtime patch failed: result=%#v err=%v", result, err)
	}
	mu.Lock()
	defer mu.Unlock()
	for _, path := range paths {
		if strings.Contains(path, "/connections") {
			t.Fatalf("default patch must not read connections: %v", paths)
		}
	}
}

func TestMihomoRulePatchUsesZashboardCompatibleAdapters(t *testing.T) {
	tests := []struct {
		name          string
		id            string
		uuid          string
		index         int
		wantMethod    string
		wantPath      string
		wantBody      map[string]any
		wantEmptyBody bool
	}{
		{
			name:          "native uuid uses empty put",
			id:            "rule-uuid",
			uuid:          "uuid-a",
			index:         7,
			wantMethod:    http.MethodPut,
			wantPath:      "/rules/uuid-a",
			wantEmptyBody: true,
		},
		{
			name:       "legacy index uses disable map",
			id:         "rule-index",
			index:      22,
			wantMethod: http.MethodPatch,
			wantPath:   "/rules/disable",
			wantBody:   map[string]any{"22": true},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			controller := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != test.wantMethod || r.URL.Path != test.wantPath {
					http.NotFound(w, r)
					return
				}
				if test.wantEmptyBody {
					if r.ContentLength > 0 {
						t.Fatalf("UUID adapter must send an empty body, content length=%d", r.ContentLength)
					}
				} else {
					var body map[string]any
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Fatalf("decode adapter body: %v", err)
					}
					if len(body) != len(test.wantBody) {
						t.Fatalf("adapter body=%#v want=%#v", body, test.wantBody)
					}
					for key, want := range test.wantBody {
						if body[key] != want {
							t.Fatalf("adapter body=%#v want=%#v", body, test.wantBody)
						}
					}
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"disabled": true})
			}))
			defer controller.Close()
			app := newTestApp(t)
			defer app.Close()
			app.setSetting("mihomo_controller_endpoint", controller.URL)
			result, err := app.patchMihomoRuleRuntime(nil, test.id, test.uuid, test.index, true, false, "", "")
			if err != nil || !boolMapValue(result.Data, "disabled", false) {
				t.Fatalf("runtime adapter failed: result=%#v err=%v", result, err)
			}
		})
	}
}

func TestMihomoRulePatchExactDisconnectAndUnsupportedCapability(t *testing.T) {
	app := newTestApp(t)
	defer app.Close()
	var mu sync.Mutex
	var calls []string
	controller := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		calls = append(calls, r.Method+" "+r.URL.EscapedPath())
		mu.Unlock()
		switch {
		case r.Method == http.MethodPatch && r.URL.Path == "/rules/rule-1":
			_ = json.NewEncoder(w).Encode(map[string]any{"disabled": true})
		case r.Method == http.MethodGet && r.URL.Path == "/connections":
			_ = json.NewEncoder(w).Encode(map[string]any{"connections": []any{
				map[string]any{"id": "c1", "rule": "RuleSet", "rulePayload": "ai"},
				map[string]any{"id": "c2", "rule_type": "RuleSet", "rule_payload": "ai"},
				map[string]any{"id": "c3", "rule": "RuleSet", "rulePayload": "a"},
			}})
		case r.Method == http.MethodDelete && r.URL.Path == "/connections/c2":
			http.Error(w, "failure", http.StatusInternalServerError)
		case r.Method == http.MethodDelete && r.URL.Path == "/connections/c1":
			_ = json.NewEncoder(w).Encode(map[string]any{"closed": true})
		default:
			http.NotFound(w, r)
		}
	}))
	defer controller.Close()
	app.setSetting("mihomo_controller_endpoint", controller.URL)
	result, err := app.patchMihomoRuleRuntime(nil, "rule-1", "", -1, true, true, "RuleSet", "ai")
	if err != nil {
		t.Fatalf("exact disconnect patch failed: %v", err)
	}
	disconnect, _ := result.Data["disconnect"].(map[string]any)
	if intAny(disconnect["matched"], 0) != 2 || intAny(disconnect["closed"], 0) != 1 {
		t.Fatalf("exact disconnect counts mismatch: %#v", disconnect)
	}
	failed := stringSlice(disconnect["failed_ids"])
	if len(failed) != 1 || failed[0] != "c2" {
		t.Fatalf("partial failure mismatch: %#v", disconnect)
	}
	mu.Lock()
	for _, call := range calls {
		if call == "GET /rules" {
			t.Fatalf("supplied rule identity should avoid a redundant rules read: %v", calls)
		}
		if strings.Contains(call, "/connections/c3") {
			t.Fatalf("nonmatching connection was closed: %v", calls)
		}
	}
	mu.Unlock()

	unsupported := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "unsupported", http.StatusNotFound)
	}))
	defer unsupported.Close()
	app.setSetting("mihomo_controller_endpoint", unsupported.URL)
	failedResult, failedErr := app.patchMihomoRuleRuntime(nil, "rule-1", "", -1, true, false, "", "")
	if failedErr == nil || !failedResult.Unsupported || failedResult.ErrorCode != "rule_toggle_unsupported" {
		t.Fatalf("unsupported controller response mismatch: result=%#v err=%v", failedResult, failedErr)
	}
}

func TestMihomoRuleProviderUpdateUsesEscapedSinglePathAndStaleCache(t *testing.T) {
	app := newTestApp(t)
	defer app.Close()
	var mu sync.Mutex
	var calls []string
	controller := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		calls = append(calls, r.Method+" "+r.URL.EscapedPath())
		mu.Unlock()
		if r.URL.Path == "/providers/rules" && r.Method == http.MethodGet {
			_ = json.NewEncoder(w).Encode(map[string]any{"providers": map[string]any{
				"机场/规则": map[string]any{"name": "机场/规则", "vehicleType": "HTTP", "size": 99, "ruleCount": 12, "updatedAt": "old"},
			}})
			return
		}
		if r.URL.Path == "/providers/rules/机场/规则" && r.Method == http.MethodPut {
			_ = json.NewEncoder(w).Encode(map[string]any{"updated": true})
			return
		}
		if r.URL.Path == "/providers/rules/机场/规则" && r.Method == http.MethodGet {
			_ = json.NewEncoder(w).Encode(map[string]any{"name": "机场/规则", "vehicleType": "HTTP", "size": 101, "ruleCount": 13, "updatedAt": "new", "rules": []any{"x"}})
			return
		}
		http.NotFound(w, r)
	}))
	defer controller.Close()
	app.setSetting("mihomo_controller_endpoint", controller.URL)
	result := app.updateMihomoRuleProviderRuntime("机场/规则")
	if !result.Success || intAny(result.Data["size"], 0) != 101 || intAny(result.Data["rule_count"], 0) != 13 {
		t.Fatalf("single provider update mismatch: %#v", result)
	}
	mu.Lock()
	if len(calls) == 0 || !strings.Contains(strings.Join(calls, "\n"), "/providers/rules/%E6%9C%BA%E5%9C%BA%2F%E8%A7%84%E5%88%99") {
		t.Fatalf("provider path was not escaped: %v", calls)
	}
	mu.Unlock()
	if err := validateMihomoProviderName(".."); err == nil {
		t.Fatal("path traversal provider name should be rejected")
	}
}
