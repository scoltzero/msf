package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFactoryResetPurgesUserStateRetainsComponentsAndAllowsTunReinitialize(t *testing.T) {
	t.Setenv("MSF_RUNTIME", "native")
	withFactoryResetTestOps(t)
	app := newTestApp(t)
	initializeFactoryResetTestSetup(t, app, "nft", "old-password-123")
	token := loginFactoryResetTestUser(t, app, "old-password-123")

	if _, err := app.DB.Exec(`insert into users(username,password,role,is_active,created_at,updated_at) values('other','x','operator',true,?,?)`, nowString(), nowString()); err != nil {
		t.Fatal(err)
	}
	if _, err := app.DB.Exec(`insert into api_tokens(user_id,name,token_hash,scope,created_at) values(1,'old','old-hash','admin',?)`, nowString()); err != nil {
		t.Fatal(err)
	}
	if _, err := app.DB.Exec(`insert into config_histories(service,file_path,content,created_at,updated_at) values('mihomo','old.yaml','old',?,?)`, nowString(), nowString()); err != nil {
		t.Fatal(err)
	}
	if _, err := app.DB.Exec(`insert into mosdns_clients(ip,created_at,updated_at) values('192.0.2.10',?,?)`, nowString(), nowString()); err != nil {
		t.Fatal(err)
	}
	app.setSetting("user.preference", "old")

	writeFactoryResetTestFile(t, app, "data/binaries/mihomo/mihomo", "mihomo-binary", 0o755)
	writeFactoryResetTestFile(t, app, "data/binaries/mosdns/mosdns", "mosdns-binary", 0o755)
	writeFactoryResetTestFile(t, app, "configs/mihomo/ui/index.html", "zashboard", 0o644)
	writeFactoryResetTestFile(t, app, "configs/mihomo/proxy_providers/old.yaml", "old-provider", 0o644)
	writeFactoryResetTestFile(t, app, "backups/old.zip", "old-backup", 0o644)
	writeFactoryResetTestFile(t, app, "logs/old.log", "old-log", 0o644)
	writeFactoryResetTestFile(t, app, "data/rule-source-downloads/old.download", "old-cache", 0o644)

	res := requestJSON(t, app, http.MethodPost, "/api/v1/setup/reset", token, map[string]any{
		"current_password":  "old-password-123",
		"delete_components": false,
	})
	if res.Code != http.StatusOK {
		t.Fatalf("reset status=%d body=%s", res.Code, res.Body.String())
	}
	for _, want := range []string{`"factory_reset":true`, `"requires_reinitialize":true`, `"retained_components"`} {
		if !strings.Contains(res.Body.String(), want) {
			t.Fatalf("reset response missing %s: %s", want, res.Body.String())
		}
	}
	if app.IsInitialized() {
		t.Fatal("factory reset should return the app to an uninitialized state")
	}
	for _, table := range []string{"users", "refresh_tokens", "api_tokens", "audit_logs", "system_setups", "config_histories", "mosdns_clients", "mosdns_client_ips", "component_update_info", "component_update_config"} {
		if count := factoryResetTableCount(t, app, table); count != 0 {
			t.Fatalf("%s count=%d after factory reset, want 0", table, count)
		}
	}
	var nonSecretSettings int
	if err := app.DB.QueryRow(`select count(*) from settings where key != 'jwt_secret'`).Scan(&nonSecretSettings); err != nil {
		t.Fatal(err)
	}
	if nonSecretSettings != 0 {
		t.Fatalf("non-secret settings count=%d after factory reset", nonSecretSettings)
	}
	if got := factoryResetTableCount(t, app, "mosdns_switch_states"); got != len(defaultMosDNSSwitchStates()) {
		t.Fatalf("mosdns default switch rows=%d, want %d", got, len(defaultMosDNSSwitchStates()))
	}
	if got := factoryResetTableCount(t, app, "update_info"); got != 1 {
		t.Fatalf("update_info rows=%d, want fresh default row", got)
	}

	for _, rel := range []string{
		"configs/mihomo/proxy_providers/old.yaml",
		"backups/old.zip",
		"logs/old.log",
		"data/rule-source-downloads/old.download",
	} {
		if fileExists(filepath.Join(app.DataDir, filepath.FromSlash(rel))) {
			t.Fatalf("old user file survived factory reset: %s", rel)
		}
	}
	for rel, want := range map[string]string{
		"data/binaries/mihomo/mihomo":  "mihomo-binary",
		"data/binaries/mosdns/mosdns":  "mosdns-binary",
		"configs/mihomo/ui/index.html": "zashboard",
	} {
		body, err := os.ReadFile(filepath.Join(app.DataDir, filepath.FromSlash(rel)))
		if err != nil || string(body) != want {
			t.Fatalf("retained component %s = %q, err=%v", rel, string(body), err)
		}
	}

	if oldJWT := requestJSON(t, app, http.MethodGet, "/api/v1/users", token, nil); oldJWT.Code != http.StatusUnauthorized {
		t.Fatalf("old JWT status=%d body=%s, want 401", oldJWT.Code, oldJWT.Body.String())
	}
	if oldLogin := requestJSON(t, app, http.MethodPost, "/api/v1/auth/login", "", map[string]string{"username": "root", "password": "old-password-123"}); oldLogin.Code != http.StatusUnauthorized {
		t.Fatalf("old login status=%d body=%s, want 401", oldLogin.Code, oldLogin.Body.String())
	}

	initializeFactoryResetTestSetup(t, app, "tun", "new-password-456")
	cfg, ok := app.latestSetupConfig()
	if !ok || !isTUNProxyMode(cfg.LinuxProxyMode) {
		t.Fatalf("reinitialized config=%#v ok=%t, want TUN", cfg, ok)
	}
	if mode := app.mihomoConfigMode(); mode != "generated" {
		t.Fatalf("mihomo config mode=%q after reinitialize, want generated", mode)
	}
	if err := app.validateGeneratedProxyModeFiles(cfg); err != nil {
		t.Fatalf("TUN configuration mismatch after reset: %v", err)
	}
	if fileExists(filepath.Join(app.DataDir, "configs/network/network.nft")) {
		t.Fatal("TUN reinitialize must not leave network.nft")
	}
}

