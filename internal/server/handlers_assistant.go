package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"syscall"
	"time"
	"unicode/utf8"

	"github.com/cloudwego/eino/schema"
	"github.com/scoltzero/msf/internal/assistant"
	"github.com/scoltzero/msf/internal/assistant/catalog"
)

type assistantChatRequest struct {
	SessionID     string                  `json:"session_id"`
	Text          string                  `json:"text"`
	Context       map[string]any          `json:"context,omitempty"`
	ExecutionMode assistant.ExecutionMode `json:"execution_mode,omitempty"`
}

type assistantStoredMessage struct {
	Role      string `json:"role"`
	Content   string `json:"content"`
	CreatedAt string `json:"created_at,omitempty"`
}

const assistantUserMessageRuneLimit = 16_000

const assistantResponseFormatGuard = `## 强制答复格式
工具返回的 JSON、日志、配置和诊断内容只能作为分析证据。最终答复必须先归纳为清晰 Markdown；除非用户明确要求，不得原样倾倒完整 JSON、配置、日志或带 \\n 转义的字符串。`

func (a *App) registerAssistantRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/assistant/status", a.handleAssistantStatus)
	mux.HandleFunc("GET /api/v1/assistant/settings", a.handleAssistantSettingsGet)
	mux.HandleFunc("PUT /api/v1/assistant/settings", a.handleAssistantSettingsPut)
	mux.HandleFunc("POST /api/v1/assistant/settings/test", a.handleAssistantSettingsTest)
	mux.HandleFunc("POST /api/v1/assistant/chat/stream", a.handleAssistantChatStream)
	mux.HandleFunc("GET /api/v1/assistant/sessions", a.handleAssistantSessions)
	mux.HandleFunc("GET /api/v1/assistant/sessions/{id}", a.handleAssistantSession)
	mux.HandleFunc("DELETE /api/v1/assistant/sessions/{id}", a.handleAssistantSessionDelete)
	mux.HandleFunc("POST /api/v1/assistant/sessions/{id}/stop", a.handleAssistantSessionStop)
	mux.HandleFunc("POST /api/v1/assistant/actions/{id}/execute", a.handleAssistantActionExecute)
	mux.HandleFunc("POST /api/v1/assistant/actions/{id}/cancel", a.handleAssistantActionCancel)
	mux.HandleFunc("POST /api/v1/assistant/actions/{id}/resume/stream", a.handleAssistantActionResumeStream)
	mux.HandleFunc("GET /api/v1/assistant/skills", a.handleAssistantSkillsList)
	mux.HandleFunc("POST /api/v1/assistant/skills", a.handleAssistantSkillCreate)
	mux.HandleFunc("DELETE /api/v1/assistant/skills/{id}", a.handleAssistantSkillDelete)
}

// assistantAdmin returns the current administrator without writing a response.
// It is used by handlers because the normal role middleware already rejects
// non-admin callers before these routes run.
func assistantAdmin(r *http.Request) (*User, bool) {
	user := currentUser(r)
	identity := currentIdentity(r)
	return user, user != nil && user.IsActive && user.Role == "admin" && (identity == nil || identity.AuthType != "api_token")
}

func (a *App) handleAssistantStatus(w http.ResponseWriter, r *http.Request) {
	user, ok := assistantAdmin(r)
	if !ok {
		writeError(w, http.StatusForbidden, "assistant_admin_required", "AI 助手仅管理员可用")
		return
	}
	settings, err := a.getAssistantSettings()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "assistant_settings_failed", err.Error())
		return
	}
	catalogSnapshot, catalogErr := catalog.Default()
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"enabled":         settings.Enabled,
			"orb_enabled":     settings.OrbEnabled,
			"admin":           user.Role == "admin",
			"runtime":         assistantRuntimeName,
			"runtime_version": assistantRuntimeVersion,
			"catalog_ready":   catalogErr == nil,
			"catalog_capabilities": func() int {
				if catalogErr != nil {
					return 0
				}
				return len(catalogSnapshot.Capabilities)
			}(),
		},
	})
}

func (a *App) handleAssistantSettingsGet(w http.ResponseWriter, r *http.Request) {
	if _, ok := assistantAdmin(r); !ok {
		writeError(w, http.StatusForbidden, "assistant_admin_required", "AI 助手仅管理员可用")
		return
	}
	settings, err := a.getAssistantSettings()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "assistant_settings_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": assistantSettingsResponse(settings)})
}

