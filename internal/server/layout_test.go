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
	for rel, content := range map[string]string{
		"configs/network/network.nft": `#!/usr/sbin/nft -f
flush ruleset

table inet msm_free {
  chain nat-prerouting {
    type nat hook prerouting priority dstnat; policy accept;
  }
}
`,
		"configs/supervisor/supervisord.conf":    "file=/opt/msm-free/configs/supervisor/supervisor.sock\nlogfile=/opt/msm-free/logs/supervisor/supervisord.log\n",
		"configs/supervisor/services/mihomo.ini": "command=/opt/msm-free/data/binaries/mihomo/mihomo -d /opt/msm-free/configs/mihomo -f /opt/msm-free/configs/mihomo/config.yaml\n",
		"configs/supervisor/services/mosdns.ini": "command=/opt/msm-free/data/binaries/mosdns/mosdns start --dir /opt/msm-free/configs/mosdns\n",
		"configs/mosdns/config.yaml":             "log:\n  file: \"/opt/msm-free/logs/mosdns.log\"\n",
	} {
		path := filepath.Join(dataDir, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
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
	for _, rel := range []string{
		"configs/network/network.nft",
		"configs/supervisor/supervisord.conf",
		"configs/supervisor/services/mihomo.ini",
		"configs/supervisor/services/mosdns.ini",
		"configs/mosdns/config.yaml",
	} {
		b, err := os.ReadFile(filepath.Join(dataDir, rel))
		if err != nil {
			t.Fatal(err)
		}
		text := string(b)
		if strings.Contains(text, "msm_free") || strings.Contains(text, "/opt/msm-free") {
			t.Fatalf("%s still contains legacy tokens:\n%s", rel, text)
		}
	}
	nft, err := os.ReadFile(filepath.Join(dataDir, "configs/network/network.nft"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(nft), "table inet msf") {
		t.Fatalf("network.nft should use msf table:\n%s", string(nft))
	}
	if strings.Contains(string(nft), "flush ruleset") {
		t.Fatalf("network.nft should not flush the global nftables ruleset:\n%s", string(nft))
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
