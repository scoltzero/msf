package server

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unicode/utf8"

	"github.com/cloudwego/eino/components/tool"
	toolutils "github.com/cloudwego/eino/components/tool/utils"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
	"github.com/scoltzero/msf/internal/assistant"
	"github.com/scoltzero/msf/internal/assistant/catalog"
	"github.com/scoltzero/msf/internal/assistant/policy"
)

const (
	assistantHostReadLimit  = 128 << 10
	assistantHostWriteLimit = 1 << 20
	assistantBashLimit      = 128 << 10
)

type assistantRuntimeEmitter func(event string, payload any)

type assistantApprovalInfo struct {
	Title         string
	Method        string
	Path          string
	Risk          string
	Details       string
	Capability    string
	ToolName      string
	ToolCallID    string
	ArgumentsJSON string
}

type assistantApprovalState struct {
	Capability      string
	ToolName        string
	ArgumentsJSON   string
	ResourceVersion string
}

type assistantApprovalDecision struct {
	Approved bool
	Reason   string
}

func init() {
	schema.RegisterName[*assistantApprovalInfo]("msf_assistant_approval_info")
	schema.RegisterName[assistantApprovalState]("msf_assistant_approval_state")
	schema.RegisterName[*assistantApprovalDecision]("msf_assistant_approval_decision")
}

type assistantEinoToolSet struct {
	app       *App
	userID    int64
	sessionID string
	mode      assistant.ExecutionMode
	catalog   catalog.Catalog
	emit      assistantRuntimeEmitter
}

func (s *assistantEinoToolSet) tools(ctx context.Context) ([]tool.BaseTool, error) {
	listTool, err := toolutils.InferTool("list_msf_api", "按关键词查询当前 MSF 已注册的 API 路径。调用管理 API 前先用它寻路。", s.listMSFAPI)
	if err != nil {
		return nil, err
	}
	apiTool, err := toolutils.InferTool("call_msf_api", "调用已登记的 MSF 站内 /api/v1 管理 API。只能使用站内路径，不能使用完整 URL。", s.callMSFAPI)
	if err != nil {
		return nil, err
	}
	hostTool, err := toolutils.InferTool("run_msf_host_operation", "执行固定的 MSF 宿主只读检查。", s.runHostOperation)
	if err != nil {
		return nil, err
	}
	readTool, err := toolutils.InferTool("read", "读取本机文件。适合查看配置、日志和文本证据；二进制文件不会原样返回。", s.readFile)
	if err != nil {
		return nil, err
	}
	writeTool, err := toolutils.InferTool("write", "原子写入本机文件。确认模式下必须经管理员确认。", s.writeFile)
	if err != nil {
		return nil, err
	}
	editTool, err := toolutils.InferTool("edit", "精确替换本机文本文件中的内容。确认模式下展示并冻结替换参数。", s.editFile)
	if err != nil {
		return nil, err
	}
	bashTool, err := toolutils.InferTool("bash", "以 MSF 服务进程权限执行 shell 命令。确认模式下必须经管理员确认。", s.runBash)
	if err != nil {
		return nil, err
	}
	tools := []tool.BaseTool{listTool, apiTool, hostTool, readTool}
	if s.mode != assistant.ExecutionReadOnly {
		tools = append(tools, writeTool, editTool, bashTool)
	}
	return tools, nil
}

type assistantListAPIInput struct {
	Query string `json:"query" jsonschema:"description=服务名、功能名或 API 路径关键词"`
}

func (s *assistantEinoToolSet) listMSFAPI(_ context.Context, input assistantListAPIInput) (string, error) {
	s.emitToolStarted("list_msf_api", "GET", "/api/v1")
	routes, err := catalog.RegisteredRoutes()
	if err != nil {
		s.emitToolFinished("list_msf_api", false, 500, err.Error())
		return "", err
	}
	query := strings.ToLower(strings.TrimSpace(input.Query))
	matches := make([]string, 0, 32)
	for _, route := range routes {
		if query == "" || strings.Contains(strings.ToLower(route), query) {
			matches = append(matches, route)
		}
		if len(matches) >= 80 {
			break
		}
	}
	result := marshalAssistantValue(map[string]any{"query": input.Query, "routes": matches, "count": len(matches)})
	s.emitToolFinished("list_msf_api", true, 200, "")
	return result, nil
}

