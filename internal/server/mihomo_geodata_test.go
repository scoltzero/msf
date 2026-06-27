package server

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnsureGeneratedMihomoConfigCompatibilityPatchesOldGeneratedConfig(t *testing.T) {
	app := &App{DataDir: t.TempDir()}
	configPath := filepath.Join(app.DataDir, "configs/mihomo/config.yaml")
	if err := os.MkdirAll(filepath.Dir(configPath), 0755); err != nil {
		t.Fatal(err)
	}
	oldConfig := `mode: rule
global-client-fingerprint: chrome
geo-auto-update: true
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
	assertValidYAML(t, got)
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
		"geo-auto-update: true",
		"client-fingerprint: chrome",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("compat patch missing %q:\n%s", want, text)
		}
	}
}

func TestEnsureGeneratedMihomoConfigCompatibilityRepairsOldGeneratedTunConfig(t *testing.T) {
	app := newTestApp(t)
	initializeTunSetupForCompatibilityTest(t, app)
	configPath := filepath.Join(app.DataDir, "configs/mihomo/config.yaml")
	if err := os.WriteFile(configPath, []byte(oldV037TunMihomoConfig()), 0644); err != nil {
		t.Fatal(err)
	}

	app.ensureGeneratedMihomoConfigCompatibility()

	got, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	assertValidYAML(t, got)
	text := string(got)
	for _, want := range []string{
		"tun:",
		"stack: system",
		"auto-route: true",
		"auto-detect-interface: true",
		"strict-route: false",
		"auto-redirect: false",
		"dns-hijack: []",
		"route-address:",
		"- 28.0.0.0/8",
		"- f2b0::/18",
		"route-exclude-address:",
		"- 192.168.0.0/16",
		"proxy-server-nameserver:",
		"- 223.5.5.5",
		"- 119.29.29.29",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("repaired TUN config missing %q:\n%s", want, text)
		}
	}
	for _, unexpected := range []string{"redir-port:", "tproxy-port:", "routing-mark:", "stack: mixed", "- any:53"} {
		if strings.Contains(text, unexpected) {
			t.Fatalf("repaired TUN config should not contain %q:\n%s", unexpected, text)
		}
	}
}

func TestEnsureGeneratedMihomoConfigCompatibilityDoesNotRewriteCustomTunConfig(t *testing.T) {
	app := newTestApp(t)
	initializeTunSetupForCompatibilityTest(t, app)
	app.setMihomoConfigMode("custom")
	configPath := filepath.Join(app.DataDir, "configs/mihomo/config.yaml")
	if err := os.WriteFile(configPath, []byte(oldV037TunMihomoConfig()), 0644); err != nil {
		t.Fatal(err)
	}

	app.ensureGeneratedMihomoConfigCompatibility()

	got, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	text := string(got)
	for _, want := range []string{"redir-port: 7877", "tproxy-port: 7896", "routing-mark: 1", "stack: mixed", "- any:53"} {
		if !strings.Contains(text, want) {
			t.Fatalf("custom TUN config should not be rewritten; missing %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "proxy-server-nameserver:") || strings.Contains(text, "route-address:") {
		t.Fatalf("custom TUN config should not get generated TUN fields:\n%s", text)
	}
}

func TestEnsureBaseLayoutDoesNotCreateMihomoGeoDataFiles(t *testing.T) {
	app := newTestApp(t)

	if err := app.EnsureBaseLayout(); err != nil {
		t.Fatal(err)
	}
	if fileExists(filepath.Join(app.DataDir, "configs/mihomo/GeoSite.dat")) {
		t.Fatal("EnsureBaseLayout should not download or create GeoSite.dat")
	}
	if fileExists(filepath.Join(app.DataDir, "configs/mihomo/GeoIP.dat")) {
		t.Fatal("EnsureBaseLayout should not download or create GeoIP.dat")
	}
	cfg, err := os.ReadFile(filepath.Join(app.DataDir, "configs/mihomo/config.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(cfg), "geo-auto-update: false") {
		t.Fatalf("default Mihomo config should disable geo auto update:\n%s", string(cfg))
	}
}

func initializeTunSetupForCompatibilityTest(t *testing.T, app *App) {
	t.Helper()
	body := map[string]any{
		"username":           "root",
		"password":           "test-password-123",
		"confirmPassword":    "test-password-123",
		"webPort":            "17777",
		"selected_interface": "eth0",
		"proxyCore":          "mihomo",
		"mosdnsEnabled":      true,
		"mihomo_core_type":   "meta",
		"linux_proxy_mode":   "tun",
		"enableIPv6":         true,
		"auto_set_dns":       true,
	}
	res := requestJSON(t, app, http.MethodPost, "/api/v1/setup/initialize", "", body)
	if res.Code != http.StatusOK {
		t.Fatalf("initialize status=%d body=%s", res.Code, res.Body.String())
	}
}

func oldV037TunMihomoConfig() string {
	return `mode: rule
log-level: info
redir-port: 7877
tproxy-port: 7896
routing-mark: 1
interface-name: eth0
dns:
  enable: true
  listen: 0.0.0.0:6666
  ipv6: true
  enhanced-mode: fake-ip
  fake-ip-range: 28.0.0.1/8
  default-nameserver:
    - 127.0.0.1:8888
tun:
  enable: true
  stack: mixed
  device: mihomo
  auto-route: true
  auto-detect-interface: true
  auto-redirect: false
  dns-hijack:
    - any:53
proxy-groups:
  - {name: 节点选择, type: select, proxies: [DIRECT]}
rules:
  - MATCH,节点选择
`
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
