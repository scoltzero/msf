# MSF 管理员 AI 助手完整实施计划

状态：首版自研 Runtime 已实施；Agent Loop 已由 Eino ADK 迁移方案取代，见 `assistant-eino-runtime.md`
更新时间：2026-08-24
目标版本：待定

## 1. 已确认需求

### 1.1 产品目标

在 MSF WebUI 中增加一个仅管理员可见的 AI 助手。管理员可以用自然语言查询和操作 MSF，助手能够覆盖 WebUI 中已有的 MosDNS、Mihomo、服务、配置、网络、更新、用户和诊断能力，并在必要时调用受限的宿主操作。

助手不是独立的第二套管理系统。它必须复用 MSF 已有 API、权限、配置校验、操作互斥、审计和回滚机制。

### 1.2 已锁定的产品决策

1. 第一版仅 `admin` 用户可见、可用。
2. AI 设置放在 `/settings?tab=system` 的“系统管理”页内。
3. 全局入口使用 React 液态玻璃球：优先运行上游 WebGPU，并在 LAN HTTP 环境自动使用由同一着色器生成的 WebGL2 后端。
4. 玻璃球只参考用户提供原型的光学原理，不复制整份 HTML 或 WGSL。
5. Agent 使用一个通用工具 `call_msf_api` 调用现有 `/api/v1/*`。
6. 无法由 MSF API 表达的宿主能力通过枚举工具 `run_msf_host_operation` 提供。
7. 不向模型开放任意 Shell、任意 URL、任意文件路径。
8. 管理员拥有完整能力；确认机制用于防止模型误操作，不用于削弱管理员权限。
9. 能力、寻路规则、禁区和配置策略写入运行时 `MEMORY.md`。
10. 所有后端路由必须在 Agent 能力目录中完成分类，新增未分类路由时 CI 失败。

### 1.3 非目标

以下内容不进入首个可验收版本：

- 普通用户、操作员和只读用户使用助手。
- 后台自治任务和定时自主执行。
- 任意 Shell 命令。
- 任意公网网页访问。
- 语音输入和语音输出。
- 图片、文件附件理解。
- 外部 MCP Client 和对外 MCP Server。
- 多 Agent、子 Agent 或远程执行器。
- 自动关闭所有高风险确认。

这些能力只能在核心链路验收后单独立项。

## 2. 当前基础与覆盖边界

### 2.1 已有基础

MSF 当前具备：

- Go `net/http` 服务端和统一 `/api/v1` 路由。
- JWT 与 API Token 认证。
- `admin/operator/viewer/guest` 角色系统。
- `admin/operate/read` API Token scope。
- SQLite、WAL 和增量迁移。
- 审计日志。
- 系统恢复期间的写操作互斥控制器。
- MosDNS、Mihomo、网络、配置、更新、诊断和用户 API。
- 通用配置文件 API、校验、历史和回滚 API。
- React 19、React Router、统一 `AppShell` 和 Liquid Glass 组件。

当前后端约有 358 条注册路由。静态前端扫描可直接识别约 79 个字面量 API 路径，其余包含动态路径、后端专用接口和兼容接口。覆盖率不能通过这两个数字直接相除计算。

### 2.2 “完整覆盖”的定义

完整覆盖分为三层：

1. **WebUI 管理能力**：必须由 `call_msf_api` 完整覆盖。
2. **配置文件能力**：优先通过领域 API，缺少领域 API 时通过通用配置 API 覆盖。
3. **宿主机人工能力**：仅对明确批准的 systemd、端口、磁盘、进程和日志操作提供枚举宿主工具。

浏览器本地偏好不属于服务器管理能力，例如：

- 仪表盘本地布局。
- 侧栏滚动位置和展开状态。
- 部分 LocalStorage 外观偏好。

如以后需要 AI 控制这些偏好，应新增前端 `UI Action`，不得伪装成服务器 API。

## 3. 总体架构

