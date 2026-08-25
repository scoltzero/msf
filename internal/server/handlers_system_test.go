package server

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDiagnosticsRunStreamsEphemeralLocalLoopEvents(t *testing.T) {
	app := newTestApp(t)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/system/diagnostics/run", nil)
	req.Header.Set("Accept", "application/x-ndjson")
	res := httptest.NewRecorder()

	app.handleDiagnosticsRun(res, req)

	if got := res.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("diagnostics stream must not be cached, got %q", got)
	}
	var eventTypes []string
	scanner := bufio.NewScanner(res.Body)
	for scanner.Scan() {
		var event map[string]any
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			t.Fatalf("invalid NDJSON event %q: %v", scanner.Text(), err)
		}
		eventTypes = append(eventTypes, fmtAny(event["type"]))
	}
	if len(eventTypes) < 3 || eventTypes[0] != "run_started" || eventTypes[len(eventTypes)-1] != "run_completed" {
		t.Fatalf("unexpected diagnostics event sequence: %#v", eventTypes)
	}
}

func TestResolverNameserversOnlyReadsConfiguredTargets(t *testing.T) {
	got := resolverNameservers("# generated\nnameserver 127.0.0.1\nsearch lan\nnameserver ::1\n")
	if len(got) != 2 || got[0] != "127.0.0.1" || got[1] != "::1" {
		t.Fatalf("unexpected resolver targets: %#v", got)
	}
}

func TestLocalLoopDiagnosticsNeverTreatsRemoteControlPlaneAsLocal(t *testing.T) {
	for _, raw := range []string{"http://127.0.0.1:9090", "http://[::1]:9099", "http://localhost:9090"} {
		if !isLocalHTTPURL(raw) {
			t.Fatalf("expected local URL: %s", raw)
		}
	}
	for _, raw := range []string{"https://example.com", "http://192.168.10.1:9090"} {
		if isLocalHTTPURL(raw) {
			t.Fatalf("remote URL must not be probed: %s", raw)
		}
	}
}

func TestFirstLocalProbeDomainIgnoresUnsafeRuleRows(t *testing.T) {
	got := firstLocalProbeDomain("# comment\ndomain:local\nfull:block.example.test\n")
	if got != "block.example.test" {
		t.Fatalf("unexpected local probe domain %q", got)
	}
}

func TestContentPlateOpacityValidationBoundaries(t *testing.T) {
	tests := []struct {
		name string
		body map[string]any
		want string
		bad  bool
	}{
		{name: "minimum bounds", body: map[string]any{contentPlateOpacitySubtleKey: "20", contentPlateOpacityRegularKey: "30", contentPlateOpacityStrongKey: "40"}, want: "20/30/40"},
		{name: "maximum bounds", body: map[string]any{contentPlateOpacitySubtleKey: "80", contentPlateOpacityRegularKey: "90", contentPlateOpacityStrongKey: "96"}, want: "80/90/96"},
		{name: "equal values", body: map[string]any{contentPlateOpacitySubtleKey: "60", contentPlateOpacityRegularKey: "60", contentPlateOpacityStrongKey: "60"}, want: "60/60/60"},
		{name: "missing field", body: map[string]any{contentPlateOpacitySubtleKey: "56", contentPlateOpacityRegularKey: "70"}, bad: true},
		{name: "subtle below range", body: map[string]any{contentPlateOpacitySubtleKey: "19", contentPlateOpacityRegularKey: "30", contentPlateOpacityStrongKey: "40"}, bad: true},
		{name: "regular above range", body: map[string]any{contentPlateOpacitySubtleKey: "80", contentPlateOpacityRegularKey: "91", contentPlateOpacityStrongKey: "96"}, bad: true},
		{name: "strong above range", body: map[string]any{contentPlateOpacitySubtleKey: "80", contentPlateOpacityRegularKey: "90", contentPlateOpacityStrongKey: "97"}, bad: true},
		{name: "reversed order", body: map[string]any{contentPlateOpacitySubtleKey: "70", contentPlateOpacityRegularKey: "60", contentPlateOpacityStrongKey: "80"}, bad: true},
		{name: "numeric value", body: map[string]any{contentPlateOpacitySubtleKey: 56, contentPlateOpacityRegularKey: "70", contentPlateOpacityStrongKey: "84"}, bad: true},
		{name: "decimal string", body: map[string]any{contentPlateOpacitySubtleKey: "56.0", contentPlateOpacityRegularKey: "70", contentPlateOpacityStrongKey: "84"}, bad: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, present, err := validateContentPlateOpacityPayload(tc.body)
			if tc.bad {
				if !present || err == nil {
					t.Fatalf("expected validation error, present=%v values=%#v err=%v", present, got, err)
				}
				return
			}
			if !present || err != nil {
				t.Fatalf("expected valid opacity snapshot, present=%v err=%v", present, err)
			}
			want := strings.Split(tc.want, "/")
			if got[contentPlateOpacitySubtleKey] != want[0] || got[contentPlateOpacityRegularKey] != want[1] || got[contentPlateOpacityStrongKey] != want[2] {
				t.Fatalf("opacity mismatch: got=%#v want=%s", got, tc.want)
			}
		})
	}
}

