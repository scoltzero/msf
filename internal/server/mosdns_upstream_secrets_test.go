package server

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMosDNSUpstreamOverridesProtectAndPreserveALIAPISecret(t *testing.T) {
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")
	initial := map[string]any{
		"domestic": []any{map[string]any{
			"tag": "private-alidns", "enabled": true, "protocol": "aliapi",
			"account_id": "account-1", "access_key_id": "key-1", "access_key_secret": "secret-1",
			"server_addr": "223.5.5.5", "ecs_client_mask": 32,
		}},
	}
	res := requestJSON(t, app, http.MethodPost, "/api/v1/mosdns/system/upstream-overrides", token, initial)
	if res.Code != http.StatusOK {
		t.Fatalf("save aliapi upstream status=%d body=%s", res.Code, res.Body.String())
	}
	if strings.Contains(res.Body.String(), "secret-1") || !strings.Contains(res.Body.String(), `"access_key_secret_set":true`) {
		t.Fatalf("save response exposed or failed to mark secret: %s", res.Body.String())
	}

	get := requestJSON(t, app, http.MethodGet, "/api/v1/mosdns/system/upstream-overrides", token, nil)
	if get.Code != http.StatusOK || strings.Contains(get.Body.String(), "secret-1") || !strings.Contains(get.Body.String(), `"access_key_secret_set":true`) {
		t.Fatalf("get response exposed or failed to mark secret: status=%d body=%s", get.Code, get.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(get.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	redacted := payload["data"].(map[string]any)
	update := requestJSON(t, app, http.MethodPost, "/api/v1/mosdns/system/upstream-overrides", token, redacted)
	if update.Code != http.StatusOK {
		t.Fatalf("preserve secret update status=%d body=%s", update.Code, update.Body.String())
	}
	stored := app.jsonSetting("mosdns_upstream_overrides", nil)
	storedRoot := stored.(map[string]any)
	item := storedRoot["domestic"].([]any)[0].(map[string]any)
	if item["access_key_secret"] != "secret-1" {
		t.Fatalf("secret was not preserved: %#v", item)
	}
	if _, exists := item[mosDNSAccessKeySecretSetField]; exists {
		t.Fatalf("redaction marker must not be persisted: %#v", item)
	}

	path := filepath.Join(app.DataDir, "configs/mosdns/upstream_overrides.json")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("upstream credential file mode=%#o, want 0600", info.Mode().Perm())
	}
}

func TestMosDNSUpstreamOverridesRejectInvalidALIAPI(t *testing.T) {
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")
	tests := []struct {
		name  string
		patch map[string]any
	}{
		{name: "missing secret", patch: map[string]any{"access_key_secret": ""}},
		{name: "invalid mask", patch: map[string]any{"ecs_client_mask": 129}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			item := map[string]any{
				"tag": "private-alidns", "enabled": true, "protocol": "aliapi",
				"account_id": "account-1", "access_key_id": "key-1", "access_key_secret": "secret-1",
				"server_addr": "223.5.5.5", "ecs_client_mask": 32,
			}
			for key, value := range test.patch {
				item[key] = value
			}
			res := requestJSON(t, app, http.MethodPost, "/api/v1/mosdns/system/upstream-overrides", token, map[string]any{"domestic": []any{item}})
			if res.Code != http.StatusBadRequest {
				t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
			}
		})
	}
}
