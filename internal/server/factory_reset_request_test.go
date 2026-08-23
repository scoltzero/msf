package server

import (
	"context"
	"net/http"
	"testing"
	"time"
)

func TestFactoryResetRequestSchedulesRestartAndPersistsIntent(t *testing.T) {
	t.Setenv("MSF_RUNTIME", "native")
	withFactoryResetTestOps(t)
	app := newTestApp(t)
	initializeFactoryResetTestSetup(t, app, "nft", "password-123")
	token := loginFactoryResetTestUser(t, app, "password-123")
	restarted := make(chan string, 1)
	app.requestProcessRestart = func(reason string) error {
		restarted <- reason
		return nil
	}

	res := requestJSON(t, app, http.MethodPost, "/api/v1/setup/reset", token, map[string]any{"current_password": "password-123"})
	if res.Code != http.StatusAccepted {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
	request, ok, err := readFactoryResetRequest(app.DataDir)
	if err != nil || !ok || request.ResetID == "" || request.DeleteComponents {
		t.Fatalf("request=%+v ok=%t err=%v", request, ok, err)
	}
	select {
	case reason := <-restarted:
		if reason != "factory_reset" {
			t.Fatalf("restart reason=%q", reason)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("process restart was not requested")
	}
}

func TestCompletePendingFactoryResetBeforeRuntimeRestore(t *testing.T) {
	t.Setenv("MSF_RUNTIME", "native")
	withFactoryResetTestOps(t)
	app := newTestApp(t)
	initializeFactoryResetTestSetup(t, app, "nft", "password-123")
	request := newFactoryResetRequest(false)
	if err := writeFactoryResetRequest(app.DataDir, request); err != nil {
		t.Fatal(err)
	}
	completed, err := app.CompletePendingFactoryReset(context.Background())
	if err != nil || !completed {
		t.Fatalf("completed=%t err=%v", completed, err)
	}
	if app.IsInitialized() {
		t.Fatal("pending reset did not clear initialized state")
	}
	if _, ok, err := readFactoryResetRequest(app.DataDir); err != nil || ok {
		t.Fatalf("request marker remains: ok=%t err=%v", ok, err)
	}
}

func TestFailedFactoryResetStopsRetryingAfterThreeAttempts(t *testing.T) {
	app := newTestApp(t)
	request := newFactoryResetRequest(false)
	request.Phase = resetPhaseFailed
	request.Attempt = 3
	request.LastError = "persistent failure"
	if err := writeFactoryResetRequest(app.DataDir, request); err != nil {
		t.Fatal(err)
	}
	completed, err := app.CompletePendingFactoryReset(context.Background())
	if err != nil || !completed {
		t.Fatalf("completed=%t err=%v", completed, err)
	}
	phase, resetID := app.operations.status()
	if phase != resetPhaseFailed || resetID != request.ResetID {
		t.Fatalf("phase=%s resetID=%s", phase, resetID)
	}
}
