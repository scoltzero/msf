package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"
)

func TestAssistantEinoCheckpointStoreScopesAndDeletes(t *testing.T) {
	app := newTestApp(t)
	store := app.assistantCheckpointStore(7, "session-a")
	if err := store.Set(t.Context(), "checkpoint-a", []byte("state")); err != nil {
		t.Fatal(err)
	}
	data, ok, err := store.Get(t.Context(), "checkpoint-a")
	if err != nil || !ok || string(data) != "state" {
		t.Fatalf("checkpoint get data=%q ok=%v err=%v", data, ok, err)
	}
	if _, ok, err := app.assistantCheckpointStore(8, "session-a").Get(t.Context(), "checkpoint-a"); err != nil || ok {
		t.Fatalf("cross-user checkpoint visible ok=%v err=%v", ok, err)
	}
	if err := store.Delete(t.Context(), "checkpoint-a"); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := store.Get(t.Context(), "checkpoint-a"); err != nil || ok {
		t.Fatalf("deleted checkpoint still visible ok=%v err=%v", ok, err)
	}
}

func TestAssistantEinoApprovalResumesToolResultIntoMarkdown(t *testing.T) {
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		switch calls.Add(1) {
		case 1:
			toolCall := map[string]any{
				"index": 0, "id": "diag-call", "type": "function",
				"function": map[string]string{"name": "call_msf_api", "arguments": `{"method":"POST","path":"/api/v1/system/diagnostics/run"}`},
			}
			choice := map[string]any{"delta": map[string]any{"tool_calls": []any{toolCall}}, "finish_reason": "tool_calls"}
			writeAssistantProviderChunk(t, w, map[string]any{"choices": []any{choice}})
		case 2:
			choice := map[string]any{
				"delta":         map[string]string{"content": "## 诊断结论\n\n系统诊断已经执行完成，结果已由 Agent 汇总。"},
				"finish_reason": "stop",
			}
			writeAssistantProviderChunk(t, w, map[string]any{"choices": []any{choice}})
		default:
			t.Fatalf("unexpected provider call %d", calls.Load())
		}
		_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer provider.Close()

	app := newTestApp(t)
	admin := tokenForRole(t, app, "admin")
	enabled := true
	baseURL := provider.URL + "/v1"
	apiKey := "test-key"
	model := "test-model"
	if _, err := app.saveAssistantSettings(assistantSettingsPatch{Enabled: &enabled, BaseURL: &baseURL, APIKey: &apiKey, Model: &model}); err != nil {
		t.Fatal(err)
	}
	start := requestJSON(t, app, http.MethodPost, "/api/v1/assistant/chat/stream", admin, map[string]any{
		"session_id": "eino-approval", "text": "运行系统诊断并总结", "execution_mode": "confirm_writes",
	})
	if start.Code != http.StatusOK {
		t.Fatalf("start status=%d body=%s", start.Code, start.Body.String())
	}
	startBody := start.Body.String()
	if !strings.Contains(startBody, "approval_required") || strings.Contains(startBody, "诊断结论") {
		t.Fatalf("turn did not pause for approval: %s", startBody)
	}
	match := regexp.MustCompile(`"action_id":"([^"]+)"`).FindStringSubmatch(startBody)
	if len(match) != 2 {
		t.Fatalf("approval action id missing: %s", startBody)
	}
	// Resume through a fresh App instance to prove the Eino checkpoint is
	// durable across the exact HTTP/process boundary that broke the legacy loop.
	dataDir := app.DataDir
	app.Close()
	restarted, err := New(Options{DataDir: dataDir, Version: "test-restarted"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(restarted.Close)
	if err := restarted.EnsureBaseLayout(); err != nil {
		t.Fatal(err)
	}
	app = restarted
	resume := requestJSON(t, app, http.MethodPost, "/api/v1/assistant/actions/"+match[1]+"/resume/stream", admin, map[string]any{"decision": "approve"})
	if resume.Code != http.StatusOK {
		t.Fatalf("resume status=%d body=%s", resume.Code, resume.Body.String())
	}
	resumeBody := resume.Body.String()
	if !strings.Contains(resumeBody, "诊断结论") || !strings.Contains(resumeBody, "event: done") {
		t.Fatalf("resumed turn did not finish with markdown: %s", resumeBody)
	}
	if strings.Contains(resumeBody, "操作结果：") {
		t.Fatalf("raw operation result was injected as assistant text: %s", resumeBody)
	}
	var checkpoints int
	if err := app.DB.QueryRow(`select count(*) from assistant_runtime_checkpoints where session_id=?`, "eino-approval").Scan(&checkpoints); err != nil || checkpoints != 0 {
		t.Fatalf("completed checkpoint count=%d err=%v", checkpoints, err)
	}
}

func TestAssistantEinoRejectResumesAgentWithoutExecutingRootWrite(t *testing.T) {
	app := newTestApp(t)
	target := filepath.Join(app.DataDir, "must-not-exist.txt")
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		if calls.Add(1) == 1 {
			toolCall := map[string]any{
				"index": 0, "id": "write-call", "type": "function",
				"function": map[string]string{"name": "write", "arguments": fmt.Sprintf(`{"path":%q,"content":"must-not-exist"}`, target)},
			}
			writeAssistantProviderChunk(t, w, map[string]any{"choices": []any{map[string]any{"delta": map[string]any{"tool_calls": []any{toolCall}}, "finish_reason": "tool_calls"}}})
		} else {
			writeAssistantProviderChunk(t, w, map[string]any{"choices": []any{map[string]any{"delta": map[string]string{"content": "操作已取消，文件没有写入。"}, "finish_reason": "stop"}}})
		}
		_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer provider.Close()

	admin := tokenForRole(t, app, "admin")
	enabled := true
	baseURL := provider.URL + "/v1"
	apiKey := "test-key"
	model := "test-model"
	if _, err := app.saveAssistantSettings(assistantSettingsPatch{Enabled: &enabled, BaseURL: &baseURL, APIKey: &apiKey, Model: &model}); err != nil {
		t.Fatal(err)
	}
	start := requestJSON(t, app, http.MethodPost, "/api/v1/assistant/chat/stream", admin, map[string]any{"session_id": "eino-reject-write", "text": "写文件", "execution_mode": "confirm_writes"})
	match := regexp.MustCompile(`"action_id":"([^"]+)"`).FindStringSubmatch(start.Body.String())
	if len(match) != 2 {
		t.Fatalf("write approval missing: %s", start.Body.String())
	}
	resume := requestJSON(t, app, http.MethodPost, "/api/v1/assistant/actions/"+match[1]+"/resume/stream", admin, map[string]any{"decision": "reject", "reason": "test rejection"})
	if resume.Code != http.StatusOK || !strings.Contains(resume.Body.String(), "文件没有写入") {
		t.Fatalf("reject did not resume agent: status=%d body=%s", resume.Code, resume.Body.String())
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatalf("rejected root write changed filesystem: %v", err)
	}
}

func TestAssistantEinoFullAutoCompletesWriteWithoutInterrupt(t *testing.T) {
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		if calls.Add(1) == 1 {
			toolCall := map[string]any{
				"index": 0, "id": "diag-auto", "type": "function",
				"function": map[string]string{"name": "call_msf_api", "arguments": `{"method":"POST","path":"/api/v1/system/diagnostics/run"}`},
			}
			writeAssistantProviderChunk(t, w, map[string]any{"choices": []any{map[string]any{"delta": map[string]any{"tool_calls": []any{toolCall}}, "finish_reason": "tool_calls"}}})
		} else {
			writeAssistantProviderChunk(t, w, map[string]any{"choices": []any{map[string]any{"delta": map[string]string{"content": "自动诊断完成"}, "finish_reason": "stop"}}})
		}
		_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer provider.Close()

	app := newTestApp(t)
	admin := tokenForRole(t, app, "admin")
	enabled := true
	baseURL := provider.URL + "/v1"
	apiKey := "test-key"
	model := "test-model"
	if _, err := app.saveAssistantSettings(assistantSettingsPatch{Enabled: &enabled, BaseURL: &baseURL, APIKey: &apiKey, Model: &model}); err != nil {
		t.Fatal(err)
	}
	response := requestJSON(t, app, http.MethodPost, "/api/v1/assistant/chat/stream", admin, map[string]any{
		"session_id": "eino-full-auto", "text": "直接运行系统诊断", "execution_mode": "full_auto",
	})
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	body := response.Body.String()
	if strings.Contains(body, "approval_required") || !strings.Contains(body, "自动诊断完成") || !strings.Contains(body, "event: done") {
		t.Fatalf("full-auto turn did not complete directly: %s", body)
	}
}

func TestAssistantEinoIterationBudgetTranslatesLegacyToolRounds(t *testing.T) {
	for _, test := range []struct {
		toolRounds int
		want       int
	}{
		{toolRounds: 0, want: 32},
		{toolRounds: 1, want: 32},
		{toolRounds: 8, want: 32},
		{toolRounds: 12, want: 48},
		{toolRounds: 16, want: 64},
	} {
		if got := assistantEinoMaxIterations(test.toolRounds); got != test.want {
			t.Fatalf("tool rounds=%d iterations=%d want=%d", test.toolRounds, got, test.want)
		}
	}
	normalized := normalizeAssistantEinoError(fmt.Errorf("[NodeRunError] exceeds max iterations"))
	if normalized == nil || strings.Contains(normalized.Error(), "NodeRunError") || !strings.Contains(normalized.Error(), "故障熔断器") {
		t.Fatalf("iteration error was not normalized: %v", normalized)
	}
}

func writeAssistantProviderChunk(t *testing.T, w http.ResponseWriter, value map[string]any) {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = fmt.Fprintf(w, "data: %s\n\n", data)
}
