package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func setManualAcceleratorForTest(t *testing.T, app *App, prefix string) {
	t.Helper()
	prefix = strings.TrimRight(strings.TrimSpace(prefix), "/")
	result, err := app.DB.Exec(`update system_setups set github_accelerator_enabled=?,github_accelerator_url=?`, prefix != "", prefix)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		t.Fatal(err)
	}
	if rows > 0 {
		return
	}
	now := time.Now()
	if _, err := app.DB.Exec(`insert into system_setups(created_at,updated_at,username,github_accelerator_enabled,github_accelerator_url,is_initialized) values(?,?,?,?,?,true)`, now, now, "root", prefix != "", prefix); err != nil {
		t.Fatal(err)
	}
}

func TestGitHubMetadataNeverTransitsConfiguredAccelerator(t *testing.T) {
	var mirrorHits atomic.Int32
	mirror := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		mirrorHits.Add(1)
	}))
	defer mirror.Close()

	app := newTestApp(t)
	setManualAcceleratorForTest(t, app, mirror.URL)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var release githubRelease
	_ = app.fetchGitHubJSONContext(ctx, "https://api.github.com/repos/scoltzero/msf/releases/latest", &release)
	if got := mirrorHits.Load(); got != 0 {
		t.Fatalf("release metadata transited the configured accelerator %d times", got)
	}
}

func TestGitHubTokenNeverTransitsConfiguredAccelerator(t *testing.T) {
	var mirrorHits atomic.Int32
	mirror := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		mirrorHits.Add(1)
	}))
	defer mirror.Close()

	app := newTestApp(t)
	setManualAcceleratorForTest(t, app, mirror.URL)
	if err := app.saveGitHubToken("ghp_token1234567890abcdef"); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var release githubRelease
	_ = app.fetchGitHubJSONContext(ctx, "https://api.github.com/repos/scoltzero/msf/releases/latest", &release)
	if got := mirrorHits.Load(); got != 0 {
		t.Fatalf("tokened metadata request transited the configured accelerator %d times", got)
	}
}