func (s *assistantEinoToolSet) callMSFAPI(ctx context.Context, call assistant.APICall) (string, error) {
	wasInterrupted, hasState, state := tool.GetInterruptState[assistantApprovalState](ctx)
	if wasInterrupted {
		if !hasState || state.ToolName != "call_msf_api" {
			return "", fmt.Errorf("MSF API 工具的恢复状态无效")
		}
		return s.resumeMSFAPICall(ctx, state)
	}

	capability, matched, err := s.catalog.Match(call)
	if !matched && err == nil {
		capability, matched = s.app.discoverAssistantCapability(call)
	}
	if err != nil || !matched {
		return "API 不在助手能力目录中", nil
	}
	decision := policy.Decide(capability, s.mode, false)
	if !decision.Allowed && !decision.ConfirmationNeeded {
		return "当前会话模式不允许调用该 API", nil
	}
	argumentsJSON, err := json.Marshal(call)
	if err != nil {
		return "", err
	}
	if decision.ConfirmationNeeded {
		state := assistantApprovalState{Capability: capability.Name, ToolName: "call_msf_api", ArgumentsJSON: string(argumentsJSON)}
		info := &assistantApprovalInfo{
			Title:         capability.Description,
			Method:        call.Method,
			Path:          call.Path,
			Risk:          string(capability.Risk),
			Details:       assistantCallSummary(call),
			Capability:    capability.Name,
			ToolName:      "call_msf_api",
			ToolCallID:    compose.GetToolCallID(ctx),
			ArgumentsJSON: string(argumentsJSON),
		}
		return "", tool.StatefulInterrupt(ctx, info, state)
	}
	return s.executeMSFAPICall(ctx, capability, call, false)
}

func (s *assistantEinoToolSet) resumeMSFAPICall(ctx context.Context, state assistantApprovalState) (string, error) {
	isTarget, hasData, decision := tool.GetResumeContext[*assistantApprovalDecision](ctx)
	if !isTarget {
		return "", tool.StatefulInterrupt(ctx, &assistantApprovalInfo{Title: "等待确认 MSF API 操作", ToolName: state.ToolName, Capability: state.Capability, ArgumentsJSON: state.ArgumentsJSON, ToolCallID: compose.GetToolCallID(ctx)}, state)
	}
	if !hasData || decision == nil {
		return "", fmt.Errorf("MSF API 工具恢复时缺少确认结果")
	}
	if !decision.Approved {
		reason := strings.TrimSpace(decision.Reason)
		if reason == "" {
			reason = "管理员取消了操作"
		}
		s.emitToolFinished(state.ToolName, false, 409, reason)
		return marshalAssistantValue(map[string]any{"success": false, "cancelled": true, "message": reason}), nil
	}
	var call assistant.APICall
	if err := json.Unmarshal([]byte(state.ArgumentsJSON), &call); err != nil {
		return "", fmt.Errorf("恢复的 MSF API 参数无效: %w", err)
	}
	capability, matched, err := s.catalog.Match(call)
	if !matched && err == nil {
		capability, matched = s.app.discoverAssistantCapability(call)
	}
	if err != nil || !matched || capability.Name != state.Capability {
		return "", fmt.Errorf("确认期间 MSF API 能力目录已经变化")
	}
	if decision := policy.Decide(capability, s.mode, true); !decision.Allowed {
		return "", fmt.Errorf("当前会话模式已不允许执行该操作")
	}
	return s.executeMSFAPICall(ctx, capability, call, true)
}

func (s *assistantEinoToolSet) executeMSFAPICall(ctx context.Context, capability catalog.Capability, call assistant.APICall, confirmed bool) (string, error) {
	s.emitToolStarted(capability.Name, call.Method, call.Path)
	result, status := s.app.executeAssistantAPICall(ctx, s.userID, s.sessionID, capability, call, confirmed)
	s.emitToolFinished(capability.Name, status < 400, status, "")
	return result, nil
}

type assistantHostOperationInput struct {
	Operation string `json:"operation" jsonschema:"required,enum=managed_services,enum=disk_usage,description=固定宿主只读检查"`
}

