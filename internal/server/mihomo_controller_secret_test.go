package server

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMihomoSecretPrefersActiveCustomConfig(t *testing.T) {
	app := newTestApp(t)
	managed := app.mihomoControllerSecret()
	if managed == "" {
		t.Fatal("managed controller secret was not generated")
	}
	custom := "external-controller: :9090\nsecret: operator-owned-secret\n"
	if err := app.writeTextFileDirect(mihomoActiveConfigRelPath, custom); err != nil {
		t.Fatal(err)
	}
	if got := app.mihomoSecret(); got != "operator-owned-secret" {
		t.Fatalf("active custom secret lost to generated setting: got %q", got)
	}
	if got := app.injectMihomoControllerSecret(custom); got != custom {
		t.Fatalf("custom secret was overwritten:\n%s", got)
	}
}

func TestMihomoSecretFallsBackToManagedValueBeforeConfigExists(t *testing.T) {
	app := newTestApp(t)
	path := filepath.Join(app.DataDir, mihomoActiveConfigRelPath)
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	managed := app.mihomoControllerSecret()
	if managed == "" || app.mihomoSecret() != managed {
		t.Fatalf("managed secret fallback mismatch: managed=%q effective=%q", managed, app.mihomoSecret())
	}
	generated := app.injectMihomoControllerSecret("external-controller: :9090\n")
	if !strings.Contains(generated, "secret: "+managed) {
		t.Fatalf("managed secret was not injected:\n%s", generated)
	}
}
