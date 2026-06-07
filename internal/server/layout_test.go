package server

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNewMigratesLegacyLayout(t *testing.T) {
	dataDir := t.TempDir()
	dbDir := filepath.Join(dataDir, "database")
	if err := os.MkdirAll(dbDir, 0755); err != nil {
		t.Fatal(err)
	}
	legacyDB := filepath.Join(dbDir, "msm.db")
	db, err := sql.Open("sqlite", legacyDB)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`create table update_info (component text); insert into update_info(component) values ('msm-free')`); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	providerDir := filepath.Join(dataDir, "configs/mihomo/proxy_providers")
	if err := os.MkdirAll(providerDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(providerDir, "msm_manual.yaml"), []byte("proxies: []\n"), 0644); err != nil {
		t.Fatal(err)
	}
	mihomoConfig := filepath.Join(dataDir, "configs/mihomo/config.yaml")
	if err := os.MkdirAll(filepath.Dir(mihomoConfig), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(mihomoConfig, []byte("proxy-providers:\n  msm_manual:\n    path: './proxy_providers/msm_manual.yaml'\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dataDir, "logs"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "logs/msm.log"), []byte("legacy log\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "msm-free.pid"), []byte("123"), 0644); err != nil {
		t.Fatal(err)
	}

	app, err := New(Options{DataDir: dataDir, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()

	if _, err := os.Stat(filepath.Join(dbDir, "msf.db")); err != nil {
		t.Fatalf("msf.db should exist after migration: %v", err)
	}
	if _, err := os.Stat(legacyDB); !os.IsNotExist(err) {
		t.Fatalf("legacy db should be removed after migration, err=%v", err)
	}
	if _, err := os.Stat(filepath.Join(providerDir, "msf_manual.yaml")); err != nil {
		t.Fatalf("manual provider should be renamed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(providerDir, "msm_manual.yaml")); !os.IsNotExist(err) {
		t.Fatalf("legacy manual provider should be removed, err=%v", err)
	}
	cfg, err := os.ReadFile(mihomoConfig)
	if err != nil {
		t.Fatal(err)
	}
	if text := string(cfg); !strings.Contains(text, "msf_manual:") || strings.Contains(text, "msm_manual") {
		t.Fatalf("mihomo config was not rewritten:\n%s", text)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "logs/msf.log")); err != nil {
		t.Fatalf("msf log should be moved: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "msm-free.pid")); !os.IsNotExist(err) {
		t.Fatalf("legacy pid should be removed, err=%v", err)
	}

	var component string
	if err := app.DB.QueryRow(`select component from update_info limit 1`).Scan(&component); err != nil {
		t.Fatal(err)
	}
	if component != "msf" {
		t.Fatalf("update_info component = %q, want msf", component)
	}
}
