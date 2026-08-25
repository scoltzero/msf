package server

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	openai "github.com/cloudwego/eino-ext/components/model/openai"
	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/adk/middlewares/skill"
	einomodel "github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/schema"
	"github.com/scoltzero/msf/internal/assistant"
	"github.com/scoltzero/msf/internal/assistant/catalog"
	"github.com/scoltzero/msf/internal/assistant/prompt"
	einoruntime "github.com/scoltzero/msf/internal/assistant/runtime/eino"
)

type assistantEinoSkillBackend struct {
	app    *App
	userID int64
}

type assistantMessage struct {
	Role    string `json:"role"`
	Content string `json:"content,omitempty"`
}

func (b *assistantEinoSkillBackend) List(_ context.Context) ([]skill.FrontMatter, error) {
	items, err := b.app.listAssistantSkills(b.userID, 50)
	if err != nil {
		return nil, err
	}
	result := make([]skill.FrontMatter, 0, len(items))
	for _, item := range items {
		result = append(result, skill.FrontMatter{Name: item.ID, Description: item.Name + " — " + item.Description})
	}
	return result, nil
}

func (b *assistantEinoSkillBackend) Get(_ context.Context, name string) (skill.Skill, error) {
	var item assistantSkill
	var filePath string
	err := b.app.DB.QueryRow(`select id,name,description,prompt,source,file_path,created_at,updated_at from assistant_skills where id=? and user_id=? and deleted_at is null`, name, b.userID).Scan(&item.ID, &item.Name, &item.Description, &item.Prompt, &item.Source, &filePath, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return skill.Skill{}, fmt.Errorf("Skill 不存在")
		}
		return skill.Skill{}, err
	}
	return skill.Skill{
		FrontMatter:   skill.FrontMatter{Name: item.ID, Description: item.Name + " — " + item.Description},
		Content:       item.Prompt,
		BaseDirectory: filepath.Dir(filePath),
	}, nil
}

func (a *App) newAssistantEinoRuntime(ctx context.Context, userID int64, sessionID string, mode assistant.ExecutionMode, settings assistantSettings, emit assistantRuntimeEmitter) (*einoruntime.Runtime, error) {
	if err := a.ensureEinoAssistantSkillFiles(userID); err != nil {
		return nil, fmt.Errorf("准备 Eino Skills 失败: %w", err)
	}
	catalogSnapshot, err := catalog.Default()
	if err != nil {
		return nil, err
	}
	baseMemory, err := a.loadAssistantMemory()
	if err != nil {
		return nil, err
	}
	instruction, err := prompt.RenderMemory(baseMemory, catalogSnapshot)
	if err != nil {
		return nil, err
	}
	instruction += "\n\n" + assistantResponseFormatGuard
	instruction += fmt.Sprintf("\n\n## 当前会话执行模式\n当前模式：`%s`。所有工具仍由 MSF Go Policy 裁决。", mode)
	instruction += "\n\n## 工具确认边界\n如果用户已经明确要求执行某项操作，立即调用对应工具。不要先用普通文本询问是否确认；需要确认时，工具会由 Eino StatefulInterrupt 暂停并由后端生成确认卡片。"

	model, err := newAssistantEinoModel(ctx, settings)
	if err != nil {
		return nil, err
	}

	toolSet := &assistantEinoToolSet{app: a, userID: userID, sessionID: sessionID, mode: mode, catalog: catalogSnapshot, emit: emit}
	tools, err := toolSet.tools(ctx)
	if err != nil {
		return nil, fmt.Errorf("创建 Eino 工具失败: %w", err)
	}
	skillHandler, err := skill.NewMiddleware(ctx, &skill.Config{
		Backend:    &assistantEinoSkillBackend{app: a, userID: userID},
		UseChinese: true,
	})
	if err != nil {
		return nil, fmt.Errorf("创建 Eino Skill Middleware 失败: %w", err)
	}

	return einoruntime.New(ctx, einoruntime.Config{
		Name:          "msf-admin-assistant",
		Description:   "MSF 管理员助手",
		Instruction:   instruction,
		Model:         model,
		Tools:         tools,
		Handlers:      []adk.ChatModelAgentMiddleware{skillHandler},
		Checkpoints:   a.assistantCheckpointStore(userID, sessionID),
		MaxIterations: assistantEinoMaxIterations(settings.MaxToolRounds),
	})
}

func assistantEinoMaxIterations(toolRounds int) int {
	if toolRounds <= 0 {
		toolRounds = 8
	}
	iterations := toolRounds * 4
	if iterations < 32 {
		return 32
	}
	if iterations > 64 {
		return 64
	}
	return iterations
}