```text
React AssistantWidget
  ├─ AssistantOrb
  └─ AssistantPanel
          │
          │ POST /api/v1/assistant/chat/stream
          ▼
Assistant HTTP Gateway
  ├─ 会话与 SSE
  ├─ Provider Adapter ──────────────► LLM Provider
  ├─ MEMORY / Prompt Builder
  ├─ Tool Loop
  │    ├─ call_msf_api
  │    │    ├─ API Catalog
  │    │    ├─ Policy / Confirmation
  │    │    ├─ Internal HTTP Dispatcher
  │    │    └─ Result Redactor
  │    └─ run_msf_host_operation
  ├─ Session Store
  └─ Audit Store
```

## 4. API 调用设计

### 4.1 通用工具契约

模型仅使用一个 MSF API 工具：

```json
{
  "name": "call_msf_api",
  "arguments": {
    "method": "POST",
    "path": "/api/v1/services/mosdns/restart",
    "query": {
      "wait": "1",
      "timeout": "5"
    },
    "body": null
  }
}
```

参数限制：

- `method` 只允许目录中声明的方法。
- `path` 必须是站内 `/api/v1/` 路径。
- 禁止 scheme、host、userinfo、fragment 和路径穿越。
- `query` 必须符合目录 schema。
- `body` 必须符合目录 schema 和大小限制。
- 禁止调用 `/api/v1/assistant/*` 形成递归。
- 登录、刷新 Token 等入口标记为内部专用。

### 4.2 Go 进程内调用

Agent 不通过网卡访问 `127.0.0.1:7777`，也不保存用户 JWT。

内部调用步骤：

1. 通过会话中的 `user_id` 重新读取用户。
2. 确认用户仍然存在、启用且角色为 `admin`。
3. 匹配 API Catalog。
4. 运行 `authorizeRequest` 等价检查。
5. 进入恢复出厂和写操作互斥控制。
6. 构造内部 `http.Request`。
7. 注入 `AuthIdentity` 与当前用户上下文。
8. 调用原始 MSF `ServeMux` handler。
9. 限制响应大小并解析 JSON。
10. 进行敏感字段脱敏。
11. 把结果返回模型或通过受保护通道交付管理员。

需要将当前中间件拆成：

- 公网请求认证层。
- 共享的已授权执行层。
- 原始路由层。

外部请求和 Agent 内部请求共用已授权执行层，避免 Agent 绕过操作互斥、安全模式和请求日志。

### 4.3 API 能力目录

新增单一事实源：

```text
internal/assistant/catalog/api_capabilities.yaml
```

每个条目至少包含：

```yaml
- method: POST
  path: /api/v1/services/{name}/restart
  name: restart_service
  description: 启动指定服务
  exposure: confirm
  body_schema: null
  query_schema:
    wait: boolean
    timeout: integer
  result_limit: 32768
  redact_profile: service_status
```

`exposure` 枚举：

- `auto`：无需确认。
- `confirm`：普通确认。
- `protected`：强确认，敏感结果使用受保护交付。
- `internal`：Agent 不可调用，但必须在目录中登记。

### 4.4 路由完整性门禁

新增 Go 测试，通过 AST 扫描所有 `mux.HandleFunc` 的静态路由注册：

```text
后端注册路由集合 - API Catalog 路由集合 = 空集
```

验收要求：

- 每条路由都有分类。
- Catalog 中不存在已经删除的路由。
- 动态路径具有一个可验证样例。
- 新增未分类路由时 CI 失败。

## 5. 配置和宿主操作寻路

### 5.1 固定寻路顺序

Agent 必须使用：

```text
领域专用 API
  → 通用配置 API
  → 枚举宿主操作
  → 明确报告不支持
```

### 5.2 领域 API 优先

有领域 API 时禁止直接修改底层文件。例如：

- 服务启停使用 `/api/v1/services/*`，不用 `systemctl`。
- MosDNS 开关使用 `/api/v1/mosdns/system/switches`，不改 `switch*.txt`。
- MosDNS 上游使用 `/api/v1/mosdns/system/upstream-overrides`。
- 网络规则使用 `/api/v1/network/apply` 和 `/api/v1/network/stop`。
- Mihomo 代理组、Provider 和规则使用各自领域 API。

### 5.3 通用配置 API 兜底

领域 API 不足时使用：

- `GET /api/v1/config/file`
- `PUT /api/v1/config/file`
- `POST /api/v1/config/validate`
- `POST /api/v1/config/backup`
- `GET /api/v1/history/compare`
- `POST /api/v1/history/{id}/rollback`

