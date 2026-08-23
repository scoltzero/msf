package cloudflareredirect

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnsureDefaultConfigCreatesEditableFile(t *testing.T) {
	dataDir := t.TempDir()
	if err := EnsureDefaultConfig(dataDir); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(ConfigPath(dataDir))
	if err != nil {
		t.Fatal(err)
	}
	content := string(b)
	for _, want := range []string{"enabled: false", "ipv4:", "ipv6:", "manual:", "domain:m-team.cc", "domain:totheglory.im", "subscriptions: []"} {
		if !strings.Contains(content, want) {
			t.Fatalf("default config missing %q:\n%s", want, content)
		}
	}
}

func TestLoadConfigOverlaysBooleanDefaults(t *testing.T) {
	dataDir := t.TempDir()
	path := ConfigPath(dataDir)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("enabled: true\nscan:\n  ipv4:\n    enabled: true\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, err := LoadConfig(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.Enabled || !cfg.Scan.TLS || !cfg.Apply.RewriteA {
		t.Fatalf("expected defaults to survive overlay: %#v", cfg)
	}
	if cfg.Scan.IPv6.Enabled != TriAuto {
		t.Fatalf("ipv6 enabled default = %q, want auto", cfg.Scan.IPv6.Enabled)
	}
}