func normalizeAssistantEinoError(err error) error {
	if err == nil {
		return nil
	}
	if strings.Contains(strings.ToLower(err.Error()), "exceeds max iterations") {
		return fmt.Errorf("本次任务出现了异常的长循环，Eino 故障熔断器已安全停止。请缩小检查范围或检查模型是否在重复调用同一工具")
	}
	return err
}

func newAssistantEinoModel(ctx context.Context, settings assistantSettings) (einomodel.BaseChatModel, error) {
	baseURL := assistantEinoProviderBaseURL(settings.BaseURL)
	if baseURL == "" {
		return nil, fmt.Errorf("AI Provider Base URL 未配置")
	}
	if settings.APIKey == "" || settings.Model == "" {
		return nil, fmt.Errorf("AI Provider API Key 或模型名称未配置")
	}
	temperature := float32(settings.Temperature)
	model, err := openai.NewChatModel(ctx, &openai.ChatModelConfig{
		APIKey:      settings.APIKey,
		BaseURL:     baseURL,
		Model:       settings.Model,
		Timeout:     time.Duration(settings.RequestTimeout) * time.Second,
		Temperature: &temperature,
		HTTPClient:  &http.Client{Timeout: time.Duration(settings.RequestTimeout) * time.Second},
	})
	if err != nil {
		return nil, fmt.Errorf("创建 Eino Provider 模型失败: %w", err)
	}
	return model, nil
}

func assistantEinoProviderBaseURL(value string) string {
	value = strings.TrimRight(strings.TrimSpace(value), "/")
	value = strings.TrimSuffix(value, "/chat/completions")
	return strings.TrimRight(value, "/")
}

func assistantMessagesToEino(messages []assistantMessage) []*schema.Message {
	result := make([]*schema.Message, 0, len(messages))
	for _, message := range messages {
		switch message.Role {
		case "user":
			result = append(result, schema.UserMessage(message.Content))
		case "assistant":
			result = append(result, schema.AssistantMessage(message.Content, nil))
		}
	}
	return result
}

type assistantEinoRunResult struct {
	Content     string
	Interrupted bool
	Approval    *assistantApprovalInfo
	InterruptID string
}

func (a *App) consumeAssistantEinoEvents(ctx context.Context, iterator *adk.AsyncIterator[*adk.AgentEvent], send assistantRuntimeEmitter) (assistantEinoRunResult, error) {
	var result assistantEinoRunResult
	var content strings.Builder
	for {
		event, ok := iterator.Next()
		if !ok {
			break
		}
		if event == nil {
			continue
		}
		if event.Err != nil {
			if ctx.Err() != nil {
				return result, ctx.Err()
			}
			return result, normalizeAssistantEinoError(event.Err)
		}
		if event.Action != nil && event.Action.Interrupted != nil {
			for _, interrupt := range event.Action.Interrupted.InterruptContexts {
				if interrupt == nil || !interrupt.IsRootCause {
					continue
				}
				info, ok := interrupt.Info.(*assistantApprovalInfo)
				if !ok || info == nil {
					return result, fmt.Errorf("Eino 返回了无法识别的中断信息")
				}
				result.Interrupted = true
				result.Approval = info
				result.InterruptID = interrupt.ID
				break
			}
			if !result.Interrupted {
				return result, fmt.Errorf("Eino 中断缺少根原因")
			}
			break
		}
		if event.Output == nil || event.Output.MessageOutput == nil {
			continue
		}
		variant := event.Output.MessageOutput
		if variant.Role != schema.Assistant {
			if variant.IsStreaming && variant.MessageStream != nil {
				for {
					_, err := variant.MessageStream.Recv()
					if err != nil {
						if err == io.EOF {
							break
						}
						return result, err
					}
				}
			}
			continue
		}
		if variant.IsStreaming && variant.MessageStream != nil {
			for {
				message, err := variant.MessageStream.Recv()
				if err != nil {
					if err == io.EOF {
						break
					}
					return result, err
				}
				if message == nil || message.Content == "" {
					continue
				}
				content.WriteString(message.Content)
				if send != nil {
					send("delta", map[string]any{"content": message.Content})
				}
			}
		} else if variant.Message != nil && variant.Message.Content != "" {
			content.WriteString(variant.Message.Content)
			if send != nil {
				send("delta", map[string]any{"content": variant.Message.Content})
			}
		}
	}
	result.Content = content.String()
	return result, nil
}
