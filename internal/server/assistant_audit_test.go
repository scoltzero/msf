package server

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/scoltzero/msf/internal/assistant"
)

func TestAssistantResultRedactionIsRecursiveAndTerminates(t *testing.T) {
	input := `{"token":"top-secret","nested":{"password":"pw","safe":"value"},"items":[{"api_key":"key"}]}`
	result := redactAssistantResult(input)
	if strings.Contains(result, "top-secret") || strings.Contains(result, `"pw"`) || strings.Contains(result, `"key"`) {
		t.Fatalf("assistant result leaked a secret: %s", result)
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(result), &decoded); err != nil {
		t.Fatalf("redacted JSON is invalid: %v result=%s", err, result)
	}
	text := redactAssistantResult("token=plain-secret status=ok")
	if strings.Contains(text, "plain-secret") {
		t.Fatalf("plain-text secret was not redacted: %s", text)
	}
}

func TestAssistantResultTruncationPreservesUTF8(t *testing.T) {
	result := truncateAssistantResult(strings.Repeat("诊断", 100), 81)
	if !utf8.ValidString(result) || !strings.Contains(result, "[结果已截断]") {
		t.Fatalf("invalid truncated result: %q", result)
	}
}

func TestAssistantConfirmationSummaryShowsFrozenBodyAndRedactsSecrets(t *testing.T) {
	summary := assistantCallSummary(assistant.APICall{Method: "POST", Path: "/api/v1/assistant/skills", Body: map[string]any{"name": "diagnose", "prompt": "run checks", "token": "secret-value"}})
	if !strings.Contains(summary, "diagnose") || !strings.Contains(summary, "run checks") {
		t.Fatalf("confirmation summary omitted body: %s", summary)
	}
	if strings.Contains(summary, "secret-value") || !strings.Contains(summary, "[REDACTED]") {
		t.Fatalf("confirmation summary leaked a secret: %s", summary)
	}
}

func TestAssistantContextTrimKeepsLatestVisibleConversation(t *testing.T) {
	messages := []assistantMessage{
		{Role: "user", Content: strings.Repeat("old", 6000)},
		{Role: "assistant", Content: strings.Repeat("answer", 3000)},
		{Role: "user", Content: "latest question"},
	}
	trimmed := trimAssistantVisibleContext(messages, 4096)
	if len(trimmed) == 0 || trimmed[len(trimmed)-1].Content != "latest question" {
		t.Fatalf("context boundaries were not preserved: %#v", trimmed)
	}
	if trimmed[0].Role == "assistant" {
		t.Fatalf("trimmed context starts with an orphaned assistant answer: %#v", trimmed)
	}
}

func TestAssistantCancelRegistrationDoesNotLetOldRequestDeleteNewHandle(t *testing.T) {
	app := newTestApp(t)
	key := assistantCancelKey(1, "same-session")
	oldContext, oldCancel := context.WithCancel(context.Background())
	defer oldCancel()
	_, newCancel := context.WithCancel(context.Background())
	defer newCancel()
	app.registerAssistantCancel(key, "old", oldCancel)
	app.registerAssistantCancel(key, "new", newCancel)
	select {
	case <-oldContext.Done():
	case <-time.After(time.Second):
		t.Fatal("registering a replacement did not cancel the old request")
	}
	app.clearAssistantCancel(key, "old")
	if current, ok := app.assistantCancels[key]; !ok || current.Token != "new" {
		t.Fatalf("old request removed the new cancel handle: %#v", current)
	}
	app.clearAssistantCancel(key, "new")
	if _, ok := app.assistantCancels[key]; ok {
		t.Fatal("current cancel handle was not cleared")
	}
}

func TestAssistantPendingActionCanOnlyBeClaimedOnce(t *testing.T) {
	app := newTestApp(t)
	adminToken := tokenForRole(t, app, "admin")
	adminID := mustUserIDFromTokenTest(t, app, adminToken)
	actionID, err := app.createAssistantEinoPendingAction(adminID, "session", "checkpoint", "interrupt", assistant.ExecutionConfirmWrites, &assistantApprovalInfo{Title: "test", Capability: "test-write", ToolName: "call_msf_api", Risk: string(assistant.RiskReversible), ArgumentsJSON: `{"method":"POST","path":"/api/v1/test"}`})
	if err != nil {
		t.Fatal(err)
	}
	results := make(chan bool, 2)
	errors := make(chan error, 2)
	var wait sync.WaitGroup
	for range 2 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			claimed, claimErr := app.claimAssistantEinoAction(actionID, adminID, "approved")
			results <- claimed
			errors <- claimErr
		}()
	}
	wait.Wait()
	close(results)
	close(errors)
	claimedCount := 0
	for claimed := range results {
		if claimed {
			claimedCount++
		}
	}
	for claimErr := range errors {
		if claimErr != nil {
			t.Fatal(claimErr)
		}
	}
	if claimedCount != 1 {
		t.Fatalf("pending action claims=%d want=1", claimedCount)
	}
}

func TestDeletingAssistantSessionCancelsPendingActions(t *testing.T) {
	app := newTestApp(t)
	adminToken := tokenForRole(t, app, "admin")
	adminID := mustUserIDFromTokenTest(t, app, adminToken)
	if err := app.ensureAssistantSession("delete-session", adminID, "delete me"); err != nil {
		t.Fatal(err)
	}
	checkpointID := "delete-checkpoint"
	if err := app.assistantCheckpointStore(adminID, "delete-session").Set(t.Context(), checkpointID, []byte("state")); err != nil {
		t.Fatal(err)
	}
	actionID, err := app.createAssistantEinoPendingAction(adminID, "delete-session", checkpointID, "interrupt", assistant.ExecutionConfirmWrites, &assistantApprovalInfo{Title: "test", Capability: "test-write", ToolName: "call_msf_api", Risk: string(assistant.RiskReversible), ArgumentsJSON: `{"method":"POST","path":"/api/v1/test"}`})
	if err != nil {
		t.Fatal(err)
	}
	response := requestJSON(t, app, "DELETE", "/api/v1/assistant/sessions/delete-session", adminToken, nil)
	if response.Code != 200 {
		t.Fatalf("session delete failed: status=%d body=%s", response.Code, response.Body.String())
	}
	var status string
	if err := app.DB.QueryRow(`select status from assistant_pending_actions where id=?`, actionID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "cancelled" {
		t.Fatalf("pending action status=%s want=cancelled", status)
	}
	if _, exists, err := app.assistantCheckpointStore(adminID, "delete-session").Get(t.Context(), checkpointID); err != nil || exists {
		t.Fatalf("deleted session checkpoint exists=%v err=%v", exists, err)
	}
}