func TestAppearanceOpacityAPIsAtomicAndConsistent(t *testing.T) {
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")

	initial := requestJSON(t, app, http.MethodGet, "/api/v1/settings/appearance", token, nil)
	if initial.Code != http.StatusOK {
		t.Fatalf("appearance GET failed: status=%d body=%s", initial.Code, initial.Body.String())
	}
	for _, want := range []string{`"theme":"system"`, `"language":"zh-CN"`, `"scene":"dynamic"`, `"quality":"balanced"`, `"content_plate_opacity_subtle":"56"`, `"content_plate_opacity_regular":"70"`, `"content_plate_opacity_strong":"84"`} {
		if !strings.Contains(initial.Body.String(), want) {
			t.Fatalf("appearance GET missing %s: %s", want, initial.Body.String())
		}
	}
	structuredInitial := requestJSON(t, app, http.MethodGet, "/api/v1/settings/structured", token, nil)
	if structuredInitial.Code != http.StatusOK {
		t.Fatalf("structured appearance GET failed: status=%d body=%s", structuredInitial.Code, structuredInitial.Body.String())
	}
	for _, want := range []string{`"scene":"dynamic"`, `"quality":"balanced"`, `"content_plate_opacity_subtle":"56"`, `"content_plate_opacity_regular":"70"`, `"content_plate_opacity_strong":"84"`} {
		if !strings.Contains(structuredInitial.Body.String(), want) {
			t.Fatalf("structured GET missing %s: %s", want, structuredInitial.Body.String())
		}
	}

	if _, err := app.DB.Exec(`insert or replace into settings(key,value,updated_at) values(?,?,?)`, "appearance.theme", "light", time.Now()); err != nil {
		t.Fatal(err)
	}
	badOrdinary := requestJSON(t, app, http.MethodPut, "/api/v1/settings/appearance", token, map[string]any{
		"theme":                       "dark",
		contentPlateOpacitySubtleKey:  "56",
		contentPlateOpacityRegularKey: "70",
		// strong intentionally omitted to verify a complete snapshot is required.
	})
	if badOrdinary.Code != http.StatusBadRequest {
		t.Fatalf("partial ordinary opacity update should fail: status=%d body=%s", badOrdinary.Code, badOrdinary.Body.String())
	}
	unchanged := requestJSON(t, app, http.MethodGet, "/api/v1/settings/appearance", token, nil)
	if strings.Contains(unchanged.Body.String(), `"theme":"dark"`) || !strings.Contains(unchanged.Body.String(), `"theme":"light"`) {
		t.Fatalf("failed ordinary opacity update partially changed theme: %s", unchanged.Body.String())
	}

	badStructured := requestJSON(t, app, http.MethodPut, "/api/v1/settings/structured", token, map[string]any{
		"appearance": map[string]any{
			"theme":                       "dark",
			contentPlateOpacitySubtleKey:  "75",
			contentPlateOpacityRegularKey: "60",
			contentPlateOpacityStrongKey:  "80",
		},
	})
	if badStructured.Code != http.StatusBadRequest {
		t.Fatalf("reversed structured opacity update should fail: status=%d body=%s", badStructured.Code, badStructured.Body.String())
	}
	unchanged = requestJSON(t, app, http.MethodGet, "/api/v1/settings/appearance", token, nil)
	if strings.Contains(unchanged.Body.String(), `"theme":"dark"`) || !strings.Contains(unchanged.Body.String(), `"theme":"light"`) {
		t.Fatalf("failed structured opacity update partially changed theme: %s", unchanged.Body.String())
	}

	validOrdinary := requestJSON(t, app, http.MethodPut, "/api/v1/settings/appearance", token, map[string]any{
		"scene":                       "static",
		"quality":                     "balanced",
		contentPlateOpacitySubtleKey:  "60",
		contentPlateOpacityRegularKey: "60",
		contentPlateOpacityStrongKey:  "80",
	})
	if validOrdinary.Code != http.StatusOK {
		t.Fatalf("valid ordinary opacity update failed: status=%d body=%s", validOrdinary.Code, validOrdinary.Body.String())
	}

	validStructured := requestJSON(t, app, http.MethodPut, "/api/v1/settings/structured", token, map[string]any{
		"appearance": map[string]any{
			"scene":                       "neutral",
			"quality":                     "reduced",
			contentPlateOpacitySubtleKey:  "64",
			contentPlateOpacityRegularKey: "64",
			contentPlateOpacityStrongKey:  "64",
		},
	})
	if validStructured.Code != http.StatusOK || strings.Contains(validStructured.Body.String(), `"restart_required":true`) {
		t.Fatalf("valid structured opacity update should not restart services: status=%d body=%s", validStructured.Code, validStructured.Body.String())
	}

	ordinaryAfter := requestJSON(t, app, http.MethodGet, "/api/v1/settings/appearance", token, nil)
	structuredAfter := requestJSON(t, app, http.MethodGet, "/api/v1/settings/structured", token, nil)
	var ordinaryBody, structuredBody map[string]any
	if err := json.Unmarshal(ordinaryAfter.Body.Bytes(), &ordinaryBody); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(structuredAfter.Body.Bytes(), &structuredBody); err != nil {
		t.Fatal(err)
	}
	ordinaryData, _ := ordinaryBody["data"].(map[string]any)
	structuredData, _ := structuredBody["data"].(map[string]any)
	structuredAppearance, _ := structuredData["appearance"].(map[string]any)
	for _, key := range []string{contentPlateOpacitySubtleKey, contentPlateOpacityRegularKey, contentPlateOpacityStrongKey, "scene", "quality"} {
		if ordinaryData[key] != structuredAppearance[key] {
			t.Fatalf("ordinary/structured GET mismatch for %s: ordinary=%v structured=%v", key, ordinaryData[key], structuredAppearance[key])
		}
	}
}