func (a *App) handleAssistantSettingsPut(w http.ResponseWriter, r *http.Request) {
	user, ok := assistantAdmin(r)
	if !ok {
		writeError(w, http.StatusForbidden, "assistant_admin_required", "AI 助手仅管理员可用")
		return
	}
	var patch assistantSettingsPatch
	if err := decodeJSON(r, &patch); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	settings, err := a.saveAssistantSettings(patch)
	if err != nil {
		a.audit(user, "assistant.settings.update", "assistant", "", false, err.Error())
		writeError(w, http.StatusBadRequest, "assistant_settings_failed", err.Error())
		return
	}
	a.audit(user, "assistant.settings.update", "assistant", "", true, "")
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": assistantSettingsResponse(settings)})
}

func (a *App) handleAssistantSettingsTest(w http.ResponseWriter, r *http.Request) {
	if _, ok := assistantAdmin(r); !ok {
		writeError(w, http.StatusForbidden, "assistant_admin_required", "AI 助手仅管理员可用")
		return
	}
	settings, err := a.getAssistantSettings()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "assistant_settings_failed", err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	model, err := newAssistantEinoModel(ctx, settings)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"success": false, "message": err.Error()})
		return
	}
	result, err := model.Generate(ctx, []*schema.Message{schema.UserMessage("只回复：MSF assistant connection ok")})
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"success": false, "message": err.Error()})
		return
	}
	if result == nil || len(result.ToolCalls) > 0 || !strings.Contains(strings.ToLower(result.Content), "msf assistant connection ok") {
		writeJSON(w, http.StatusBadGateway, map[string]any{"success": false, "message": "AI Provider 已连接，但没有按要求返回测试文本"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]any{"message": result.Content, "runtime": assistantRuntimeName}})
}

func (a *App) handleAssistantSessions(w http.ResponseWriter, r *http.Request) {
	user, ok := assistantAdmin(r)
	if !ok {
		writeError(w, http.StatusForbidden, "assistant_admin_required", "AI 助手仅管理员可用")
		return
	}
	rows, err := a.DB.Query(`select id,coalesce(title,''),status,coalesce(execution_mode,'confirm_writes'),created_at,updated_at from assistant_sessions where user_id=? order by updated_at desc limit 50`, user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "assistant_sessions_failed", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, title, status, executionMode string
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&id, &title, &status, &executionMode, &createdAt, &updatedAt); err != nil {
			continue
		}
		items = append(items, map[string]any{"id": id, "title": title, "status": status, "execution_mode": assistant.NormalizeExecutionMode(assistant.ExecutionMode(executionMode)), "created_at": createdAt, "updated_at": updatedAt})
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": items})
}

func (a *App) handleAssistantSession(w http.ResponseWriter, r *http.Request) {
	user, ok := assistantAdmin(r)
	if !ok {
		writeError(w, http.StatusForbidden, "assistant_admin_required", "AI 助手仅管理员可用")
		return
	}
	id := r.PathValue("id")
	var messages string
	var title, status, executionMode string
	var owner int64
	if err := a.DB.QueryRow(`select user_id,coalesce(title,''),status,coalesce(execution_mode,'confirm_writes'),messages_json from assistant_sessions where id=?`, id).Scan(&owner, &title, &status, &executionMode, &messages); err != nil || owner != user.ID {
		writeError(w, http.StatusNotFound, "assistant_session_not_found", "会话不存在")
		return
	}
	var decoded []assistantStoredMessage
	if err := json.Unmarshal([]byte(messages), &decoded); err != nil {
		writeError(w, http.StatusInternalServerError, "assistant_session_corrupt", "会话消息无法解析")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]any{"id": id, "title": title, "status": status, "execution_mode": assistant.NormalizeExecutionMode(assistant.ExecutionMode(executionMode)), "messages": decoded}})
}

func (a *App) handleAssistantSessionDelete(w http.ResponseWriter, r *http.Request) {
	user, ok := assistantAdmin(r)
	if !ok {
		writeError(w, http.StatusForbidden, "assistant_admin_required", "AI 助手仅管理员可用")
		return
	}
	sessionID := r.PathValue("id")
	a.assistantStop(sessionID, user.ID)
	tx, err := a.DB.Begin()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "assistant_session_delete_failed", err.Error())
		return
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`update assistant_pending_actions set status='cancelled',decision='session_deleted',decided_at=?,call_json='[cleared]',call_hash='' where session_id=? and user_id=? and status='pending'`, time.Now(), sessionID, user.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "assistant_session_delete_failed", err.Error())
		return
	}
	if _, err := tx.Exec(`delete from assistant_runtime_checkpoints where session_id=? and user_id=?`, sessionID, user.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "assistant_session_delete_failed", err.Error())
		return
	}
	result, err := tx.Exec(`delete from assistant_sessions where id=? and user_id=?`, sessionID, user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "assistant_session_delete_failed", err.Error())
		return
	}
	count, _ := result.RowsAffected()
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "assistant_session_delete_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": count > 0})
}