func TestFactoryResetModeChangesIgnorePreviousMihomoState(t *testing.T) {
	for _, state := range []string{"implicit-generated", "explicit-generated", "custom"} {
		t.Run(state, func(t *testing.T) {
			t.Setenv("MSF_RUNTIME", "native")
			withFactoryResetTestOps(t)
			app := newTestApp(t)
			initializeFactoryResetTestSetup(t, app, "nft", "old-password-123")
			token := loginFactoryResetTestUser(t, app, "old-password-123")
			switch state {
			case "explicit-generated":
				app.setMihomoConfigMode("generated")
			case "custom":
				customRel := "configs/mihomo/user_configs/old-custom.yaml"
				writeFactoryResetTestFile(t, app, customRel, testMihomoConfigYAML("OldCustom"), 0o644)
				app.setMihomoConfigMode("custom")
				app.setSetting(mihomoAppliedUserConfigKey, customRel)
			}
			res := requestJSON(t, app, http.MethodPost, "/api/v1/setup/reset", token, map[string]any{"current_password": "old-password-123"})
			if res.Code != http.StatusOK {
				t.Fatalf("reset status=%d body=%s", res.Code, res.Body.String())
			}
			initializeFactoryResetTestSetup(t, app, "tun", "new-password-456")
			cfg, _ := app.latestSetupConfig()
			if err := app.validateGeneratedProxyModeFiles(cfg); err != nil {
				t.Fatal(err)
			}
			if app.mihomoConfigMode() != "generated" || app.setting(mihomoAppliedUserConfigKey, "") != "" {
				t.Fatalf("stale Mihomo state survived reset: mode=%s applied=%q", app.mihomoConfigMode(), app.setting(mihomoAppliedUserConfigKey, ""))
			}
		})
	}
}