func TestAppearanceExplicitQualitySurvivesDefaultAndUpgradeFallbacks(t *testing.T) {
	app := newTestApp(t)
	for _, quality := range []string{"full", "balanced", "reduced"} {
		app.setSetting("appearance.quality", quality)
		if got := app.appearanceSettingsPayload()["quality"]; got != quality {
			t.Fatalf("explicit quality %q was overwritten by fallback %q", quality, got)
		}
	}
	app.setSetting("appearance.scene", "static")
	if got := app.appearanceSettingsPayload()["scene"]; got != "static" {
		t.Fatalf("explicit scene was overwritten by fallback %q", got)
	}
}

func TestAppearanceLegacyOpacityMigrationAndDefaults(t *testing.T) {
	app := newTestApp(t)
	if got := app.appearanceContentPlateOpacity(); got[contentPlateOpacitySubtleKey] != "56" || got[contentPlateOpacityRegularKey] != "70" || got[contentPlateOpacityStrongKey] != "84" {
		t.Fatalf("default opacity mismatch: %#v", got)
	}
	for _, tc := range []struct {
		legacy string
		want   string
	}{
		{legacy: "70", want: "56/70/84"},
		{legacy: "0", want: "20/30/40"},
		{legacy: "100", want: "80/90/96"},
	} {
		if _, err := app.DB.Exec(`delete from settings where key like 'appearance.content_plate_opacity%'`); err != nil {
			t.Fatal(err)
		}
		app.setSetting("appearance."+contentPlateOpacityLegacyKey, tc.legacy)
		got := app.appearanceContentPlateOpacity()
		want := strings.Split(tc.want, "/")
		if got[contentPlateOpacitySubtleKey] != want[0] || got[contentPlateOpacityRegularKey] != want[1] || got[contentPlateOpacityStrongKey] != want[2] {
			t.Fatalf("legacy %s migration mismatch: got=%#v want=%s", tc.legacy, got, tc.want)
		}
		var count int
		if err := app.DB.QueryRow(`select count(*) from settings where key in (?,?,?)`, "appearance."+contentPlateOpacitySubtleKey, "appearance."+contentPlateOpacityRegularKey, "appearance."+contentPlateOpacityStrongKey).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("legacy migration should not write new keys, count=%d", count)
		}
	}

	// Legacy writes remain accepted for old clients, but the key is read-only:
	// submitting a new legacy value must not alter it or the newer snapshot.
	if _, err := app.DB.Exec(`delete from settings where key like 'appearance.content_plate_opacity%'`); err != nil {
		t.Fatal(err)
	}
	app.setSetting("appearance."+contentPlateOpacityLegacyKey, "70")
	app.setSetting("appearance."+contentPlateOpacitySubtleKey, "56")
	app.setSetting("appearance."+contentPlateOpacityRegularKey, "70")
	app.setSetting("appearance."+contentPlateOpacityStrongKey, "84")
	token := tokenForRole(t, app, "admin")
	res := requestJSON(t, app, http.MethodPut, "/api/v1/settings/appearance", token, map[string]any{contentPlateOpacityLegacyKey: "42"})
	if res.Code != http.StatusOK {
		t.Fatalf("legacy opacity PUT should remain compatible: status=%d body=%s", res.Code, res.Body.String())
	}
	for key, want := range map[string]string{
		"appearance." + contentPlateOpacityLegacyKey:  "70",
		"appearance." + contentPlateOpacitySubtleKey:  "56",
		"appearance." + contentPlateOpacityRegularKey: "70",
		"appearance." + contentPlateOpacityStrongKey:  "84",
	} {
		if got := app.setting(key, ""); got != want {
			t.Fatalf("legacy opacity PUT changed %s: got=%q want=%q", key, got, want)
		}
	}
}

