package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMosDNSTrafficEndpointsProxyLocalAgent(t *testing.T) {
	agent := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/traffic/status":
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "interface": "eth0"})
		case "/api/traffic/client":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"ip": r.URL.Query().Get("ip")}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer agent.Close()
	previous := mosDNSTrafficAgentURL
	mosDNSTrafficAgentURL = agent.URL
	t.Cleanup(func() { mosDNSTrafficAgentURL = previous })

	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")
	status := requestJSON(t, app, http.MethodGet, "/api/v1/mosdns/traffic/status", token, nil)
	if status.Code != http.StatusOK || !strings.Contains(status.Body.String(), `"interface":"eth0"`) {
		t.Fatalf("traffic status mismatch: status=%d body=%s", status.Code, status.Body.String())
	}
	client := requestJSON(t, app, http.MethodGet, "/api/v1/mosdns/traffic/client?ip=192.168.1.2", token, nil)
	if client.Code != http.StatusOK || !strings.Contains(client.Body.String(), `"ip":"192.168.1.2"`) {
		t.Fatalf("traffic client mismatch: status=%d body=%s", client.Code, client.Body.String())
	}
	bad := requestJSON(t, app, http.MethodGet, "/api/v1/mosdns/traffic/client?ip=not-an-ip", token, nil)
	if bad.Code != http.StatusBadRequest || !strings.Contains(bad.Body.String(), "invalid_ip") {
		t.Fatalf("invalid client IP should be rejected: status=%d body=%s", bad.Code, bad.Body.String())
	}
}

func TestMosDNSTrafficEndpointReportsUnavailableAgent(t *testing.T) {
	previous := mosDNSTrafficAgentURL
	mosDNSTrafficAgentURL = "http://127.0.0.1:1"
	t.Cleanup(func() { mosDNSTrafficAgentURL = previous })

	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")
	res := requestJSON(t, app, http.MethodGet, "/api/v1/mosdns/traffic/snapshot", token, nil)
	if res.Code != http.StatusServiceUnavailable || !strings.Contains(res.Body.String(), "traffic_agent_unavailable") {
		t.Fatalf("unavailable traffic agent mismatch: status=%d body=%s", res.Code, res.Body.String())
	}
}