固定流程：

```text
读取当前内容
  → 创建备份或历史
  → 生成草案
  → 展示 diff
  → 用户确认
  → 写入
  → 验证
  → 重载或重启
  → 健康检查
  → 失败回滚
```

### 5.4 配置禁区

`MEMORY.md` 和 Policy 必须共同声明：

- `configs/mihomo/config.yaml` 是运行时副本，使用用户配置 API 修改。
- 禁止直接修改 MosDNS `switch*.txt`。
- 禁止直接覆盖自动生成的 `network.nft`。
- 禁止修改 `configs/mosdns/gen` 中的生成文件作为持久设置。
- 禁止模型自行猜测不存在的配置路径。
- 禁止在没有校验和备份时覆盖配置。

### 5.5 宿主操作工具

第二个工具：

```json
{
  "name": "run_msf_host_operation",
  "arguments": {
    "operation": "restart_msf_service",
    "parameters": {}
  }
}
```

允许的枚举操作首批仅包括：

- 查询 MSF systemd 状态。
- 重启 MSF 服务。
- 查询受管进程。
- 查询端口占用。
- 查询磁盘空间。
- 查询受限 journal 日志。
- 校验受管二进制版本与摘要。

不接受任意命令字符串。

## 6. MEMORY.md 设计

运行时位置：

```text
/opt/msf/configs/assistant/MEMORY.md
```

结构：

```markdown
# 管理员自定义记忆

管理员可以在这里写本机约定，不得保存密钥。

<!-- BEGIN MSF AUTO API CAPABILITIES -->
由 api_capabilities.yaml 自动生成的能力、示例和寻路规则。
<!-- END MSF AUTO API CAPABILITIES -->
```

升级时只更新自动区间，保留管理员自定义内容。

加载规则：

- 每次新会话加载。
- 文件修改后下一轮生效。
- 限制最大字符数。
- 进入模型前扫描明显密钥格式。
- MEMORY 内容被视为管理指令，但不能突破后端 Policy。
- MEMORY 不能增加 Catalog 中不存在的工具权限。

## 7. 管理员权限与确认

### 7.1 可见性

- 只有 `admin` 渲染玻璃球和面板。
- 只有 `admin` 渲染 AI 设置卡片。
- 所有 `/api/v1/assistant/*` 后端入口再次执行 `requireAdmin`。
- 第一版不允许 API Token 调用助手。

### 7.2 执行模式

设置提供三档：

1. `read_only`
2. `confirm_writes`
3. `auto_low_risk_writes`

无论选择哪档，下列动作始终使用 `protected`：

- 恢复出厂设置。
- 删除用户和重置密码。
- 创建、显示或撤销 API Token。
- 清除 nftables。
- 删除配置或批量规则。
- 安装系统或组件更新。
- 清空生成规则。
- 停止 MSF 自身。

### 7.3 冻结参数确认

写操作在执行前生成：

- `action_id`
- `tool_name`
- 冻结 method/path/query/body
- 参数摘要 hash
- 风险等级
- 影响说明
- 当前用户
- 过期时间

确认后执行冻结参数，不重新让模型解释“确认”。

普通确认使用按钮；高风险确认要求输入指定确认文本。

### 7.4 受保护结果

敏感结果通过 SSE `protected_result` 发送，仅展示给当前管理员：

- 不进入模型上下文。
- 不写入聊天历史。
- 不写入普通日志。
- 不进入前端 LocalStorage。
- 页面刷新后不再显示。

## 8. LLM Provider

### 8.1 第一版协议

第一版实现 OpenAI-compatible Provider Adapter，支持自定义：

- Base URL
- API Key
- 模型名称
- Chat Completions 或 Responses 协议
- 最大上下文
- 温度
- 请求超时
- 最大工具轮数

后端统一 Provider 接口，Anthropic 或其他协议以后通过新 Adapter 扩展。

### 8.2 API Key 存储

- 浏览器不直接调用 Provider。
- API Key 不进入 LocalStorage。
- 独立生成 AES-GCM 密钥。
- 密钥文件位于 `/opt/msf/data/secrets/assistant.key`，权限 `0600`。
- SQLite 只保存密文和 nonce。
- GET 设置接口只返回 `api_key_set`。
- 支持 `MSF_AI_API_KEY` 环境变量覆盖。