func (s *assistantEinoToolSet) runHostOperation(_ context.Context, input assistantHostOperationInput) (result string, err error) {
	started := time.Now()
	s.emitToolStarted("run_msf_host_operation", "HOST", input.Operation)
	defer func() {
		s.recordHostTool("run_msf_host_operation", input.Operation, marshalAssistantValue(input), result, err, false, time.Since(started))
	}()
	result = s.app.executeAssistantHostRead(input.Operation)
	s.emitToolFinished("run_msf_host_operation", !strings.Contains(result, `"success":false`), 200, "")
	return result, nil
}

type assistantReadInput struct {
	Path   string `json:"path" jsonschema:"required,description=要读取的绝对文件路径"`
	Offset int64  `json:"offset,omitempty" jsonschema:"description=起始字节偏移"`
	Limit  int    `json:"limit,omitempty" jsonschema:"description=最多读取字节数"`
}

func (s *assistantEinoToolSet) readFile(_ context.Context, input assistantReadInput) (result string, err error) {
	started := time.Now()
	path, err := normalizeAssistantHostPath(input.Path)
	if err != nil {
		return "", err
	}
	s.emitToolStarted("read", "READ", path)
	defer func() {
		s.emitToolFinished("read", err == nil, statusForAssistantToolError(err), errorText(err))
		s.recordHostTool("read", path, marshalAssistantValue(input), result, err, false, time.Since(started))
	}()
	limit := input.Limit
	if limit <= 0 || limit > assistantHostReadLimit {
		limit = assistantHostReadLimit
	}
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	if input.Offset < 0 {
		return "", fmt.Errorf("offset 不能为负数")
	}
	if input.Offset > 0 {
		if _, err := file.Seek(input.Offset, io.SeekStart); err != nil {
			return "", err
		}
	}
	data, err := io.ReadAll(io.LimitReader(file, int64(limit)+1))
	if err != nil {
		return "", err
	}
	truncated := len(data) > limit
	if truncated {
		data = data[:limit]
	}
	if !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
		return marshalAssistantValue(map[string]any{"path": path, "binary": true, "bytes_read": len(data), "message": "二进制文件未原样返回"}), nil
	}
	return marshalAssistantValue(map[string]any{"path": path, "offset": input.Offset, "content": string(data), "truncated": truncated}), nil
}

type assistantWriteInput struct {
	Path    string `json:"path" jsonschema:"required,description=要写入的绝对文件路径"`
	Content string `json:"content" jsonschema:"required,description=完整文件内容"`
	Mode    uint32 `json:"mode,omitempty" jsonschema:"description=可选 Unix 文件权限，例如 420 表示 0644"`
}

func (s *assistantEinoToolSet) writeFile(ctx context.Context, input assistantWriteInput) (string, error) {
	resourceVersion, versionErr := assistantFileResourceVersion(input.Path)
	if versionErr != nil {
		return "", versionErr
	}
	return s.runHostWriteTool(ctx, "write", "写入文件", input.Path, input, resourceVersion, func() (string, error) {
		path, err := normalizeAssistantWritePath(input.Path)
		if err != nil {
			return "", err
		}
		if len(input.Content) > assistantHostWriteLimit {
			return "", fmt.Errorf("写入内容超过 %d 字节", assistantHostWriteLimit)
		}
		mode := os.FileMode(input.Mode)
		if mode == 0 {
			mode = 0644
			if info, statErr := os.Stat(path); statErr == nil {
				mode = info.Mode().Perm()
			}
		}
		if mode&^0777 != 0 {
			return "", fmt.Errorf("文件权限不合法")
		}
		if err := atomicWriteAssistantFile(path, []byte(input.Content), mode); err != nil {
			return "", err
		}
		digest := sha256.Sum256([]byte(input.Content))
		return marshalAssistantValue(map[string]any{"success": true, "path": path, "bytes": len(input.Content), "sha256": hex.EncodeToString(digest[:])}), nil
	})
}

type assistantEditInput struct {
	Path       string `json:"path" jsonschema:"required,description=要编辑的绝对文本文件路径"`
	OldText    string `json:"old_text" jsonschema:"required,description=必须精确匹配的旧文本"`
	NewText    string `json:"new_text" jsonschema:"description=替换后的新文本"`
	ReplaceAll bool   `json:"replace_all,omitempty" jsonschema:"description=是否替换全部匹配项"`
}

