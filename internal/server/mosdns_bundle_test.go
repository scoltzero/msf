package server

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInstallMosDNSBundleInstallsCompleteRuntime(t *testing.T) {
	app := newTestApp(t)
	archive := writeMosDNSBundleFixture(t, map[string][]byte{
		"bundle/cus/bin/mosdns": minimalAMD64ELF(),
		"bundle/cus/mosdns/config_custom.yaml": []byte(`log:
  level: warn
api:
  http: "0.0.0.0:9099"
include:
  - "sub_config/rule_set.yaml"
`),
		"bundle/cus/mosdns/sub_config/rule_set.yaml": []byte("plugins:\n  - tag: direct_ip\n    type: ip_set\n"),
		"bundle/cus/mosdns/rule/whitelist.txt":       []byte("example.com\n"),
		"bundle/monitor/bin/mosdns-traffic-agent":    minimalAMD64ELF(),
		"bundle/monitor/config/config.json":          []byte(`{"listen":"0.0.0.0:9199","interfaces":["old0"]}`),
	})

	if err := app.installMosDNSBundle(context.Background(), archive, "eth0"); err != nil {
		t.Fatal(err)
	}
	if !app.hasMosDNSBundle() {
		t.Fatal("complete MosDNS bundle should be installed")
	}

	configPath := filepath.Join(app.DataDir, "configs/mosdns/config_custom.yaml")
	config, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(config), `http: "127.0.0.1:9099"`) {
		t.Fatalf("MosDNS API must be loopback-only:\n%s", config)
	}
	if _, err := os.Stat(filepath.Join(app.DataDir, "configs/mosdns/config.yaml")); !os.IsNotExist(err) {
		t.Fatalf("legacy generated config.yaml must not survive bundle installation: %v", err)
	}
	if _, err := os.Stat(filepath.Join(app.DataDir, "configs/mosdns/nft/nftadd.json")); !os.IsNotExist(err) {
		t.Fatalf("legacy nft_add configuration must not survive bundle installation: %v", err)
	}

	trafficConfig, err := os.ReadFile(filepath.Join(app.DataDir, "configs/monitor/config.json"))
	if err != nil {
		t.Fatal(err)
	}
	var traffic map[string]any
	if err := json.Unmarshal(trafficConfig, &traffic); err != nil {
		t.Fatal(err)
	}
	if traffic["listen"] != "127.0.0.1:9199" || traffic["mosdns_backend"] != "http://127.0.0.1:9099" {
		t.Fatalf("traffic agent endpoints were not restricted to loopback: %#v", traffic)
	}
	interfaces, _ := traffic["interfaces"].([]any)
	if len(interfaces) != 1 || interfaces[0] != "eth0" {
		t.Fatalf("traffic agent interface mismatch: %#v", traffic["interfaces"])
	}

	mosdnsSpec, err := app.Services.spec("mosdns")
	if err != nil {
		t.Fatal(err)
	}
	if mosdnsSpec.Config != configPath || !containsString(mosdnsSpec.Args, "-c") || !containsString(mosdnsSpec.Args, configPath) {
		t.Fatalf("MosDNS service must use config_custom.yaml: %#v", mosdnsSpec)
	}
	agentSpec, err := app.Services.spec("mosdns-traffic-agent")
	if err != nil {
		t.Fatal(err)
	}
	if agentSpec.Config != filepath.Join(app.DataDir, "configs/monitor/config.json") {
		t.Fatalf("traffic agent config mismatch: %#v", agentSpec)
	}
}