### 8.3 Provider 测试

`POST /api/v1/assistant/settings/test` 验证：

1. 网络连接。
2. 普通文本响应。
3. 流式输出。
4. 一个无副作用工具调用。
5. 模型是否支持要求的工具格式。

## 9. 会话与 SSE

### 9.1 API

```text
GET    /api/v1/assistant/status
GET    /api/v1/assistant/settings
PUT    /api/v1/assistant/settings
POST   /api/v1/assistant/settings/test

POST   /api/v1/assistant/chat/stream
GET    /api/v1/assistant/sessions
GET    /api/v1/assistant/sessions/{id}
DELETE /api/v1/assistant/sessions/{id}
POST   /api/v1/assistant/sessions/{id}/stop

POST   /api/v1/assistant/actions/{id}/execute
POST   /api/v1/assistant/actions/{id}/cancel
```

### 9.2 SSE 事件

- `start`
- `delta`
- `tool_started`
- `tool_finished`
- `approval_required`
- `protected_result`
- `usage`
- `done`
- `error`

要求：

- 15 秒 heartbeat。
- 服务端合并过细 token。
- 前端每动画帧最多提交一次文本更新。
- 同一会话最多一个活动任务。
- 支持前端停止和后端 Context 取消。
- 页面后台断流后可从会话快照恢复。

## 10. 数据模型

新增 SQLite 表：

### assistant_settings

- provider
- base_url
- api_key_ciphertext
- api_key_nonce
- model
- protocol
- context_tokens
- temperature
- request_timeout
- max_tool_rounds
- execution_mode
- show_tool_details
- orb_enabled
- updated_at

### assistant_sessions

- id
- user_id
- title
- provider
- model
- status
- created_at
- updated_at

### assistant_messages

- id
- session_id
- role
- content
- status
- usage_json
- created_at

### assistant_tool_runs

- id
- session_id
- user_id
- tool_name
- method
- path
- arguments_summary
- risk
- confirmed
- status
- result_summary
- error
- duration_ms
- created_at

### assistant_pending_actions

- id
- session_id
- user_id
- payload_ciphertext 或受保护 JSON
- payload_hash
- risk
- status
- expires_at
- created_at

所有迁移必须可重复运行，不删除现有数据。

## 11. React 前端模块

```text
web/src/components/assistant/
  AssistantWidget.tsx
  AssistantPanel.tsx
  AssistantHeader.tsx
  AssistantComposer.tsx
  AssistantMessageList.tsx
  AssistantMessage.tsx
  AssistantToolEvent.tsx
  AssistantApprovalCard.tsx
  AssistantHistory.tsx
  orb/
    AssistantOrb.tsx
    OrbRenderer.ts
    vendor/ler-sent001-orb/effect.wgsl
    assistant-orb.css
    OrbFallback.tsx

web/src/features/assistant/
  types.ts
  reducer.ts
  api.ts
  sse.ts
  useAssistantStream.ts
  useAssistantSession.ts
  useOrbState.ts

web/src/app/settings/
  AssistantSettingsCard.tsx
```

修改：

- `AppShell.tsx`：管理员且助手启用时挂载 Widget。
- `SettingsClient.tsx`：在 SystemTab 中插入 AI 助手设置。
- 全局 z-index token：为助手面板和玻璃球预留稳定层级。

## 12. 设置页设计

路径固定为：

```text
/settings?tab=system
```

SystemTab 顺序：

```text
系统配置
AI 助手
初始化配置
```

AI 助手卡片字段：

- 启用 AI 助手。
- 显示浮动玻璃球。
- Provider。
- Base URL。
- API Key。
- 模型名称。
- API 协议。
- 最大上下文。
- 温度。
- 请求超时。
- 最大工具调用轮数。
- 显示工具过程。
- API 执行模式。
- 测试连接。

API Key 只显示“已配置”，不回填明文。

## 13. 玻璃球实现

### 13.1 分层

- React 管理状态、点击、拖动、贴边、可见性和卸载。
- `OrbRenderer` 管理 WebGPU/WebGL2 device、pipeline、uniform、resize 和动画帧。
- WGSL 只负责流体、折射、边缘色散和光照。
- CSS fallback 只负责 WebGPU 与 WebGL2 均不可用或 reduced motion 的环境。