func (a *App) handleAssistantSessionStop(w http.ResponseWriter, r *http.Request) {
	user, ok := assistantAdmin(r)
	if !ok {
		writeError(w, http.StatusForbidden, "assistant_admin_required", "AI 助手仅管理员可用")
		return
	}
	a.assistantStop(r.PathValue("id"), user.ID)
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]any{"stopped": true}})
}

func (a *App) handleAssistantChatStream(w http.ResponseWriter, r *http.Request) {
	user, ok := assistantAdmin(r)
	if !ok {
		writeError(w, http.StatusForbidden, "assistant_admin_required", "AI 助手仅管理员可用")
		return
	}
	var payload assistantChatRequest
	if err := decodeJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	payload.Text = strings.TrimSpace(payload.Text)
	if payload.Text == "" {
		writeError(w, http.StatusBadRequest, "assistant_empty_message", "请输入要发送给 AI 助手的内容")
		return
	}
	if len([]rune(payload.Text)) > assistantUserMessageRuneLimit {
		writeError(w, http.StatusRequestEntityTooLarge, "assistant_message_too_large", "单条消息不能超过 16000 个字符")
		return
	}
	settings, err := a.getAssistantSettings()
	if err != nil || !settings.Enabled {
		writeError(w, http.StatusServiceUnavailable, "assistant_disabled", "AI 助手未启用")
		return
	}
	a.cleanupAssistantRuntimeState()
	if payload.SessionID == "" {
		payload.SessionID = "assistant-" + randomHex(16)
	}
	payload.ExecutionMode = assistant.NormalizeExecutionMode(payload.ExecutionMode)
	if err := a.ensureAssistantSessionWithMode(payload.SessionID, user.ID, payload.Text, payload.ExecutionMode); err != nil {
		writeError(w, http.StatusInternalServerError, "assistant_session_failed", err.Error())
		return
	}
	runID := "run-" + randomHex(12)
	claimed, err := a.claimAssistantSessionRun(payload.SessionID, user.ID, runID, payload.ExecutionMode, false)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "assistant_session_failed", err.Error())
		return
	}
	if !claimed {
		writeError(w, http.StatusConflict, "assistant_session_busy", "该会话正在运行或等待操作确认")
		return
	}
	streamContext, cancel := context.WithCancel(r.Context())
	cancelKey := assistantCancelKey(user.ID, payload.SessionID)
	cancelToken := randomHex(12)
	a.registerAssistantCancel(cancelKey, cancelToken, cancel)
	defer func() {
		cancel()
		a.clearAssistantCancel(cancelKey, cancelToken)
	}()
	r = r.WithContext(streamContext)
	messages, err := a.loadAssistantMessages(payload.SessionID, user.ID)
	if err != nil {
		a.finishAssistantRun(payload.SessionID, user.ID, "error", "", "")
		writeError(w, http.StatusInternalServerError, "assistant_session_failed", err.Error())
		return
	}
	messages = append(messages, assistantMessage{Role: "user", Content: payload.Text})
	if err := a.persistAssistantMessages(payload.SessionID, user.ID, messages, "running", "", runID); err != nil {
		a.finishAssistantRun(payload.SessionID, user.ID, "error", "", "")
		writeError(w, http.StatusInternalServerError, "assistant_session_failed", err.Error())
		return
	}
	a.streamAssistantEinoTurn(w, r, user, settings, payload.SessionID, payload.ExecutionMode, messages)
}

func (a *App) executeAssistantHostRead(operation string) string {
	switch operation {
	case "managed_services":
		if a.Services == nil {
			return `{"success":false,"message":"service manager unavailable"}`
		}
		return marshalAssistantValue(map[string]any{"success": true, "services": a.Services.List()})
	case "disk_usage":
		var stat syscall.Statfs_t
		if err := syscall.Statfs(a.DataDir, &stat); err != nil {
			return marshalAssistantValue(map[string]any{"success": false, "message": err.Error()})
		}
		return marshalAssistantValue(map[string]any{"success": true, "path": a.DataDir, "total_bytes": stat.Blocks * uint64(stat.Bsize), "available_bytes": stat.Bavail * uint64(stat.Bsize), "used_bytes": (stat.Blocks - stat.Bfree) * uint64(stat.Bsize)})
	default:
		return `{"success":false,"message":"host operation is not allowed"}`
	}
}

