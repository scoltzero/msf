package server

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestOperationControllerResetCancelsAndRejectsWrites(t *testing.T) {
	controller := newOperationController()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/update/check", nil)
	tracked, finish, accepted := controller.begin(req)
	if !accepted {
		t.Fatal("initial write was rejected")
	}
	defer finish()
	if !controller.requestReset("fr-test") {
		t.Fatal("reset request was rejected")
	}
	controller.cancelOperations()
	select {
	case <-tracked.Context().Done():
		if !errors.Is(context.Cause(tracked.Context()), errFactoryResetRequested) {
			t.Fatalf("cancel cause=%v", context.Cause(tracked.Context()))
		}
	case <-time.After(time.Second):
		t.Fatal("active operation was not canceled")
	}
	if _, _, accepted := controller.begin(httptest.NewRequest(http.MethodPut, "/api/v1/settings", nil)); accepted {
		t.Fatal("new write was accepted after reset takeover")
	}
}

func TestOperationControllerDrainTimeoutReportsBlocker(t *testing.T) {
	controller := newOperationController()
	_, finish, accepted := controller.begin(httptest.NewRequest(http.MethodPost, "/api/v1/update/download", nil))
	if !accepted {
		t.Fatal("write was rejected")
	}
	defer finish()
	controller.requestReset("fr-test")
	controller.cancelOperations()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	remaining := controller.waitForDrain(ctx)
	if len(remaining) != 1 || remaining[0].Path != "/api/v1/update/download" {
		t.Fatalf("remaining=%+v", remaining)
	}
}