### 13.2 状态

- idle
- hover
- thinking
- tool
- success
- warning
- error
- dragging
- docked
- disabled

### 13.3 性能约束

- CSS 尺寸约 72px。
- 内部分辨率不超过 192px。
- DPR 最大 1.5。
- idle 12-15fps，长时间空闲后冻结。
- thinking/tool 24-30fps。
- 页面隐藏或入口不可见时停止。
- 面板展开后降帧。
- 不创建全屏 GPU Canvas。
- WebGPU 初始化失败后自动切换同源 WebGL2 动态后端；仅 WebGL2 也失败时切换静态 fallback。
- 卸载时取消 rAF、observer、事件并释放 GPU 资源。

## 14. 安全约束

- 模型不能修改自身权限。
- MEMORY 不能突破 Policy。
- API 和配置返回内容均视为不可信数据。
- 日志中的文字不能触发权限提升。
- 结果进入模型前统一脱敏。
- 工具参数全部由 Go 校验。
- 单工具默认超时 30 秒。
- 单轮总时限默认 120 秒。
- 最大工具轮数默认 8。
- 每管理员限制活动会话数量。
- 写操作具有幂等键。
- AI 关闭时不产生 Provider 网络请求。
- Provider Base URL 仅允许 http/https。
- 禁止重定向到非 http/https 协议。
- 测试默认使用本地 mock Provider，不调用真实外部服务。

## 15. 分阶段实施与提交边界

### 阶段 A：契约和安全骨架

范围：

- API Catalog schema。
- 路由分类门禁。
- MEMORY 生成器。
- Policy、风险和确认契约。
- 数据库迁移。

验收：没有 UI；所有当前路由完成分类；Go 测试通过。

### 阶段 B：Provider 与设置

范围：

- OpenAI-compatible Adapter。
- 加密 API Key。
- status/settings/test API。
- `/settings?tab=system` AI 设置卡片。
- admin-only 前后端门禁。

验收：关闭时零外部请求；非管理员无法看到或访问；mock Provider 测试通过。

### 阶段 C：只读对话闭环

范围：

- SSE Gateway。
- 会话和消息持久化。
- `call_msf_api` 的 `auto` 路由。
- 助手面板。
- 玻璃球和 fallback。
- 停止生成。

验收：管理员可以询问系统、MosDNS 和 Mihomo 状态；模型不能执行写操作。

### 阶段 D：完整 API 分类执行

范围：

- `confirm/protected/internal` 路由。
- 冻结动作。
- 确认卡。
- 受保护结果。
- 完整审计。

验收：所有可管理 API 可由管理员请求；写操作未经确认不执行。

### 阶段 E：配置草案与回滚

范围：

- 领域 API 寻路。
- 通用配置 API 兜底。
- diff、校验、备份、应用、健康检查和回滚。
- 配置禁区 Policy。

验收：配置修改失败时恢复原文件和原运行状态。

### 阶段 F：宿主操作

范围：

- `run_msf_host_operation`。
- systemd、端口、磁盘、进程、journal 和摘要检查。
- 不支持任意 Shell。

验收：每个枚举操作有独立 schema、权限、确认、超时和测试。

### 阶段 G：可靠性和性能收口

范围：

- 断流恢复。
- 会话历史分页。
- SSE 背压。
- Prompt/结果大小限制。
- GPU 生命周期和性能测量。
- VM136 实机测试。

验收：满足第 16 节全部 Definition of Done。

每个阶段独立 commit、独立构建、独立部署和独立回滚，不把无关 UI 或基础设施改动混入同一提交。

## 16. 收敛验收计划

### 16.1 功能验收

- 管理员能够启用和关闭助手。
- 设置页位置和字段符合第 12 节。
- 玻璃球能打开、关闭助手面板。
- 支持新会话、历史、停止生成。
- SSE 文本、工具、确认、错误和终态顺序正确。
- `call_msf_api` 能执行目录中的 GET 和写操作。
- `run_msf_host_operation` 只能执行枚举操作。
- MEMORY 修改在下一轮生效。
- 配置写入遵守领域 API 优先级。
- 写配置具有 diff、验证、备份和回滚。

