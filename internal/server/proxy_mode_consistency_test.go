package server

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGeneratedProxyModeCompatibilityMigrationFixtures(t *testing.T) {
	fixtures := []struct {
		version string
		mode    string
	}{
		{version: "v0.1.12", mode: "nft"},
		{version: "v0.2.1", mode: "tun"},
		{version: "v0.3.6", mode: "tun"},
		{version: "v0.3.7", mode: "tun"},
		{version: "v0.3.8", mode: "nft"},
		{version: "v0.3.9.2", mode: "tun"},
		{version: "v0.3.9.3", mode: "tun"},
	}
	for _, fixture := range fixtures {
		t.Run(fixture.version+"-"+fixture.mode, func(t *testing.T) {
			t.Setenv("MSF_RUNTIME", "native")
			app := newTestApp(t)
			app.Version = fixture.version
			app.setMihomoConfigMode("generated")
			cfg := SetupConfig{
				Username:          "root",
				SelectedInterface: "eth0",
				LinuxProxyMode:    fixture.mode,
				EnableIPv6:        true,
				ProxyCore:         "mihomo",
				MosDNSEnabled:     true,
			}
			cfg.defaults()
			if _, err := app.insertInitializedSetup(cfg); err != nil {
				t.Fatal(err)
			}
			writeFactoryResetTestFile(t, app, mihomoActiveConfigRelPath, "mode: rule\ntun:\n  enable: false\n", 0o644)
			writeFactoryResetTestFile(t, app, "configs/network/network.yaml", "mode: stale\n", 0o644)
			writeFactoryResetTestFile(t, app, "configs/network/network.nft", "table inet msf {}\n", 0o644)

			if err := app.ensureProxyModeConsistency(cfg, true); err != nil {
				t.Fatalf("compatibility migration failed: %v", err)
			}
			if err := app.validateGeneratedProxyModeFiles(cfg); err != nil {
				t.Fatalf("migrated config is inconsistent: %v", err)
			}
			if fixture.mode == "tun" && fileExists(filepath.Join(app.DataDir, "configs/network/network.nft")) {
				t.Fatal("TUN migration left network.nft")
			}
		})
	}
}

func TestCustomProxyModeConflictIsNotOverwritten(t *testing.T) {
	t.Setenv("MSF_RUNTIME", "native")
	app := newTestApp(t)
	custom := testMihomoConfigYAML("CustomNFT")
	writeFactoryResetTestFile(t, app, mihomoActiveConfigRelPath, custom, 0o644)
	app.setMihomoConfigMode("custom")
	cfg := SetupConfig{LinuxProxyMode: "tun", SelectedInterface: "eth0", ProxyCore: "mihomo", MosDNSEnabled: true}
	cfg.defaults()

	err := app.ensureProxyModeConsistency(cfg, true)
	if err == nil || !strings.Contains(err.Error(), "custom Mihomo config mode conflicts") {
		t.Fatalf("custom mode mismatch error=%v", err)
	}
	body, readErr := os.ReadFile(filepath.Join(app.DataDir, mihomoActiveConfigRelPath))
	if readErr != nil || string(body) != custom {
		t.Fatalf("custom config was overwritten: err=%v body=%q", readErr, string(body))
	}
}

func TestDockerCompatibilityMigrationForcesDatabaseTargetToTun(t *testing.T) {
	t.Setenv("MSF_RUNTIME", "native")
	app := newTestApp(t)
	cfg := SetupConfig{Username: "root", LinuxProxyMode: "nft", SelectedInterface: "eth0", ProxyCore: "mihomo", MosDNSEnabled: true}
	cfg.defaults()
	if _, err := app.insertInitializedSetup(cfg); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MSF_RUNTIME", "docker")
	if err := app.migrateSetupProxyModeForRuntime(&cfg); err != nil {
		t.Fatal(err)
	}
	if cfg.LinuxProxyMode != "tun" {
		t.Fatalf("effective Docker mode=%q, want tun", cfg.LinuxProxyMode)
	}
	stored, ok := app.latestSetupConfig()
	if !ok || stored.LinuxProxyMode != "tun" {
		t.Fatalf("stored Docker mode=%q ok=%t, want tun", stored.LinuxProxyMode, ok)
	}
	if shouldRestoreNFT(stored) {
		t.Fatal("Docker compatibility migration must never restore nftables")
	}
}

func TestSetupConfigSwitchAppliesGeneratedProxyMode(t *testing.T) {
	t.Setenv("MSF_RUNTIME", "native")
	app := newTestApp(t)
	initializeFactoryResetTestSetup(t, app, "nft", "password-123")
	token := loginFactoryResetTestUser(t, app, "password-123")

	oldApply := setupApplyProxyNetworkState
	var applied []string
	setupApplyProxyNetworkState = func(_ *App, _ context.Context, cfg SetupConfig) error {
		applied = append(applied, cfg.LinuxProxyMode)
		return nil
	}
	t.Cleanup(func() { setupApplyProxyNetworkState = oldApply })

	for _, mode := range []string{"tun", "nft"} {
		res := requestJSON(t, app, http.MethodPut, "/api/v1/setup/config", token, setupModeUpdatePayload(mode))
		if res.Code != http.StatusOK {
			t.Fatalf("switch to %s status=%d body=%s", mode, res.Code, res.Body.String())
		}
		cfg, ok := app.latestSetupConfig()
		if !ok || cfg.LinuxProxyMode != mode {
			t.Fatalf("stored mode=%q ok=%t, want %s", cfg.LinuxProxyMode, ok, mode)
		}
		if err := app.validateGeneratedProxyModeFiles(cfg); err != nil {
			t.Fatalf("generated %s config mismatch: %v", mode, err)
		}
	}
	if got := strings.Join(applied, ","); got != "tun,nft" {
		t.Fatalf("applied network modes=%q, want tun,nft", got)
	}
}