func marshalAssistantValue(value any) string {
	data, err := json.Marshal(value)
	if err != nil {
		return `{"success":false,"message":"result serialization failed"}`
	}
	return string(data)
}

func assistantCallSummary(call assistant.APICall) string {
	value := map[string]any{}
	if len(call.Query) > 0 {
		value["query"] = call.Query
	}
	if call.Body != nil {
		value["body"] = call.Body
	}
	if len(value) == 0 {
		return ""
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return "参数无法序列化"
	}
	return truncateAssistantResult(redactAssistantResult(string(data)), 4096)
}

// discoverAssistantCapability gives administrators complete coverage of the
// current registered MSF API without maintaining a second handler table.  The
// raw ServeMux remains the source of truth for route existence; high-impact
// paths receive a protected exposure by default until a catalog entry provides
// a more precise description and schema.
func (a *App) discoverAssistantCapability(call assistant.APICall) (catalog.Capability, bool) {
	path := strings.TrimSpace(call.Path)
	if path == "" || !strings.HasPrefix(path, "/api/v1/") || strings.Contains(path, "://") || strings.Contains(path, "..") || strings.HasPrefix(path, "/api/v1/assistant/") {
		return catalog.Capability{}, false
	}
	req, err := http.NewRequest(strings.ToUpper(call.Method), path, nil)
	if err != nil {
		return catalog.Capability{}, false
	}
	_, pattern := a.rawRouter().(*http.ServeMux).Handler(req)
	if pattern == "" {
		return catalog.Capability{}, false
	}
	method := strings.ToUpper(call.Method)
	exposure := assistant.ExposureConfirm
	risk := assistant.RiskReversible
	if method == http.MethodGet {
		exposure = assistant.ExposureAuto
		risk = assistant.RiskRead
	}
	lowerPath := strings.ToLower(path)
	if protectedAssistantFallback(method, lowerPath) {
		exposure = assistant.ExposureProtected
		risk = assistant.RiskDestructive
	}
	if strings.HasPrefix(lowerPath, "/api/v1/auth/") {
		exposure = assistant.ExposureInternal
	}
	name := "api_" + strings.ToLower(method) + "_" + strings.NewReplacer("/", "_", "{", "", "}", "", "-", "_").Replace(strings.TrimPrefix(path, "/api/v1/"))
	return catalog.Capability{Name: name, Method: method, Path: pattern, Description: "调用已注册的 MSF API", Exposure: exposure, Risk: risk, RequiredRole: "admin", ResultLimit: 65536, RedactProfile: "generic"}, true
}

func protectedAssistantFallback(method, lowerPath string) bool {
	if method == http.MethodDelete {
		return true
	}
	for _, fragment := range []string{"reset", "delete", "clear", "password", "token", "config/file", "settings", "audit-logs", "/users"} {
		if strings.Contains(lowerPath, fragment) {
			return true
		}
	}
	if method == http.MethodGet {
		return false
	}
	for _, fragment := range []string{"/install", "/restore", "/nftables", "/network/apply", "/network/stop", "/network/runtime/stop", "/daemon/stop", "/services/stop-all", "/license-activation/", "/setup/activate"} {
		if strings.Contains(lowerPath, fragment) {
			return true
		}
	}
	return false
}

func (a *App) handleAssistantActionExecute(w http.ResponseWriter, r *http.Request) {
	user, ok := assistantAdmin(r)
	if !ok {
		writeError(w, http.StatusForbidden, "assistant_admin_required", "AI 助手仅管理员可用")
		return
	}
	a.resumeAssistantAction(w, r, user, r.PathValue("id"), true, "", false)
}

func (a *App) handleAssistantActionCancel(w http.ResponseWriter, r *http.Request) {
	user, ok := assistantAdmin(r)
	if !ok {
		writeError(w, http.StatusForbidden, "assistant_admin_required", "AI 助手仅管理员可用")
		return
	}
	a.resumeAssistantAction(w, r, user, r.PathValue("id"), false, "管理员取消了操作", false)
}

type assistantPendingAction struct {
	ID, SessionID, Capability, CallJSON, CallHash, Risk, Status string
	CheckpointID, InterruptID, ToolCallID, ToolName             string
	ExecutionMode                                               assistant.ExecutionMode
	UserID                                                      int64
	ExpiresAt                                                   time.Time
}

