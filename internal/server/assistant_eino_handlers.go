package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/scoltzero/msf/internal/assistant"
)

type assistantSSEStream struct {
	w       http.ResponseWriter
	flusher http.Flusher
	mu      sync.Mutex
	failed  bool
}

func newAssistantSSEStream(w http.ResponseWriter) (*assistantSSEStream, error) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		return nil, fmt.Errorf("当前响应不支持流式输出")
	}
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-store")
	w.Header().Set("Connection", "keep-alive")
	return &assistantSSEStream{w: w, flusher: flusher}, nil
}

func (s *assistantSSEStream) Emit(event string, payload any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failed {
		return
	}
	data, err := json.Marshal(payload)
	if err == nil {
		_, err = fmt.Fprintf(s.w, "event: %s\ndata: %s\n\n", event, data)
	}
	if err != nil {
		s.failed = true
		return
	}
	s.flusher.Flush()
}

func (a *App) streamAssistantEinoTurn(w http.ResponseWriter, r *http.Request, user *User, settings assistantSettings, sessionID string, mode assistant.ExecutionMode, messages []assistantMessage) {
	stream, err := newAssistantSSEStream(w)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "assistant_stream_unavailable", err.Error())
		return
	}
	stream.Emit("start", map[string]any{"session_id": sessionID, "runtime": assistantRuntimeName, "execution_mode": mode})
	checkpointID := "checkpoint-" + randomHex(16)
	runtime, err := a.newAssistantEinoRuntime(r.Context(), user.ID, sessionID, mode, settings, stream.Emit)
	if err != nil {
		a.failAssistantRun(sessionID, user.ID, err)
		stream.Emit("error", map[string]any{"message": err.Error()})
		return
	}
	providerMessages := trimAssistantVisibleContext(messages, settings.ContextTokens)
	result, err := a.consumeAssistantEinoEvents(r.Context(), runtime.Run(r.Context(), assistantMessagesToEino(providerMessages), checkpointID), stream.Emit)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) && r.Context().Err() != nil {
			_ = a.assistantCheckpointStore(user.ID, sessionID).Delete(context.Background(), checkpointID)
			a.finishAssistantRun(sessionID, user.ID, "stopped", "", "")
			return
		}
		a.failAssistantRun(sessionID, user.ID, err)
		stream.Emit("error", map[string]any{"message": err.Error()})
		return
	}
	if result.Content != "" {
		messages = appendOrMergeAssistantContent(messages, result.Content)
	}
	if result.Interrupted {
		actionID, pendingErr := a.createAssistantEinoPendingAction(user.ID, sessionID, checkpointID, result.InterruptID, mode, result.Approval)
		if pendingErr != nil {
			_ = a.assistantCheckpointStore(user.ID, sessionID).Delete(context.Background(), checkpointID)
			a.failAssistantRun(sessionID, user.ID, pendingErr)
			stream.Emit("error", map[string]any{"message": pendingErr.Error()})
			return
		}
		if err := a.persistAssistantMessages(sessionID, user.ID, messages, "awaiting_approval", checkpointID, ""); err != nil {
			_, _ = a.DB.Exec(`update assistant_pending_actions set status='error' where id=? and user_id=? and status='pending'`, actionID, user.ID)
			_ = a.assistantCheckpointStore(user.ID, sessionID).Delete(context.Background(), checkpointID)
			a.finishAssistantRun(sessionID, user.ID, "error", "", "")
			stream.Emit("error", map[string]any{"message": "保存助手会话失败：" + err.Error()})
			return
		}
		stream.Emit("approval_required", approvalPayload(actionID, result.Approval))
		return
	}
	_ = a.assistantCheckpointStore(user.ID, sessionID).Delete(context.Background(), checkpointID)
	if err := a.persistAssistantMessages(sessionID, user.ID, messages, "idle", "", ""); err != nil {
		stream.Emit("error", map[string]any{"message": "保存助手会话失败：" + err.Error()})
		return
	}
	stream.Emit("done", map[string]any{"session_id": sessionID})
}

