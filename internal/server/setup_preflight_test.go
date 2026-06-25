package server

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestSystemSetupsTimezoneMigration(t *testing.T) {
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`create table system_setups (
		id integer primary key autoincrement,
		created_at datetime,
		updated_at datetime,
		username text not null,
		is_initialized numeric default false
	)`); err != nil {
		t.Fatal(err)
	}
	app := &App{DB: db}
	if err := app.migrate(); err != nil {
		t.Fatal(err)
	}
	rows, err := db.Query(`pragma table_info(system_setups)`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	found := false
	for rows.Next() {
		var cid int
		var name, typ string
		var notNull, pk int
		var defaultValue any
		if err := rows.Scan(&cid, &name, &typ, &notNull, &defaultValue, &pk); err != nil {
			t.Fatal(err)
		}
		if name == "timezone" {
			found = true
		}
	}
	if !found {
		t.Fatal("system_setups should have timezone column")
	}
}

func TestSetupInitializeRejectsInvalidTimezone(t *testing.T) {
	app := newTestApp(t)
	res := requestJSON(t, app, http.MethodPost, "/api/v1/setup/initialize", "", map[string]any{
		"username":        "root",
		"password":        "test-password-123",
		"confirmPassword": "test-password-123",
		"timezone":        "Mars/Base",
	})
	if res.Code != http.StatusConflict {
		t.Fatalf("invalid timezone should fail with 409, status=%d body=%s", res.Code, res.Body.String())
	}
	if !strings.Contains(res.Body.String(), "preflight_blocked") {
		t.Fatalf("response should include preflight error: %s", res.Body.String())
	}
}

func TestSetupInitializePersistsTimezone(t *testing.T) {
	app := newTestApp(t)
	res := requestJSON(t, app, http.MethodPost, "/api/v1/setup/initialize", "", map[string]any{
		"username":             "root",
		"password":             "test-password-123",
		"confirmPassword":      "test-password-123",
		"timezone":             "UTC",
		"selected_interface":   "eth0",
		"proxyCore":            "mihomo",
		"mosdnsEnabled":        true,
		"github_proxy_enabled": false,
	})
	if res.Code != http.StatusOK {
		t.Fatalf("initialize status=%d body=%s", res.Code, res.Body.String())
	}
	cfg, ok := app.latestSetupConfig()
	if !ok {
		t.Fatal("latest setup config missing")
	}
	if cfg.Timezone != "UTC" {
		t.Fatalf("timezone = %q, want UTC", cfg.Timezone)
	}
}

func TestDNS53PreflightClassifiesSystemdResolvedAndUnknown(t *testing.T) {
	systemd := parseSSListeners(`udp UNCONN 0 0 127.0.0.53%lo:53 0.0.0.0:* users:(("systemd-resolve",pid=422,fd=14))
tcp LISTEN 0 4096 127.0.0.53%lo:53 0.0.0.0:* users:(("systemd-resolve",pid=422,fd=15))`, "udp", []int{53})
	status := setupDNS53Preflight(context.Background(), systemd, false)
	if status.Status != "blocked" || !status.CanRemediate || status.Reason != setupDNS53ReasonSystemdResolvedStub {
		t.Fatalf("systemd-resolved should be blocked but remediable: %+v", status)
	}

	unknown := []setupPortListener{{Port: 53, Protocol: "udp", Address: "0.0.0.0:53", PID: 100, Process: "dnsmasq"}}
	status = setupDNS53Preflight(context.Background(), unknown, false)
	if status.Status != "blocked" || status.CanRemediate || status.Reason != setupDNS53ReasonOccupied {
		t.Fatalf("unknown 53 owner should block without remediation: %+v", status)
	}
}

