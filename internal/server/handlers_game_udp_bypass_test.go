package server

import (
	"net/http"
	"strings"
	"testing"
)

// PUT /settings 必须走 setSetting：game_udp_bypass_ports 的 nft 渲染只读内存
// 缓存，直写 DB 会导致面板保存的端口在下次重启前不生效（本次修复的回归锚）。
func TestSettingsPutUpdatesGameUDPBypassCache(t *testing.T) {
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")

	if cached := app.cachedGameUDPBypassPorts(); cached != "" {
		t.Fatalf("initial cache = %q, want empty", cached)
	}

	res := requestJSON(t, app, http.MethodPut, "/api/v1/settings", token, map[string]any{
		"network.game_udp_bypass_ports": "22101, 9999",
	})
	if res.Code != http.StatusOK {
		t.Fatalf("put settings status=%d body=%s", res.Code, res.Body.String())
	}
	if cached := app.cachedGameUDPBypassPorts(); !strings.Contains(cached, "9999") {
		t.Fatalf("cache not refreshed after put: %q", cached)
	}
	if stored := app.setting("network.game_udp_bypass_ports", ""); !strings.Contains(stored, "9999") {
		t.Fatalf("setting not persisted: %q", stored)
	}
	if rendered := app.gameUDPBypassPorts(); !strings.Contains(rendered, "9999") {
		t.Fatalf("renderer did not pick up new ports: %q", rendered)
	}
}
