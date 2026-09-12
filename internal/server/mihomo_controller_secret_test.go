package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMihomoControllerProxyReplacesMSFSessionAuthorization(t *testing.T) {
	app := newTestApp(t)
	const controllerSecret = "controller-secret"
	var gotAuth string
	var gotPath string
	controller := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"mode": "global"})
	}))
	t.Cleanup(controller.Close)
	app.setSetting("mihomo_controller_endpoint", controller.URL)
	if err := app.writeTextFileDirect(mihomoActiveConfigRelPath, "external-controller: :9090\nsecret: "+controllerSecret+"\n"); err != nil {
		t.Fatal(err)
	}
	msfToken := tokenForRole(t, app, "admin")
	res := requestJSON(t, app, http.MethodPatch, "/api/v1/mihomo/controller/configs", msfToken, map[string]any{"mode": "global"})
	if res.Code != http.StatusOK {
		t.Fatalf("controller proxy status=%d body=%s", res.Code, res.Body.String())
	}
	if gotPath != "/configs" {
		t.Fatalf("controller proxy path=%q, want /configs", gotPath)
	}
	if gotAuth != "Bearer "+controllerSecret {
		t.Fatalf("controller proxy authorization=%q, want controller secret", gotAuth)
	}
	if gotAuth == "Bearer "+msfToken {
		t.Fatal("MSF session token must not be forwarded to Mihomo controller")
	}
}

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

func TestMihomoDefaultSecretDocumentationKeepsAuthenticationEnabled(t *testing.T) {
	app := newTestApp(t)
	managed := app.mihomoControllerSecret()
	app.ensureMihomoControllerSecret()
	if managed == "" || app.mihomoControllerSecret() != managed {
		t.Fatal("managed secret should be generated once and reused")
	}
	template, ok := runtimeTemplateText("mihomo/config.yaml")
	if !ok {
		t.Fatal("default Mihomo template missing")
	}
	for name, content := range map[string]string{
		"default":  template,
		"fallback": renderMihomoFallbackYAML(SetupConfig{}),
	} {
		for _, note := range []string{"优先使用你的值", "不是每次重启都换一个", `配置写成 secret: ""`, "建议保留认证"} {
			if !strings.Contains(content, note) {
				t.Fatalf("%s is missing secret guidance: %s", name, note)
			}
		}
		generated := app.injectMihomoControllerSecret(content)
		if !strings.Contains(generated, "\nsecret: "+managed+"\n") {
			t.Fatalf("%s guidance must not prevent random-secret injection", name)
		}
	}
	blank := "external-controller: :9090\nsecret: \"\"\n"
	if app.injectMihomoControllerSecret(blank) != blank {
		t.Fatal("explicit empty secret must not be overwritten")
	}
}