func (s *assistantEinoToolSet) editFile(ctx context.Context, input assistantEditInput) (string, error) {
	resourceVersion, versionErr := assistantFileResourceVersion(input.Path)
	if versionErr != nil {
		return "", versionErr
	}
	return s.runHostWriteTool(ctx, "edit", "编辑文件", input.Path, input, resourceVersion, func() (string, error) {
		path, err := normalizeAssistantWritePath(input.Path)
		if err != nil {
			return "", err
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return "", err
		}
		if len(data) > assistantHostWriteLimit || !utf8.Valid(data) {
			return "", fmt.Errorf("只允许编辑不超过 %d 字节的 UTF-8 文本文件", assistantHostWriteLimit)
		}
		count := strings.Count(string(data), input.OldText)
		if count == 0 {
			return "", fmt.Errorf("old_text 在目标文件中不存在")
		}
		if !input.ReplaceAll && count != 1 {
			return "", fmt.Errorf("old_text 匹配了 %d 次；请提供更精确文本或启用 replace_all", count)
		}
		replacements := 1
		if input.ReplaceAll {
			replacements = -1
		}
		updated := strings.Replace(string(data), input.OldText, input.NewText, replacements)
		info, err := os.Stat(path)
		if err != nil {
			return "", err
		}
		if err := atomicWriteAssistantFile(path, []byte(updated), info.Mode().Perm()); err != nil {
			return "", err
		}
		return marshalAssistantValue(map[string]any{"success": true, "path": path, "replacements": count}), nil
	})
}

type assistantBashInput struct {
	Command        string `json:"command" jsonschema:"required,description=要执行的 shell 命令"`
	Cwd            string `json:"cwd,omitempty" jsonschema:"description=工作目录绝对路径"`
	TimeoutSeconds int    `json:"timeout_seconds,omitempty" jsonschema:"description=超时秒数，范围 1 到 300"`
}

