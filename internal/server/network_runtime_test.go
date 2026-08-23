package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestNetworkRuntimeLifecycle(t *testing.T) {
	t.Setenv("MSF_RUNTIME", "native")
	app := newTestApp(t)
	cfg := SetupConfig{
		Username:          "root",
		SelectedInterface: "en0",
		LinuxProxyMode:    "tun",
		ProxyCore:         "mihomo",
		MosDNSEnabled:     true,
	}
	cfg.defaults()
	if _, err := app.insertInitializedSetup(cfg); err != nil {
		t.Fatal(err)
	}
	installRuntimeTestBinary(t, app, "mihomo")
	installRuntimeTestBinary(t, app, "mosdns")

	var modesMu sync.Mutex
	var modes []string
	controller := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/configs":
			if r.Method == http.MethodPatch {
				var body map[string]string
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					http.Error(w, err.Error(), http.StatusBadRequest)
					return
				}
				modesMu.Lock()
				modes = append(modes, body["mode"])
				modesMu.Unlock()
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"mode": "rule"})
		case "/traffic":
			_ = json.NewEncoder(w).Encode(map[string]any{"up": 1024, "down": 4096})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(controller.Close)
	app.setSetting("mihomo_controller_endpoint", controller.URL)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = app.Services.StopAll(ctx)
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := app.performNetworkRuntimeAction(ctx, "enable"); err != nil {
		t.Fatalf("enable runtime: %v", err)
	}
	if !app.Services.Status("mihomo").Running || !app.Services.Status("mosdns").Running {
		t.Fatalf("enable should start both services: %#v", app.Services.List())
	}
	if got := app.networkRuntimeDesired(); got != runtimeStateEnabled {
		t.Fatalf("desired state after enable = %q, want %q", got, runtimeStateEnabled)
	}
	if got := app.networkRuntimeSnapshot(ctx)["effective_state"]; got != runtimeStateEnabled {
		t.Fatalf("effective state after enable = %#v, want %q", got, runtimeStateEnabled)
	}

	if err := app.performNetworkRuntimeAction(ctx, "disable"); err != nil {
		t.Fatalf("safe disable runtime: %v", err)
	}
	if !app.Services.Status("mihomo").Running || !app.Services.Status("mosdns").Running {
		t.Fatal("safe disable must keep Mihomo and MosDNS running")
	}
	if got := app.networkRuntimeDesired(); got != runtimeStateDirect {
		t.Fatalf("desired state after safe disable = %q, want %q", got, runtimeStateDirect)
	}

	if err := app.performNetworkRuntimeAction(ctx, "restart"); err != nil {
		t.Fatalf("restart runtime: %v", err)
	}
	if !app.Services.Status("mihomo").Running || !app.Services.Status("mosdns").Running {
		t.Fatal("restart should leave both services running")
	}
	if got := app.networkRuntimeDesired(); got != runtimeStateDirect {
		t.Fatalf("restart should preserve direct desired state, got %q", got)
	}

	if err := app.performNetworkRuntimeAction(ctx, "stop"); err != nil {
		t.Fatalf("full stop runtime: %v", err)
	}
	if app.Services.Status("mihomo").Running || app.Services.Status("mosdns").Running {
		t.Fatalf("full stop should stop both services: %#v", app.Services.List())
	}
	if got := app.networkRuntimeDesired(); got != runtimeStateStopped {
		t.Fatalf("desired state after full stop = %q, want %q", got, runtimeStateStopped)
	}

	modesMu.Lock()
	gotModes := strings.Join(modes, ",")
	modesMu.Unlock()
	if gotModes != "rule,direct,direct" {
		t.Fatalf("Mihomo runtime mode changes = %q, want rule,direct,direct", gotModes)
	}
}

func TestNetworkRuntimeRequiresInitializationAndAuthorization(t *testing.T) {
	app := newTestApp(t)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := app.performNetworkRuntimeAction(ctx, "enable"); err == nil || !strings.Contains(err.Error(), "尚未完成初始化") {
		t.Fatalf("uninitialized enable error = %v", err)
	}

	viewer := tokenForRole(t, app, "viewer")
	if res := requestJSON(t, app, http.MethodGet, "/api/v1/network/runtime", viewer, nil); res.Code != http.StatusOK {
		t.Fatalf("viewer should read runtime state: status=%d body=%s", res.Code, res.Body.String())
	}
	if res := requestJSON(t, app, http.MethodPost, "/api/v1/network/runtime/enable", viewer, nil); res.Code != http.StatusForbidden {
		t.Fatalf("viewer should not mutate runtime state: status=%d body=%s", res.Code, res.Body.String())
	}
	operator := tokenForRole(t, app, "operator")
	if res := requestJSON(t, app, http.MethodPost, "/api/v1/network/runtime/enable", operator, nil); res.Code != http.StatusConflict {
		t.Fatalf("operator should reach runtime action handler: status=%d body=%s", res.Code, res.Body.String())
	}
}

