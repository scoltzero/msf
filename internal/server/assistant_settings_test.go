package server

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/scoltzero/msf/internal/assistant"
	"github.com/scoltzero/msf/internal/assistant/catalog"
)

func TestAssistantSettingsAreAdminOnlyAndDoNotReturnSecrets(t *testing.T) {
	app := newTestApp(t)
	admin := tokenForRole(t, app, "admin")
	viewer := tokenForRole(t, app, "viewer")

	if response := requestJSON(t, app, http.MethodGet, "/api/v1/assistant/settings", viewer, nil); response.Code != http.StatusForbidden {
		t.Fatalf("viewer assistant settings status=%d body=%s", response.Code, response.Body.String())
	}
	patch := map[string]any{
		"enabled":  true,
		"base_url": "http://127.0.0.1:9999/v1",
		"api_key":  "secret-test-key",
		"model":    "test-model",
	}
	if response := requestJSON(t, app, http.MethodPut, "/api/v1/assistant/settings", admin, patch); response.Code != http.StatusOK {
		t.Fatalf("admin assistant settings update status=%d body=%s", response.Code, response.Body.String())
	}
	response := requestJSON(t, app, http.MethodGet, "/api/v1/assistant/settings", admin, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("admin assistant settings get status=%d body=%s", response.Code, response.Body.String())
	}
	if stringBody := response.Body.String(); stringBody == "" || containsSecret(stringBody, "secret-test-key") {
		t.Fatalf("assistant settings response leaked API key: %s", stringBody)
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	data, _ := payload["data"].(map[string]any)
	if data["api_key_set"] != true {
		t.Fatalf("expected api_key_set=true, got %#v", data["api_key_set"])
	}

	stored, err := app.getAssistantSettings()
	if err != nil {
		t.Fatal(err)
	}
	if stored.APIKey != "secret-test-key" || !stored.APIKeySet {
		t.Fatalf("encrypted API key did not round-trip")
	}
}

func TestAssistantInternalDispatchReusesMSFAuthorization(t *testing.T) {
	app := newTestApp(t)
	adminToken := tokenForRole(t, app, "admin")
	viewerToken := tokenForRole(t, app, "viewer")
	adminID := mustUserIDFromTokenTest(t, app, adminToken)
	viewerID := mustUserIDFromTokenTest(t, app, viewerToken)
	catalogSnapshot, err := catalog.Default()
	if err != nil {
		t.Fatal(err)
	}
	capability, matched, err := catalogSnapshot.Match(assistantCallForTest("GET", "/api/v1/version"))
	if err != nil || !matched {
		t.Fatalf("version capability did not match: %v", err)
	}
	result, statusCode := app.executeAssistantAPICall(testContext(), adminID, "assistant-test", capability, assistantCallForTest("GET", "/api/v1/version"), false)
	if statusCode != http.StatusOK || result == "" {
		t.Fatalf("internal assistant dispatch failed status=%d result=%s", statusCode, result)
	}
	if _, statusCode := app.executeAssistantAPICall(testContext(), viewerID, "assistant-test", capability, assistantCallForTest("GET", "/api/v1/version"), false); statusCode != http.StatusForbidden {
		t.Fatalf("non-admin internal dispatch should be forbidden, status=%d", statusCode)
	}
	var toolRuns int
	if err := app.DB.QueryRow(`select count(*) from assistant_tool_runs where user_id=? and session_id=? and capability=?`, adminID, "assistant-test", capability.Name).Scan(&toolRuns); err != nil || toolRuns != 1 {
		t.Fatalf("assistant tool run was not persisted: count=%d err=%v", toolRuns, err)
	}
}

func TestAssistantRejectsAdminAPIToken(t *testing.T) {
	app := newTestApp(t)
	adminJWT := tokenForRole(t, app, "admin")
	adminID := mustUserIDFromTokenTest(t, app, adminJWT)
	rawToken := "assistant-admin-api-token"
	if _, err := app.DB.Exec(`insert into api_tokens(user_id,name,token_hash,scope,created_at,revoked) values(?,?,?,?,?,false)`, adminID, "assistant-test", tokenHash(rawToken), "admin", time.Now()); err != nil {
		t.Fatal(err)
	}
	response := requestJSON(t, app, http.MethodGet, "/api/v1/assistant/status", rawToken, nil)
	if response.Code != http.StatusForbidden {
		t.Fatalf("admin API token accessed assistant: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAssistantKeyCreationIsAtomicAndInvalidKeyIsNotOverwritten(t *testing.T) {
	app := newTestApp(t)
	_ = os.Remove(app.assistantKeyPath())
	keys := make([][]byte, 2)
	errs := make([]error, 2)
	var wait sync.WaitGroup
	for index := range keys {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			keys[index], errs[index] = app.assistantKey()
		}(index)
	}
	wait.Wait()
	if errs[0] != nil || errs[1] != nil || string(keys[0]) != string(keys[1]) {
		t.Fatalf("concurrent assistant keys differ: errors=%v keys_equal=%v", errs, string(keys[0]) == string(keys[1]))
	}
	if err := os.WriteFile(app.assistantKeyPath(), []byte("invalid"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := app.assistantKey(); err == nil {
		t.Fatal("invalid assistant key was silently replaced")
	}
}

func mustUserIDFromTokenTest(t *testing.T, app *App, token string) int64 {
	t.Helper()
	identity, err := app.authenticateJWT(token)
	if err != nil {
		t.Fatal(err)
	}
	return identity.User.ID
}

func assistantCallForTest(method, path string) assistant.APICall {
	return assistant.APICall{Method: method, Path: path}
}

func testContext() context.Context {
	return context.Background()
}

func containsSecret(value, secret string) bool {
	return secret != "" && strings.Contains(value, secret)
}