func (a *App) ensureAssistantSession(id string, userID int64, firstText string) error {
	return a.ensureAssistantSessionWithMode(id, userID, firstText, assistant.ExecutionConfirmWrites)
}

func (a *App) ensureAssistantSessionWithMode(id string, userID int64, firstText string, mode assistant.ExecutionMode) error {
	title := strings.TrimSpace(firstText)
	titleRunes := []rune(title)
	if len(titleRunes) > 80 {
		title = string(titleRunes[:80])
	}
	mode = assistant.NormalizeExecutionMode(mode)
	_, err := a.DB.Exec(`insert into assistant_sessions(id,user_id,title,status,messages_json,runtime,runtime_version,execution_mode,created_at,updated_at) values(?,?,?,?,?,?,?,?,?,?) on conflict(id) do nothing`, id, userID, title, "idle", "[]", assistantRuntimeName, assistantRuntimeVersion, mode, time.Now(), time.Now())
	return err
}

func (a *App) loadAssistantMessages(sessionID string, userID int64) ([]assistantMessage, error) {
	var raw string
	if err := a.DB.QueryRow(`select messages_json from assistant_sessions where id=? and user_id=?`, sessionID, userID).Scan(&raw); err != nil {
		return nil, err
	}
	var stored []assistantStoredMessage
	if err := json.Unmarshal([]byte(raw), &stored); err != nil {
		return nil, err
	}
	messages := make([]assistantMessage, 0, len(stored))
	for _, message := range stored {
		messages = append(messages, assistantMessage{Role: message.Role, Content: message.Content})
	}
	return messages, nil
}

func (a *App) executeAssistantAPICall(ctx context.Context, userID int64, sessionID string, capability catalog.Capability, call assistant.APICall, confirmed bool) (string, int) {
	startedAt := time.Now()
	user, err := a.userByID(userID)
	if err != nil || user.Role != "admin" || !user.IsActive {
		return "管理员身份已失效", http.StatusForbidden
	}
	path := call.Path
	if len(call.Query) > 0 {
		values := url.Values{}
		for key, value := range call.Query {
			values.Set(key, fmt.Sprint(value))
		}
		path += "?" + values.Encode()
	}
	body := []byte(nil)
	if call.Body != nil {
		body, err = json.Marshal(call.Body)
		if err != nil {
			return "请求 body 无效", http.StatusBadRequest
		}
	}
	req, err := http.NewRequestWithContext(ctx, strings.ToUpper(call.Method), path, bytes.NewReader(body))
	if err != nil {
		return err.Error(), http.StatusBadRequest
	}
	if len(body) > 1<<20 {
		return "请求 body 超过限制", http.StatusRequestEntityTooLarge
	}
	req.Header.Set("Content-Type", "application/json")
	identity := &AuthIdentity{User: user, AuthType: "assistant", TokenScope: "admin"}
	requestContext := context.WithValue(req.Context(), userContextKey{}, user)
	requestContext = context.WithValue(requestContext, authIdentityContextKey{}, identity)
	req = req.WithContext(requestContext)
	recorder := httptest.NewRecorder()
	a.withCommonMiddleware(a.rawRouter()).ServeHTTP(recorder, req)
	result := redactAssistantResult(recorder.Body.String())
	result = truncateAssistantResult(result, capability.ResultLimit)
	a.audit(user, "assistant.api_call", capability.Name, call.Method+" "+call.Path, recorder.Code < 400, "")
	a.recordAssistantToolRun(userID, sessionID, capability, call, confirmed, recorder.Code, result, time.Since(startedAt))
	return result, recorder.Code
}