func TestGitHubJSONTokenSendsBearer(t *testing.T) {
	var gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"tag_name":"v1.0.0"}`))
	}))
	defer server.Close()

	app := newTestApp(t)
	if err := app.saveGitHubToken("ghp_token1234567890abcdef"); err != nil {
		t.Fatal(err)
	}
	var release githubRelease
	if err := app.fetchGitHubJSONOnce(context.Background(), server.URL, false, "ghp_token1234567890abcdef", &release, "token"); err != nil {
		t.Fatal(err)
	}
	if gotAuth != "Bearer ghp_token1234567890abcdef" {
		t.Fatalf("Authorization header = %q, want Bearer token", gotAuth)
	}
}

func TestGitHubAccessPUTStoresOnlyManualConfigurationAndMaskedToken(t *testing.T) {
	app := newTestApp(t)
	setManualAcceleratorForTest(t, app, "")
	token := tokenForRole(t, app, "admin")

	res := requestJSON(t, app, http.MethodPut, "/api/v1/github/accelerators", token, map[string]any{
		"manual_prefix": "https://mirror.example/",
		"github_token":  "ghp_token1234567890abcdef",
	})
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"success":true`) {
		t.Fatalf("PUT GitHub access settings failed: status=%d body=%s", res.Code, res.Body.String())
	}

	res = requestJSON(t, app, http.MethodGet, "/api/v1/github/accelerators", token, nil)
	if res.Code != http.StatusOK {
		t.Fatalf("GET GitHub access settings failed: status=%d", res.Code)
	}
	var payload struct {
		Success bool `json:"success"`
		Data    struct {
			ManualPrefix      string `json:"manual_prefix"`
			GitHubTokenMasked string `json:"github_token_masked"`
		} `json:"data"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Data.ManualPrefix != "https://mirror.example" {
		t.Fatalf("manual prefix = %q", payload.Data.ManualPrefix)
	}
	if payload.Data.GitHubTokenMasked != "ghp_******cdef" {
		t.Fatalf("masked token = %q", payload.Data.GitHubTokenMasked)
	}
	for _, removedField := range []string{"best_prefix", "extra_prefixes", "probed_at", "results"} {
		if strings.Contains(res.Body.String(), `"`+removedField+`"`) {
			t.Fatalf("automatic accelerator field %q remained in response: %s", removedField, res.Body.String())
		}
	}
	if full := res.Body.String(); strings.Contains(full, "ghp_token1234567890abcdef") {
		t.Fatal("raw token leaked through the GitHub access endpoint")
	}
	var legacyCount int
	if err := app.DB.QueryRow(`select count(*) from settings where key=?`, settingGitHubToken).Scan(&legacyCount); err != nil || legacyCount != 0 {
		t.Fatalf("plaintext GitHub token key remains: count=%d err=%v", legacyCount, err)
	}
	var encrypted string
	if err := app.DB.QueryRow(`select value from settings where key=?`, settingGitHubTokenCiphertext).Scan(&encrypted); err != nil || encrypted == "" || strings.Contains(encrypted, "ghp_token") {
		t.Fatalf("encrypted GitHub token storage invalid: value=%q err=%v", encrypted, err)
	}

	invalid := requestJSON(t, app, http.MethodPut, "/api/v1/github/accelerators", token, map[string]any{"manual_prefix": "ftp://mirror.example"})
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("non-HTTP manual prefix must 400, got %d: %s", invalid.Code, invalid.Body.String())
	}

	res = requestJSON(t, app, http.MethodPut, "/api/v1/github/accelerators", token, map[string]any{"reset_token": true})
	if res.Code != http.StatusOK {
		t.Fatalf("token reset failed: status=%d body=%s", res.Code, res.Body.String())
	}
	if masked := maskGitHubToken(app.githubToken()); masked != "" {
		t.Fatalf("token not cleared: %q", masked)
	}
}

func TestManualAcceleratorProbeChecksOnlyConfiguredPrefix(t *testing.T) {
	var hits atomic.Int32
	var requestURI string
	mirror := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		requestURI = r.RequestURI
		_, _ = w.Write([]byte(strings.Repeat("manual-probe-", 32)))
	}))
	defer mirror.Close()

	app := newTestApp(t)
	setManualAcceleratorForTest(t, app, mirror.URL)
	token := tokenForRole(t, app, "admin")
	res := requestJSON(t, app, http.MethodPost, "/api/v1/github/accelerators/probe", token, nil)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"ok":true`) || !strings.Contains(res.Body.String(), `"current_route":"manual"`) {
		t.Fatalf("manual accelerator probe failed: status=%d body=%s", res.Code, res.Body.String())
	}
	if hits.Load() != 1 {
		t.Fatalf("manual accelerator was probed %d times, want exactly once", hits.Load())
	}
	if !strings.Contains(requestURI, manualAcceleratorProbeTarget) {
		t.Fatalf("probe URI %q does not contain official target %q", requestURI, manualAcceleratorProbeTarget)
	}

	setManualAcceleratorForTest(t, app, "")
	res = requestJSON(t, app, http.MethodPost, "/api/v1/github/accelerators/probe", token, nil)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"ok":false`) || !strings.Contains(res.Body.String(), "尚未配置手动加速源") {
		t.Fatalf("empty manual accelerator probe should report unavailable: status=%d body=%s", res.Code, res.Body.String())
	}
	if hits.Load() != 1 {
		t.Fatalf("empty configuration triggered an additional probe: hits=%d", hits.Load())
	}
}

func TestOnlyExplicitProxyOrAcceleratorChangesDownloadRoute(t *testing.T) {
	app := newTestApp(t)
	setManualAcceleratorForTest(t, app, "")
	const raw = "https://github.com/example/project/releases/download/v1/archive.tar.gz"

	// Settings left by the removed automatic-probing implementation are inert.
	app.setSetting("github_accelerator_mode", "auto")
	app.setSetting("github_accelerator_extra_prefixes", "https://legacy-auto.example")
	if got := app.githubDownloadRoute(raw); got.URL != raw || got.Direct {
		t.Fatalf("unconfigured route = %#v, want official URL", got)
	}
	if _, err := app.DB.Exec(`update system_setups set github_accelerator_enabled=true,github_accelerator_url='ftp://legacy-invalid.example'`); err != nil {
		t.Fatal(err)
	}
	if got := app.githubDownloadRoute(raw); got.URL != raw || got.Direct {
		t.Fatalf("invalid persisted accelerator changed route: %#v", got)
	}

	setManualAcceleratorForTest(t, app, "https://operator-mirror.example")
	if got := app.githubDownloadRoute(raw); got.URL != "https://operator-mirror.example/"+raw || !got.Direct {
		t.Fatalf("manual accelerator route = %#v", got)
	}

	if _, err := app.DB.Exec(`update system_setups set github_proxy_enabled=true,github_http_proxy='http://127.0.0.1:18080'`); err != nil {
		t.Fatal(err)
	}
	if got := app.githubDownloadRoute(raw); got.URL != raw || got.Direct {
		t.Fatalf("explicit proxy must keep the official URL, got %#v", got)
	}
}

func TestFriendlyGitHubAPIError(t *testing.T) {
	err := friendlyGitHubAPIError(stringsToError("github api 403 Forbidden: {\"message\":\"API rate limit exceeded for 1.2.3.4.\"}"))
	if err == nil || !strings.Contains(err.Error(), "匿名限流") || !strings.Contains(err.Error(), "5000") {
		t.Fatalf("rate-limit hint missing: %v", err)
	}
	err = friendlyGitHubAPIError(stringsToError("github api 401 Unauthorized: {\"message\":\"Bad credentials\"}"))
	if err == nil || !strings.Contains(err.Error(), "Token 无效") {
		t.Fatalf("bad-credentials hint missing: %v", err)
	}
	if err := friendlyGitHubAPIError(stringsToError("github api 404 Not Found: {}")); err == nil || strings.Contains(err.Error(), "限流") {
		t.Fatalf("404 must stay untouched: %v", err)
	}
}

func stringsToError(msg string) error { return &testError{msg} }

type testError struct{ msg string }

func (e *testError) Error() string { return e.msg }

func TestMaskGitHubToken(t *testing.T) {
	cases := map[string]string{
		"":                        "",
		"short":                   "****",
		"ghp_token1234567890abcd": "ghp_******abcd",
	}
	for input, want := range cases {
		if got := maskGitHubToken(input); got != want {
			t.Fatalf("maskGitHubToken(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestGitHubTokenLegacyStorageMigratesWithoutChangingValue(t *testing.T) {
	app := newTestApp(t)
	const token = "ghp_legacytoken1234567890"
	app.setSetting(settingGitHubToken, token)
	if err := app.migrateGitHubTokenStorage(); err != nil {
		t.Fatal(err)
	}
	if got := app.githubToken(); got != token {
		t.Fatalf("migrated token = %q", got)
	}
	var count int
	if err := app.DB.QueryRow(`select count(*) from settings where key=?`, settingGitHubToken).Scan(&count); err != nil || count != 0 {
		t.Fatalf("legacy plaintext key remains: count=%d err=%v", count, err)
	}
	const replacement = "ghp_replacement1234567890"
	admin := tokenForRole(t, app, "admin")
	res := requestJSON(t, app, http.MethodPut, "/api/v1/settings", admin, map[string]any{settingGitHubToken: replacement})
	if res.Code != http.StatusOK || app.githubToken() != replacement {
		t.Fatalf("legacy settings endpoint did not encrypt replacement token: status=%d body=%s", res.Code, res.Body.String())
	}
	if err := app.DB.QueryRow(`select count(*) from settings where key=?`, settingGitHubToken).Scan(&count); err != nil || count != 0 {
		t.Fatalf("legacy settings endpoint stored plaintext token: count=%d err=%v", count, err)
	}
}