func TestFactoryResetCanDeleteComponents(t *testing.T) {
	t.Setenv("MSF_RUNTIME", "native")
	withFactoryResetTestOps(t)
	app := newTestApp(t)
	initializeFactoryResetTestSetup(t, app, "tun", "password-123")
	token := loginFactoryResetTestUser(t, app, "password-123")
	writeFactoryResetTestFile(t, app, "data/binaries/mihomo/mihomo", "mihomo", 0o755)
	writeFactoryResetTestFile(t, app, "data/binaries/mosdns/mosdns", "mosdns", 0o755)
	writeFactoryResetTestFile(t, app, "configs/mihomo/ui/index.html", "zashboard", 0o644)

	res := requestJSON(t, app, http.MethodPost, "/api/v1/setup/reset", token, map[string]any{
		"current_password": "password-123",
		"delete_binaries":  true,
	})
	if res.Code != http.StatusOK {
		t.Fatalf("reset status=%d body=%s", res.Code, res.Body.String())
	}
	for _, rel := range []string{"data/binaries/mihomo/mihomo", "data/binaries/mosdns/mosdns", "configs/mihomo/ui/index.html"} {
		if fileExists(filepath.Join(app.DataDir, filepath.FromSlash(rel))) {
			t.Fatalf("component target survived delete_components reset: %s", rel)
		}
	}
}

func TestFactoryResetRejectsInvalidPasswordWithoutChangingState(t *testing.T) {
	t.Setenv("MSF_RUNTIME", "native")
	withFactoryResetTestOps(t)
	app := newTestApp(t)
	initializeFactoryResetTestSetup(t, app, "nft", "password-123")
	token := loginFactoryResetTestUser(t, app, "password-123")
	writeFactoryResetTestFile(t, app, "configs/mihomo/user_configs/sentinel.yaml", "sentinel", 0o644)
	secret := string(app.currentSecret())

	res := requestJSON(t, app, http.MethodPost, "/api/v1/setup/reset", token, map[string]any{"current_password": "wrong-password"})
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("invalid password reset status=%d body=%s", res.Code, res.Body.String())
	}
	if !app.IsInitialized() || factoryResetTableCount(t, app, "users") != 1 {
		t.Fatal("invalid password changed initialized database state")
	}
	if string(app.currentSecret()) != secret || !fileExists(filepath.Join(app.DataDir, "configs/mihomo/user_configs/sentinel.yaml")) {
		t.Fatal("invalid password changed secret or files")
	}
}

func TestFactoryResetRollsBackFilesAndDatabaseOnFailure(t *testing.T) {
	for _, test := range []struct {
		name  string
		setup func(t *testing.T, app *App)
	}{
		{
			name: "service stop failure",
			setup: func(t *testing.T, app *App) {
				factoryResetStopManagedServices = func(*App, context.Context) error { return errors.New("stop failed") }
			},
		},
		{
			name: "base layout failure",
			setup: func(t *testing.T, app *App) {
				factoryResetBuildBaseLayout = func(*App, string, factoryResetState) error { return errors.New("layout failed") }
			},
		},
		{
			name: "database failure",
			setup: func(t *testing.T, app *App) {
				if _, err := app.DB.Exec(`create table reset_guard(id integer); insert into reset_guard values(1); create trigger reject_reset before delete on reset_guard begin select raise(fail, 'reset blocked'); end`); err != nil {
					t.Fatal(err)
				}
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("MSF_RUNTIME", "native")
			withFactoryResetTestOps(t)
			app := newTestApp(t)
			initializeFactoryResetTestSetup(t, app, "nft", "password-123")
			token := loginFactoryResetTestUser(t, app, "password-123")
			writeFactoryResetTestFile(t, app, "configs/mihomo/user_configs/sentinel.yaml", "sentinel", 0o644)
			secret := string(app.currentSecret())
			runtimeRestored := false
			factoryResetRestoreRuntime = func(*App, factoryResetRuntimeSnapshot) error {
				runtimeRestored = true
				return nil
			}
			test.setup(t, app)

			res := requestJSON(t, app, http.MethodPost, "/api/v1/setup/reset", token, map[string]any{"current_password": "password-123"})
			if res.Code != http.StatusInternalServerError {
				t.Fatalf("reset failure status=%d body=%s", res.Code, res.Body.String())
			}
			if !app.IsInitialized() || factoryResetTableCount(t, app, "users") != 1 {
				t.Fatal("failed reset did not roll back database")
			}
			if string(app.currentSecret()) != secret || !fileExists(filepath.Join(app.DataDir, "configs/mihomo/user_configs/sentinel.yaml")) {
				t.Fatal("failed reset did not roll back secret/files")
			}
			if auth := requestJSON(t, app, http.MethodGet, "/api/v1/users", token, nil); auth.Code != http.StatusOK {
				t.Fatalf("old JWT should remain valid after rollback: status=%d body=%s", auth.Code, auth.Body.String())
			}
			if !runtimeRestored {
				t.Fatal("failed reset did not attempt to restore the previous runtime state")
			}
		})
	}
}