func (s *assistantEinoToolSet) runBash(ctx context.Context, input assistantBashInput) (string, error) {
	return s.runHostWriteTool(ctx, "bash", "执行 Shell 命令", input.Cwd, input, "", func() (string, error) {
		command := strings.TrimSpace(input.Command)
		if command == "" || len(command) > 32<<10 {
			return "", fmt.Errorf("shell 命令为空或过长")
		}
		cwd := strings.TrimSpace(input.Cwd)
		if cwd == "" {
			cwd = s.app.DataDir
		}
		var err error
		cwd, err = normalizeAssistantHostPath(cwd)
		if err != nil {
			return "", err
		}
		timeout := input.TimeoutSeconds
		if timeout <= 0 {
			timeout = 60
		}
		if timeout > 300 {
			timeout = 300
		}
		commandCtx, cancel := context.WithTimeout(ctx, time.Duration(timeout)*time.Second)
		defer cancel()
		cmd := exec.CommandContext(commandCtx, "/bin/sh", "-lc", command)
		cmd.Dir = cwd
		cmd.Env = []string{"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "LANG=C.UTF-8", "LC_ALL=C.UTF-8"}
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
		cmd.Cancel = func() error {
			if cmd.Process == nil {
				return nil
			}
			return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		}
		var stdout, stderr limitedAssistantBuffer
		stdout.limit = assistantBashLimit
		stderr.limit = assistantBashLimit
		cmd.Stdout = &stdout
		cmd.Stderr = &stderr
		started := time.Now()
		err = cmd.Run()
		exitCode := 0
		if err != nil {
			exitCode = -1
			if exitErr, ok := err.(*exec.ExitError); ok {
				exitCode = exitErr.ExitCode()
			} else if commandCtx.Err() == context.DeadlineExceeded {
				exitCode = 124
			}
		}
		return marshalAssistantValue(map[string]any{
			"success": err == nil, "exit_code": exitCode, "stdout": stdout.String(), "stderr": stderr.String(),
			"truncated": stdout.truncated || stderr.truncated, "duration_ms": time.Since(started).Milliseconds(),
		}), nil
	})
}

func (s *assistantEinoToolSet) runHostWriteTool(ctx context.Context, toolName, title, target string, input any, resourceVersion string, execute func() (string, error)) (string, error) {
	wasInterrupted, hasState, state := tool.GetInterruptState[assistantApprovalState](ctx)
	if wasInterrupted {
		if !hasState || state.ToolName != toolName {
			return "", fmt.Errorf("%s 工具的恢复状态无效", toolName)
		}
		isTarget, hasData, decision := tool.GetResumeContext[*assistantApprovalDecision](ctx)
		if !isTarget {
			return "", tool.StatefulInterrupt(ctx, &assistantApprovalInfo{Title: title, Method: strings.ToUpper(toolName), Path: target, Risk: string(assistant.RiskSensitive), ToolName: toolName, Capability: toolName, ToolCallID: compose.GetToolCallID(ctx), ArgumentsJSON: state.ArgumentsJSON}, state)
		}
		if !hasData || decision == nil {
			return "", fmt.Errorf("%s 工具恢复时缺少确认结果", toolName)
		}
		if !decision.Approved {
			reason := strings.TrimSpace(decision.Reason)
			if reason == "" {
				reason = "管理员取消了操作"
			}
			s.emitToolFinished(toolName, false, 409, reason)
			s.recordHostTool(toolName, target, state.ArgumentsJSON, "", fmt.Errorf("%s", reason), true, 0)
			return marshalAssistantValue(map[string]any{"success": false, "cancelled": true, "message": reason}), nil
		}
		if s.mode == assistant.ExecutionReadOnly {
			return "", fmt.Errorf("当前会话已经切换为只读模式")
		}
		if state.ResourceVersion != "" && state.ResourceVersion != resourceVersion {
			return "", fmt.Errorf("%s 的目标在确认期间发生变化，请重新发起操作", toolName)
		}
		var restored json.RawMessage = []byte(state.ArgumentsJSON)
		if len(restored) == 0 || !json.Valid(restored) {
			return "", fmt.Errorf("恢复的 %s 参数无效", toolName)
		}
		currentArguments, marshalErr := json.Marshal(input)
		if marshalErr != nil || !jsonEqualAssistantArguments(currentArguments, restored) {
			return "", fmt.Errorf("%s 的恢复参数与冻结参数不一致", toolName)
		}
		// execute closes over the typed input that Eino replays on resume. The
		// frozen JSON hash was independently verified by the resume endpoint.
		s.emitToolStarted(toolName, strings.ToUpper(toolName), target)
		started := time.Now()
		result, err := execute()
		s.emitToolFinished(toolName, err == nil, statusForAssistantToolError(err), errorText(err))
		s.recordHostTool(toolName, target, state.ArgumentsJSON, result, err, true, time.Since(started))
		return result, err
	}

	if s.mode == assistant.ExecutionReadOnly {
		return marshalAssistantValue(map[string]any{"success": false, "message": "只读模式禁止执行 " + toolName}), nil
	}
	arguments, err := json.Marshal(input)
	if err != nil {
		return "", err
	}
	if s.mode == assistant.ExecutionConfirmWrites {
		state := assistantApprovalState{Capability: toolName, ToolName: toolName, ArgumentsJSON: string(arguments), ResourceVersion: resourceVersion}
		return "", tool.StatefulInterrupt(ctx, &assistantApprovalInfo{
			Title: title, Method: strings.ToUpper(toolName), Path: target, Risk: string(assistant.RiskSensitive),
			Details: truncateAssistantResult(string(arguments), 4096), Capability: toolName, ToolName: toolName,
			ToolCallID: compose.GetToolCallID(ctx), ArgumentsJSON: string(arguments),
		}, state)
	}
	s.emitToolStarted(toolName, strings.ToUpper(toolName), target)
	started := time.Now()
	result, err := execute()
	s.emitToolFinished(toolName, err == nil, statusForAssistantToolError(err), errorText(err))
	s.recordHostTool(toolName, target, string(arguments), result, err, false, time.Since(started))
	return result, err
}

func (s *assistantEinoToolSet) emitToolStarted(name, method, path string) {
	if s.emit != nil {
		s.emit("tool_started", map[string]any{"name": name, "method": method, "path": path})
	}
}

func (s *assistantEinoToolSet) emitToolFinished(name string, success bool, status int, message string) {
	if s.emit != nil {
		s.emit("tool_finished", map[string]any{"name": name, "status": success, "status_code": status, "message": message})
	}
}

func normalizeAssistantHostPath(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || strings.IndexByte(value, 0) >= 0 || !filepath.IsAbs(value) {
		return "", fmt.Errorf("必须提供有效的绝对路径")
	}
	return filepath.Clean(value), nil
}

func normalizeAssistantWritePath(value string) (string, error) {
	path, err := normalizeAssistantHostPath(value)
	if err != nil {
		return "", err
	}
	if resolved, resolveErr := filepath.EvalSymlinks(path); resolveErr == nil {
		return resolved, nil
	} else if !os.IsNotExist(resolveErr) {
		return "", resolveErr
	}
	parent := filepath.Dir(path)
	suffix := []string{filepath.Base(path)}
	for {
		resolved, resolveErr := filepath.EvalSymlinks(parent)
		if resolveErr == nil {
			parts := append([]string{resolved}, suffix...)
			return filepath.Join(parts...), nil
		}
		if !os.IsNotExist(resolveErr) {
			return "", resolveErr
		}
		next := filepath.Dir(parent)
		if next == parent {
			return "", resolveErr
		}
		suffix = append([]string{filepath.Base(parent)}, suffix...)
		parent = next
	}
}

func assistantFileResourceVersion(value string) (string, error) {
	path, err := normalizeAssistantWritePath(value)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return "missing", nil
	}
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:]), nil
}

