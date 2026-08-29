package server

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

// --- helpers -------------------------------------------------------------

func smartAssetFor(goos, goarch string, amd64v3 bool, commit string) string {
	base := "mihomo-" + goos + "-" + goarch
	if goos == "darwin" && goarch == "amd64" {
		return base + "-compatible-alpha-smart-" + commit + ".gz"
	}
	if goarch == "amd64" && amd64v3 {
		return base + "-v3-alpha-smart-" + commit + ".gz"
	}
	if goarch == "amd64" {
		return base + "-v1-alpha-smart-" + commit + ".gz"
	}
	return base + "-alpha-smart-" + commit + ".gz"
}

func gzipBytes(t *testing.T, data []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if _, err := zw.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func fakeMihomoScript(rejectConfig bool) []byte {
	script := `#!/bin/sh
case "$1" in
  -v)
    echo "Mihomo v1.35.0-alpha-smart-abc1234"
    exit 0
    ;;
  -t)
    if [ -n "$MSF_REJECT_CONFIG" ]; then
      echo "config validation failed: unsupported smart field"
      exit 1
    fi
    exit 0
    ;;
esac
echo "unexpected args: $*"
exit 0
`
	if rejectConfig {
		script = strings.Replace(script, "-n \"$MSF_REJECT_CONFIG\"", "1 -eq 1", 1)
		script = strings.Replace(script, "exit 0\n    ;;\n    ;;", "exit 1\n    ;;\n    ;;", 1)
	}
	return []byte(script)
}

func fakeMetaScriptRejectingSmartGroups() []byte {
	return []byte(`#!/bin/sh
case "$1" in
  -v)
    echo "Mihomo Meta v1.19.30"
    exit 0
    ;;
  -t)
    config=""
    while [ "$#" -gt 0 ]; do
      if [ "$1" = "-f" ]; then
        shift
        config="$1"
        break
      fi
      shift
    done
    if [ -n "$config" ] && grep -Eq 'type:[[:space:]]*smart' "$config"; then
      echo 'proxy group: unsupported type: smart'
      exit 1
    fi
    exit 0
    ;;
esac
exit 0
`)
}

func writeMihomoActiveConfig(t *testing.T, app *App) string {
	t.Helper()
	configPath := filepath.Join(app.DataDir, mihomoActiveConfigRelPath)
	if err := os.MkdirAll(filepath.Dir(configPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(configPath, []byte(testMihomoConfigYAML("Smart")), 0644); err != nil {
		t.Fatal(err)
	}
	return configPath
}

func writeInstalledMihomoBinary(t *testing.T, app *App, content string) string {
	t.Helper()
	target := app.componentTarget("mihomo")
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte(content), 0755); err != nil {
		t.Fatal(err)
	}
	return target
}

func insertSetupRow(t *testing.T, app *App, coreType string, amd64v3 bool, acceleratorURL string) {
	t.Helper()
	now := time.Now()
	// Provide non-NULL values for the nullable columns that setup GET and the
	// structured-settings readers scan into Go strings, so a NULL does not
	// cause the row to be silently ignored in tests.
	if _, err := app.DB.Exec(`insert into system_setups(created_at,updated_at,username,email,timezone,web_port,amd64v3_enabled,selected_interface,singbox_core_type,mihomo_core_type,auto_set_dns,dns_on,dns_off,enable_ipv6,fake_ip_range_v4,fake_ip_range_v6,linux_proxy_mode,nft_proxy_policy,proxy_core,mos_dns_enabled,subscription_urls,mihomo_proxies,github_proxy_enabled,github_https_proxy,github_http_proxy,github_socks5_proxy,github_accelerator_enabled,github_accelerator_url,is_initialized)
		values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		now, now, "root", "", "Asia/Shanghai", "7777", amd64v3, "eth0", "", coreType, true, "127.0.0.1", "223.5.5.5", false, "28.0.0.0/8", "f2b0::/18", "nft", "direct_default", "mihomo", true, "", "", false, "", "", "", acceleratorURL != "", acceleratorURL, true); err != nil {
		t.Fatal(err)
	}
}

func smartReleaseForPlatform(commit, digest string) githubRelease {
	goos := runtime.GOOS
	goarch := runtime.GOARCH
	name := smartAssetFor(goos, goarch, false, commit)
	return githubRelease{
		TagName: "Prerelease-Alpha",
		Name:    "Prerelease-Alpha",
		Assets: []githubAsset{{
			Name:               name,
			BrowserDownloadURL: "https://github.com/vernesong/mihomo/releases/download/Prerelease-Alpha/" + name,
			Digest:             digest,
		}},
	}
}

func newSmartSwitchServer(t *testing.T, release githubRelease, blob []byte) *httptest.Server {
	t.Helper()
	return newCapturingReleaseServer(t, release, blob, nil)
}

func newCapturingReleaseServer(t *testing.T, release githubRelease, blob []byte, captures *[]string) *httptest.Server {
	t.Helper()
	releaseJSON, err := json.Marshal(release)
	if err != nil {
		t.Fatal(err)
	}
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if captures != nil {
			*captures = append(*captures, r.URL.Path)
		}
		switch {
		case strings.Contains(r.URL.Path, "api.github.com"):
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(releaseJSON)
		case strings.Contains(r.URL.Path, "releases/download"):
			w.Header().Set("Content-Type", "application/octet-stream")
			_, _ = w.Write(blob)
		default:
			http.NotFound(w, r)
		}
	}))
}

// metaReleaseForPlatform builds an official MetaCubeX latest release whose
// single asset matches the runtime platform, for switch tests targeting meta.
func metaReleaseForPlatform(tag string) githubRelease {
	goos := runtime.GOOS
	goarch := runtime.GOARCH
	base := "mihomo-" + goos + "-" + goarch
	var name string
	switch {
	case goos == "darwin" && goarch == "amd64":
		name = base + "-compatible-" + tag + ".gz"
	case goarch == "amd64":
		name = base + "-v1-" + tag + ".gz"
	default:
		name = base + "-" + tag + ".gz"
	}
	return githubRelease{
		TagName: tag,
		Name:    tag,
		Assets: []githubAsset{{
			Name:               name,
			BrowserDownloadURL: "https://github.com/MetaCubeX/mihomo/releases/download/" + tag + "/" + name,
			Digest:             testSHA256Digest([]byte(tag + name)),
		}},
	}
}

// --- persistence normalization ------------------------------------------

func TestMihomoCoreTypeDefaultsPreserveSmart(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want string
	}{
		{"smart", "smart"},
		{"SMART", "smart"},
		{"mihomo", "meta"},
		{"meta", "meta"},
		{"alpha", "meta"},
		{"legacy", "meta"},
		{"", "meta"},
	} {
		var cfg SetupConfig
		cfg.MihomoCoreType = tc.in
		cfg.defaults()
		if cfg.MihomoCoreType != tc.want {
			t.Fatalf("SetupConfig.defaults(%q) = %q, want %q", tc.in, cfg.MihomoCoreType, tc.want)
		}
		var cfg2 SetupConfig
		cfg2.MihomoCoreType = tc.in
		applySetupStringDefaults(&cfg2)
		if cfg2.MihomoCoreType != tc.want {
			t.Fatalf("applySetupStringDefaults(%q) = %q, want %q", tc.in, cfg2.MihomoCoreType, tc.want)
		}
	}
}

func TestComponentDownloadUsesRunningMihomoWhenNoExplicitProxy(t *testing.T) {
	app := newTestApp(t)
	writeInstalledMihomoBinary(t, app, "test-mihomo")
	if err := app.writeTextFile(mihomoActiveConfigRelPath, "mixed-port: 17892\n"); err != nil {
		t.Fatal(err)
	}
	pidPath := filepath.Join(app.DataDir, "data", "mihomo.pid")
	if err := os.MkdirAll(filepath.Dir(pidPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(os.Getpid())), 0o644); err != nil {
		t.Fatal(err)
	}
	client := app.downloadHTTPClient()
	transport, ok := client.Transport.(*http.Transport)
	if !ok || transport.Proxy == nil {
		t.Fatalf("download client did not configure the running Mihomo proxy: %#v", client.Transport)
	}
	proxyURL, err := transport.Proxy(&http.Request{URL: mustURL(t, "https://github.com/example/file")})
	if err != nil {
		t.Fatal(err)
	}
	if proxyURL == nil || proxyURL.String() != "http://127.0.0.1:17892" {
		t.Fatalf("download proxy = %v, want local Mihomo mixed port", proxyURL)
	}
}

func TestComponentDownloadContextCancellation(t *testing.T) {
	app := newTestApp(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := app.downloadFileContext(ctx, server.URL, filepath.Join(app.DataDir, "data", "cancelled.download"), nil)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled download error = %v, want context.Canceled", err)
	}
}

func TestMihomoCoreSwitchProgressUsesExistingComponentState(t *testing.T) {
	app := newTestApp(t)
	insertSetupRow(t, app, "meta", false, "")
	writeInstalledMihomoBinary(t, app, "test-mihomo")
	app.setMihomoCoreSwitchState("smart", "switching", 42, "")
	state := app.componentUpdateState("mihomo")
	if stringMapValue(state, "status") != "switching" || intAny(state["progress"], 0) != 42 {
		t.Fatalf("switch progress was not exposed through component state: %#v", state)
	}
	if stringMapValue(state, "core_type") != "meta" {
		t.Fatalf("progress must not persist the target core before success: %#v", state)
	}
}

func TestMihomoCoreSwitchDownloadURLUsesVerifiedAcceleratorPath(t *testing.T) {
	const raw = "https://github.com/vernesong/mihomo/releases/download/Prerelease-Alpha/mihomo-linux-amd64-v1-alpha-smart-deadbee.gz"
	t.Run("default", func(t *testing.T) {
		app := newTestApp(t)
		if got := app.mihomoCoreSwitchDownloadURL(raw); got != defaultMihomoCoreSwitchAccelerator+raw {
			t.Fatalf("default switch download URL = %q", got)
		}
	})
	t.Run("configured accelerator", func(t *testing.T) {
		app := newTestApp(t)
		insertSetupRow(t, app, "meta", false, "https://mirror.example")
		if got := app.mihomoCoreSwitchDownloadURL(raw); got != "https://mirror.example/"+raw {
			t.Fatalf("configured switch download URL = %q", got)
		}
	})
}

func TestSmartMihomoAssetSelectionRejectsPackageFormats(t *testing.T) {
	const commit = "b750813"
	base := smartAssetFor("linux", "amd64", false, commit)
	deb := strings.TrimSuffix(base, ".gz") + ".deb"
	rpm := strings.TrimSuffix(base, ".gz") + ".rpm"
	release := githubRelease{TagName: "Prerelease-Alpha", Assets: []githubAsset{
		{Name: deb, BrowserDownloadURL: "https://example.invalid/" + deb},
		{Name: rpm, BrowserDownloadURL: "https://example.invalid/" + rpm},
		{Name: base, BrowserDownloadURL: "https://example.invalid/" + base},
	}}
	asset, ok := componentReleaseAssetForCore(release, "mihomo", "linux", "amd64", "smart", false, "")
	if !ok || asset.Name != base {
		t.Fatalf("selected Smart asset = %q, want gzip %q", asset.Name, base)
	}
}

func TestSmartMihomoDisplayVersionDoesNotUseGoVersion(t *testing.T) {
	raw := "Mihomo Meta alpha-smart-b750813 linux amd64 with go1.26.7 Fri Aug 28 01:28:56 UTC 2026"
	display, detail := componentDisplayCurrentVersion("mihomo", raw, "Prerelease-Alpha-b750813")
	if display != "alpha-smart-b750813" || detail != raw {
		t.Fatalf("Smart display/detail = %q / %q", display, detail)
	}
}

func mustURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}

func TestMihomoCoreTypeDBNormalizationPreservesSmart(t *testing.T) {
	app := newTestApp(t)
	now := time.Now()

	// Valid smart survives normalization.
	app.DB.Exec(`delete from system_setups`)
	if _, err := app.DB.Exec(`insert into system_setups(created_at,updated_at,username,mihomo_core_type) values(?,?,?,?)`, now, now, "smart_user", "smart"); err != nil {
		t.Fatal(err)
	}
	if err := app.normalizePersistedRows(); err != nil {
		t.Fatal(err)
	}
	var got string
	if err := app.DB.QueryRow(`select mihomo_core_type from system_setups where username='smart_user'`).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != "smart" {
		t.Fatalf("smart persisted core type was clobbered to %q, want smart", got)
	}

	// Invalid/empty/legacy values resolve to meta.
	for _, tc := range []struct {
		name  string
		value string
	}{
		{"alpha", "alpha"},
		{"empty", ""},
		{"invalid", "garbage"},
	} {
		app.DB.Exec(`delete from system_setups`)
		if _, err := app.DB.Exec(`insert into system_setups(created_at,updated_at,username,mihomo_core_type) values(?,?,?,?)`, now, now, tc.name, tc.value); err != nil {
			t.Fatal(err)
		}
		if err := app.normalizePersistedRows(); err != nil {
			t.Fatal(err)
		}
		if err := app.DB.QueryRow(`select mihomo_core_type from system_setups where username=?`, tc.name).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != "meta" {
			t.Fatalf("%s core type = %q, want meta", tc.name, got)
		}
	}
}

func TestMihomoCoreTypeStructuredSettingsRoundTrip(t *testing.T) {
	app := newTestApp(t)
	insertSetupRow(t, app, "meta", false, "")
	admin := tokenForRole(t, app, "admin")

	// Persist a valid smart selection through structured settings.
	res := requestJSON(t, app, http.MethodPut, "/api/v1/settings/structured", admin, map[string]any{
		"mihomo": map[string]any{"core_type": "smart"},
	})
	if res.Code != http.StatusOK {
		t.Fatalf("structured settings smart core put failed: status=%d body=%s", res.Code, res.Body.String())
	}
	var persisted string
	if err := app.DB.QueryRow(`select mihomo_core_type from system_setups order by id desc limit 1`).Scan(&persisted); err != nil {
		t.Fatal(err)
	}
	if persisted != "smart" {
		t.Fatalf("structured settings persisted core type = %q, want smart", persisted)
	}

	got := requestJSON(t, app, http.MethodGet, "/api/v1/settings/structured", admin, nil)
	if !strings.Contains(got.Body.String(), `"core_type":"smart"`) {
		t.Fatalf("structured settings get missing smart core: status=%d body=%s", got.Code, got.Body.String())
	}

	// Legacy/invalid structured values are rejected or normalize to meta.
	if res := requestJSON(t, app, http.MethodPut, "/api/v1/settings/structured", admin, map[string]any{
		"mihomo": map[string]any{"core_type": "alpha"},
	}); res.Code != http.StatusBadRequest {
		t.Fatalf("invalid structured core type should be rejected, status=%d body=%s", res.Code, res.Body.String())
	}

	// Setting mihomo (alias) normalizes to meta.
	if res := requestJSON(t, app, http.MethodPut, "/api/v1/settings/structured", admin, map[string]any{
		"mihomo": map[string]any{"core_type": "mihomo"},
	}); res.Code != http.StatusOK {
		t.Fatalf("structured settings mihomo alias should be accepted, status=%d body=%s", res.Code, res.Body.String())
	}
	if err := app.DB.QueryRow(`select mihomo_core_type from system_setups order by id desc limit 1`).Scan(&persisted); err != nil {
		t.Fatal(err)
	}
	if persisted != "meta" {
		t.Fatalf("structured settings mihomo alias persisted core type = %q, want meta", persisted)
	}
}

func TestMihomoSmartSourceAndAssetSelection(t *testing.T) {
	// Smart uses the vernesong orphan Prerelease-Alpha stream.
	if got := componentDownloadURLFor("mihomo", "linux", "amd64", "smart", false); !strings.Contains(got, "vernesong/mihomo/releases/tag/Prerelease-Alpha") {
		t.Fatalf("smart download URL = %q, want vernesong Prerelease-Alpha", got)
	}
	// Meta source unchanged.
	if got := componentDownloadURLFor("mihomo", "linux", "amd64", "meta", false); !strings.Contains(got, "MetaCubeX/mihomo/releases/latest") {
		t.Fatalf("meta download URL = %q, want MetaCubeX latest", got)
	}

	release := githubRelease{TagName: "Prerelease-Alpha", Assets: []githubAsset{
		{Name: "mihomo-linux-amd64-v1-alpha-smart-aaa1111.gz", BrowserDownloadURL: "https://example.invalid/v1.gz", Digest: testSHA256Digest([]byte("v1"))},
		{Name: "mihomo-linux-amd64-v3-alpha-smart-aaa1111.gz", BrowserDownloadURL: "https://example.invalid/v3.gz", Digest: testSHA256Digest([]byte("v3"))},
		{Name: "mihomo-linux-arm64-alpha-smart-aaa1111.gz", BrowserDownloadURL: "https://example.invalid/arm64.gz", Digest: testSHA256Digest([]byte("arm64"))},
		{Name: "mihomo-darwin-amd64-compatible-alpha-smart-aaa1111.gz", BrowserDownloadURL: "https://example.invalid/darwin-amd64.gz", Digest: testSHA256Digest([]byte("darwin"))},
		{Name: "mihomo-darwin-arm64-alpha-smart-aaa1111.gz", BrowserDownloadURL: "https://example.invalid/darwin-arm64.gz", Digest: testSHA256Digest([]byte("darwin-arm64"))},
	}}

	// v3 selected for amd64 when amd64v3 is enabled.
	if got, ok := componentReleaseAssetForCore(release, "mihomo", "linux", "amd64", "smart", true, ""); !ok || got.Name != "mihomo-linux-amd64-v3-alpha-smart-aaa1111.gz" {
		t.Fatalf("smart v3 asset selection failed: ok=%v name=%q", ok, got.Name)
	}
	// v1 selected for amd64 when amd64v3 is disabled.
	if got, ok := componentReleaseAssetForCore(release, "mihomo", "linux", "amd64", "smart", false, ""); !ok || got.Name != "mihomo-linux-amd64-v1-alpha-smart-aaa1111.gz" {
		t.Fatalf("smart v1 asset selection failed: ok=%v name=%q", ok, got.Name)
	}
	// Meta asset name selection unchanged.
	if got := componentReleaseAssetNameFor(githubRelease{TagName: "v1.19.30"}, "mihomo", "linux", "amd64", true, ""); got != "mihomo-linux-amd64-v3-v1.19.30.gz" {
		t.Fatalf("meta asset name selection changed: %q", got)
	}
}

func TestMihomoSmartAssetSelectionIndependentOfOrdering(t *testing.T) {
	v1 := githubAsset{Name: "mihomo-linux-amd64-v1-alpha-smart-bbbb2222.gz", BrowserDownloadURL: "https://example.invalid/v1.gz", Digest: testSHA256Digest([]byte("v1"))}
	v3 := githubAsset{Name: "mihomo-linux-amd64-v3-alpha-smart-bbbb2222.gz", BrowserDownloadURL: "https://example.invalid/v3.gz", Digest: testSHA256Digest([]byte("v3"))}
	unversioned := githubAsset{Name: "mihomo-linux-amd64-alpha-smart-bbbb2222.gz", BrowserDownloadURL: "https://example.invalid/u.gz", Digest: testSHA256Digest([]byte("u"))}
	orders := [][]githubAsset{
		{v3, v1, unversioned},
		{unversioned, v1, v3},
		{v1, unversioned, v3},
		{v1, v3, unversioned},
	}
	for i, assets := range orders {
		release := githubRelease{TagName: "Prerelease-Alpha", Assets: assets}
		got, ok := componentReleaseAssetForCore(release, "mihomo", "linux", "amd64", "smart", true, "")
		if !ok || got.Name != v3.Name {
			t.Fatalf("order %d: smart v3 selection = %q (ok=%v), want %q", i, got.Name, ok, v3.Name)
		}
	}
}

func TestMihomoSmartFixedTagUpdateIdentity(t *testing.T) {
	commitA := "abc1234"
	commitB := "def5678"
	releaseA := githubRelease{TagName: "Prerelease-Alpha", Assets: []githubAsset{{
		Name:               smartAssetFor(runtime.GOOS, runtime.GOARCH, false, commitA),
		BrowserDownloadURL: "https://example.invalid/a.gz",
		Digest:             testSHA256Digest([]byte("a")),
	}}}
	releaseB := githubRelease{TagName: "Prerelease-Alpha", Assets: []githubAsset{{
		Name:               smartAssetFor(runtime.GOOS, runtime.GOARCH, false, commitB),
		BrowserDownloadURL: "https://example.invalid/b.gz",
		Digest:             testSHA256Digest([]byte("b")),
	}}}
	va := smartMihomoVersionIdentity(releaseA, runtime.GOOS, runtime.GOARCH, false)
	vb := smartMihomoVersionIdentity(releaseB, runtime.GOOS, runtime.GOARCH, false)
	if va == "" || vb == "" || va == vb {
		t.Fatalf("smart identity should change with commit: va=%q vb=%q", va, vb)
	}
	if !strings.Contains(va, commitA) || !strings.Contains(vb, commitB) {
		t.Fatalf("smart identity should expose asset commit: va=%q vb=%q", va, vb)
	}

	// Digest fallback when no commit token is present in the asset name.
	digestOnly := githubRelease{TagName: "Prerelease-Alpha", Assets: []githubAsset{{
		Name:               "mihomo-smart-" + runtime.GOOS + "-" + runtime.GOARCH + ".gz",
		BrowserDownloadURL: "https://example.invalid/d.gz",
		Digest:             testSHA256Digest([]byte("digest")),
	}}}
	vd := smartMihomoVersionIdentity(digestOnly, runtime.GOOS, runtime.GOARCH, false)
	if !strings.Contains(vd, "Prerelease-Alpha") {
		t.Fatalf("digest fallback identity missing tag prefix: %q", vd)
	}

	// componentRemoteVersion for a smart app derives identity from the asset.
	app := newTestApp(t)
	insertSetupRow(t, app, "smart", false, "")
	got := app.componentRemoteVersion("mihomo", releaseA)
	if got != "Prerelease-Alpha-"+commitA {
		t.Fatalf("componentRemoteVersion(smart) = %q, want Prerelease-Alpha-%s", got, commitA)
	}
}

// --- switch endpoint -----------------------------------------------------

func TestMihomoCoreSwitchSuccess(t *testing.T) {
	app := newTestApp(t)
	commit := "cafe1234"
	script := fakeMihomoScript(false)
	blob := gzipBytes(t, script)
	digest := testSHA256Digest(blob)
	release := smartReleaseForPlatform(commit, digest)
	var captured []string
	server := newCapturingReleaseServer(t, release, blob, &captured)
	defer server.Close()

	insertSetupRow(t, app, "meta", false, server.URL)
	writeMihomoActiveConfig(t, app)
	writeInstalledMihomoBinary(t, app, "original-meta-binary")

	res := requestJSON(t, app, http.MethodPost, "/api/v1/component-updates/mihomo/switch", tokenForRole(t, app, "admin"), map[string]any{"core_type": "smart"})
	if res.Code != http.StatusOK {
		t.Fatalf("smart switch failed: status=%d body=%s", res.Code, res.Body.String())
	}
	if !strings.Contains(res.Body.String(), `"success":true`) {
		t.Fatalf("smart switch success flag missing: %s", res.Body.String())
	}
	var persisted string
	if err := app.DB.QueryRow(`select mihomo_core_type from system_setups order by id desc limit 1`).Scan(&persisted); err != nil {
		t.Fatal(err)
	}
	if persisted != "smart" {
		t.Fatalf("post-switch persisted core type = %q, want smart", persisted)
	}
	installed, err := os.ReadFile(app.componentTarget("mihomo"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(installed), "alpha-smart-abc1234") {
		t.Fatalf("installed binary was not replaced with the smart candidate: %q", string(installed))
	}
	state := app.componentUpdateState("mihomo")
	if stringMapValue(state, "core_type") != "smart" || stringMapValue(state, "installed_core_type") != "smart" {
		t.Fatalf("component state did not expose the installed smart branch: %#v", state)
	}
	if !strings.Contains(stringMapValue(state, "release_source"), "vernesong/mihomo") {
		t.Fatalf("component state did not expose the smart release source: %#v", state)
	}
	if stringMapValue(state, "installed_verified_digest") != digest {
		t.Fatalf("component state did not retain the verified switch digest: %#v", state)
	}
	// The smart release was fetched by the fixed Prerelease-Alpha tag, never by
	// the latest-release endpoint used for Meta.
	joined := strings.Join(captured, "\n")
	if !strings.Contains(joined, "vernesong/mihomo/releases/tags/Prerelease-Alpha") {
		t.Fatalf("smart switch did not fetch the Prerelease-Alpha tag: %q", joined)
	}
}

func TestMihomoCoreSwitchRejectsIncompatibleConfig(t *testing.T) {
	app := newTestApp(t)
	commit := "beef5678"
	script := fakeMihomoScript(true)
	blob := gzipBytes(t, script)
	digest := testSHA256Digest(blob)
	release := smartReleaseForPlatform(commit, digest)
	server := newSmartSwitchServer(t, release, blob)
	defer server.Close()

	insertSetupRow(t, app, "meta", false, server.URL)
	writeMihomoActiveConfig(t, app)
	writeInstalledMihomoBinary(t, app, "original-meta-binary")

	res := requestJSON(t, app, http.MethodPost, "/api/v1/component-updates/mihomo/switch", tokenForRole(t, app, "admin"), map[string]any{"core_type": "smart"})
	if !strings.Contains(res.Body.String(), `"success":false`) {
		t.Fatalf("incompatible smart switch should fail: status=%d body=%s", res.Code, res.Body.String())
	}
	var persisted string
	if err := app.DB.QueryRow(`select mihomo_core_type from system_setups order by id desc limit 1`).Scan(&persisted); err != nil {
		t.Fatal(err)
	}
	if persisted != "meta" {
		t.Fatalf("rejected switch left persisted core type = %q, want meta", persisted)
	}
	installed, err := os.ReadFile(app.componentTarget("mihomo"))
	if err != nil {
		t.Fatal(err)
	}
	if string(installed) != "original-meta-binary" {
		t.Fatalf("rejected switch modified installed binary: %q", string(installed))
	}
}

func TestMihomoCoreSwitchRollbackOnRestartFailure(t *testing.T) {
	app := newTestApp(t)
	writeMihomoActiveConfig(t, app)
	writeInstalledMihomoBinary(t, app, "original-binary")
	_ = insertSetupCoreAndBinary(t, app)

	candidate := mihomoCoreCandidate{Binary: writeCandidateScript(t, app, false)}
	defer candidate.cleanup()

	var persisted []string
	restarts := 0
	ops := mihomoCoreSwitchOps{
		Running:     func() bool { return true },
		Restart:     func(context.Context) error { restarts++; return os.ErrPermission },
		Probe:       func() error { return nil },
		CurrentCore: func() string { return "meta" },
		PersistCore: func(v string) error { persisted = append(persisted, v); return nil },
	}

	_, err := app.switchMihomoCoreWithOps(context.Background(), "smart", candidate, ops)
	if err == nil {
		t.Fatal("switch should fail on restart error")
	}
	// Rollback restored the original binary.
	installed, readErr := os.ReadFile(app.componentTarget("mihomo"))
	if readErr != nil {
		t.Fatal(readErr)
	}
	if string(installed) != "original-binary" {
		t.Fatalf("binary not restored on rollback: %q", string(installed))
	}
	// The failed switch never persisted the target core; rollback restored the
	// previous (meta) core only.
	if len(persisted) == 0 || persisted[len(persisted)-1] != "meta" {
		t.Fatalf("rollback should persist previous core meta, got %v", persisted)
	}
	for _, v := range persisted {
		if v == "smart" {
			t.Fatalf("failed switch must not leave target core persisted, got %v", persisted)
		}
	}
	// Restart was attempted both during switch and during rollback.
	if restarts < 2 {
		t.Fatalf("restart should be attempted for switch and rollback, got %d", restarts)
	}
}

func TestMihomoCoreSwitchRollbackOnProbeFailure(t *testing.T) {
	app := newTestApp(t)
	writeMihomoActiveConfig(t, app)
	writeInstalledMihomoBinary(t, app, "original-binary")
	_ = insertSetupCoreAndBinary(t, app)

	candidate := mihomoCoreCandidate{Binary: writeCandidateScript(t, app, false)}
	defer candidate.cleanup()

	var persisted []string
	ops := mihomoCoreSwitchOps{
		Running:     func() bool { return true },
		Restart:     func(context.Context) error { return nil },
		Probe:       func() error { return os.ErrDeadlineExceeded },
		CurrentCore: func() string { return "meta" },
		PersistCore: func(v string) error { persisted = append(persisted, v); return nil },
	}

	_, err := app.switchMihomoCoreWithOps(context.Background(), "smart", candidate, ops)
	if err == nil {
		t.Fatal("switch should fail on controller probe error")
	}
	installed, readErr := os.ReadFile(app.componentTarget("mihomo"))
	if readErr != nil {
		t.Fatal(readErr)
	}
	if string(installed) != "original-binary" {
		t.Fatalf("binary not restored on probe rollback: %q", string(installed))
	}
	if len(persisted) == 0 || persisted[len(persisted)-1] != "meta" {
		t.Fatalf("rollback should persist previous core meta, got %v", persisted)
	}
	for _, v := range persisted {
		if v == "smart" {
			t.Fatalf("failed switch must not leave target core persisted, got %v", persisted)
		}
	}
}

func TestMihomoCoreSwitchRejectsInvalidCoreType(t *testing.T) {
	app := newTestApp(t)
	insertSetupRow(t, app, "meta", false, "")
	admin := tokenForRole(t, app, "admin")

	res := requestJSON(t, app, http.MethodPost, "/api/v1/component-updates/mihomo/switch", admin, map[string]any{"core_type": "alpha"})
	if res.Code != http.StatusBadRequest {
		t.Fatalf("invalid core_type should be rejected, status=%d body=%s", res.Code, res.Body.String())
	}
	if res := requestJSON(t, app, http.MethodPost, "/api/v1/component-updates/mihomo/switch", admin, map[string]any{"core_type": ""}); res.Code != http.StatusBadRequest {
		t.Fatalf("empty core_type should be rejected, status=%d body=%s", res.Code, res.Body.String())
	}
}

func TestMihomoCoreSwitchRejectsUninitializedWithoutDownload(t *testing.T) {
	app := newTestApp(t)
	admin := tokenForRole(t, app, "admin")
	// No setup row: the system is uninitialized and the switch must not attempt
	// to download or resolve a candidate.
	res := requestJSON(t, app, http.MethodPost, "/api/v1/component-updates/mihomo/switch", admin, map[string]any{"core_type": "smart"})
	if res.Code != http.StatusConflict {
		t.Fatalf("uninitialized switch should be rejected, status=%d body=%s", res.Code, res.Body.String())
	}
}

func TestMihomoCoreTypeSetupEndpointsPreserveSmart(t *testing.T) {
	app := newTestApp(t)
	admin := tokenForRole(t, app, "admin")
	// Seed a smart core type directly and confirm the setup GET payload exposes it.
	insertSetupRow(t, app, "smart", false, "")
	get := requestJSON(t, app, http.MethodGet, "/api/v1/setup/config", admin, nil)
	if get.Code != http.StatusOK || !strings.Contains(get.Body.String(), `"mihomo_core_type":"smart"`) || !strings.Contains(get.Body.String(), `"mihomoCoreType":"smart"`) {
		t.Fatalf("setup GET should expose smart core type: status=%d body=%s", get.Code, get.Body.String())
	}
	// PUT setup config with an explicit invalid type must be rejected; valid
	// smart is preserved and does not get clobbered by defaulting.
	put := requestJSON(t, app, http.MethodPut, "/api/v1/setup/config", admin, map[string]any{
		"username":           "root",
		"password":           "x",
		"confirm_password":   "x",
		"selected_interface": "eth0",
		"mihomo_core_type":   "smart",
		"proxy_core":         "mihomo",
		"mos_dns_enabled":    true,
	})
	if put.Code != http.StatusOK {
		t.Fatalf("setup PUT smart core failed: status=%d body=%s", put.Code, put.Body.String())
	}
	var persisted string
	if err := app.DB.QueryRow(`select mihomo_core_type from system_setups order by id desc limit 1`).Scan(&persisted); err != nil {
		t.Fatal(err)
	}
	if persisted != "smart" {
		t.Fatalf("setup PUT persisted core type = %q, want smart", persisted)
	}
}

func TestMihomoCoreSwitchSmartToMetaRestoresDefaultAndPreservesUserConfig(t *testing.T) {
	app := newTestApp(t)
	tag := "v1.19.30"
	script := fakeMetaScriptRejectingSmartGroups()
	blob := gzipBytes(t, script)
	release := metaReleaseForPlatform(tag)
	// Match the digest expected by the asset selection for the runtime asset.
	release.Assets[0].Digest = testSHA256Digest(blob)
	server := newSmartSwitchServer(t, release, blob)
	defer server.Close()

	// Current core and active user config contain a Smart-only group. The Meta
	// candidate would reject that file, so the switch must restore the generated
	// default first while preserving the user-owned source file.
	insertSetupRow(t, app, "smart", false, server.URL)
	custom := strings.Replace(testMihomoConfigYAML("Smart"), "type: select", "type: smart", 1)
	userRel := "configs/mihomo/user_configs/smart-user.yaml"
	if err := app.writeTextFile(userRel, custom); err != nil {
		t.Fatal(err)
	}
	if err := app.writeTextFile(mihomoActiveConfigRelPath, custom); err != nil {
		t.Fatal(err)
	}
	app.setMihomoConfigMode("custom")
	app.setSetting(mihomoAppliedUserConfigKey, userRel)
	writeInstalledMihomoBinary(t, app, string(fakeMihomoScript(false)))
	admin := tokenForRole(t, app, "admin")

	res := requestJSON(t, app, http.MethodPost, "/api/v1/component-updates/mihomo/switch", admin, map[string]any{"core_type": "meta"})
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"success":true`) || !strings.Contains(res.Body.String(), `"default_config_restored":true`) {
		t.Fatalf("smart->meta default migration failed: status=%d body=%s", res.Code, res.Body.String())
	}
	var persisted string
	if err := app.DB.QueryRow(`select mihomo_core_type from system_setups order by id desc limit 1`).Scan(&persisted); err != nil {
		t.Fatal(err)
	}
	if persisted != "meta" {
		t.Fatalf("smart->meta switch left persisted core = %q, want meta", persisted)
	}
	if app.mihomoConfigMode() != "generated" || app.setting(mihomoAppliedUserConfigKey, "") != "" {
		t.Fatalf("successful Meta switch did not select generated config: mode=%s applied=%q", app.mihomoConfigMode(), app.setting(mihomoAppliedUserConfigKey, ""))
	}
	active, err := app.readTextFile(mihomoActiveConfigRelPath)
	if err != nil || strings.Contains(active, "type: smart") {
		t.Fatalf("generated active config still contains Smart group: err=%v content=%s", err, active)
	}
	preserved, err := app.readTextFile(userRel)
	if err != nil || preserved != custom {
		t.Fatalf("user Smart config was not preserved: err=%v content=%s", err, preserved)
	}
	if !fileExists(app.mihomoCoreCachePath("smart")) || !fileExists(app.mihomoCoreCachePath("meta")) {
		t.Fatalf("successful switch did not retain both core caches")
	}
	back := requestJSON(t, app, http.MethodPost, "/api/v1/component-updates/mihomo/switch", admin, map[string]any{"core_type": "smart"})
	if back.Code != http.StatusOK || !strings.Contains(back.Body.String(), `"success":true`) || !strings.Contains(back.Body.String(), `"used_cached_core":true`) {
		t.Fatalf("cached Meta->Smart switch failed: status=%d body=%s", back.Code, back.Body.String())
	}
}

func TestMihomoCoreSwitchMetaFailureRestoresPreviousCustomConfig(t *testing.T) {
	app := newTestApp(t)
	tag := "v1.19.30"
	blob := gzipBytes(t, fakeMihomoScript(true))
	release := metaReleaseForPlatform(tag)
	release.Assets[0].Digest = testSHA256Digest(blob)
	server := newSmartSwitchServer(t, release, blob)
	defer server.Close()

	insertSetupRow(t, app, "smart", false, server.URL)
	custom := strings.Replace(testMihomoConfigYAML("Smart"), "type: select", "type: smart", 1)
	userRel := "configs/mihomo/user_configs/smart-user.yaml"
	if err := app.writeTextFile(userRel, custom); err != nil {
		t.Fatal(err)
	}
	if err := app.writeTextFile(mihomoActiveConfigRelPath, custom); err != nil {
		t.Fatal(err)
	}
	app.setMihomoConfigMode("custom")
	app.setSetting(mihomoAppliedUserConfigKey, userRel)
	writeInstalledMihomoBinary(t, app, "smart-binary")

	res := requestJSON(t, app, http.MethodPost, "/api/v1/component-updates/mihomo/switch", tokenForRole(t, app, "admin"), map[string]any{"core_type": "meta"})
	if !strings.Contains(res.Body.String(), `"success":false`) {
		t.Fatalf("always-rejecting Meta candidate should fail: status=%d body=%s", res.Code, res.Body.String())
	}
	active, err := app.readTextFile(mihomoActiveConfigRelPath)
	if err != nil || active != custom {
		t.Fatalf("failed switch did not restore active custom config: err=%v content=%s", err, active)
	}
	if app.mihomoConfigMode() != "custom" || app.setting(mihomoAppliedUserConfigKey, "") != userRel {
		t.Fatalf("failed switch did not restore config authority: mode=%s applied=%q", app.mihomoConfigMode(), app.setting(mihomoAppliedUserConfigKey, ""))
	}
	var persisted string
	if err := app.DB.QueryRow(`select mihomo_core_type from system_setups order by id desc limit 1`).Scan(&persisted); err != nil {
		t.Fatal(err)
	}
	if persisted != "smart" {
		t.Fatalf("failed Meta switch persisted core = %q, want smart", persisted)
	}
	installed, err := os.ReadFile(app.componentTarget("mihomo"))
	if err != nil || string(installed) != "smart-binary" {
		t.Fatalf("failed Meta switch modified installed core: err=%v content=%q", err, string(installed))
	}
}

func writeCandidateScript(t *testing.T, app *App, reject bool) string {
	t.Helper()
	dir := filepath.Join(app.DataDir, "data", "mihomo-test-candidate")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	bin := filepath.Join(dir, "mihomo")
	if err := os.WriteFile(bin, fakeMihomoScript(reject), 0755); err != nil {
		t.Fatal(err)
	}
	_ = os.Chmod(bin, 0755)
	return bin
}

func insertSetupCoreAndBinary(t *testing.T, app *App) *App {
	t.Helper()
	insertSetupRow(t, app, "meta", false, "")
	return app
}
