package server

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// forward 迁移后 secret 字段不再绑定 aliapi 协议，但 redact/merge 机制保留：
// 任意上游条目携带 access_key_secret 时都不得经 API 泄露，编辑器回传
// access_key_secret_set 标记时可恢复已存密钥。
func TestMosDNSUpstreamOverridesProtectAndPreserveSecret(t *testing.T) {
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")
	initial := map[string]any{
		"domestic": []any{
			map[string]any{
				"tag": "private-upstream", "enabled": true, "protocol": "https",
				"addr": "https://223.5.5.5/dns-query", "access_key_secret": "secret-1",
			},
		},
	}
	res := requestJSON(t, app, http.MethodPost, "/api/v1/mosdns/system/upstream-overrides", token, initial)
	if res.Code != http.StatusOK {
		t.Fatalf("save upstream status=%d body=%s", res.Code, res.Body.String())
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

// forward 插件不支持 aliapi 专用条目：整组只有 aliapi 时保存必须被明确拒绝，
// 引导用户改用 udp/tcp/tls/https。
func TestMosDNSUpstreamOverridesRejectALIAPIOnlyGroup(t *testing.T) {
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")
	item := map[string]any{
		"tag": "private-alidns", "enabled": true, "protocol": "aliapi",
		"account_id": "account-1", "access_key_id": "key-1", "access_key_secret": "secret-1",
		"server_addr": "223.5.5.5", "ecs_client_mask": 32,
	}
	res := requestJSON(t, app, http.MethodPost, "/api/v1/mosdns/system/upstream-overrides", token, map[string]any{"domestic": []any{item}})
	if res.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
	if !strings.Contains(res.Body.String(), "no longer supported") {
		t.Fatalf("rejection message should explain aliapi removal: %s", res.Body.String())
	}
}