func TestDarwinNetworkCommandParsing(t *testing.T) {
	oldCommand := darwinNetworkCommand
	t.Cleanup(func() { darwinNetworkCommand = oldCommand })
	darwinNetworkCommand = func(_ context.Context, name string, args ...string) ([]byte, error) {
		command := name + " " + strings.Join(args, " ")
		switch command {
		case "/usr/sbin/networksetup -listnetworkserviceorder":
			return []byte(`An asterisk (*) denotes that a network service is disabled.
(1) Wi-Fi
(Hardware Port: Wi-Fi, Device: en0)
(2) *Thunderbolt Bridge
(Hardware Port: Thunderbolt Bridge, Device: bridge0)
(3) USB 10/100/1000 LAN
(Hardware Port: USB 10/100/1000 LAN, Device: en5)
`), nil
		case "/usr/sbin/networksetup -getdnsservers Wi-Fi":
			return []byte("There aren't any DNS Servers set on Wi-Fi.\n"), nil
		case "/usr/sbin/networksetup -getdnsservers USB 10/100/1000 LAN":
			return []byte("1.1.1.1\n8.8.8.8\n"), nil
		case "/sbin/route -n get default":
			return []byte("   route to: default\ninterface: en0\n"), nil
		case "/sbin/route -n get 28.0.0.1":
			return []byte("   route to: 28.0.0.1\ninterface: utun7\n"), nil
		default:
			t.Fatalf("unexpected Darwin command: %s", command)
			return nil, nil
		}
	}

	services, err := listDarwinNetworkServices(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(sortedDarwinServiceNames(services), ","); got != "Thunderbolt Bridge,USB 10/100/1000 LAN,Wi-Fi" {
		t.Fatalf("parsed network services = %q", got)
	}
	if service, ok := darwinServiceForDevice(services, "en0"); !ok || service.Name != "Wi-Fi" {
		t.Fatalf("en0 service mapping = %#v, %v", service, ok)
	}
	if _, ok := darwinServiceForDevice(services, "bridge0"); ok {
		t.Fatal("disabled network service must not be selected")
	}

	wifiDNS, err := getDarwinDNSBackup(context.Background(), darwinNetworkService{Name: "Wi-Fi", Device: "en0"})
	if err != nil || !wifiDNS.Automatic || len(wifiDNS.Servers) != 0 {
		t.Fatalf("automatic Wi-Fi DNS backup = %#v, err=%v", wifiDNS, err)
	}
	usbDNS, err := getDarwinDNSBackup(context.Background(), darwinNetworkService{Name: "USB 10/100/1000 LAN", Device: "en5"})
	if err != nil || usbDNS.Automatic || strings.Join(usbDNS.Servers, ",") != "1.1.1.1,8.8.8.8" {
		t.Fatalf("explicit USB DNS backup = %#v, err=%v", usbDNS, err)
	}
	if iface, err := darwinDefaultRouteInterface(context.Background()); err != nil || iface != "en0" {
		t.Fatalf("default route interface = %q, err=%v", iface, err)
	}
	cfg := SetupConfig{FakeIPRangeV4: "28.0.0.0/8"}
	if iface, err := darwinFakeIPRouteInterface(context.Background(), cfg); err != nil || iface != "utun7" {
		t.Fatalf("Fake-IP route interface = %q, err=%v", iface, err)
	}
	if !darwinDNSContainsLocalhost("192.168.1.1\n127.0.0.1\n") || darwinDNSContainsLocalhost("127.0.0.53\n") {
		t.Fatal("localhost DNS matching is incorrect")
	}
}

func TestChooseDarwinSetupInterfaceSkipsVirtualDefaultRoute(t *testing.T) {
	services := []darwinNetworkService{
		{Name: "Ethernet", Device: "en0"},
		{Name: "Wi-Fi", Device: "en1"},
		{Name: "Disabled LAN", Device: "en8", Disabled: true},
	}
	usable := map[string]bool{"en0": true, "en1": true, "utun5": true}
	check := func(name string) bool { return usable[name] }

	if got := chooseDarwinSetupInterface("utun5", services, check); got != "en0" {
		t.Fatalf("virtual default route selected %q, want first usable physical service en0", got)
	}
	if got := chooseDarwinSetupInterface("en1", services, check); got != "en1" {
		t.Fatalf("physical default route selected %q, want en1", got)
	}
	usable["en0"] = false
	if got := chooseDarwinSetupInterface("utun5", services, check); got != "en1" {
		t.Fatalf("fallback selected %q, want next usable physical service en1", got)
	}
}

func TestMacOSTunConfigLetsMihomoAllocateUtun(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("macOS runtime detection requires a Darwin build")
	}
	cfg := SetupConfig{LinuxProxyMode: "tun", FakeIPRangeV4: "28.0.0.0/8"}

	t.Setenv("MSF_RUNTIME", "native")
	nativeYAML := renderMihomoTunYAML(cfg)
	if !strings.Contains(nativeYAML, "  device: mihomo\n") {
		t.Fatalf("native TUN config should retain the named device:\n%s", nativeYAML)
	}

	t.Setenv("MSF_RUNTIME", "macos")
	macOSYAML := renderMihomoTunYAML(cfg)
	if strings.Contains(macOSYAML, "device:") {
		t.Fatalf("macOS TUN config must let Mihomo allocate an available utun:\n%s", macOSYAML)
	}
	for _, want := range []string{"stack: system", "auto-route: true", "route-address:", "- 28.0.0.0/8"} {
		if !strings.Contains(macOSYAML, want) {
			t.Fatalf("macOS TUN config missing %q:\n%s", want, macOSYAML)
		}
	}
}

