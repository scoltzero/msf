package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestMosDNSCacheClearFlushesEveryCachePluginWithoutTouchingFiles(t *testing.T) {
	called := []string{}
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = append(called, r.URL.Path)
		if r.Method != http.MethodGet {
			t.Errorf("method=%s want GET", r.Method)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer api.Close()

	app := newTestApp(t)
	app.setSetting("mosdns_api_endpoint", api.URL)
	rulePath := filepath.Join(app.DataDir, "configs/mosdns/rule/whitelist.txt")
	mihomoCachePath := filepath.Join(app.DataDir, "configs/mihomo/cache.db")
	if err := os.MkdirAll(filepath.Dir(rulePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(mihomoCachePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(rulePath, []byte("domain:keep.example\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(mihomoCachePath, []byte("keep-fakeip-cache"), 0o644); err != nil {
		t.Fatal(err)
	}

	res := httptest.NewRecorder()
	app.handleMosDNSCacheClear(res, httptest.NewRequest(http.MethodPost, "/api/v1/mosdns/cache/clear", nil))
	if res.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["success"] != true {
		t.Fatalf("body=%s", res.Body.String())
	}
	want := make([]string, 0, len(mosDNSCachePluginTags))
	for _, tag := range mosDNSCachePluginTags {
		want = append(want, "/plugins/"+tag+"/flush")
	}
	if !reflect.DeepEqual(called, want) {
		t.Fatalf("called=%v want=%v", called, want)
	}
	if got, _ := os.ReadFile(rulePath); string(got) != "domain:keep.example\n" {
		t.Fatalf("rule changed: %q", got)
	}
	if got, _ := os.ReadFile(mihomoCachePath); string(got) != "keep-fakeip-cache" {
		t.Fatalf("Mihomo cache changed: %q", got)
	}
}

func TestMosDNSCacheClearReportsFailuresAndContinues(t *testing.T) {
	called := []string{}
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = append(called, r.URL.Path)
		if strings.Contains(r.URL.Path, "/cache_google/flush") {
			http.Error(w, "flush failed", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer api.Close()

	app := newTestApp(t)
	app.setSetting("mosdns_api_endpoint", api.URL)
	res := httptest.NewRecorder()
	app.handleMosDNSCacheClear(res, httptest.NewRequest(http.MethodPost, "/api/v1/mosdns/cache/clear", nil))
	if len(called) != len(mosDNSCachePluginTags) {
		t.Fatalf("called=%v", called)
	}
	if !strings.Contains(res.Body.String(), `"success":false`) ||
		!strings.Contains(res.Body.String(), `"error":"mosdns_cache_partial_failure"`) ||
		!strings.Contains(res.Body.String(), `"cache_google"`) ||
		!strings.Contains(res.Body.String(), `失败：cache_google`) ||
		!strings.Contains(res.Body.String(), `"cleared_count":6`) {
		t.Fatalf("unexpected body=%s", res.Body.String())
	}
}

func TestMosDNSCacheClearIsRepeatableAndReportsUnavailableRuntime(t *testing.T) {
	app := newTestApp(t)
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	app.setSetting("mosdns_api_endpoint", api.URL)
	for attempt := 0; attempt < 2; attempt++ {
		res := httptest.NewRecorder()
		app.handleMosDNSCacheClear(res, httptest.NewRequest(http.MethodPost, "/api/v1/mosdns/cache/clear", nil))
		if !strings.Contains(res.Body.String(), `"success":true`) || !strings.Contains(res.Body.String(), `"cleared_count":7`) {
			t.Fatalf("attempt %d body=%s", attempt+1, res.Body.String())
		}
	}
	api.Close()
	res := httptest.NewRecorder()
	app.handleMosDNSCacheClear(res, httptest.NewRequest(http.MethodPost, "/api/v1/mosdns/cache/clear", nil))
	if !strings.Contains(res.Body.String(), `"success":false`) ||
		!strings.Contains(res.Body.String(), `"failed_count":7`) ||
		!strings.Contains(res.Body.String(), `"cleared_count":0`) {
		t.Fatalf("unavailable runtime body=%s", res.Body.String())
	}
}