### 16.2 覆盖验收

- 所有 `mux.HandleFunc` 路由都出现在 Catalog。
- 所有 Catalog 条目都能匹配真实路由。
- 每个条目具有 exposure、schema、结果限制和脱敏配置。
- 任何未分类新增路由使 CI 失败。
- MEMORY 自动区间与 Catalog 一致。

### 16.3 权限验收

- 非管理员不渲染入口和设置。
- 非管理员直接请求助手 API 返回 403。
- 被停用或降权的管理员下一次工具调用立即失败。
- 第一版 API Token 无法调用助手。
- Agent 不能调用 internal 路由。
- MEMORY 无法扩大权限。

### 16.4 确认和安全验收

- 未确认写操作不产生副作用。
- 确认执行的是冻结参数。
- 修改 action 参数、用户或 hash 后拒绝。
- action 过期后拒绝。
- protected 结果不进入模型、历史、普通日志和 LocalStorage。
- 订阅 URL、密码、AccessKey、JWT 和 API Token 在普通结果中被脱敏。
- 日志和配置中的提示注入不能触发未授权操作。
- 不存在任意 Shell、任意 URL 和任意路径入口。

### 16.5 可靠性验收

- SSE 每 15 秒 heartbeat。
- 网络中断后会话可恢复。
- 页面切后台再恢复可获得终态。
- 用户停止后 Go Context 被取消。
- 同一会话不会并行执行两轮工具循环。
- Provider 超时、格式错误和工具不兼容均返回可读错误。
- MSF 重启后历史存在，未完成 action 正确过期或恢复为可判定状态。

### 16.6 性能验收

- SSE delta 在前端每动画帧最多提交一次。
- 面板长会话不因 token 流发生持续全树重渲染。
- 玻璃球隐藏时无 rAF 和 GPU 提交。
- 玻璃球 idle 不超过目标 15fps。
- WebGPU 不可用时自动使用 WebGL2，两个 GPU 后端均不可用时才使用 fallback。
- `/mihomo/proxies` 和 `/mosdns/rules` 滚动性能不因全局助手明显回退。
- 移动端无横向溢出，输入框和确认按钮不被底部导航遮挡。

### 16.7 测试门禁

后端：

- `go test ./internal/assistant/...`
- Assistant handler 与数据库测试。
- API Catalog 完整性测试。
- 权限、确认、脱敏、取消和回滚测试。
- `go test ./...`

前端：

- reducer、SSE parser、历史、确认卡和设置测试。
- Orb 生命周期与 fallback 测试。
- `npm run typecheck`
- `npm run build`
- 目标 Vitest。

E2E：

- 管理员可见、普通用户不可见。
- mock Provider 流式对话。
- 只读 API 调用。
- 写操作确认和取消。
- 停止、断流和恢复。
- 移动端和 reduced motion。

### 16.8 VM136 实机验收

- 从干净或隔离工作树构建。
- 保留 `/opt/msf`。
- 替换前备份程序和 service unit。
- 验证版本、HTTP 200、MSF、MosDNS、Mihomo 和日志。
- AI 关闭时确认无 Provider 出站。
- 使用本地 mock Provider 完成读写确认流程。
- 用户配置真实 Provider 后再执行真实模型验证。
- 记录回滚备份和 SHA-256。

## 17. 最终 Definition of Done

只有同时满足以下条件，管理员 AI 助手才算完成：

1. API Catalog 对当前后端路由无遗漏。
2. WebUI 可管理能力全部可通过 `call_msf_api` 表达。
3. 配置修改具有明确寻路、校验和回滚。
4. 宿主操作只有枚举能力，没有任意 Shell。
5. 只有管理员可见、可用。
6. 敏感信息不进入模型或普通持久化。
7. 写操作确认不可被模型绕过。
8. 会话、取消、断流恢复和审计完整。
9. 玻璃球具有 WebGPU/WebGL2 生命周期、页面可见性控制和静态 fallback。
10. 全部后端、前端、E2E 和 VM136 验收通过。

任何一项未通过，都不能标记为完成，也不能默认扩大到附件、语音、MCP 或后台自治范围。
