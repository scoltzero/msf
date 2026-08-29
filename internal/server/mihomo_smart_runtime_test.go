package server

import "testing"

// TestMihomoSmartGroupRuntimeClassification verifies the controller-side proxy
// normalization treats a Smart group as a group even when its member list is
// temporarily empty (the controller still reports it under /proxies with type
// Smart). Without this the Smart group would be demoted to a plain node and
// would disappear from the groups tab.
func TestMihomoSmartGroupRuntimeClassification(t *testing.T) {
	raw := map[string]any{
		"proxies": map[string]any{
			"SmartGroup": map[string]any{
				"name":            "SmartGroup",
				"type":            "Smart",
				"all":             []any{},
				"policy-priority": "url-test",
				"uselightgbm":     true,
				"collectdata":     false,
				"sample-rate":     0.3,
				"prefer-asn":      true,
			},
			"SomeNode": map[string]any{
				"name": "SomeNode",
				"type": "Trojan",
				"all":  []any{},
			},
			"EmptyRelay": map[string]any{
				"name": "EmptyRelay",
				"type": "Relay",
				"all":  []any{},
			},
		},
	}

	_, groups, proxies := normalizeMihomoProxies(raw, nil)

	if len(groups) != 2 {
		t.Fatalf("expected 2 groups (Smart + Relay), got %d: %v", len(groups), groups)
	}
	if groups[0]["name"] != "EmptyRelay" && groups[0]["name"] != "SmartGroup" {
		// Both have order 100000 so sort falls back to name order.
		t.Fatalf("unexpected first group %v", groups[0]["name"])
	}
	foundSmart := false
	for _, group := range groups {
		if group["name"] == "SmartGroup" {
			foundSmart = true
			if group["type"] != "Smart" {
				t.Fatalf("Smart group type = %v, want Smart", group["type"])
			}
			if got := group["all_count"]; got != 0 {
				t.Fatalf("Smart group all_count = %v, want 0", got)
			}
		}
	}
	if !foundSmart {
		t.Fatalf("Smart group not classified as a group: %v", groups)
	}

	if len(proxies) != 1 {
		t.Fatalf("expected 1 proxy (SomeNode), got %d", len(proxies))
	}
	if proxies[0]["name"] != "SomeNode" {
		t.Fatalf("expected SomeNode proxy, got %v", proxies[0]["name"])
	}
}

// TestMihomoSmartGroupEmptyAllStillGroup is a focused regression: a Smart type
// with an empty runtime member list must still be reported in the groups slice
// rather than being demoted to a proxy.
func TestMihomoSmartGroupEmptyAllStillGroup(t *testing.T) {
	raw := map[string]any{
		"proxies": map[string]any{
			"Smart": map[string]any{
				"name": "Smart",
				"type": "Smart",
				"all":  []any{},
			},
		},
	}

	byName, groups, proxies := normalizeMihomoProxies(raw, nil)
	if len(groups) != 1 {
		t.Fatalf("expected 1 group, got %d (proxies=%v)", len(groups), proxies)
	}
	if _, ok := byName["Smart"]; !ok {
		t.Fatalf("Smart missing from byName map")
	}
	if len(proxies) != 0 {
		t.Fatalf("expected no proxies, got %d", len(proxies))
	}
}