func TestSetupMosDNSInstallAcceptsBundleBeforeInitialization(t *testing.T) {
	app := newTestApp(t)
	archive := readFileForTest(t, writeMosDNSBundleFixture(t, map[string][]byte{
		"cus/bin/mosdns":                              minimalAMD64ELF(),
		"cus/mosdns/config_custom.yaml":               []byte("api:\n  http: \":9099\"\n"),
		"cus/mosdns/config_overrides.json":            []byte(`{"socks5":"127.0.0.1:7891","ecs":"2408:8214:213::1"}`),
		"cus/mosdns/upstream_overrides.json":          mosDNSUpstreamOverridesFixture(),
		"cus/mosdns/adguard/config.json":              []byte(`[{"id":"httpdns","name":"httpdns","type":"adguard","url":"https://example.com/httpdns.txt","enabled":true},{"id":"pcdn1","name":"pcdn1","type":"adguard","url":"https://example.com/pcdn1.txt","enabled":true}]`),
		"cus/mosdns/rule/.keep":                       nil,
		"cus/mosdns/srs/geositecn.json":               []byte(`[{"name":"geosite_cn","type":"geositecn","files":"srs/geosite-cn.srs","url":"https://example.com/geosite-cn.srs","enabled":true}]`),
		"cus/mosdns/srs/geositenocn.json":             []byte(`[{"name":"geosite_no_cn","type":"geositenocn","files":"srs/geolocation-!cn.srs","url":"https://example.com/geolocation.srs","enabled":true}]`),
		"cus/mosdns/srs/geoipcn.json":                 []byte(`[{"name":"geoip_cn","type":"geoipcn","files":"srs/geoip-cn.srs","url":"https://example.com/geoip-cn.srs","enabled":true}]`),
		"cus/mosdns/srs/cusnocn.json":                 []byte(`[{"name":"tiktok","type":"cusnocn","files":"srs/geosite-tiktok.srs","url":"https://example.com/tiktok.srs","enabled":true}]`),
		"cus/mosdns/sub_config/forward_local.yaml":    []byte("plugins:\n  - tag: domestic\n    type: forward\n    args:\n      upstreams:\n        - addr: udp://223.5.5.5\n"),
		"cus/mosdns/sub_config/forward_nocn.yaml":     []byte("plugins:\n  - tag: foreign\n    type: forward\n    args:\n      upstreams:\n        - addr: https://1.1.1.1/dns-query\n"),
		"cus/mosdns/sub_config/forward_nocn_ecs.yaml": []byte("plugins:\n  - tag: foreignecs\n    type: forward\n    args:\n      upstreams:\n        - addr: https://1.1.1.1/dns-query\n  - tag: ecs_sequence\n    type: sequence\n    args:\n      - exec: ecs 2408:8214:213::1\n"),
		"cus/mosdns/sub_config/forward_1.yaml":        []byte("plugins:\n  - tag: foreign_fakeip\n    type: aliapi\n    args:\n      upstreams:\n        - addr: udp://127.0.0.1:9333\n"),
		"monitor/bin/mosdns-traffic-agent":            minimalAMD64ELF(),
		"monitor/config/config.json":                  []byte(`{"listen":":9199"}`),
	}))

	res := requestMultipartFile(t, app, http.MethodPost, "/api/v1/setup/mosdns/install", "", "file", "mosdns.zip", archive, nil)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"success":true`) {
		t.Fatalf("setup bundle install failed: status=%d body=%s", res.Code, res.Body.String())
	}
	if !app.hasMosDNSBundle() {
		t.Fatal("setup route did not install a complete bundle")
	}
}

func TestAuthenticatedMosDNSInstallAcceptsCompleteBundle(t *testing.T) {
	app := newTestApp(t)
	archive := readFileForTest(t, writeMosDNSBundleFixture(t, completeMosDNSBundleFixture()))
	token := tokenForRole(t, app, "admin")

	res := requestMultipartFile(t, app, http.MethodPost, "/api/v1/mosdns/install", token, "file", "mosdns.zip", archive, nil)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"success":true`) {
		t.Fatalf("authenticated bundle install failed: status=%d body=%s", res.Code, res.Body.String())
	}
	if !app.hasMosDNSBundle() {
		t.Fatal("authenticated install route did not install a complete bundle")
	}
}

func TestComponentUploadInstallsCompleteMosDNSBundle(t *testing.T) {
	app := newTestApp(t)
	archive := readFileForTest(t, writeMosDNSBundleFixture(t, completeMosDNSBundleFixture()))
	token := tokenForRole(t, app, "admin")

	res := requestMultipartFile(t, app, http.MethodPost, "/api/v1/component-updates/mosdns/upload", token, "file", "mosdns.zip", archive, nil)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"success":true`) {
		t.Fatalf("component bundle upload failed: status=%d body=%s", res.Code, res.Body.String())
	}
	if !app.hasMosDNSBundle() {
		t.Fatal("component upload route did not install a complete bundle")
	}
}

func TestGeneratedConfigsDoNotRestoreLegacyMosDNSTemplates(t *testing.T) {
	app := newTestApp(t)
	archive := writeMosDNSBundleFixture(t, completeMosDNSBundleFixture())
	if err := app.installMosDNSBundle(context.Background(), archive, "eth0"); err != nil {
		t.Fatal(err)
	}
	cfg := SetupConfig{SelectedInterface: "eth0", ProxyCore: "mihomo", MosDNSEnabled: true}
	cfg.defaults()
	if err := app.writeGeneratedConfigs(cfg); err != nil {
		t.Fatal(err)
	}
	for _, legacy := range []string{
		"configs/mosdns/config.yaml",
		"configs/mosdns/nft/nftadd.json",
		"configs/mosdns/nft/fixip.txt",
	} {
		if _, err := os.Stat(filepath.Join(app.DataDir, filepath.FromSlash(legacy))); !os.IsNotExist(err) {
			t.Fatalf("legacy MosDNS file must not be regenerated: %s (%v)", legacy, err)
		}
	}
	if _, ok := runtimeTemplateText("mosdns/config.yaml"); ok {
		t.Fatal("legacy MosDNS runtime template must not remain embedded")
	}
}

func TestMosDNSConfigEndpointDefaultsToBundleEntry(t *testing.T) {
	app := newTestApp(t)
	archive := writeMosDNSBundleFixture(t, completeMosDNSBundleFixture())
	if err := app.installMosDNSBundle(context.Background(), archive, "eth0"); err != nil {
		t.Fatal(err)
	}
	token := tokenForRole(t, app, "admin")
	res := requestJSON(t, app, http.MethodGet, "/api/v1/mosdns/config/file", token, nil)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"path":"configs/mosdns/config_custom.yaml"`) {
		t.Fatalf("MosDNS config endpoint must default to bundle entry: status=%d body=%s", res.Code, res.Body.String())
	}
}

