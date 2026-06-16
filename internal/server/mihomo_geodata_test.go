package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnsureMihomoGeoDataFilesDownloadsMissingFiles(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/geosite.dat":
			_, _ = w.Write([]byte("site-data"))
		case "/geoip.dat":
			_, _ = w.Write([]byte("ip-data"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	withMihomoGeoDataTestFiles(t, []mihomoGeoDataFile{
		{Name: "GeoSite.dat", URL: server.URL + "/geosite.dat"},
		{Name: "GeoIP.dat", URL: server.URL + "/geoip.dat"},
	})
	app := &App{DataDir: t.TempDir()}

	if err := app.ensureMihomoGeoDataFiles(); err != nil {
		t.Fatal(err)
	}
	assertFileContent(t, filepath.Join(app.DataDir, "configs/mihomo/GeoSite.dat"), "site-data")
	assertFileContent(t, filepath.Join(app.DataDir, "configs/mihomo/GeoIP.dat"), "ip-data")
}

func TestEnsureMihomoGeoDataFilesSkipsExistingAndIgnoresFailures(t *testing.T) {
	hits := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		http.Error(w, "failed", http.StatusInternalServerError)
	}))
	defer server.Close()
	withMihomoGeoDataTestFiles(t, []mihomoGeoDataFile{
		{Name: "GeoSite.dat", URL: server.URL + "/geosite.dat"},
		{Name: "GeoIP.dat", URL: server.URL + "/geoip.dat"},
	})
	app := &App{DataDir: t.TempDir()}
	existing := filepath.Join(app.DataDir, "configs/mihomo/GeoSite.dat")
	if err := os.MkdirAll(filepath.Dir(existing), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(existing, []byte("existing"), 0644); err != nil {
		t.Fatal(err)
	}

	if err := app.ensureMihomoGeoDataFiles(); err != nil {
		t.Fatal(err)
	}
	assertFileContent(t, existing, "existing")
	if fileExists(filepath.Join(app.DataDir, "configs/mihomo/GeoIP.dat")) {
		t.Fatal("failed GeoIP download should not leave a target file")
	}
	if hits != 1 {
		t.Fatalf("expected only missing file to be downloaded, got %d hits", hits)
	}
}

func TestEnsureGeneratedMihomoConfigCompatibilityPatchesOldGeneratedConfig(t *testing.T) {
	app := &App{DataDir: t.TempDir()}
	configPath := filepath.Join(app.DataDir, "configs/mihomo/config.yaml")
	if err := os.MkdirAll(filepath.Dir(configPath), 0755); err != nil {
		t.Fatal(err)
	}
	oldConfig := `mode: rule
global-client-fingerprint: chrome
geox-url:
  geoip: "https://github.com/MetaCubeX/meta-rules-dat/releases/latest/download/geoip.dat"
  geosite: "https://github.com/MetaCubeX/meta-rules-dat/releases/latest/download/geosite.dat"
  mmdb: 'https://gitlab.com/Masaiki/GeoIP2-CN/-/raw/release/Country.mmdb'
  asn: 'https://gitlab.com/Loon0x00/loon_data/-/raw/main/geo/GeoLite2-ASN.mmdb'
proxies:
  - name: keep
    client-fingerprint: chrome
`
	if err := os.WriteFile(configPath, []byte(oldConfig), 0644); err != nil {
		t.Fatal(err)
	}

	app.ensureGeneratedMihomoConfigCompatibility()

	got, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	text := string(got)
	for _, bad := range []string{
		"global-client-fingerprint",
		"releases/latest/download/geosite.dat",
		"releases/latest/download/geoip.dat",
		"gitlab.com/Masaiki",
		"gitlab.com/Loon0x00",
	} {
		if strings.Contains(text, bad) {
			t.Fatalf("compat patch left old content %q:\n%s", bad, text)
		}
	}
	for _, want := range []string{
		"releases/download/latest/geosite.dat",
		"releases/download/latest/geoip.dat",
		"releases/download/latest/geoip.metadb",
		"releases/download/latest/GeoLite2-ASN.mmdb",
		"client-fingerprint: chrome",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("compat patch missing %q:\n%s", want, text)
		}
	}
}

func TestMihomoOverviewDoesNotDialTProxyPort(t *testing.T) {
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")
	api := newFakeMihomoController(t)
	defer api.Close()
	app.setSetting("mihomo_controller_endpoint", api.URL)

	old := mihomoTCPPortOpen
	ports := []int{}
	mihomoTCPPortOpen = func(host string, port int) bool {
		ports = append(ports, port)
		if port == 7896 {
			t.Fatalf("overview should not TCP dial Mihomo TProxy port")
		}
		return true
	}
	t.Cleanup(func() { mihomoTCPPortOpen = old })

	overview := requestJSON(t, app, http.MethodGet, "/api/v1/mihomo/overview", token, nil)
	if overview.Code != http.StatusOK || !strings.Contains(overview.Body.String(), `"tproxy":false`) {
		t.Fatalf("overview should expose tproxy health without dialing it: status=%d body=%s", overview.Code, overview.Body.String())
	}
	full := requestJSON(t, app, http.MethodGet, "/api/v1/mihomo/overview?full=1", token, nil)
	if full.Code != http.StatusOK || !strings.Contains(full.Body.String(), `"tproxy":false`) {
		t.Fatalf("full overview should expose tproxy health without dialing it: status=%d body=%s", full.Code, full.Body.String())
	}
	for _, port := range ports {
		if port == 7896 {
			t.Fatalf("unexpected tproxy dial recorded in ports: %v", ports)
		}
	}
}

func withMihomoGeoDataTestFiles(t *testing.T, files []mihomoGeoDataFile) {
	t.Helper()
	oldFiles := mihomoGeoDataFiles
	oldAuto := mihomoGeoDataAutoEnsure
	mihomoGeoDataFiles = files
	mihomoGeoDataAutoEnsure = true
	t.Cleanup(func() {
		mihomoGeoDataFiles = oldFiles
		mihomoGeoDataAutoEnsure = oldAuto
	})
}

func assertFileContent(t *testing.T, path, want string) {
	t.Helper()
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != want {
		t.Fatalf("content mismatch for %s: got %q want %q", path, string(got), want)
	}
}