func (a *App) handleAssistantActionResumeStream(w http.ResponseWriter, r *http.Request) {
	user, ok := assistantAdmin(r)
	if !ok {
		writeError(w, http.StatusForbidden, "assistant_admin_required", "AI 助手仅管理员可用")
		return
	}
	var request struct {
		Decision string `json:"decision"`
		Reason   string `json:"reason"`
	}
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	approved := request.Decision == "approve"
	if !approved && request.Decision != "reject" {
		writeError(w, http.StatusBadRequest, "assistant_action_decision_invalid", "decision 必须是 approve 或 reject")
		return
	}
	a.resumeAssistantAction(w, r, user, r.PathValue("id"), approved, request.Reason, true)
}

func (a *App) resumeAssistantAction(w http.ResponseWriter, r *http.Request, user *User, actionID string, approved bool, reason string, streamResponse bool) {
	a.cleanupAssistantRuntimeState()
	action, err := a.loadAssistantPendingAction(actionID, user.ID)
	if err != nil {
		writeError(w, http.StatusConflict, "assistant_action_expired", "该操作已执行、取消或失效")
		return
	}
	settings, err := a.getAssistantSettings()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "assistant_disabled", "AI 助手已禁用")
		return
	}
	if !settings.Enabled {
		if !approved {
			a.cancelAssistantActionWithoutRuntime(w, user, action, reason, streamResponse)
			return
		}
		writeError(w, http.StatusServiceUnavailable, "assistant_disabled", "AI 助手已禁用")
		return
	}
	mode, err := a.assistantSessionMode(action.SessionID, user.ID)
	if err != nil {
		writeError(w, http.StatusConflict, "assistant_session_not_found", "助手会话不存在")
		return
	}
	if approved && mode == assistant.ExecutionReadOnly {
		writeError(w, http.StatusForbidden, "assistant_action_not_allowed", "当前会话已经切换为只读模式")
		return
	}
	if !a.verifyAssistantPendingAction(action) {
		writeError(w, http.StatusConflict, "assistant_action_changed", "待执行操作校验失败，请重新发起")
		return
	}
	decisionText := "rejected"
	if approved {
		decisionText = "approved"
	}
	if claimed, claimErr := a.claimAssistantEinoAction(action.ID, user.ID, decisionText); claimErr != nil {
		writeError(w, http.StatusInternalServerError, "assistant_action_claim_failed", claimErr.Error())
		return
	} else if !claimed {
		writeError(w, http.StatusConflict, "assistant_action_expired", "该操作已执行、取消或失效")
		return
	}
	runID := "run-" + randomHex(12)
	if claimed, claimErr := a.claimAssistantSessionRun(action.SessionID, user.ID, runID, mode, true); claimErr != nil || !claimed {
		_, _ = a.DB.Exec(`update assistant_pending_actions set status='pending',decision=null,decided_at=null where id=? and user_id=? and status='executing'`, action.ID, user.ID)
		if claimErr != nil {
			writeError(w, http.StatusInternalServerError, "assistant_session_busy", claimErr.Error())
		} else {
			writeError(w, http.StatusConflict, "assistant_session_busy", "该会话正在执行其他任务")
		}
		return
	}
	a.audit(user, "assistant.action."+decisionText, action.ToolName, fmt.Sprintf("session=%s capability=%s", action.SessionID, action.Capability), true, "")

	if !streamResponse {
		collector := &assistantBufferedResponse{}
		a.resumeAssistantEinoAction(r.Context(), collector.Emit, user, settings, mode, action, approved, reason)
		writeJSON(w, http.StatusOK, map[string]any{"success": collector.err == "", "data": map[string]any{"result": collector.content, "status_code": collector.statusCode, "session_id": action.SessionID}, "message": collector.err})
		return
	}
	stream, err := newAssistantSSEStream(w)
	if err != nil {
		a.failAssistantAction(action, err)
		writeError(w, http.StatusInternalServerError, "assistant_stream_unavailable", err.Error())
		return
	}
	stream.Emit("start", map[string]any{"session_id": action.SessionID, "runtime": assistantRuntimeName, "resumed": true, "execution_mode": mode})
	a.resumeAssistantEinoAction(r.Context(), stream.Emit, user, settings, mode, action, approved, reason)
}

