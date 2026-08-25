package einoruntime

import (
	"context"
	"fmt"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
)

const Version = "v0.9.15"

type Config struct {
	Name          string
	Description   string
	Instruction   string
	Model         model.BaseChatModel
	Tools         []tool.BaseTool
	Handlers      []adk.ChatModelAgentMiddleware
	Checkpoints   adk.CheckPointStore
	MaxIterations int
}

type Runtime struct {
	runner *adk.Runner
}

func New(ctx context.Context, config Config) (*Runtime, error) {
	if config.Model == nil {
		return nil, fmt.Errorf("eino runtime model is required")
	}
	if config.Name == "" {
		config.Name = "msf-admin-assistant"
	}
	if config.MaxIterations <= 0 {
		config.MaxIterations = 32
	}
	agent, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
		Name:          config.Name,
		Description:   config.Description,
		Instruction:   config.Instruction,
		Model:         config.Model,
		Handlers:      config.Handlers,
		MaxIterations: config.MaxIterations,
		ToolsConfig: adk.ToolsConfig{ToolsNodeConfig: compose.ToolsNodeConfig{
			Tools:               config.Tools,
			ExecuteSequentially: true,
			UnknownToolsHandler: func(_ context.Context, name, _ string) (string, error) {
				return fmt.Sprintf("模型请求了未登记的工具：%s", name), nil
			},
		}},
	})
	if err != nil {
		return nil, fmt.Errorf("create eino chat model agent: %w", err)
	}
	return &Runtime{runner: adk.NewRunner(ctx, adk.RunnerConfig{
		Agent:           agent,
		EnableStreaming: true,
		CheckPointStore: config.Checkpoints,
	})}, nil
}

func (r *Runtime) Run(ctx context.Context, messages []*schema.Message, checkpointID string) *adk.AsyncIterator[*adk.AgentEvent] {
	return r.runner.Run(ctx, messages, adk.WithCheckPointID(checkpointID))
}

func (r *Runtime) Resume(ctx context.Context, checkpointID, interruptID string, data any) (*adk.AsyncIterator[*adk.AgentEvent], error) {
	return r.runner.ResumeWithParams(ctx, checkpointID, &adk.ResumeParams{Targets: map[string]any{interruptID: data}})
}
