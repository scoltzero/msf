package server

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestDockerRuntimeEnvOverride(t *testing.T) {
	t.Setenv("MSF_RUNTIME", "docker")
	if !IsDockerRuntime() {
		t.Fatal("MSF_RUNTIME=docker should enable Docker runtime")
	}

	t.Setenv("MSF_RUNTIME", "native")
	if IsDockerRuntime() {
		t.Fatal("non-empty non-docker MSF_RUNTIME should disable Docker auto-detection")
	}
}

func TestDockerCleanupNetworkOnExitDefault(t *testing.T) {
	t.Setenv("MSF_DOCKER_CLEANUP_NETWORK_ON_EXIT", "")
	if !DockerCleanupNetworkOnExit() {
		t.Fatal("Docker network cleanup should default to enabled")
	}

	t.Setenv("MSF_DOCKER_CLEANUP_NETWORK_ON_EXIT", "false")
	if DockerCleanupNetworkOnExit() {
		t.Fatal("MSF_DOCKER_CLEANUP_NETWORK_ON_EXIT=false should disable cleanup")
	}
}

func TestDockerNetworkModeAliases(t *testing.T) {
	t.Setenv("MSF_DOCKER_NETWORK_MODE", "")
	if got := DockerNetworkMode(); got != "host-tun" {
		t.Fatalf("empty docker network mode = %q, want host-tun", got)
	}
	t.Setenv("MSF_DOCKER_NETWORK_MODE", "macvlan")
	if got := DockerNetworkMode(); got != "macvlan-tun" {
		t.Fatalf("macvlan alias = %q, want macvlan-tun", got)
	}
}