func TestFactoryResetGatesConcurrentWrites(t *testing.T) {
	t.Setenv("MSF_RUNTIME", "native")
	withFactoryResetTestOps(t)
	app := newTestApp(t)
	initializeFactoryResetTestSetup(t, app, "nft", "password-123")
	token := loginFactoryResetTestUser(t, app, "password-123")
	entered := make(chan struct{})
	release := make(chan struct{})
	factoryResetBuildBaseLayout = func(a *App, secret string, state factoryResetState) error {
		close(entered)
		<-release
		return a.createFactoryResetBaseLayout(secret, state)
	}

	resetDone := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		resetDone <- factoryResetRequest(app, token, map[string]any{"current_password": "password-123"})
	}()
	<-entered
	write := requestJSON(t, app, http.MethodPut, "/api/v1/settings", token, map[string]any{"appearance.theme": "dark"})
	if write.Code != http.StatusServiceUnavailable || !strings.Contains(write.Body.String(), "system_resetting") {
		t.Fatalf("concurrent write status=%d body=%s", write.Code, write.Body.String())
	}
	second := requestJSON(t, app, http.MethodPost, "/api/v1/setup/reset", token, map[string]any{"current_password": "password-123"})
	if second.Code != http.StatusConflict || !strings.Contains(second.Body.String(), "reset_in_progress") {
		t.Fatalf("concurrent reset status=%d body=%s", second.Code, second.Body.String())
	}
	close(release)
	if first := <-resetDone; first.Code != http.StatusOK {
		t.Fatalf("first reset status=%d body=%s", first.Code, first.Body.String())
	}
}