func TestMacOSCompatibilityMigrationForcesTunAndAutomaticDNS(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("macOS runtime detection requires a Darwin build")
	}
	t.Setenv("MSF_RUNTIME", "native")
	app := newTestApp(t)
	cfg := SetupConfig{
		Username:          "root",
		SelectedInterface: "msf-invalid-interface",
		LinuxProxyMode:    "nft",
		AutoSetDNS:        false,
		ProxyCore:         "mihomo",
		MosDNSEnabled:     true,
	}
	cfg.defaults()
	if _, err := app.insertInitializedSetup(cfg); err != nil {
		t.Fatal(err)
	}

	t.Setenv("MSF_RUNTIME", "macos")
	if shouldRestoreNFT(cfg) {
		t.Fatal("macOS must never restore nftables state")
	}
	migrated, err := app.migrateSetupProxyModeForRuntime(&cfg)
	if err != nil {
		t.Fatal(err)
	}
	if !migrated {
		t.Fatal("legacy macOS configuration should be reported as migrated")
	}
	if cfg.LinuxProxyMode != "tun" || !cfg.AutoSetDNS || cfg.SelectedInterface == "" || cfg.SelectedInterface == "msf-invalid-interface" {
		t.Fatalf("effective macOS config=%#v, want TUN with automatic DNS", cfg)
	}
	stored, ok := app.latestSetupConfig()
	if !ok || stored.LinuxProxyMode != "tun" || !stored.AutoSetDNS || stored.SelectedInterface != cfg.SelectedInterface {
		t.Fatalf("stored macOS config=%#v ok=%t, want TUN with automatic DNS", stored, ok)
	}
}

func TestRestoreConfiguredRuntimePersistsMacOSAutomaticDNSMigration(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("macOS runtime detection requires a Darwin build")
	}
	t.Setenv("MSF_RUNTIME", "native")
	app := newTestApp(t)
	selectedInterface := defaultSetupInterface()
	if selectedInterface == "" {
		t.Skip("test host does not expose a usable network interface")
	}
	cfg := SetupConfig{
		Username:          "root",
		SelectedInterface: selectedInterface,
		LinuxProxyMode:    "tun",
		AutoSetDNS:        false,
		ProxyCore:         "mihomo",
		MosDNSEnabled:     true,
	}
	cfg.defaults()
	if _, err := app.insertInitializedSetup(cfg); err != nil {
		t.Fatal(err)
	}
	app.setMihomoConfigMode("generated")
	if err := app.writeGeneratedConfigs(cfg); err != nil {
		t.Fatal(err)
	}
	app.persistNetworkRuntimeDesired(runtimeStateStopped)

	t.Setenv("MSF_RUNTIME", "macos")
	report := app.RestoreConfiguredRuntime(context.Background())
	if len(report.Errors) > 0 {
		t.Fatalf("restore errors=%v", report.Errors)
	}
	stored, ok := app.latestSetupConfig()
	if !ok || !stored.AutoSetDNS {
		t.Fatalf("stored macOS config=%#v ok=%t, want automatic DNS persisted", stored, ok)
	}
}