func completeMosDNSBundleFixture() map[string][]byte {
	return map[string][]byte{
		"cus/bin/mosdns":                              minimalAMD64ELF(),
		"cus/mosdns/config_custom.yaml":               []byte("api:\n  http: \":9099\"\n"),
		"cus/mosdns/config_overrides.json":            []byte(`{"socks5":"127.0.0.1:7891","ecs":"2408:8214:213::1"}`),
		"cus/mosdns/upstream_overrides.json":          mosDNSUpstreamOverridesFixture(),
		"cus/mosdns/adguard/config.json":              []byte(`[{"id":"httpdns","name":"httpdns","type":"adguard","url":"https://example.com/httpdns.txt","enabled":true},{"id":"pcdn1","name":"pcdn1","type":"adguard","url":"https://example.com/pcdn1.txt","enabled":true}]`),
		"cus/mosdns/rule/.keep":                       nil,
		"cus/mosdns/srs/geositecn.json":               []byte(`[{"name":"geosite_cn","type":"geositecn","files":"srs/geosite-cn.srs","url":"https://example.com/geosite-cn.srs","enabled":true}]`),
		"cus/mosdns/srs/geositenocn.json":             []byte(`[{"name":"geosite_no_cn","type":"geositenocn","files":"srs/geolocation-!cn.srs","url":"https://example.com/geolocation.srs","enabled":true}]`),
		"cus/mosdns/srs/geoipcn.json":                 []byte(`[{"name":"geoip_cn","type":"geoipcn","files":"srs/geoip-cn.srs","url":"https://example.com/geoip-cn.srs","enabled":true}]`),
		"cus/mosdns/srs/cusnocn.json":                 []byte(`[{"name":"tiktok","type":"cusnocn","files":"srs/geosite-tiktok.srs","url":"https://example.com/tiktok.srs","enabled":true}]`),
		"cus/mosdns/sub_config/forward_local.yaml":    []byte("plugins:\n  - tag: domestic\n    type: forward\n    args:\n      upstreams:\n        - addr: udp://223.5.5.5\n"),
		"cus/mosdns/sub_config/forward_nocn.yaml":     []byte("plugins:\n  - tag: foreign\n    type: forward\n    args:\n      upstreams:\n        - addr: https://1.1.1.1/dns-query\n"),
		"cus/mosdns/sub_config/forward_nocn_ecs.yaml": []byte("plugins:\n  - tag: foreignecs\n    type: forward\n    args:\n      upstreams:\n        - addr: https://1.1.1.1/dns-query\n  - tag: ecs_sequence\n    type: sequence\n    args:\n      - exec: ecs 2408:8214:213::1\n"),
		"cus/mosdns/sub_config/forward_1.yaml":        []byte("plugins:\n  - tag: foreign_fakeip\n    type: aliapi\n    args:\n      upstreams:\n        - addr: udp://127.0.0.1:9333\n"),
		"monitor/bin/mosdns-traffic-agent":            minimalAMD64ELF(),
		"monitor/config/config.json":                  []byte(`{"listen":":9199"}`),
	}
}

func mosDNSUpstreamOverridesFixture() []byte {
	return []byte(`{
  "domestic": [{"tag":"carrier","enabled":true,"protocol":"udp","addr":"202.96.134.133"}],
  "foreign": [{"tag":"Google","enabled":true,"protocol":"https","addr":"https://dns.google/dns-query","dial_addr":"8.8.8.8","socks5":"127.0.0.1:9666"}],
  "foreign_fakeip": [{"tag":"SingBox","enabled":true,"protocol":"udp","addr":"127.0.0.1:9333"}],
  "foreignecs": [{"tag":"Google","enabled":true,"protocol":"https","addr":"https://dns.google/dns-query","dial_addr":"8.8.8.8","socks5":"127.0.0.1:9666"}]
}`)
}

func writeMosDNSBundleFixture(t *testing.T, files map[string][]byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "mosdns-bundle.zip")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	for name, content := range files {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write(content); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

func readFileForTest(t *testing.T, path string) []byte {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return content
}

func minimalAMD64ELF() []byte {
	header := make([]byte, 64)
	copy(header, []byte{0x7f, 'E', 'L', 'F', 2, 1, 1})
	binary.LittleEndian.PutUint16(header[16:18], 2)
	binary.LittleEndian.PutUint16(header[18:20], 62)
	binary.LittleEndian.PutUint32(header[20:24], 1)
	binary.LittleEndian.PutUint16(header[52:54], 64)
	binary.LittleEndian.PutUint16(header[54:56], 56)
	binary.LittleEndian.PutUint16(header[58:60], 64)
	return bytes.Clone(header)
}
