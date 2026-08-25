# 组件更新移除 MosDNS 设计规格

## 目标

从系统设置的「组件更新」功能中移除 MosDNS 在线更新相关内容，同时保留 MosDNS 的 WebUI 卡片和本地文件上传能力。在线组件更新页面和后台默认更新流程只管理 Mihomo 与 Zashboard。

本次变更不删除 MosDNS 的初始化安装能力，也不影响 MosDNS 服务、配置、日志、流量监控和运行状态接口。

## 方案

采用“前端移除、后台默认移除、旧接口兼容”的方案：

- 前端保留 MosDNS 卡片，但仅展示本地上传入口，不展示在线更新控件。
- 前端不再读取或保存 `mosdns_upgrade_mode`。
- 后端 `GET /api/v1/component-updates` 默认只返回 `mihomo`、`zashboard`。
- 自动检查和自动更新调度只遍历默认组件列表，不再因为历史数据库中的 MosDNS 记录访问 GitHub。
- 历史 MosDNS 组件状态、配置数据库记录暂不物理删除，避免升级时产生迁移风险。
- 已存在的按组件 API 路由继续保留，兼容旧客户端；新的前端不再调用 MosDNS 的检查、更新和配置接口。
- MosDNS 本地上传、ZIP URL 初始化安装、`componentTarget`、服务重启和流量监控相关代码继续保留。

## 前端行为

修改 `web/src/app/settings/SettingsClient.tsx`：

1. 从 `UpdateConfigState` 和 `defaultUpdateConfig` 移除 `mosdns_upgrade_mode` 类型及默认值。
2. 删除设置页中的「MosDNS 升级方式」选择框及其说明文字。
3. 初始化组件配置请求只请求 `mihomo`、`zashboard`。
4. 「组件更新」网格保留 MosDNS、Mihomo、Zashboard 三张卡片；MosDNS 卡片仅渲染本地上传按钮。
5. MosDNS 卡片不请求或展示在线版本、在线检查、在线更新、自动检查、检查间隔、自动更新和发布页。
6. 保留通用 `ComponentUpdateCard` 的本地上传能力，不删除 MosDNS 安装后端。

前端完成后，页面应满足：

- 保留 MosDNS 卡片，并且仅显示本地上传入口。
- 不出现 MosDNS 升级方式、全量升级、增量升级和重置升级相关文案。
- MosDNS 卡片不出现检查更新、在线更新、自动检查、检查间隔、自动更新和发布页。
- Mihomo 和 Zashboard 的检查、更新、上传、自动检查和自动更新操作不变。

## 后端行为

修改 `internal/server/handlers_update.go`：

1. 抽取或统一默认组件列表，内容固定为 `mihomo`、`zashboard`，用于组件列表和后台调度入口。
2. `handleComponentUpdates` 不再把 MosDNS 写入响应。
3. `updateConfig()` 不再返回 `mosdns_upgrade_mode`。
4. `saveUpdateConfig()` 不再写入 `update.mosdns_upgrade_mode`；历史 settings key 保留但不再读取和更新。
5. `handleUpdateConfigPut` 不再校验或接收 MosDNS 升级策略；仍保留 Mihomo 升级策略校验。
6. 自动检查/自动更新路径必须使用默认组件列表，不能从数据库中枚举出 MosDNS 后继续执行远程检查。
7. 保留按组件 API 注册和旧状态读取逻辑，避免旧客户端直接调用时出现路由缺失；新页面不再产生这些请求。

如果当前调度逻辑分散在其他文件，计划实施时应将其改为调用统一默认组件列表，而不是复制一份组件名称。

## 下载与安装边界

以下逻辑不能删除或改成依赖组件更新列表：

- `internal/server/downloader.go` 中 MosDNS 的目标路径和手动安装保护。
- `internal/server/component_upload.go` 中 ZIP 上传、解压、校验和服务重启逻辑。
- `internal/server/handlers_setup.go` 中初始化阶段的组件安装流程。
- MosDNS 配置生成、服务文件、日志、查询日志、审计和流量监控 API。

组件更新页面移除 MosDNS 在线更新，不等于移除 MosDNS 安装。初始化安装仍由本地 ZIP 或用户提供的 ZIP URL 完成，不能回退到从 GitHub 自动拉取 MosDNS。

## 数据兼容

- `component_update_info` 和 `component_update_config` 表结构不变。
- 历史 MosDNS 行保留，不执行删除迁移。
- 新版本启动后，默认组件列表不会暴露这些行，也不会触发 MosDNS 自动检查。
- `mihomo_upgrade_mode` 的 settings key 和 API 字段继续保留。

## 验证标准

本次实施按用户要求只做代码修改和规范审查，不由 Codex 执行构建或测试。代码完成后由用户手动确认：

- 设置页显示 MosDNS 本地上传卡片，以及 Mihomo、Zashboard 在线更新卡片。
- MosDNS 卡片只能执行本地上传，不能执行在线检查或在线更新。
- 设置页不再出现 MosDNS 升级策略。
- `GET /api/v1/component-updates` 返回的组件只有 Mihomo、Zashboard。
- `GET /api/v1/update/config` 不返回 `mosdns_upgrade_mode`，仍返回 `mihomo_upgrade_mode`。
- 初始化页面的 MosDNS ZIP 安装入口仍可使用。
- MosDNS 服务、流量监控和配置页面不受影响。
