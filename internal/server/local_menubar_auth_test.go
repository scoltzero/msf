package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLocalMenuBarTokenIsLoopbackOnlyAndLeastPrivilege(t *testing.T) {
	app := newTestApp(t)
	token, err := app.IssueLocalMenuBarToken()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(token, "msf_local_") {
		t.Fatalf("token prefix = %q", token)
	}
	stored := app.setting(localMenuBarTokenHashKey, "")
	if stored == "" || stored == token || stored != tokenHash(token) {
		t.Fatal("local menu bar token must be stored as a hash")
	}

	for _, item := range []struct {
		method string
		path   string
		want   bool
	}{
		{http.MethodGet, "/api/v1/network/runtime", true},
		{http.MethodPost, "/api/v1/network/runtime/enable", true},
		{http.MethodPost, "/api/v1/network/runtime/disable", true},
		{http.MethodPost, "/api/v1/network/runtime/restart", true},
		{http.MethodPost, "/api/v1/network/runtime/stop", true},
		{http.MethodGet, "/api/v1/settings", false},
		{http.MethodGet, "/api/v1/api-tokens", false},
		{http.MethodPost, "/api/v1/services/start-all", false},
	} {
		req := httptest.NewRequest(item.method, "http://127.0.0.1"+item.path, nil)
		req.RemoteAddr = "127.0.0.1:54321"
		req.Header.Set("Authorization", "Bearer "+token)
		identity, authErr := app.authenticateRequest(req)
		if authErr != nil {
			t.Fatalf("authenticate %s %s: %v", item.method, item.path, authErr)
		}
		if got := app.authorizeRequest(identity, req); got != item.want {
			t.Fatalf("authorize %s %s = %t, want %t", item.method, item.path, got, item.want)
		}
	}

	remote := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/v1/network/runtime", nil)
	remote.RemoteAddr = "192.0.2.10:54321"
	remote.Header.Set("Authorization", "Bearer "+token)
	if _, err := app.authenticateRequest(remote); err == nil {
		t.Fatal("local menu bar token authenticated from a non-loopback address")
	}

	routerRequest := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/v1/network/runtime", nil)
	routerRequest.RemoteAddr = "127.0.0.1:54321"
	routerRequest.Header.Set("Authorization", "Bearer "+token)
	recorder := httptest.NewRecorder()
	app.Router().ServeHTTP(recorder, routerRequest)
	if recorder.Code != http.StatusOK {
		t.Fatalf("local menu bar request status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestIssuingLocalMenuBarTokenRevokesPreviousValue(t *testing.T) {
	app := newTestApp(t)
	oldToken, err := app.IssueLocalMenuBarToken()
	if err != nil {
		t.Fatal(err)
	}
	newToken, err := app.IssueLocalMenuBarToken()
	if err != nil {
		t.Fatal(err)
	}
	if oldToken == newToken {
		t.Fatal("rotated local menu bar token did not change")
	}
	if _, err := app.authenticateLocalMenuBarToken(oldToken, "127.0.0.1:1"); err == nil {
		t.Fatal("previous local menu bar token still authenticates")
	}
	if _, err := app.authenticateLocalMenuBarToken(newToken, "[::1]:1"); err != nil {
		t.Fatalf("new local menu bar token did not authenticate over IPv6 loopback: %v", err)
	}
}
