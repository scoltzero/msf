package server

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

var mosDNSTrafficAgentURL = "http://127.0.0.1:9199"

func (a *App) handleMosDNSTrafficStatus(w http.ResponseWriter, r *http.Request) {
	a.proxyMosDNSTraffic(w, r, "/api/traffic/status")
}

func (a *App) handleMosDNSTrafficSnapshot(w http.ResponseWriter, r *http.Request) {
	a.proxyMosDNSTraffic(w, r, "/api/traffic/snapshot")
}

func (a *App) handleMosDNSTrafficClients(w http.ResponseWriter, r *http.Request) {
	a.proxyMosDNSTraffic(w, r, "/api/traffic/clients")
}

func (a *App) handleMosDNSTrafficClient(w http.ResponseWriter, r *http.Request) {
	ip := strings.TrimSpace(r.URL.Query().Get("ip"))
	if addr, err := netip.ParseAddr(ip); err != nil || !addr.IsValid() {
		writeError(w, http.StatusBadRequest, "invalid_ip", "ip must be a valid IPv4 or IPv6 address")
		return
	}
	a.proxyMosDNSTraffic(w, r, "/api/traffic/client?ip="+url.QueryEscape(ip))
}

func (a *App) proxyMosDNSTraffic(w http.ResponseWriter, r *http.Request, path string) {
	ctx, cancel := context.WithTimeout(r.Context(), 1500*time.Millisecond)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, mosDNSTrafficAgentURL+path, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "traffic_request_failed", err.Error())
		return
	}
	resp, err := (&http.Client{Timeout: 2 * time.Second}).Do(req)
	if err != nil || resp.StatusCode >= http.StatusMultipleChoices {
		if resp != nil {
			resp.Body.Close()
		}
		writeError(w, http.StatusServiceUnavailable, "traffic_agent_unavailable", "mosdns-traffic-agent is unavailable")
		return
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		writeError(w, http.StatusBadGateway, "traffic_agent_invalid_response", err.Error())
		return
	}
	var payload any
	if err := json.Unmarshal(body, &payload); err != nil {
		writeError(w, http.StatusBadGateway, "traffic_agent_invalid_response", "mosdns-traffic-agent returned invalid JSON")
		return
	}
	if envelope, ok := payload.(map[string]any); ok {
		if data, exists := envelope["data"]; exists {
			writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": data})
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": payload})
}