func TestDarwinNetworkStatusRequiresDNSRouteAndForwarding(t *testing.T) {
	t.Setenv("MSF_RUNTIME", "native")
	app := newTestApp(t)
	cfg := SetupConfig{
		Username:          "root",
		SelectedInterface: "en0",
		LinuxProxyMode:    "tun",
		ProxyCore:         "mihomo",
		MosDNSEnabled:     true,
	}
	cfg.defaults()
	if _, err := app.insertInitializedSetup(cfg); err != nil {
		t.Fatal(err)
	}
	if err := app.writeDarwinNetworkBackup(darwinNetworkBackup{
		Version:           1,
		Applied:           true,
		SelectedInterface: "en0",
		IPv4Forwarding:    "0",
		DNS:               []darwinDNSBackup{{Service: "Wi-Fi", Device: "en0", Automatic: true}},
	}); err != nil {
		t.Fatal(err)
	}

	oldCommand := darwinNetworkCommand
	t.Cleanup(func() { darwinNetworkCommand = oldCommand })
	forwarding := "0"
	darwinNetworkCommand = func(_ context.Context, name string, args ...string) ([]byte, error) {
		command := name + " " + strings.Join(args, " ")
		switch command {
		case "/usr/sbin/networksetup -getdnsservers Wi-Fi":
			return []byte("127.0.0.1\n"), nil
		case "/usr/sbin/sysctl -n net.inet.ip.forwarding":
			return []byte(forwarding + "\n"), nil
		case "/sbin/route -n get 28.0.0.1":
			return []byte("route to: 28.0.0.1\ninterface: utun9\n"), nil
		default:
			t.Fatalf("unexpected Darwin status command: %s", command)
			return nil, nil
		}
	}

	status := app.darwinNetworkStatus(context.Background())
	if isTruthy(fmtAny(status["ready"])) {
		t.Fatalf("status must not be ready while forwarding is disabled: %#v", status)
	}
	forwarding = "1"
	status = app.darwinNetworkStatus(context.Background())
	if !isTruthy(fmtAny(status["ready"])) {
		t.Fatalf("status should be ready when DNS, utun route and forwarding are active: %#v", status)
	}
}

func TestRestoreDarwinNetworkPreservesCapturedForwardingAndDNS(t *testing.T) {
	app := newTestApp(t)
	backup := darwinNetworkBackup{
		Version:        1,
		Applied:        true,
		IPv4Forwarding: "1",
		DNS: []darwinDNSBackup{
			{Service: "Wi-Fi", Device: "en0", Automatic: true},
			{Service: "Ethernet", Device: "en5", Servers: []string{"1.1.1.1", "8.8.8.8"}},
		},
	}
	if err := app.writeDarwinNetworkBackup(backup); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(app.darwinNetworkBackupPath())
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("Darwin network backup permissions = %o, want 600", got)
	}

	oldCommand := darwinNetworkCommand
	t.Cleanup(func() { darwinNetworkCommand = oldCommand })
	var commands []string
	darwinNetworkCommand = func(_ context.Context, name string, args ...string) ([]byte, error) {
		commands = append(commands, name+" "+strings.Join(args, " "))
		return nil, nil
	}
	if err := app.restoreDarwinNetwork(context.Background()); err != nil {
		t.Fatal(err)
	}
	want := []string{
		"/usr/sbin/networksetup -setdnsservers Wi-Fi Empty",
		"/usr/sbin/networksetup -setdnsservers Ethernet 1.1.1.1 8.8.8.8",
		"/usr/sbin/sysctl -w net.inet.ip.forwarding=1",
	}
	if strings.Join(commands, "\n") != strings.Join(want, "\n") {
		t.Fatalf("restore commands:\n%s\nwant:\n%s", strings.Join(commands, "\n"), strings.Join(want, "\n"))
	}
	if _, err := os.Stat(app.darwinNetworkBackupPath()); !os.IsNotExist(err) {
		t.Fatalf("successful restore should remove backup, stat err=%v", err)
	}
}

func installRuntimeTestBinary(t *testing.T, app *App, component string) {
	t.Helper()
	path := filepath.Join(app.DataDir, "data/binaries", component, component)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	script := "#!/bin/sh\ntrap 'exit 0' TERM INT\nwhile :; do sleep 1; done\n"
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
}