func atomicWriteAssistantFile(path string, data []byte, mode os.FileMode) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(dir, ".msf-assistant-*.tmp")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(mode); err != nil {
		_ = temporary.Close()
		return err
	}
	if info, err := os.Stat(path); err == nil {
		if stat, ok := info.Sys().(*syscall.Stat_t); ok {
			if err := temporary.Chown(int(stat.Uid), int(stat.Gid)); err != nil {
				_ = temporary.Close()
				return err
			}
		}
	}
	if _, err := temporary.Write(data); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
}

type limitedAssistantBuffer struct {
	buffer    bytes.Buffer
	limit     int
	truncated bool
}

func (b *limitedAssistantBuffer) Write(data []byte) (int, error) {
	original := len(data)
	remaining := b.limit - b.buffer.Len()
	if remaining <= 0 {
		b.truncated = true
		return original, nil
	}
	if len(data) > remaining {
		data = data[:remaining]
		b.truncated = true
	}
	_, _ = b.buffer.Write(data)
	return original, nil
}

func (b *limitedAssistantBuffer) String() string { return b.buffer.String() }

func statusForAssistantToolError(err error) int {
	if err != nil {
		return 500
	}
	return 200
}

func errorText(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func (s *assistantEinoToolSet) recordHostTool(name, target, arguments, result string, runErr error, confirmed bool, duration time.Duration) {
	risk := assistant.RiskSensitive
	exposure := assistant.ExposureConfirm
	if name == "read" || name == "run_msf_host_operation" {
		risk = assistant.RiskRead
		exposure = assistant.ExposureAuto
	}
	status := "success"
	errorCode := ""
	logicalFailure := runErr != nil || strings.Contains(result, `"success":false`)
	if logicalFailure {
		status = "error"
		errorCode = "host_tool_failed"
	}
	argumentDigest := sha256.Sum256([]byte(arguments))
	arguments = fmt.Sprintf("target=%s argument_bytes=%d sha256=%s", target, len(arguments), hex.EncodeToString(argumentDigest[:]))
	resultSummary := fmt.Sprintf("bytes=%d logical_success=%t", len(result), !logicalFailure)
	_, _ = s.app.DB.Exec(`insert into assistant_tool_runs(id,user_id,session_id,capability,method,path,risk,exposure,confirmed,status,arguments_summary,result_summary,error_code,duration_ms,created_at) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, "tool-"+randomHex(12), s.userID, s.sessionID, name, "HOST", target, risk, exposure, confirmed, status, arguments, resultSummary, errorCode, duration.Milliseconds(), time.Now())
	if user, err := s.app.userByID(s.userID); err == nil {
		detail := fmt.Sprintf("tool=%s target=%s confirmed=%t", name, target, confirmed)
		auditError := errorText(runErr)
		if auditError == "" && logicalFailure {
			auditError = "tool reported failure"
		}
		s.app.audit(user, "assistant.host."+name, target, detail, !logicalFailure, auditError)
	}
}

func jsonEqualAssistantArguments(left, right []byte) bool {
	var leftValue, rightValue any
	if json.Unmarshal(left, &leftValue) != nil || json.Unmarshal(right, &rightValue) != nil {
		return false
	}
	leftCanonical, leftErr := json.Marshal(leftValue)
	rightCanonical, rightErr := json.Marshal(rightValue)
	return leftErr == nil && rightErr == nil && bytes.Equal(leftCanonical, rightCanonical)
}
