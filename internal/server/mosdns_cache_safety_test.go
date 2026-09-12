package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRenderMosDNSCacheTemplateUsesConfiguredFakeIPRanges(t *testing.T) {
	cfg := SetupConfig{FakeIPRangeV4: "100.64.0.0/10", FakeIPRangeV6: "fc00::/7"}
	content, err := renderMosDNSCacheTemplate(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(content, "lazy_cache_ttl: 86400") {
		t.Fatalf("cache template did not use the bounded lazy TTL:\n%s", content)
	}
	if !strings.Contains(content, "- 100.64.0.0/10") || !strings.Contains(content, "- fc00::/7") {
		t.Fatalf("cache template did not follow configured Fake-IP ranges:\n%s", content)
	}
	if strings.Contains(content, "- 28.0.0.0/8") || strings.Contains(content, "- f2b0::/18") {
		t.Fatalf("cache template retained default Fake-IP exclusions:\n%s", content)
	}
	if mosDNSCacheTemplateNeedsRepair(content, cfg) {
		t.Fatal("fresh cache template was incorrectly considered unsafe")
	}
}

func TestEnsureMosDNSCacheSafetyRepairsLegacyState(t *testing.T) {
	app := newTestApp(t)
	legacy := strings.ReplaceAll(string(mustMosDNSRuntimeTemplate(t, "mosdns/sub_config/cache.yaml")), "lazy_cache_ttl: 86400", "lazy_cache_ttl: 259200000")
	legacy = strings.ReplaceAll(legacy, "        - 28.0.0.0/8\n        - f2b0::/18\n", "#        - 28.0.0.0/8\n#        - f2b0::/18\n")
	cachePath := filepath.Join(app.DataDir, "configs/mosdns/sub_config/cache.yaml")
	if err := os.WriteFile(cachePath, []byte(legacy), 0644); err != nil {
		t.Fatal(err)
	}
	for _, rel := range []string{
		"configs/mosdns/cache/cache_all.dump",
		"configs/mosdns/cache/cache_all_noleak.dump",
		"configs/mosdns/gen/fakeiprule.txt",
		"configs/mosdns/gen/fakeiplist.txt",
	} {
		path := filepath.Join(app.DataDir, filepath.FromSlash(rel))
		if err := os.WriteFile(path, []byte("stale\n"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if err := app.ensureMosDNSCacheSafety(); err != nil {
		t.Fatal(err)
	}
	repaired, err := os.ReadFile(cachePath)
	if err != nil {
		t.Fatal(err)
	}
	if mosDNSCacheTemplateNeedsRepair(string(repaired), SetupConfig{}) {
		t.Fatalf("repaired cache template is still unsafe:\n%s", repaired)
	}
	for _, rel := range []string{
		"configs/mosdns/cache/cache_all.dump",
		"configs/mosdns/cache/cache_all_noleak.dump",
	} {
		if _, err := os.Stat(filepath.Join(app.DataDir, filepath.FromSlash(rel))); !os.IsNotExist(err) {
			t.Fatalf("legacy cache dump %s survived migration, err=%v", rel, err)
		}
	}
	for _, rel := range []string{
		"configs/mosdns/gen/fakeiprule.txt",
		"configs/mosdns/gen/fakeiplist.txt",
	} {
		got, err := os.ReadFile(filepath.Join(app.DataDir, filepath.FromSlash(rel)))
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != 0 {
			t.Fatalf("legacy Fake-IP learning file %s was not cleared: %q", rel, got)
		}
	}
}

func TestMosDNSCacheClearFlushesFakeIPLearning(t *testing.T) {
	app := newTestApp(t)
	markMosDNSRunningForTest(t, app)
	for _, rel := range mosDNSFakeIPLearningFiles {
		if err := os.WriteFile(filepath.Join(app.DataDir, filepath.FromSlash(rel)), []byte("full:stale.example\n"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	called := make(chan string, len(mosDNSCachePluginTags)+1)
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called <- r.URL.Path
		w.WriteHeader(http.StatusNoContent)
	}))
	defer api.Close()
	app.setSetting("mosdns_api_endpoint", api.URL)

	res := httptest.NewRecorder()
	app.handleMosDNSCacheClear(res, httptest.NewRequest(http.MethodPost, "/api/v1/mosdns/cache/clear", nil))
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "同步清除 FakeIP 学习记忆") {
		t.Fatalf("cache clear response=%d body=%s", res.Code, res.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	data, _ := body["data"].(map[string]any)
	if data["fakeip_learning_cleared"] != true {
		t.Fatalf("cache clear did not report Fake-IP learning cleanup: %s", res.Body.String())
	}
	seen := map[string]bool{}
	for range len(mosDNSCachePluginTags) + 1 {
		seen[<-called] = true
	}
	if !seen["/plugins/"+mosDNSFakeIPLearningTag+"/flush"] {
		t.Fatalf("Fake-IP learning plugin was not flushed: %#v", seen)
	}
	for _, rel := range mosDNSFakeIPLearningFiles {
		got, err := os.ReadFile(filepath.Join(app.DataDir, filepath.FromSlash(rel)))
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != 0 {
			t.Fatalf("Fake-IP learning file %s was not cleared: %q", rel, got)
		}
	}
}

func mustMosDNSRuntimeTemplate(t *testing.T, rel string) []byte {
	t.Helper()
	content, ok := runtimeTemplateText(rel)
	if !ok {
		t.Fatalf("missing runtime template %s", rel)
	}
	return []byte(content)
}