func (a *App) cancelAssistantActionWithoutRuntime(w http.ResponseWriter, user *User, action assistantPendingAction, reason string, streamResponse bool) {
	if !a.verifyAssistantPendingAction(action) {
		writeError(w, http.StatusConflict, "assistant_action_changed", "待执行操作校验失败，请重新发起")
		return
	}
	claimed, err := a.claimAssistantEinoAction(action.ID, user.ID, "rejected")
	if err != nil || !claimed {
		writeError(w, http.StatusConflict, "assistant_action_expired", "该操作已执行、取消或失效")
		return
	}
	if strings.TrimSpace(reason) == "" {
		reason = "管理员取消了操作"
	}
	_, _ = a.DB.Exec(`update assistant_pending_actions set status='cancelled',call_json='[cleared]',call_hash='' where id=? and user_id=?`, action.ID, user.ID)
	_ = a.assistantCheckpointStore(user.ID, action.SessionID).Delete(context.Background(), action.CheckpointID)
	messages, _ := a.loadAssistantMessages(action.SessionID, user.ID)
	messages = appendOrMergeAssistantContent(messages, "\n\n"+reason+"，操作未执行。")
	_ = a.persistAssistantMessages(action.SessionID, user.ID, messages, "idle", "", "")
	a.audit(user, "assistant.action.rejected", action.ToolName, fmt.Sprintf("session=%s capability=%s runtime_disabled=true", action.SessionID, action.Capability), true, "")
	if !streamResponse {
		writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]any{"result": reason + "，操作未执行。", "status_code": 200, "session_id": action.SessionID}})
		return
	}
	stream, streamErr := newAssistantSSEStream(w)
	if streamErr != nil {
		writeError(w, http.StatusInternalServerError, "assistant_stream_unavailable", streamErr.Error())
		return
	}
	stream.Emit("start", map[string]any{"session_id": action.SessionID, "runtime": assistantRuntimeName, "resumed": false})
	stream.Emit("delta", map[string]any{"content": reason + "，操作未执行。"})
	stream.Emit("done", map[string]any{"session_id": action.SessionID})
}

func (a *App) resumeAssistantEinoAction(ctx context.Context, emit assistantRuntimeEmitter, user *User, settings assistantSettings, mode assistant.ExecutionMode, action assistantPendingAction, approved bool, reason string) {
	runtime, err := a.newAssistantEinoRuntime(ctx, user.ID, action.SessionID, mode, settings, emit)
	if err != nil {
		a.failAssistantAction(action, err)
		emit("error", map[string]any{"message": err.Error()})
		return
	}
	iterator, err := runtime.Resume(ctx, action.CheckpointID, action.InterruptID, &assistantApprovalDecision{Approved: approved, Reason: reason})
	if err != nil {
		a.failAssistantAction(action, err)
		emit("error", map[string]any{"message": err.Error()})
		return
	}
	result, err := a.consumeAssistantEinoEvents(ctx, iterator, emit)
	if err != nil {
		a.failAssistantAction(action, err)
		emit("error", map[string]any{"message": err.Error()})
		return
	}
	messages, loadErr := a.loadAssistantMessages(action.SessionID, user.ID)
	if loadErr != nil {
		a.failAssistantAction(action, loadErr)
		emit("error", map[string]any{"message": loadErr.Error()})
		return
	}
	if result.Content != "" {
		messages = appendOrMergeAssistantContent(messages, result.Content)
	}
	finalStatus := "done"
	if !approved {
		finalStatus = "cancelled"
	}
	_, _ = a.DB.Exec(`update assistant_pending_actions set status=?,call_json='[cleared]',call_hash='' where id=? and user_id=? and status='executing'`, finalStatus, action.ID, user.ID)
	if result.Interrupted {
		newActionID, pendingErr := a.createAssistantEinoPendingAction(user.ID, action.SessionID, action.CheckpointID, result.InterruptID, mode, result.Approval)
		if pendingErr != nil {
			a.failAssistantAction(action, pendingErr)
			emit("error", map[string]any{"message": pendingErr.Error()})
			return
		}
		if err := a.persistAssistantMessages(action.SessionID, user.ID, messages, "awaiting_approval", action.CheckpointID, ""); err != nil {
			_, _ = a.DB.Exec(`update assistant_pending_actions set status='error' where id=? and user_id=? and status='pending'`, newActionID, user.ID)
			_ = a.assistantCheckpointStore(user.ID, action.SessionID).Delete(context.Background(), action.CheckpointID)
			a.finishAssistantRun(action.SessionID, user.ID, "error", "", "")
			emit("error", map[string]any{"message": err.Error()})
			return
		}
		emit("approval_required", approvalPayload(newActionID, result.Approval))
		return
	}
	_ = a.assistantCheckpointStore(user.ID, action.SessionID).Delete(context.Background(), action.CheckpointID)
	if err := a.persistAssistantMessages(action.SessionID, user.ID, messages, "idle", "", ""); err != nil {
		a.finishAssistantRun(action.SessionID, user.ID, "error", "", "")
		emit("error", map[string]any{"message": err.Error()})
		return
	}
	emit("done", map[string]any{"session_id": action.SessionID})
}

