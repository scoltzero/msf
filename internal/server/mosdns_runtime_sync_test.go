package server

import (
	"bytes"
	"compress/zlib"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

type mosDNSRuntimeCall struct {
	Method string
	Path   string
	Body   []byte
}

func TestMosDNSPersonalRulesHotSyncRuntime(t *testing.T) {
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")
	previousWait := waitForMosDNSRulePropagation
	waits := 0
	waitForMosDNSRulePropagation = func() { waits++ }
	t.Cleanup(func() { waitForMosDNSRulePropagation = previousWait })
	calls := make(chan mosDNSRuntimeCall, 16)
	controller := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		calls <- mosDNSRuntimeCall{Method: r.Method, Path: r.URL.Path, Body: body}
		_, _ = w.Write([]byte("ok"))
	}))
	defer controller.Close()
	app.setSetting("mosdns_api_endpoint", controller.URL)
	markMosDNSRunningForTest(t, app)

	tests := []struct {
		category string
		tag      string
		pattern  string
	}{
		{category: "whitelist", tag: "whitelist", pattern: "direct.example"},
		{category: "blocklist", tag: "blocklist", pattern: "ads.example"},
		{category: "greylist", tag: "greylist", pattern: "proxy.example"},
		{category: "ddnslist", tag: "ddnslist", pattern: "home.example"},
		{category: "direct_ip", tag: "direct_ip", pattern: "192.0.2.0/24"},
		{category: "redirect", tag: "rewrite", pattern: "full:edge.example 192.0.2.10"},
	}
	for _, test := range tests {
		t.Run(test.category, func(t *testing.T) {
			res := requestJSON(t, app, http.MethodPost, "/api/v1/mosdns/rules/"+test.category, token, map[string]any{"pattern": test.pattern})
			if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"restart_required":false`) {
				t.Fatalf("rule mutation status=%d body=%s", res.Code, res.Body.String())
			}
			call := <-calls
			if call.Method != http.MethodPost || call.Path != "/plugins/"+test.tag+"/post" {
				t.Fatalf("runtime call = %s %s, want POST /plugins/%s/post", call.Method, call.Path, test.tag)
			}
			var payload struct {
				Values []string `json:"values"`
			}
			if err := json.Unmarshal(call.Body, &payload); err != nil {
				t.Fatal(err)
			}
			wantPattern := test.pattern
			if test.category == "ddnslist" {
				wantPattern = "full:" + test.pattern
			} else if slices.Contains([]string{"whitelist", "blocklist", "greylist"}, test.category) {
				wantPattern = "domain:" + test.pattern
			}
			if !slices.Contains(payload.Values, wantPattern) {
				t.Fatalf("runtime values do not contain %q: %#v", wantPattern, payload.Values)
			}
			if test.category == "ddnslist" {
				content, err := app.readTextFile(mosDNSRuleCategoryFile(test.category))
				if err != nil || content != wantPattern+"\n" {
					t.Fatalf("persisted DDNS rules = %q, err=%v; want %q", content, err, wantPattern+"\n")
				}
			}
			assertMosDNSFrontCacheFlushes(t, calls)
		})
	}
	if waits != 4 {
		t.Fatalf("domain_mapper propagation waits=%d, want 4", waits)
	}
}

func TestNormalizeMosDNSRulePattern(t *testing.T) {
	tests := []struct {
		category string
		pattern  string
		want     string
	}{
		{category: "ddnslist", pattern: "home.example", want: "full:home.example"},
		{category: "ddns", pattern: " home.example ", want: "full:home.example"},
		{category: "ddnslist", pattern: "full:home.example", want: "full:home.example"},
		{category: "ddnslist", pattern: "domain:example", want: "domain:example"},
		{category: "ddnslist", pattern: "keyword:home", want: "keyword:home"},
		{category: "ddnslist", pattern: `regexp:^.+\.example$`, want: `regexp:^.+\.example$`},
		{category: "whitelist", pattern: "home.example", want: "domain:home.example"},
		{category: "direct", pattern: "home.example", want: "domain:home.example"},
		{category: "blocklist", pattern: "ads.example", want: "domain:ads.example"},
		{category: "greylist", pattern: "proxy.example", want: "domain:proxy.example"},
		{category: "direct_ip", pattern: "192.0.2.0/24", want: "192.0.2.0/24"},
	}
	for _, test := range tests {
		if got := normalizeMosDNSRulePattern(test.category, test.pattern); got != test.want {
			t.Errorf("normalizeMosDNSRulePattern(%q, %q) = %q, want %q", test.category, test.pattern, got, test.want)
		}
	}
}

func TestMosDNSDomainMapperBackedTags(t *testing.T) {
	for _, tag := range []string{"whitelist", "blocklist", "greylist", "ddnslist"} {
		if !mosDNSDomainMapperBackedTag(tag) {
			t.Errorf("%s should wait for domain_mapper propagation", tag)
		}
	}
	for _, tag := range []string{"direct_ip", "rewrite", "client_ip"} {
		if mosDNSDomainMapperBackedTag(tag) {
			t.Errorf("%s should not wait for domain_mapper propagation", tag)
		}
	}
}

func TestMosDNSDDNSImportNormalizesPlainDomains(t *testing.T) {
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")
	res := requestJSON(t, app, http.MethodPost, "/api/v1/mosdns/rules/ddnslist/import", token, map[string]any{
		"content": "one.example\nfull:two.example\none.example\n",
	})
	if res.Code != http.StatusOK {
		t.Fatalf("DDNS import status=%d body=%s", res.Code, res.Body.String())
	}
	content, err := app.readTextFile(mosDNSRuleCategoryFile("ddnslist"))
	if err != nil {
		t.Fatal(err)
	}
	if want := "full:one.example\nfull:two.example\n"; content != want {
		t.Fatalf("imported DDNS rules = %q, want %q", content, want)
	}
}

func TestMosDNSDomainListImportsNormalizePlainDomains(t *testing.T) {
	for _, category := range []string{"whitelist", "blocklist", "greylist"} {
		t.Run(category, func(t *testing.T) {
			app := newTestApp(t)
			token := tokenForRole(t, app, "admin")
			res := requestJSON(t, app, http.MethodPost, "/api/v1/mosdns/rules/"+category+"/import", token, map[string]any{
				"content": "example.com\nfull:exact.example\nexample.com\n",
			})
			if res.Code != http.StatusOK {
				t.Fatalf("%s import status=%d body=%s", category, res.Code, res.Body.String())
			}
			content, err := app.readTextFile(mosDNSRuleCategoryFile(category))
			if err != nil {
				t.Fatal(err)
			}
			if want := "domain:example.com\nfull:exact.example\n"; content != want {
				t.Fatalf("imported %s rules = %q, want %q", category, content, want)
			}
		})
	}
}

func TestMosDNSSpecialRuleValidation(t *testing.T) {
	tests := []struct {
		category string
		patterns []string
		wantErr  bool
	}{
		{category: "direct_ip", patterns: []string{"192.0.2.1", "2001:db8::/32"}},
		{category: "direct_ip", patterns: []string{"domain:192.0.2.1"}, wantErr: true},
		{category: "direct_ip", patterns: []string{"192.0.2.0/99"}, wantErr: true},
		{category: "redirect", patterns: []string{"full:edge.example 192.0.2.10", "domain:old.example new.example"}},
		{category: "redirect", patterns: []string{"full:edge.example"}, wantErr: true},
		{category: "redirect", patterns: []string{"edge.example 192.0.2.10"}, wantErr: true},
		{category: "redirect", patterns: []string{"regexp:[ 192.0.2.10"}, wantErr: true},
		{category: "redirect", patterns: []string{"full:edge.example not/a/target"}, wantErr: true},
	}
	for _, test := range tests {
		err := validateMosDNSRulePatterns(test.category, test.patterns)
		if (err != nil) != test.wantErr {
			t.Errorf("validateMosDNSRulePatterns(%q, %#v) err=%v, wantErr=%v", test.category, test.patterns, err, test.wantErr)
		}
	}
}

func TestMosDNSSpecialRuleImportRejectsInvalidEntries(t *testing.T) {
	for _, test := range []struct {
		category string
		content  string
	}{
		{category: "direct_ip", content: "domain:192.0.2.1\n"},
		{category: "redirect", content: "full:edge.example\n"},
	} {
		t.Run(test.category, func(t *testing.T) {
			app := newTestApp(t)
			token := tokenForRole(t, app, "admin")
			res := requestJSON(t, app, http.MethodPost, "/api/v1/mosdns/rules/"+test.category+"/import", token, map[string]any{"content": test.content})
			if res.Code != http.StatusBadRequest || !strings.Contains(res.Body.String(), `"error":"write_failed"`) {
				t.Fatalf("invalid %s import status=%d body=%s", test.category, res.Code, res.Body.String())
			}
		})
	}
}

func TestMosDNSClientListHotSyncsAddAndRemove(t *testing.T) {
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")
	previousWait := waitForMosDNSRulePropagation
	waitForMosDNSRulePropagation = func() {}
	t.Cleanup(func() { waitForMosDNSRulePropagation = previousWait })
	calls := make(chan mosDNSRuntimeCall, 4)
	controller := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		calls <- mosDNSRuntimeCall{Method: r.Method, Path: r.URL.Path, Body: body}
		_, _ = w.Write([]byte("ok"))
	}))
	defer controller.Close()
	app.setSetting("mosdns_api_endpoint", controller.URL)
	markMosDNSRunningForTest(t, app)

	create := requestJSON(t, app, http.MethodPost, "/api/v1/mosdns/clients", token, map[string]any{
		"ip": "192.168.10.88", "hostname": "unit-client", "type": "allow",
	})
	if create.Code != http.StatusOK {
		t.Fatalf("create client status=%d body=%s", create.Code, create.Body.String())
	}
	assertMosDNSRuntimeValues(t, <-calls, "client_ip", []string{"192.168.10.88"})
	assertMosDNSFrontCacheFlushes(t, calls)

	remove := requestJSON(t, app, http.MethodPost, "/api/v1/mosdns/clients/192.168.10.88/move", token, map[string]string{"status": "disabled"})
	if remove.Code != http.StatusOK {
		t.Fatalf("remove client status=%d body=%s", remove.Code, remove.Body.String())
	}
	assertMosDNSRuntimeValues(t, <-calls, "client_ip", []string{})
	assertMosDNSFrontCacheFlushes(t, calls)
}

func TestMosDNSHotSyncFailurePromptsForRestart(t *testing.T) {
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")
	controller := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("Invalid request POST " + r.URL.Path))
	}))
	defer controller.Close()
	app.setSetting("mosdns_api_endpoint", controller.URL)
	markMosDNSRunningForTest(t, app)

	res := requestJSON(t, app, http.MethodPost, "/api/v1/mosdns/rules/whitelist", token, map[string]any{"pattern": "domain:saved.example"})
	if res.Code != http.StatusBadRequest || !strings.Contains(res.Body.String(), "请重启 MosDNS 后生效") {
		t.Fatalf("hot sync failure should prompt restart: status=%d body=%s", res.Code, res.Body.String())
	}
	content, err := os.ReadFile(filepath.Join(app.DataDir, "configs/mosdns/rule/whitelist.txt"))
	if err != nil || !strings.Contains(string(content), "domain:saved.example") {
		t.Fatalf("rule should remain saved after runtime failure: content=%q err=%v", string(content), err)
	}
}

func TestMosDNSRuleSourceRuntimeTagMapping(t *testing.T) {
	tests := map[string]string{
		"geositecn":   "geosite_cn",
		"geositenocn": "geosite_no_cn",
		"geoipcn":     "geoip_cn",
		"cuscn":       "cuscn",
		"cusnocn":     "cusnocn",
	}
	for sourceType, want := range tests {
		if got := mosDNSRuleSourcePluginTag(sourceType); got != want {
			t.Fatalf("plugin tag for %q = %q, want %q", sourceType, got, want)
		}
	}
}

func TestMosDNSRuleSourcesUsePluginRuntimeAPIs(t *testing.T) {
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")
	previousSourceWait := waitForMosDNSRuleSourcePropagation
	waits := 0
	waitForMosDNSRuleSourcePropagation = func() { waits++ }
	t.Cleanup(func() { waitForMosDNSRuleSourcePropagation = previousSourceWait })
	rules := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, ".srs") {
			var compressed bytes.Buffer
			compressed.WriteString("SRS")
			compressed.WriteByte(3)
			zw := zlib.NewWriter(&compressed)
			_, _ = zw.Write([]byte{0})
			_ = zw.Close()
			_, _ = w.Write(compressed.Bytes())
			return
		}
		_, _ = w.Write([]byte("||example.com^\n"))
	}))
	defer rules.Close()
	calls := make(chan mosDNSRuntimeCall, 8)
	controller := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		calls <- mosDNSRuntimeCall{Method: r.Method, Path: r.URL.Path, Body: body}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/plugins/adguard/rules" {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id": "runtime-adguard-id", "name": "unit-adguard", "url": rules.URL + "/adguard.txt",
				"enabled": true, "auto_update": true, "update_interval_hours": 24,
			})
			return
		}
		_, _ = w.Write([]byte(`{}`))
	}))
	defer controller.Close()
	app.setSetting("mosdns_api_endpoint", controller.URL)
	markMosDNSRunningForTest(t, app)

	srs := requestJSON(t, app, http.MethodPost, "/api/v1/mosdns/rule-sets", token, map[string]any{
		"source_type": "srs", "name": "unit-srs", "type": "cusnocn", "files": "srs/unit-srs.srs",
		"url": rules.URL + "/unit-srs.srs", "enabled": true,
	})
	if srs.Code != http.StatusCreated || !strings.Contains(srs.Body.String(), `"restart_required":false`) {
		t.Fatalf("create SRS source status=%d body=%s", srs.Code, srs.Body.String())
	}
	srsCall := <-calls
	if srsCall.Method != http.MethodPut || srsCall.Path != "/plugins/cusnocn/config/unit-srs" {
		t.Fatalf("SRS runtime call = %s %s", srsCall.Method, srsCall.Path)
	}
	assertMosDNSFrontCacheFlushes(t, calls)

	adguard := requestJSON(t, app, http.MethodPost, "/api/v1/mosdns/rule-sets", token, map[string]any{
		"source_type": "adguard", "name": "unit-adguard", "type": "adguard",
		"url": rules.URL + "/adguard.txt", "enabled": true, "auto_update": true,
	})
	if adguard.Code != http.StatusCreated || !strings.Contains(adguard.Body.String(), "runtime-adguard-id") {
		t.Fatalf("create AdGuard source status=%d body=%s", adguard.Code, adguard.Body.String())
	}
	adguardCall := <-calls
	if adguardCall.Method != http.MethodPost || adguardCall.Path != "/plugins/adguard/rules" {
		t.Fatalf("AdGuard runtime call = %s %s", adguardCall.Method, adguardCall.Path)
	}
	var createPayload mosDNSRuleSource
	if err := json.Unmarshal(adguardCall.Body, &createPayload); err != nil || createPayload.Enabled {
		t.Fatalf("AdGuard create should be initially disabled: payload=%s err=%v", adguardCall.Body, err)
	}
	adguardEnableCall := <-calls
	if adguardEnableCall.Method != http.MethodPut || adguardEnableCall.Path != "/plugins/adguard/rules/runtime-adguard-id" {
		t.Fatalf("AdGuard enable runtime call = %s %s", adguardEnableCall.Method, adguardEnableCall.Path)
	}
	assertMosDNSFrontCacheFlushes(t, calls)
	config, err := os.ReadFile(filepath.Join(app.DataDir, "configs/mosdns/adguard/config.json"))
	if err != nil || !strings.Contains(string(config), "runtime-adguard-id") {
		t.Fatalf("AdGuard runtime id should be reconciled locally: config=%s err=%v", string(config), err)
	}
	if waits != 2 {
		t.Fatalf("rule source propagation waits=%d, want 2", waits)
	}
}

func TestMosDNSRuleSourceCreateRollsBackFailedInitialDownload(t *testing.T) {
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")
	badRules := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("not an srs file"))
	}))
	defer badRules.Close()
	controller := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	defer controller.Close()
	app.setSetting("mosdns_api_endpoint", controller.URL)
	markMosDNSRunningForTest(t, app)

	res := requestJSON(t, app, http.MethodPost, "/api/v1/mosdns/rule-sets", token, map[string]any{
		"source_type": "srs", "name": "broken-source", "type": "cusnocn", "files": "srs/broken.srs",
		"url": badRules.URL + "/broken.srs", "enabled": true,
	})
	if res.Code != http.StatusConflict || !strings.Contains(res.Body.String(), "首次下载失败") {
		t.Fatalf("failed create status=%d body=%s", res.Code, res.Body.String())
	}
	if _, ok := app.findMosDNSRuleSource("broken-source"); ok {
		t.Fatal("failed source create should roll back local configuration")
	}
	if _, err := os.Stat(filepath.Join(app.DataDir, "configs/mosdns/srs/broken.srs")); !os.IsNotExist(err) {
		t.Fatalf("failed source artifact should not remain, err=%v", err)
	}
}

func TestMosDNSRuleSourceIdentityChangeDeletesThenCreates(t *testing.T) {
	app := newTestApp(t)
	calls := make(chan mosDNSRuntimeCall, 4)
	controller := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		calls <- mosDNSRuntimeCall{Method: r.Method, Path: r.URL.Path, Body: body}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	defer controller.Close()
	app.setSetting("mosdns_api_endpoint", controller.URL)
	markMosDNSRunningForTest(t, app)

	previous := mosDNSRuleSource{SourceType: "srs", Type: "cuscn", Name: "old-name"}
	next := mosDNSRuleSource{
		SourceType: "srs", Type: "cusnocn", Name: "new-name", Files: "srs/new-name.srs",
		URL: "https://example.com/new-name.srs", Enabled: true,
	}
	if _, err := app.updateMosDNSRuleSourceRuntime(previous, next); err != nil {
		t.Fatal(err)
	}
	deleted := <-calls
	if deleted.Method != http.MethodDelete || deleted.Path != "/plugins/cuscn/config/old-name" {
		t.Fatalf("delete runtime call = %s %s", deleted.Method, deleted.Path)
	}
	created := <-calls
	if created.Method != http.MethodPut || created.Path != "/plugins/cusnocn/config/new-name" {
		t.Fatalf("create runtime call = %s %s", created.Method, created.Path)
	}
	assertMosDNSFrontCacheFlushes(t, calls)
}

func assertMosDNSRuntimeValues(t *testing.T, call mosDNSRuntimeCall, tag string, want []string) {
	t.Helper()
	if call.Method != http.MethodPost || call.Path != "/plugins/"+tag+"/post" {
		t.Fatalf("runtime call = %s %s, want POST /plugins/%s/post", call.Method, call.Path, tag)
	}
	var payload struct {
		Values []string `json:"values"`
	}
	if err := json.Unmarshal(call.Body, &payload); err != nil {
		t.Fatal(err)
	}
	if strings.Join(payload.Values, ",") != strings.Join(want, ",") {
		t.Fatalf("runtime values = %#v, want %#v", payload.Values, want)
	}
}

func assertMosDNSFrontCacheFlushes(t *testing.T, calls <-chan mosDNSRuntimeCall) {
	t.Helper()
	want := map[string]bool{
		"/plugins/cache_all/flush":        false,
		"/plugins/cache_all_noleak/flush": false,
	}
	for range 2 {
		call := <-calls
		if call.Method != http.MethodGet {
			t.Fatalf("cache flush method = %s, want GET", call.Method)
		}
		if _, ok := want[call.Path]; !ok {
			t.Fatalf("unexpected cache flush path %s", call.Path)
		}
		want[call.Path] = true
	}
	for path, seen := range want {
		if !seen {
			t.Fatalf("missing cache flush %s", path)
		}
	}
}

func markMosDNSRunningForTest(t *testing.T, app *App) {
	t.Helper()
	for _, name := range []string{"mosdns", "mosdns-traffic-agent"} {
		pidPath := filepath.Join(app.DataDir, "data", name+".pid")
		if err := os.MkdirAll(filepath.Dir(pidPath), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(pidPath, []byte(strconv.Itoa(os.Getpid())), 0644); err != nil {
			t.Fatal(err)
		}
	}
}