func TestParseIPIPExitText(t *testing.T) {
	info, err := parseIPIPExitText("当前 IP：121.231.226.241  来自于：中国 江苏 常州  电信")
	if err != nil {
		t.Fatalf("parseIPIPExitText returned error: %v", err)
	}
	if info["ip"] != "121.231.226.241" {
		t.Fatalf("ip mismatch: %#v", info)
	}
	if info["location"] != "中国 江苏 常州 电信" {
		t.Fatalf("location mismatch: %#v", info)
	}
	if info["country"] != "中国" || info["province"] != "江苏" || info["city"] != "常州" || info["isp"] != "电信" {
		t.Fatalf("location parts mismatch: %#v", info)
	}
}

func TestNormalizeInternationalExit(t *testing.T) {
	info := normalizeInternationalExit(map[string]any{
		"ip":           "198.51.100.10",
		"country":      "Exampleland",
		"region":       "Example Region",
		"city":         "Example City",
		"organization": "Example Transit",
	})
	if info["ip"] != "198.51.100.10" {
		t.Fatalf("ip mismatch: %#v", info)
	}
	if info["location"] != "Exampleland Example Transit" {
		t.Fatalf("location mismatch: %#v", info)
	}
	if info["region"] != "Example Region" || info["city"] != "Example City" || info["isp"] != "Example Transit" {
		t.Fatalf("metadata mismatch: %#v", info)
	}
}

func TestNormalizeInternationalExitUsesCarrierWhenAvailable(t *testing.T) {
	info := normalizeInternationalExit(map[string]any{
		"ip":               "121.231.226.241",
		"country":          "China",
		"isp":              "China Telecom",
		"asn_organization": "CHINATELECOM Jiangsu province Changzhou 5G network",
	})
	if info["location"] != "China China Telecom" {
		t.Fatalf("location should prefer carrier: %#v", info)
	}
}

func TestMihomoExitProxyURLPrefersMixedPort(t *testing.T) {
	app := newTestApp(t)
	configDir := filepath.Join(app.DataDir, "configs", "mihomo")
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(configDir, "config.yaml"), []byte("port: 7890\nmixed-port: 7892\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	proxyURL, err := app.mihomoExitProxyURL()
	if err != nil {
		t.Fatal(err)
	}
	if got, want := proxyURL.String(), "http://127.0.0.1:7892"; got != want {
		t.Fatalf("proxy URL mismatch: got %q want %q", got, want)
	}
}

func TestMihomoExitProxyURLFallsBackToHTTPPort(t *testing.T) {
	app := newTestApp(t)
	configDir := filepath.Join(app.DataDir, "configs", "mihomo")
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(configDir, "config.yaml"), []byte("port: 7890\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	proxyURL, err := app.mihomoExitProxyURL()
	if err != nil {
		t.Fatal(err)
	}
	if got, want := proxyURL.String(), "http://127.0.0.1:7890"; got != want {
		t.Fatalf("proxy URL mismatch: got %q want %q", got, want)
	}
}

func TestMihomoExitProxyURLRejectsMissingHTTPProxyPort(t *testing.T) {
	app := newTestApp(t)
	configDir := filepath.Join(app.DataDir, "configs", "mihomo")
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(configDir, "config.yaml"), []byte("mode: rule\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := app.mihomoExitProxyURL(); err == nil {
		t.Fatal("missing Mihomo HTTP/mixed proxy port should return an error")
	}
}

func TestNetworkExitHTTPClientUsesConfiguredProxy(t *testing.T) {
	targets := make(chan string, 1)
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		targets <- r.URL.Host
		_, _ = fmt.Fprint(w, "proxied")
	}))
	defer proxy.Close()
	proxyURL, err := url.Parse(proxy.URL)
	if err != nil {
		t.Fatal(err)
	}
	client := networkExitHTTPClient(time.Second, proxyURL)
	response, err := client.Get("http://example.invalid/exit-check")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("unexpected proxy response status: %d", response.StatusCode)
	}
	if got, want := <-targets, "example.invalid"; got != want {
		t.Fatalf("proxy received target %q, want %q", got, want)
	}
}