func (a *App) recordAssistantToolRun(userID int64, sessionID string, capability catalog.Capability, call assistant.APICall, confirmed bool, statusCode int, result string, duration time.Duration) {
	arguments, _ := json.Marshal(map[string]any{"query": call.Query, "body": call.Body})
	argumentsSummary := truncateAssistantResult(redactAssistantResult(string(arguments)), 4096)
	resultSummary := truncateAssistantResult(result, 4096)
	status := "success"
	if statusCode >= 400 {
		status = "error"
	}
	_, _ = a.DB.Exec(`insert into assistant_tool_runs(id,user_id,session_id,capability,method,path,risk,exposure,confirmed,status,arguments_summary,result_summary,error_code,duration_ms,created_at) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, "tool-"+randomHex(16), userID, sessionID, capability.Name, strings.ToUpper(call.Method), call.Path, capability.Risk, capability.Exposure, confirmed, status, argumentsSummary, resultSummary, func() string {
		if statusCode >= 400 {
			return fmt.Sprintf("http_%d", statusCode)
		}
		return ""
	}(), duration.Milliseconds(), time.Now())
}

func redactAssistantResult(value string) string {
	var decoded any
	if json.Unmarshal([]byte(value), &decoded) == nil {
		redactAssistantJSON(decoded)
		if redacted, err := json.Marshal(decoded); err == nil {
			return string(redacted)
		}
	}
	return redactAssistantText(value)
}

func redactAssistantJSON(value any) {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			if assistantSensitiveKey(key) {
				typed[key] = "[REDACTED]"
				continue
			}
			redactAssistantJSON(child)
		}
	case []any:
		for _, child := range typed {
			redactAssistantJSON(child)
		}
	}
}

func assistantSensitiveKey(key string) bool {
	normalized := strings.ToLower(strings.TrimSpace(key))
	for _, sensitive := range []string{"api_key", "apikey", "password", "token", "secret", "access_key_secret"} {
		if normalized == sensitive || strings.HasSuffix(normalized, "_"+sensitive) {
			return true
		}
	}
	return false
}

func redactAssistantText(value string) string {
	for _, label := range []string{"api_key", "apikey", "password", "token", "secret", "access_key_secret"} {
		lower := strings.ToLower(value)
		searchFrom := 0
		for {
			relative := strings.Index(lower[searchFrom:], label)
			if relative < 0 {
				break
			}
			index := searchFrom + relative + len(label)
			separator := index
			for separator < len(value) && (value[separator] == ' ' || value[separator] == '\t' || value[separator] == '"') {
				separator++
			}
			if separator >= len(value) || (value[separator] != ':' && value[separator] != '=') {
				searchFrom = index
				continue
			}
			start := separator + 1
			for start < len(value) && (value[start] == ' ' || value[start] == '\t' || value[start] == '"' || value[start] == '\'') {
				start++
			}
			end := start
			for end < len(value) && value[end] != ',' && value[end] != '}' && value[end] != '\n' && value[end] != '"' && value[end] != '\'' && value[end] != ' ' && value[end] != '\t' {
				end++
			}
			if end > start {
				value = value[:start] + "[REDACTED]" + value[end:]
				lower = strings.ToLower(value)
				searchFrom = start + len("[REDACTED]")
			} else {
				searchFrom = index
			}
		}
	}
	return value
}

func truncateAssistantResult(value string, limit int) string {
	if limit <= 0 || len(value) <= limit {
		return value
	}
	end := limit
	for end > 0 && !utf8.ValidString(value[:end]) {
		end--
	}
	return value[:end] + "\n[结果已截断]"
}

func (a *App) assistantStop(sessionID string, userID int64) {
	key := assistantCancelKey(userID, sessionID)
	a.assistantMu.Lock()
	if entry, ok := a.assistantCancels[key]; ok && entry.Cancel != nil {
		entry.Cancel()
	}
	a.assistantMu.Unlock()
	_, _ = a.DB.Exec(`update assistant_pending_actions set status='cancelled',decision='stopped',decided_at=?,call_json='[cleared]',call_hash='' where session_id=? and user_id=? and status='pending'`, time.Now(), sessionID, userID)
	_, _ = a.DB.Exec(`delete from assistant_runtime_checkpoints where session_id=? and user_id=?`, sessionID, userID)
	_, _ = a.DB.Exec(`update assistant_sessions set status='stopped',checkpoint_id=null,active_run_id=null,updated_at=? where id=? and user_id=?`, time.Now(), sessionID, userID)
}

func assistantCancelKey(userID int64, sessionID string) string {
	return fmt.Sprintf("%d:%s", userID, sessionID)
}

func (a *App) registerAssistantCancel(key, token string, cancel context.CancelFunc) {
	a.assistantMu.Lock()
	defer a.assistantMu.Unlock()
	if previous, ok := a.assistantCancels[key]; ok && previous.Cancel != nil {
		previous.Cancel()
	}
	a.assistantCancels[key] = assistantCancelEntry{Token: token, Cancel: cancel}
}

func (a *App) clearAssistantCancel(key, token string) {
	a.assistantMu.Lock()
	defer a.assistantMu.Unlock()
	if current, ok := a.assistantCancels[key]; ok && current.Token == token {
		delete(a.assistantCancels, key)
	}
}