func TestDNS53PreflightClassifiesBindProbeErrors(t *testing.T) {
	tests := []struct {
		name          string
		err           error
		wantStatus    string
		wantReason    string
		wantBlocking  bool
		wantBlockers  bool
		wantProbeText string
	}{
		{
			name:          "address in use blocks",
			err:           syscall.EADDRINUSE,
			wantStatus:    "blocked",
			wantReason:    setupDNS53ReasonOccupied,
			wantBlocking:  true,
			wantBlockers:  true,
			wantProbeText: "address already in use",
		},
		{
			name:          "permission denied warns",
			err:           syscall.EACCES,
			wantStatus:    "warning",
			wantReason:    setupDNS53ReasonPermissionDenied,
			wantBlocking:  false,
			wantProbeText: "permission denied",
		},
		{
			name:          "unexpected probe error warns",
			err:           errors.New("bind probe unavailable"),
			wantStatus:    "warning",
			wantReason:    setupDNS53ReasonProbeError,
			wantBlocking:  false,
			wantProbeText: "bind probe unavailable",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			withTestSetupSystemOps(t)
			setupProbePort = func(protocol string, port int) error { return tt.err }

			status := setupDNS53Preflight(context.Background(), nil, false)
			if status.Status != tt.wantStatus || status.Reason != tt.wantReason {
				t.Fatalf("status = %+v, want status=%s reason=%s", status, tt.wantStatus, tt.wantReason)
			}
			if (len(status.Blockers) > 0) != tt.wantBlockers {
				t.Fatalf("blockers = %+v, want blockers=%v", status.Blockers, tt.wantBlockers)
			}
			if !strings.Contains(status.ProbeError, tt.wantProbeText) {
				t.Fatalf("probe_error = %q, want containing %q", status.ProbeError, tt.wantProbeText)
			}

			res := (&App{}).buildSetupPreflight(context.Background(), "Asia/Shanghai", false)
			if res.Blocking != tt.wantBlocking {
				t.Fatalf("blocking = %v, want %v; result=%+v", res.Blocking, tt.wantBlocking, res)
			}
		})
	}
}

func TestDNS53PreflightIgnoresTemplateText(t *testing.T) {
	templateText := `
# systemd-resolved dnsmasq listen :53 marker in a template comment
plugins:
  - tag: udp_all
    type: server
    args:
      entry: main_sequence
      listen: ":53"
`
	if listeners := parseSSListeners(templateText, "udp", []int{53}); len(listeners) != 0 {
		t.Fatalf("template text should not parse as ss listeners: %+v", listeners)
	}
	if listeners := parseLSOFListeners(templateText, "udp", 53); len(listeners) != 0 {
		t.Fatalf("template text should not parse as lsof listeners: %+v", listeners)
	}
}

func TestReservedPortConflictIsWarningOnly(t *testing.T) {
	withTestSetupSystemOps(t)
	checks := setupReservedPortChecks(context.Background(), []setupPortListener{
		{Port: 7890, Protocol: "tcp", Address: "0.0.0.0:7890", PID: 1234, Process: "other-proxy"},
	})
	var found setupPortCheck
	for _, item := range checks {
		if item.Port == 7890 && item.Protocol == "tcp" {
			found = item
			break
		}
	}
	if found.Status != "occupied" || len(found.Listeners) != 1 {
		t.Fatalf("7890 should be reported occupied: %+v", found)
	}
	if status := setupDNS53Preflight(context.Background(), nil, false); status.Status != "ok" {
		t.Fatalf("non-53 conflict must not affect DNS blocker: %+v", status)
	}
}