func TestDockerRuntimeDefaultsToTunGeneratedConfig(t *testing.T) {
	t.Setenv("MSF_RUNTIME", "docker")
	app := newTestApp(t)

	cfg := SetupConfig{}
	cfg.defaults()
	if cfg.LinuxProxyMode != "tun" {
		t.Fatalf("docker default linux_proxy_mode = %q, want tun", cfg.LinuxProxyMode)
	}

	body := map[string]any{
		"username":           "root",
		"password":           "test-password-123",
		"confirmPassword":    "test-password-123",
		"webPort":            "17777",
		"selected_interface": "eth0",
		"proxyCore":          "mihomo",
		"mosdnsEnabled":      true,
		"mihomo_core_type":   "meta",
		"enableIPv6":         true,
		"auto_set_dns":       true,
	}
	res := requestJSON(t, app, http.MethodPost, "/api/v1/setup/initialize", "", body)
	if res.Code != http.StatusOK {
		t.Fatalf("initialize status=%d body=%s", res.Code, res.Body.String())
	}
	if got := app.setting(nftDesiredKey, ""); got != "false" {
		t.Fatalf("docker tun should not request nft restore, got %q", got)
	}

	mihomo, err := os.ReadFile(filepath.Join(app.DataDir, "configs/mihomo/config.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	assertValidYAML(t, mihomo)
	text := string(mihomo)
	for _, want := range []string{
		"tun:",
		"enable: true",
		"stack: system",
		"auto-route: true",
		"auto-detect-interface: true",
		"strict-route: false",
		"auto-redirect: false",
		"dns-hijack: []",
		"route-address:",
		"- 28.0.0.0/8",
		"- f2b0::/18",
		"- 8.8.8.8/32",
		"- 1.1.1.1/32",
		"route-exclude-address:",
		"- 192.168.0.0/16",
		"- fc00::/7",
		"proxy-server-nameserver:",
		"- 223.5.5.5",
		"- 119.29.29.29",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("docker tun mihomo config missing %q:\n%s", want, text)
		}
	}
	for _, unexpected := range []string{"redir-port:", "tproxy-port:", "routing-mark:", "- any:53"} {
		if strings.Contains(text, unexpected) {
			t.Fatalf("docker tun mihomo config should not contain %q:\n%s", unexpected, text)
		}
	}
	template := app.mihomoCustomTemplateContent()
	for _, want := range []string{"tun.enable: true", "tun.stack: system", "tun.auto-route: true", "tun.auto-detect-interface: true", "tun.auto-redirect: false", "tun.dns-hijack: []", "tun.route-address 包含 Fake-IP 网段", "dns.proxy-server-nameserver"} {
		if !strings.Contains(template, want) {
			t.Fatalf("docker tun custom template missing %q:\n%s", want, template)
		}
	}
	for _, unexpected := range []string{"redir-port: 7877", "tproxy-port: 7896", "routing-mark: 1"} {
		if strings.Contains(template, unexpected) {
			t.Fatalf("docker tun custom template should not contain %q:\n%s", unexpected, template)
		}
	}
	fallback, ok := app.mihomoControllerFallback("configs")
	if !ok {
		t.Fatal("expected Mihomo configs fallback")
	}
	fallbackConfig, ok := fallback.(map[string]any)
	if !ok {
		t.Fatalf("fallback config type = %T", fallback)
	}
	if _, ok := fallbackConfig["tun"]; !ok {
		t.Fatalf("docker tun fallback should expose tun config: %#v", fallbackConfig)
	}
	tunFallback, ok := fallbackConfig["tun"].(map[string]any)
	if !ok {
		t.Fatalf("docker tun fallback type = %T: %#v", fallbackConfig["tun"], fallbackConfig["tun"])
	}
	if tunFallback["stack"] != "system" {
		t.Fatalf("docker tun fallback stack = %#v, want system", tunFallback["stack"])
	}
	if hijack, ok := tunFallback["dns-hijack"].([]string); !ok || len(hijack) != 0 {
		t.Fatalf("docker tun fallback dns-hijack = %#v, want empty string list", tunFallback["dns-hijack"])
	}
	if !stringSliceContainsAny(tunFallback["route-address"], "28.0.0.0/8") {
		t.Fatalf("docker tun fallback route-address missing fake-ip range: %#v", tunFallback["route-address"])
	}
	if !stringSliceContainsAny(tunFallback["route-exclude-address"], "192.168.0.0/16") {
		t.Fatalf("docker tun fallback route-exclude-address missing LAN exclusion: %#v", tunFallback["route-exclude-address"])
	}
	dnsFallback, ok := fallbackConfig["dns"].(map[string]any)
	if !ok || !stringSliceContainsAny(dnsFallback["proxy-server-nameserver"], "223.5.5.5") || !stringSliceContainsAny(dnsFallback["proxy-server-nameserver"], "119.29.29.29") {
		t.Fatalf("docker tun fallback dns.proxy-server-nameserver missing: %#v", fallbackConfig["dns"])
	}
	for _, unexpected := range []string{"redir-port", "tproxy-port", "routing-mark"} {
		if _, ok := fallbackConfig[unexpected]; ok {
			t.Fatalf("docker tun fallback should not expose %s: %#v", unexpected, fallbackConfig)
		}
	}

	network, err := os.ReadFile(filepath.Join(app.DataDir, "configs/network/network.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	networkText := string(network)
	if !strings.Contains(networkText, "mode: tun") {
		t.Fatalf("network.yaml should use tun mode:\n%s", networkText)
	}
	for _, unexpected := range []string{"tproxy_port:", "listen_port:", "mark:", "table:"} {
		if strings.Contains(networkText, unexpected) {
			t.Fatalf("docker tun network.yaml should not contain %q:\n%s", unexpected, networkText)
		}
	}
	if _, err := os.Stat(filepath.Join(app.DataDir, "configs/network/network.nft")); !os.IsNotExist(err) {
		t.Fatalf("docker tun should not create network.nft, err=%v", err)
	}
}

func TestDockerRuntimeDefaultsIPv6OffWhenOmitted(t *testing.T) {
	t.Setenv("MSF_RUNTIME", "docker")
	app := newTestApp(t)

	body := map[string]any{
		"username":           "root",
		"password":           "test-password-123",
		"confirmPassword":    "test-password-123",
		"webPort":            "17777",
		"selected_interface": "eth0",
		"proxyCore":          "mihomo",
		"mosdnsEnabled":      true,
		"mihomo_core_type":   "meta",
		"auto_set_dns":       true,
	}
	res := requestJSON(t, app, http.MethodPost, "/api/v1/setup/initialize", "", body)
	if res.Code != http.StatusOK {
		t.Fatalf("initialize status=%d body=%s", res.Code, res.Body.String())
	}
	cfg, ok := app.latestSetupConfig()
	if !ok {
		t.Fatal("missing setup config")
	}
	if cfg.EnableIPv6 {
		t.Fatal("docker setup should default enable_ipv6 to false when omitted")
	}
	mihomo, err := os.ReadFile(filepath.Join(app.DataDir, "configs/mihomo/config.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	assertValidYAML(t, mihomo)
	if strings.Contains(string(mihomo), "- f2b0::/18") {
		t.Fatalf("docker default TUN route-address should not include IPv6 fake range when enableIPv6 is omitted:\n%s", string(mihomo))
	}
}

func TestLinuxTunGeneratedConfigUsesUnifiedTunDefaults(t *testing.T) {
	t.Setenv("MSF_RUNTIME", "native")
	app := newTestApp(t)
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
	if got := app.setting(nftDesiredKey, ""); got != "false" {
		t.Fatalf("linux tun should not request nft restore, got %q", got)
	}
	mihomo, err := os.ReadFile(filepath.Join(app.DataDir, "configs/mihomo/config.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	assertValidYAML(t, mihomo)
	text := string(mihomo)
	for _, want := range []string{"stack: system", "dns-hijack: []", "route-address:", "- 28.0.0.0/8", "- f2b0::/18", "route-exclude-address:", "proxy-server-nameserver:"} {
		if !strings.Contains(text, want) {
			t.Fatalf("linux tun mihomo config missing %q:\n%s", want, text)
		}
	}
	for _, unexpected := range []string{"redir-port:", "tproxy-port:", "routing-mark:", "- any:53"} {
		if strings.Contains(text, unexpected) {
			t.Fatalf("linux tun mihomo config should not contain %q:\n%s", unexpected, text)
		}
	}
	if _, err := os.Stat(filepath.Join(app.DataDir, "configs/network/network.nft")); !os.IsNotExist(err) {
		t.Fatalf("linux tun should not create network.nft, err=%v", err)
	}
}

func TestLinuxNFTGeneratedConfigKeepsTransparentProxyDefaults(t *testing.T) {
	t.Setenv("MSF_RUNTIME", "native")
	app := newTestApp(t)
	body := map[string]any{
		"username":           "root",
		"password":           "test-password-123",
		"confirmPassword":    "test-password-123",
		"webPort":            "17777",
		"selected_interface": "eth0",
		"proxyCore":          "mihomo",
		"mosdnsEnabled":      true,
		"mihomo_core_type":   "meta",
		"linux_proxy_mode":   "nft",
		"enableIPv6":         true,
		"auto_set_dns":       true,
	}
	res := requestJSON(t, app, http.MethodPost, "/api/v1/setup/initialize", "", body)
	if res.Code != http.StatusOK {
		t.Fatalf("initialize status=%d body=%s", res.Code, res.Body.String())
	}
	if got := app.setting(nftDesiredKey, ""); got != "true" {
		t.Fatalf("linux nft should request nft restore, got %q", got)
	}
	mihomo, err := os.ReadFile(filepath.Join(app.DataDir, "configs/mihomo/config.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	assertValidYAML(t, mihomo)
	text := string(mihomo)
	for _, want := range []string{"redir-port: 7877", "tproxy-port: 7896", "routing-mark: 1", "tun:", "enable: false"} {
		if !strings.Contains(text, want) {
			t.Fatalf("linux nft mihomo config missing %q:\n%s", want, text)
		}
	}
	for _, unexpected := range []string{"proxy-server-nameserver:", "dns-hijack: []", "route-address:"} {
		if strings.Contains(text, unexpected) {
			t.Fatalf("linux nft mihomo config should not contain %q:\n%s", unexpected, text)
		}
	}
	if _, err := os.Stat(filepath.Join(app.DataDir, "configs/network/network.nft")); err != nil {
		t.Fatalf("linux nft should create network.nft, err=%v", err)
	}
}

func TestDockerTunPreflightSkipsTProxyRedirectPorts(t *testing.T) {
	t.Setenv("MSF_RUNTIME", "docker")
	for _, item := range setupReservedPorts("tun") {
		if item.Port == 7877 || item.Port == 7896 {
			t.Fatalf("docker tun preflight should not reserve %d", item.Port)
		}
	}
	foundRedirect := false
	foundTProxy := false
	for _, item := range setupReservedPorts("nft") {
		foundRedirect = foundRedirect || item.Port == 7877
		foundTProxy = foundTProxy || item.Port == 7896
	}
	if !foundRedirect || !foundTProxy {
		t.Fatal("nft preflight should still reserve redirect/tproxy ports")
	}
}

func TestDockerRuntimeDisablesSelfUpdateAPI(t *testing.T) {
	t.Setenv("MSF_RUNTIME", "docker")
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")

	status := requestJSON(t, app, http.MethodGet, "/api/v1/update/status", token, nil)
	for _, want := range []string{`"supported":false`, `"has_update":false`, DockerUpdateDisabledReason()} {
		if !strings.Contains(status.Body.String(), want) {
			t.Fatalf("docker update status missing %q: status=%d body=%s", want, status.Code, status.Body.String())
		}
	}

	for _, item := range []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/api/v1/update/check"},
		{http.MethodPost, "/api/v1/update/download"},
		{http.MethodPost, "/api/v1/update/install"},
	} {
		res := requestJSON(t, app, item.method, item.path, token, nil)
		if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"success":false`) || !strings.Contains(res.Body.String(), DockerUpdateDisabledReason()) {
			t.Fatalf("%s %s should reject self-update in docker: status=%d body=%s", item.method, item.path, res.Code, res.Body.String())
		}
	}
}

func TestFnOSRuntimeDisablesSelfUpdateAPI(t *testing.T) {
	t.Setenv("MSF_RUNTIME", "fnos")
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")

	status := requestJSON(t, app, http.MethodGet, "/api/v1/update/status", token, nil)
	for _, want := range []string{`"supported":false`, `"has_update":false`, FnOSUpdateDisabledReason()} {
		if !strings.Contains(status.Body.String(), want) {
			t.Fatalf("fnOS update status missing %q: status=%d body=%s", want, status.Code, status.Body.String())
		}
	}

	for _, item := range []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/api/v1/update/check"},
		{http.MethodPost, "/api/v1/update/download"},
		{http.MethodPost, "/api/v1/update/install"},
	} {
		res := requestJSON(t, app, item.method, item.path, token, nil)
		if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"success":false`) || !strings.Contains(res.Body.String(), FnOSUpdateDisabledReason()) {
			t.Fatalf("%s %s should reject self-update in fnOS: status=%d body=%s", item.method, item.path, res.Code, res.Body.String())
		}
	}
}

func TestPolicyRouteCommandsAreIdempotent(t *testing.T) {
	deletes := policyRouteRuleDeleteCommands()
	if len(deletes) != 32 {
		t.Fatalf("policyRouteRuleDeleteCommands len=%d, want 32", len(deletes))
	}
	install := strings.Join(flattenCommandArgs(policyRouteInstallCommands()), "\n")
	for _, want := range []string{
		"ip rule add fwmark 1 table 100",
		"ip route replace local 0.0.0.0/0 dev lo table 100",
		"ip -6 rule add fwmark 1 table 100",
		"ip -6 route replace local ::/0 dev lo table 100",
	} {
		if !strings.Contains(install, want) {
			t.Fatalf("install commands missing %q:\n%s", want, install)
		}
	}
	clear := strings.Join(flattenCommandArgs(policyRouteClearCommands()), "\n")
	for _, want := range []string{
		"ip rule del fwmark 1 table 100",
		"ip route del local 0.0.0.0/0 dev lo table 100",
		"ip -6 rule del fwmark 1 table 100",
		"ip -6 route del local ::/0 dev lo table 100",
	} {
		if !strings.Contains(clear, want) {
			t.Fatalf("clear commands missing %q:\n%s", want, clear)
		}
	}
}

func flattenCommandArgs(cmds [][]string) []string {
	out := make([]string, 0, len(cmds))
	for _, cmd := range cmds {
		out = append(out, strings.Join(cmd, " "))
	}
	return out
}

func stringSliceContainsAny(value any, want string) bool {
	switch v := value.(type) {
	case []string:
		for _, item := range v {
			if item == want {
				return true
			}
		}
	case []any:
		for _, item := range v {
			if item == want {
				return true
			}
		}
	}
	return false
}

func assertValidYAML(t *testing.T, content []byte) {
	t.Helper()
	var parsed any
	if err := yaml.Unmarshal(content, &parsed); err != nil {
		t.Fatalf("generated YAML should parse: %v\n%s", err, string(content))
	}
}
