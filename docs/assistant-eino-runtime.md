# MSF 管理员助手 Eino Runtime

状态：已实施并通过 VM136 验证
固定版本：CloudWeGo Eino v0.9.15
更新时间：2026-08-25

## 目标

Eino ADK 负责 Provider 模型、流式 Agent Loop、工具调用关联、Skill
Middleware、Checkpoint 与 interrupt/resume。MSF Go 服务继续作为唯一的
安全控制面，负责管理员鉴权、API Catalog、Policy、参数冻结、确认、内部
API 调度、root 工具、审计与脱敏。

## 运行链路

```text
React AssistantPanel
  -> POST /api/v1/assistant/chat/stream
  -> Eino ChatModelAgent
  -> MSF Tool Gateway
  -> Eino StatefulInterrupt
  -> SQLite CheckPointStore
  -> POST /api/v1/assistant/actions/{id}/resume/stream
  -> Eino ResumeWithParams
  -> tool result -> model -> Markdown
```

确认和拒绝都会恢复原始 Agent turn。Go 不再把 API JSON 拼成 assistant
消息。Checkpoint 持久化在 MSF SQLite 中，并按 user/session 进行所有权
隔离；完成、停止、删除、过期或错误后清理。

## 会话模式

- `read_only`：只读 API、文件读取和固定诊断。
- `confirm_writes`：写 API、write、edit、bash 通过 Checkpoint 等待确认。
- `full_auto`：通过 Policy 后自动执行，仍保留身份复核、校验、超时、审计和脱敏。

模式在助手输入框中按会话选择。系统设置只保存 Provider、模型、超时和
入口外观。

## Skills

MSF 保留用户 Skill 数据库、文件目录、最近五个卡槽、创建和可恢复删除。
Eino Skill Middleware 使用 MSF Backend 按需加载 `SKILL.md`，不再把全部
Skill 正文注入系统提示。Skill 文件使用 YAML frontmatter，数据库 ID 是
稳定的 Runtime 名称。

## MCP

MCP 不与首轮 Runtime 迁移同时启用。未来通过
`eino-ext/components/tool/mcp/officialmcp` 注册为额外 ToolSource；每个 MCP
工具仍需经过 MSF 风险分类、会话模式、结果限制、脱敏和审计。

## 验收门禁

```bash
go vet ./...
go test ./...
go test -race ./internal/server ./internal/assistant/... -count=1
cd web && npm test && npx tsc --noEmit && npm run build
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build ./...
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build ./...
CGO_ENABLED=0 GOOS=linux GOARCH=riscv64 go build ./...
```

VM136 必须验证系统诊断 Skill 在确认后输出人类可读 Markdown，并验证
确认期间重启 MSF 后仍能继续恢复。