func TestFactoryResetRecoveryMarkerRollsBackUncommittedState(t *testing.T) {
	t.Setenv("MSF_RUNTIME", "native")
	dataDir := t.TempDir()
	app, err := New(Options{DataDir: dataDir, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	if err := app.EnsureBaseLayout(); err != nil {
		t.Fatal(err)
	}
	writeFactoryResetTestFile(t, app, "configs/mihomo/user_configs/sentinel.yaml", "sentinel", 0o644)
	state, err := app.stageFactoryResetFiles(false)
	if err != nil {
		t.Fatal(err)
	}
	if state.Phase != factoryResetPhaseStaged {
		t.Fatalf("marker phase=%q", state.Phase)
	}
	app.Close()

	if err := recoverIncompleteFactoryReset(dataDir); err != nil {
		t.Fatal(err)
	}
	if !fileExists(filepath.Join(dataDir, "configs/mihomo/user_configs/sentinel.yaml")) {
		t.Fatal("uncommitted marker recovery did not restore staged config")
	}
	if fileExists(filepath.Join(dataDir, factoryResetMarkerName)) || fileExists(filepath.Join(dataDir, state.TrashRel)) {
		t.Fatal("uncommitted marker recovery left reset artifacts")
	}
}

func TestFactoryResetRecoveryMarkerFinishesCommittedState(t *testing.T) {
	t.Setenv("MSF_RUNTIME", "native")
	withTestSetupSystemOps(t)
	dataDir := t.TempDir()
	app, err := New(Options{DataDir: dataDir, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	if err := app.EnsureBaseLayout(); err != nil {
		t.Fatal(err)
	}
	initializeFactoryResetTestSetup(t, app, "nft", "password-123")
	writeFactoryResetTestFile(t, app, "configs/mihomo/user_configs/sentinel.yaml", "sentinel", 0o644)
	state, err := app.stageFactoryResetFiles(false)
	if err != nil {
		t.Fatal(err)
	}
	tx, secret, err := app.prepareFactoryResetDatabase(state.ResetID)
	if err != nil {
		t.Fatal(err)
	}
	if err := app.createFactoryResetBaseLayout(secret, state); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	state.Phase = factoryResetPhaseCommit
	if err := app.writeFactoryResetMarker(state); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	app.Close()

	if err := recoverIncompleteFactoryReset(dataDir); err != nil {
		t.Fatal(err)
	}
	reopened, err := New(Options{DataDir: dataDir, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if reopened.IsInitialized() || factoryResetTableCount(t, reopened, "users") != 0 {
		t.Fatal("committed marker recovery restored old database state")
	}
	if fileExists(filepath.Join(dataDir, "configs/mihomo/user_configs/sentinel.yaml")) {
		t.Fatal("committed marker recovery restored old files")
	}
	if fileExists(filepath.Join(dataDir, factoryResetMarkerName)) || fileExists(filepath.Join(dataDir, state.TrashRel)) {
		t.Fatal("committed marker recovery left reset artifacts")
	}
}

func TestFactoryResetRecoveryRejectsUnsafeMarkerPaths(t *testing.T) {
	dataDir := t.TempDir()
	sentinel := filepath.Join(dataDir, "sentinel")
	if err := os.WriteFile(sentinel, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	marker := factoryResetState{ResetID: "unsafe", Phase: factoryResetPhaseCommitted}
	body, err := json.Marshal(marker)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, factoryResetMarkerName), body, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := recoverIncompleteFactoryReset(dataDir); err == nil {
		t.Fatal("unsafe marker should be rejected")
	}
	if !fileExists(sentinel) {
		t.Fatal("unsafe recovery marker removed unrelated data")
	}
}

func withFactoryResetTestOps(t *testing.T) {
	t.Helper()
	oldStop := factoryResetStopManagedServices
	oldClear := factoryResetClearNetworkState
	oldLayout := factoryResetBuildBaseLayout
	oldRestore := factoryResetRestoreRuntime
	factoryResetStopManagedServices = func(*App, context.Context) error { return nil }
	factoryResetClearNetworkState = func(*App, context.Context) error { return nil }
	factoryResetBuildBaseLayout = func(a *App, secret string, state factoryResetState) error {
		return a.createFactoryResetBaseLayout(secret, state)
	}
	factoryResetRestoreRuntime = func(*App, factoryResetRuntimeSnapshot) error { return nil }
	t.Cleanup(func() {
		factoryResetStopManagedServices = oldStop
		factoryResetClearNetworkState = oldClear
		factoryResetBuildBaseLayout = oldLayout
		factoryResetRestoreRuntime = oldRestore
	})
}

func initializeFactoryResetTestSetup(t *testing.T, app *App, mode, password string) {
	t.Helper()
	body := map[string]any{
		"username":           "root",
		"password":           password,
		"confirmPassword":    password,
		"webPort":            "17777",
		"selected_interface": "eth0",
		"proxyCore":          "mihomo",
		"mosdnsEnabled":      true,
		"mihomo_core_type":   "meta",
		"linux_proxy_mode":   mode,
		"enableIPv6":         true,
		"auto_set_dns":       true,
	}
	res := requestJSON(t, app, http.MethodPost, "/api/v1/setup/initialize", "", body)
	if res.Code != http.StatusOK {
		t.Fatalf("initialize %s status=%d body=%s", mode, res.Code, res.Body.String())
	}
}

func loginFactoryResetTestUser(t *testing.T, app *App, password string) string {
	t.Helper()
	res := requestJSON(t, app, http.MethodPost, "/api/v1/auth/login", "", map[string]string{"username": "root", "password": password})
	if res.Code != http.StatusOK {
		t.Fatalf("login status=%d body=%s", res.Code, res.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	token, _ := payload["token"].(string)
	if token == "" {
		t.Fatalf("login response missing token: %s", res.Body.String())
	}
	return token
}

func writeFactoryResetTestFile(t *testing.T, app *App, rel, content string, mode os.FileMode) {
	t.Helper()
	path := filepath.Join(app.DataDir, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), mode); err != nil {
		t.Fatal(err)
	}
}

func factoryResetTableCount(t *testing.T, app *App, table string) int {
	t.Helper()
	var count int
	if err := app.DB.QueryRow(`select count(*) from "` + strings.ReplaceAll(table, `"`, `""`) + `"`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func factoryResetRequest(app *App, token string, body any) *httptest.ResponseRecorder {
	payload, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/setup/reset", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	res := httptest.NewRecorder()
	app.Router().ServeHTTP(res, req)
	return res
}
