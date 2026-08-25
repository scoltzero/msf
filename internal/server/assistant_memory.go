package server

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/scoltzero/msf/internal/assistant/prompt"
)

const assistantMemoryLimit = 64 << 10
const assistantMemoryVersionMarker = "<!-- MSF ASSISTANT MEMORY VERSION: 3 -->"

var assistantMemorySecretPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)(api[_ -]?key|password|secret|token|access[_ -]?token)\s*[:=]\s*[^\s]{8,}`),
	regexp.MustCompile(`\bsk-[A-Za-z0-9_-]{12,}\b`),
}

func (a *App) assistantMemoryPath() string {
	return filepath.Join(a.DataDir, "configs", "assistant", "MEMORY.md")
}

func (a *App) loadAssistantMemory() (string, error) {
	path := a.assistantMemoryPath()
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		if err := a.createDefaultAssistantMemory(path); err != nil {
			return "", err
		}
		data, err = os.ReadFile(path)
	}
	if err != nil {
		return "", fmt.Errorf("read assistant MEMORY: %w", err)
	}
	if len(data) > assistantMemoryLimit {
		return "", fmt.Errorf("assistant MEMORY exceeds 64 KiB")
	}
	value := string(data)
	if !strings.Contains(value, assistantMemoryVersionMarker) {
		value = migrateAssistantMemoryCurrent(value)
		if err := atomicWriteAssistantFile(path, []byte(value), 0640); err != nil {
			return "", fmt.Errorf("migrate assistant MEMORY: %w", err)
		}
	}
	if !assistantMemoryHasMarkers(value) {
		return "", fmt.Errorf("assistant MEMORY capability markers are missing")
	}
	if assistantTextContainsLikelySecret(value) {
		return "", fmt.Errorf("assistant MEMORY contains a possible secret; remove it before starting a new conversation")
	}
	return value, nil
}

func migrateAssistantMemoryCurrent(value string) string {
	value = strings.ReplaceAll(value, "<!-- MSF ASSISTANT MEMORY VERSION: 2 -->\n", "")
	value = strings.ReplaceAll(value, assistantMemoryVersionMarker+"\n", "")
	replacements := [][2]string{
		{"你是 MSF 的管理员助手。你只能通过系统提供的已登记工具操作本机 MSF：使用 `list_msf_api` 寻路、使用 `call_msf_api` 调用站内 API、使用 `run_msf_host_operation` 执行固定宿主只读检查。", "你是 MSF 的管理员助手。你通过 Eino ADK Runtime 运行，并且只能使用当前会话实际提供的工具：使用 `list_msf_api` 寻路、使用 `call_msf_api` 调用站内 API、使用 `run_msf_host_operation` 执行固定宿主只读检查；需要文件或宿主操作时使用 `read`、`write`、`edit`、`bash`。可复用流程通过 `skill` 工具按需加载。"},
		{"5. 不得执行任意 Shell、任意 URL 或任意文件路径操作。", "5. 文件和 Shell 工具必须服从当前会话的只读、确认或全自动模式；不得绕过后端模式、参数校验或审计。"},
		{"9. 宿主检查只能使用 `run_msf_host_operation` 的固定枚举，不能要求任意命令。", "9. 能由领域 API 完成的操作优先使用 API；只有 API 无法表达时才使用文件或 Shell 工具。"},
		{"7. 写操作必须先交给服务器 Policy 裁决；服务器返回确认要求时必须等待界面确认，不得把自然语言“确认”当成后端授权。", "7. 用户已经明确要求执行操作时，直接发起结构化工具调用，把确认交给服务器 Policy。不得先在普通文本中再次询问“是否确认”；只有后端生成的确认卡片才是授权入口。"},
		{"读取操作可以直接执行。重启、清理、修改、删除、更新、用户、密码、Token、审计和系统设置等操作必须遵守后端 Policy；需要确认时，先向管理员展示具体方法、路径和影响，等待界面确认。", "读取操作可以直接执行。重启、清理、修改、删除、更新、用户、密码、Token、审计和系统设置等操作必须遵守后端 Policy。用户已明确要求执行时必须调用工具，由后端自动展示冻结参数和影响；模型不得用普通文本模拟确认卡片，也不得要求用户在聊天框再次输入“确认”。"},
	}
	for _, replacement := range replacements {
		value = strings.Replace(value, replacement[0], replacement[1], 1)
	}
	modeSection := "\n\n## 会话执行模式\n\n- `read_only`：只允许读取、查询和固定诊断。\n- `confirm_writes`：写文件、编辑、Shell 和有副作用 API 必须等待界面确认。\n- `full_auto`：允许通过后端 Policy 的工具自动执行，但仍受身份复核、参数校验、超时、脱敏和审计约束。\n\n确认或拒绝后，Eino 必须恢复同一轮 Agent 并把工具结果整理成人类可读 Markdown。\n"
	if !strings.Contains(value, "## 会话执行模式") {
		if index := strings.Index(value, "\n## 配置禁区"); index >= 0 {
			value = value[:index] + modeSection + value[index:]
		} else {
			value += modeSection
		}
	}
	return assistantMemoryVersionMarker + "\n" + value
}

func assistantTextContainsLikelySecret(value string) bool {
	for _, pattern := range assistantMemorySecretPatterns {
		if pattern.MatchString(value) {
			return true
		}
	}
	return false
}

func (a *App) createDefaultAssistantMemory(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0750); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".MEMORY.md.*.tmp")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0640); err != nil {
		_ = temporary.Close()
		return err
	}
	if _, err := temporary.WriteString(prompt.DefaultMemory()); err != nil {
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
	if err := os.Link(temporaryPath, path); err != nil {
		if errors.Is(err, os.ErrExist) {
			return nil
		}
		return err
	}
	return nil
}

func assistantMemoryHasMarkers(value string) bool {
	return strings.Contains(value, "<!-- BEGIN MSF AUTO API CAPABILITIES -->") && strings.Contains(value, "<!-- END MSF AUTO API CAPABILITIES -->")
}