func TestMosDNSStartOnlyBlocksOnDNS53Blocked(t *testing.T) {
	t.Run("warning does not preempt startup", func(t *testing.T) {
		app := newTestApp(t)
		installTestMosDNSBinary(t, app, "echo attempted >&2\nexit 42\n")
		setupProbePort = func(protocol string, port int) error { return syscall.EACCES }

		_, err := app.Services.Start(context.Background(), "mosdns")
		if err == nil {
			t.Fatal("mosdns start should return process failure from the test binary")
		}
		if strings.Contains(err.Error(), "mosdns cannot bind 53") {
			t.Fatalf("warning preflight should not block startup: %v", err)
		}
		if !strings.Contains(err.Error(), "attempted") {
			t.Fatalf("start should reach the test binary and report stderr, got: %v", err)
		}
	})

	t.Run("blocked preempts startup", func(t *testing.T) {
		app := newTestApp(t)
		marker := filepath.Join(app.DataDir, "mosdns-started")
		installTestMosDNSBinary(t, app, "echo started > "+marker+"\nexit 0\n")
		setupProbePort = func(protocol string, port int) error { return syscall.EADDRINUSE }

		_, err := app.Services.Start(context.Background(), "mosdns")
		if err == nil || !strings.Contains(err.Error(), "mosdns cannot bind 53") {
			t.Fatalf("blocked preflight should stop startup, got: %v", err)
		}
		if _, statErr := os.Stat(marker); !os.IsNotExist(statErr) {
			t.Fatalf("blocked preflight should not execute mosdns binary, stat err=%v", statErr)
		}
	})
}

func TestSetupActivateReturnsConflictOnRuntimeErrors(t *testing.T) {
	app := newTestApp(t)
	now := time.Now()
	if _, err := app.DB.Exec(`insert into system_setups(created_at,updated_at,username,timezone,is_initialized) values(?,?,?,?,true)`, now, now, "root", "Asia/Shanghai"); err != nil {
		t.Fatal(err)
	}
	app.Services.setDesired("mihomo", true)
	res := requestJSON(t, app, http.MethodPost, "/api/v1/setup/activate", "", nil)
	if res.Code != http.StatusConflict {
		t.Fatalf("activate should return 409 on runtime errors, status=%d body=%s", res.Code, res.Body.String())
	}
	if !strings.Contains(res.Body.String(), "activation_failed") {
		t.Fatalf("response should include activation_failed: %s", res.Body.String())
	}
}

func withTestSetupSystemOps(t *testing.T) {
	t.Helper()
	oldCommandOutput := setupCommandOutput
	oldLookPath := setupLookPath
	oldGeteuid := setupGeteuid
	oldProbePort := setupProbePort
	oldShouldProbePort := setupShouldProbePort
	oldLocal := time.Local
	oldTZ, hadTZ := os.LookupEnv("TZ")
	setupGeteuid = func() int { return 0 }
	setupProbePort = func(protocol string, port int) error { return nil }
	setupShouldProbePort = func() bool { return true }
	setupLookPath = func(name string) (string, error) {
		switch name {
		case "timedatectl", "systemctl":
			return "/usr/bin/" + name, nil
		default:
			return "", errors.New("not found")
		}
	}
	setupCommandOutput = func(ctx context.Context, timeout time.Duration, name string, args ...string) ([]byte, error) {
		if name == "timedatectl" && len(args) > 0 {
			switch args[0] {
			case "show":
				return []byte("Asia/Shanghai\n"), nil
			case "set-timezone":
				return nil, nil
			}
		}
		return nil, errors.New("not available in test")
	}
	t.Cleanup(func() {
		setupCommandOutput = oldCommandOutput
		setupLookPath = oldLookPath
		setupGeteuid = oldGeteuid
		setupProbePort = oldProbePort
		setupShouldProbePort = oldShouldProbePort
		time.Local = oldLocal
		if hadTZ {
			_ = os.Setenv("TZ", oldTZ)
		} else {
			_ = os.Unsetenv("TZ")
		}
	})
}

func installTestMosDNSBinary(t *testing.T, app *App, body string) {
	t.Helper()
	bin := filepath.Join(app.DataDir, "data/binaries/mosdns/mosdns")
	if err := os.MkdirAll(filepath.Dir(bin), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bin, []byte("#!/bin/sh\n"+body), 0755); err != nil {
		t.Fatal(err)
	}
}
