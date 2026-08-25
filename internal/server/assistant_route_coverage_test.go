package server

import (
	"net/http"
	"testing"

	"github.com/scoltzero/msf/internal/assistant"
)

func TestAssistantFallbackCapabilityCoversRegisteredRoutes(t *testing.T) {
	app := newTestApp(t)
	cases := []struct {
		method string
		path   string
		expose assistant.Exposure
	}{
		{http.MethodGet, "/api/v1/mosdns/status", assistant.ExposureAuto},
		{http.MethodPost, "/api/v1/services/mosdns/restart", assistant.ExposureConfirm},
		{http.MethodDelete, "/api/v1/mihomo/connections/123", assistant.ExposureProtected},
		{http.MethodPut, "/api/v1/config/file", assistant.ExposureProtected},
		{http.MethodPost, "/api/v1/setup/reset", assistant.ExposureProtected},
		{http.MethodPost, "/api/v1/mihomo/install", assistant.ExposureProtected},
		{http.MethodPost, "/api/v1/network/apply", assistant.ExposureProtected},
		{http.MethodPost, "/api/v1/daemon/stop", assistant.ExposureProtected},
	}
	for _, test := range cases {
		capability, matched := app.discoverAssistantCapability(assistant.APICall{Method: test.method, Path: test.path})
		if !matched {
			t.Fatalf("registered route was not discovered: %s %s", test.method, test.path)
		}
		if capability.Exposure != test.expose {
			t.Fatalf("unexpected exposure for %s %s: got %s want %s", test.method, test.path, capability.Exposure, test.expose)
		}
	}
}
