package catalog

import (
	"testing"

	"github.com/scoltzero/msf/internal/assistant"
)

func TestDefaultCatalogValidatesAndMatches(t *testing.T) {
	catalog, err := Default()
	if err != nil {
		t.Fatal(err)
	}
	call := assistant.APICall{Method: "POST", Path: "/api/v1/services/mosdns/restart"}
	capability, matched, err := catalog.Match(call)
	if err != nil || !matched {
		t.Fatalf("expected service restart match, matched=%v err=%v", matched, err)
	}
	if capability.Exposure != assistant.ExposureConfirm {
		t.Fatalf("unexpected exposure: %s", capability.Exposure)
	}
}

func TestCatalogRejectsAbsoluteAndTraversalPaths(t *testing.T) {
	catalog, err := Default()
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{
		"https://127.0.0.1/api/v1/services",
		"/api/v1/../settings",
		"/api/v1/%2e%2e/settings",
		"/not-msf/services",
	} {
		if _, matched, matchErr := catalog.Match(assistant.APICall{Method: "GET", Path: path}); matchErr == nil || matched {
			t.Fatalf("expected path rejection for %q, matched=%v err=%v", path, matched, matchErr)
		}
	}
}

func TestRegisteredRouteInventoryIsNonEmptyAndDeduplicated(t *testing.T) {
	routes, err := RegisteredRoutes()
	if err != nil {
		t.Fatal(err)
	}
	if len(routes) < 300 {
		t.Fatalf("route inventory unexpectedly small: %d", len(routes))
	}
	seen := make(map[string]struct{}, len(routes))
	for _, route := range routes {
		if _, exists := seen[route]; exists {
			t.Fatalf("duplicate route inventory entry: %s", route)
		}
		seen[route] = struct{}{}
	}
}