func (a *App) createAssistantEinoPendingAction(userID int64, sessionID, checkpointID, interruptID string, mode assistant.ExecutionMode, info *assistantApprovalInfo) (string, error) {
	if info == nil || checkpointID == "" || interruptID == "" || info.ArgumentsJSON == "" {
		return "", fmt.Errorf("Eino 确认操作缺少恢复信息")
	}
	hash := sha256.Sum256([]byte(info.ArgumentsJSON))
	id := "act-" + randomHex(16)
	now := time.Now()
	_, err := a.DB.Exec(`insert into assistant_pending_actions(id,user_id,session_id,capability,call_json,call_hash,risk,checkpoint_id,interrupt_id,tool_call_id,tool_name,execution_mode,status,expires_at,created_at) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, userID, sessionID, info.Capability, info.ArgumentsJSON, hex.EncodeToString(hash[:]), info.Risk, checkpointID, interruptID, info.ToolCallID, info.ToolName, mode, "pending", now.Add(5*time.Minute), now)
	return id, err
}

func approvalPayload(actionID string, info *assistantApprovalInfo) map[string]any {
	return map[string]any{"action_id": actionID, "title": info.Title, "method": info.Method, "path": info.Path, "risk": info.Risk, "details": info.Details, "expires_in": 300}
}

func (a *App) loadAssistantPendingAction(actionID string, userID int64) (assistantPendingAction, error) {
	var action assistantPendingAction
	err := a.DB.QueryRow(`select id,user_id,session_id,capability,call_json,call_hash,risk,status,expires_at,coalesce(checkpoint_id,''),coalesce(interrupt_id,''),coalesce(tool_call_id,''),coalesce(tool_name,''),coalesce(execution_mode,'confirm_writes') from assistant_pending_actions where id=? and user_id=? and status='pending' and expires_at>?`, actionID, userID, time.Now()).Scan(&action.ID, &action.UserID, &action.SessionID, &action.Capability, &action.CallJSON, &action.CallHash, &action.Risk, &action.Status, &action.ExpiresAt, &action.CheckpointID, &action.InterruptID, &action.ToolCallID, &action.ToolName, &action.ExecutionMode)
	if err != nil || action.CheckpointID == "" || action.InterruptID == "" {
		return action, fmt.Errorf("pending action unavailable")
	}
	return action, nil
}

func (a *App) verifyAssistantPendingAction(action assistantPendingAction) bool {
	hash := sha256.Sum256([]byte(action.CallJSON))
	return hex.EncodeToString(hash[:]) == action.CallHash
}

func (a *App) claimAssistantEinoAction(actionID string, userID int64, decision string) (bool, error) {
	result, err := a.DB.Exec(`update assistant_pending_actions set status='executing',decision=?,decided_at=? where id=? and user_id=? and status='pending' and expires_at>?`, decision, time.Now(), actionID, userID, time.Now())
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	return count == 1, err
}

func (a *App) assistantSessionMode(sessionID string, userID int64) (assistant.ExecutionMode, error) {
	var raw string
	if err := a.DB.QueryRow(`select coalesce(execution_mode,'confirm_writes') from assistant_sessions where id=? and user_id=?`, sessionID, userID).Scan(&raw); err != nil {
		return "", err
	}
	return assistant.NormalizeExecutionMode(assistant.ExecutionMode(raw)), nil
}

func (a *App) claimAssistantSessionRun(sessionID string, userID int64, runID string, mode assistant.ExecutionMode, allowAwaiting bool) (bool, error) {
	allowed := "('idle','stopped','error')"
	if allowAwaiting {
		allowed = "('idle','stopped','error','awaiting_approval')"
	}
	query := `update assistant_sessions set status='running',active_run_id=?,execution_mode=?,updated_at=? where id=? and user_id=? and (active_run_id is null or active_run_id='') and status in ` + allowed
	result, err := a.DB.Exec(query, runID, mode, time.Now(), sessionID, userID)
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	return count == 1, err
}

func (a *App) persistAssistantMessages(sessionID string, userID int64, messages []assistantMessage, status, checkpointID, activeRunID string) error {
	stored := make([]assistantStoredMessage, 0, len(messages))
	for _, message := range messages {
		if message.Role != "user" && message.Role != "assistant" || message.Content == "" {
			continue
		}
		stored = append(stored, assistantStoredMessage{Role: message.Role, Content: message.Content, CreatedAt: time.Now().Format(time.RFC3339)})
	}
	if len(stored) > 100 {
		stored = stored[len(stored)-100:]
	}
	raw, err := json.Marshal(stored)
	if err != nil {
		return err
	}
	_, err = a.DB.Exec(`update assistant_sessions set messages_json=?,status=?,checkpoint_id=nullif(?,''),active_run_id=nullif(?,''),runtime=?,runtime_version=?,updated_at=? where id=? and user_id=?`, raw, status, checkpointID, activeRunID, assistantRuntimeName, assistantRuntimeVersion, time.Now(), sessionID, userID)
	return err
}

func appendOrMergeAssistantContent(messages []assistantMessage, content string) []assistantMessage {
	if content == "" {
		return messages
	}
	if len(messages) > 0 && messages[len(messages)-1].Role == "assistant" {
		messages[len(messages)-1].Content += content
		return messages
	}
	return append(messages, assistantMessage{Role: "assistant", Content: content})
}

func trimAssistantVisibleContext(messages []assistantMessage, contextTokens int) []assistantMessage {
	if len(messages) <= 1 {
		return messages
	}
	maxChars := contextTokens * 3
	if maxChars < 16_000 {
		maxChars = 16_000
	}
	if maxChars > 512_000 {
		maxChars = 512_000
	}
	remaining := maxChars
	start := len(messages) - 1
	for index := len(messages) - 1; index >= 0; index-- {
		size := len(messages[index].Role) + len(messages[index].Content)
		if size > remaining && index < len(messages)-1 {
			break
		}
		start = index
		remaining -= size
		if remaining <= 0 {
			break
		}
	}
	// Do not start with an orphaned assistant answer after truncation.
	if start < len(messages)-1 && messages[start].Role == "assistant" {
		start++
	}
	return append([]assistantMessage(nil), messages[start:]...)
}

func (a *App) finishAssistantRun(sessionID string, userID int64, status, checkpointID, activeRunID string) {
	_, _ = a.DB.Exec(`update assistant_sessions set status=?,checkpoint_id=nullif(?,''),active_run_id=nullif(?,''),updated_at=? where id=? and user_id=?`, status, checkpointID, activeRunID, time.Now(), sessionID, userID)
}

func (a *App) failAssistantRun(sessionID string, userID int64, err error) {
	a.finishAssistantRun(sessionID, userID, "error", "", "")
}

func (a *App) failAssistantAction(action assistantPendingAction, err error) {
	_, _ = a.DB.Exec(`update assistant_pending_actions set status='error',call_json='[cleared]',call_hash='' where id=? and user_id=? and status='executing'`, action.ID, action.UserID)
	_ = a.assistantCheckpointStore(action.UserID, action.SessionID).Delete(context.Background(), action.CheckpointID)
	a.finishAssistantRun(action.SessionID, action.UserID, "error", "", "")
}

type assistantBufferedResponse struct {
	content    string
	err        string
	statusCode int
}

func (b *assistantBufferedResponse) Emit(event string, payload any) {
	data, _ := json.Marshal(payload)
	var object map[string]any
	_ = json.Unmarshal(data, &object)
	switch event {
	case "delta":
		b.content += fmt.Sprint(object["content"])
	case "error":
		b.err = fmt.Sprint(object["message"])
		b.statusCode = 500
	case "done":
		b.statusCode = 200
	case "approval_required":
		b.statusCode = 202
	}
}