func TestSetupConfigModeSwitchRejectsCustomMihomo(t *testing.T) {
	t.Setenv("MSF_RUNTIME", "native")
	app := newTestApp(t)
	initializeFactoryResetTestSetup(t, app, "nft", "password-123")
	token := loginFactoryResetTestUser(t, app, "password-123")
	app.setMihomoConfigMode("custom")

	res := requestJSON(t, app, http.MethodPut, "/api/v1/setup/config", token, setupModeUpdatePayload("tun"))
	if res.Code != http.StatusConflict || !strings.Contains(res.Body.String(), "custom_config_mode_conflict") {
		t.Fatalf("custom mode switch status=%d body=%s", res.Code, res.Body.String())
	}
	cfg, _ := app.latestSetupConfig()
	if cfg.LinuxProxyMode != "nft" {
		t.Fatalf("custom conflict changed stored mode to %q", cfg.LinuxProxyMode)
	}
}

func TestSetupConfigModeSwitchAcceptsManuallyAlignedCustomMihomo(t *testing.T) {
	t.Setenv("MSF_RUNTIME", "native")
	app := newTestApp(t)
	initializeFactoryResetTestSetup(t, app, "nft", "password-123")
	token := loginFactoryResetTestUser(t, app, "password-123")
	target := SetupConfig{LinuxProxyMode: "tun", SelectedInterface: "eth0", EnableIPv6: true, ProxyCore: "mihomo", MosDNSEnabled: true}
	target.defaults()
	custom := app.renderMihomoYAML(target)
	writeFactoryResetTestFile(t, app, mihomoActiveConfigRelPath, custom, 0o644)
	app.setMihomoConfigMode("custom")

	res := requestJSON(t, app, http.MethodPut, "/api/v1/setup/config", token, setupModeUpdatePayload("tun"))
	if res.Code != http.StatusOK {
		t.Fatalf("aligned custom mode switch status=%d body=%s", res.Code, res.Body.String())
	}
	active, err := os.ReadFile(filepath.Join(app.DataDir, mihomoActiveConfigRelPath))
	if err != nil {
		t.Fatal(err)
	}
	if string(active) != custom || app.mihomoConfigMode() != "custom" {
		t.Fatal("aligned custom config was overwritten during proxy mode switch")
	}
}

func TestSetupConfigNetworkFailureRestoresPreviousMode(t *testing.T) {
	t.Setenv("MSF_RUNTIME", "native")
	app := newTestApp(t)
	initializeFactoryResetTestSetup(t, app, "nft", "password-123")
	token := loginFactoryResetTestUser(t, app, "password-123")

	oldApply := setupApplyProxyNetworkState
	var applied []string
	setupApplyProxyNetworkState = func(_ *App, _ context.Context, cfg SetupConfig) error {
		applied = append(applied, cfg.LinuxProxyMode)
		if isTUNProxyMode(cfg.LinuxProxyMode) {
			return errors.New("simulated network failure")
		}
		return nil
	}
	t.Cleanup(func() { setupApplyProxyNetworkState = oldApply })

	res := requestJSON(t, app, http.MethodPut, "/api/v1/setup/config", token, setupModeUpdatePayload("tun"))
	if res.Code != http.StatusInternalServerError || !strings.Contains(res.Body.String(), "network_apply_failed") {
		t.Fatalf("network failure status=%d body=%s", res.Code, res.Body.String())
	}
	cfg, ok := app.latestSetupConfig()
	if !ok || cfg.LinuxProxyMode != "nft" {
		t.Fatalf("rollback stored mode=%q ok=%t, want nft", cfg.LinuxProxyMode, ok)
	}
	if err := app.validateGeneratedProxyModeFiles(cfg); err != nil {
		t.Fatalf("rollback generated config mismatch: %v", err)
	}
	if got := app.setting(nftDesiredKey, ""); got != "true" {
		t.Fatalf("rollback nft desired=%q, want true", got)
	}
	if got := strings.Join(applied, ","); got != "tun,nft" {
		t.Fatalf("network rollback modes=%q, want tun,nft", got)
	}
}

func setupModeUpdatePayload(mode string) map[string]any {
	return map[string]any{
		"username":           "root",
		"timezone":           "Asia/Shanghai",
		"webPort":            "17777",
		"selected_interface": "eth0",
		"proxy_core":         "mihomo",
		"mos_dns_enabled":    true,
		"mihomo_core_type":   "meta",
		"linux_proxy_mode":   mode,
		"enableIPv6":         true,
		"auto_set_dns":       true,
	}
}
