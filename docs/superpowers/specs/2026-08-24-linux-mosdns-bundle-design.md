# Linux MosDNS 发布包与流量监控设计

## 目标

将 MSF 收敛为仅支持 Linux amd64 的产品，安装用户提供的 MosDNS 发布 ZIP 包，保持既有 MSF WebUI 和鉴权模型不变，并增加独立的设备流量监控页面。

## 范围

- 仅支持 Linux amd64。
- 仅保留 Linux tarball 与 systemd 的安装和发布链路。
- 删除 Docker、macOS、Unraid、fnOS 的代码目录、发布目标、工作流校验、文档和资源引用。
- MosDNS ZIP 是一个完整组件，其中必须同时包含 `mosdns` 和 `mosdns-traffic-agent`。流量代理不作为独立组件安装、更新、重启、回滚或删除，而是始终跟随 MosDNS。
- 保留既有 MSF WebUI 的页面、导航和视觉语言；唯一新增的用户页面为 MosDNS 下的“流量监控”。

## 发布包约定

管理员可在初始化时通过本地上传 ZIP，或填写任意 HTTP(S) ZIP 地址安装发布包。系统不设置来源白名单、不提供 SHA-256 输入、不显示校验状态，也不提供可配置的安装策略。

后端只接受可安全解压，且在单一包根目录下具备以下结构的 ZIP：

```text
cus/bin/mosdns
cus/mosdns/
monitor/bin/mosdns-traffic-agent
monitor/config/config.json
```

`mosdns` 与 `mosdns-traffic-agent` 必须均为 Linux x86_64 ELF 可执行文件。解压时拒绝绝对路径与逃逸出暂存目录的路径。这些检查是固定的正确性与安全性要求，不属于用户可配置的安装策略。

## 安装与运行时

1. 初始化向导移除自动下载 MosDNS 的步骤，替换为“本地 ZIP 上传”和“URL 安装”二选一。
2. MSF 将上传文件或下载结果写入临时上传目录。
3. MSF 在暂存目录解压并验证完整发布包。
4. MSF 将初始化时选择的网卡写入流量代理配置，其余发布包配置保持原样。
5. MSF 将暂存发布包原子替换到受管 MosDNS 运行目录。验证、配置或替换失败时，当前正在运行的发布包与配置必须保持不变。
6. MSF 将 `mosdns` 与 `mosdns-traffic-agent` 作为一个运行单元启动和监管。MosDNS 的重启、升级、重装、回滚、停止与恢复出厂设置，均在适当顺序中作用于这两个进程。

为兼容发布包自带的 MosDNS WebUI，发布包中的 MosDNS API 与流量代理 API 监听 `0.0.0.0:9099` 和 `0.0.0.0:9199`；流量代理保留 `cors_allowed_origins: ["*"]`，由 WebUI 直连其 API。MSF 管理面仍通过本机回环地址代理流量 API。

## 配置模型

用户发布包替换 MSF 当前的 MosDNS 模板树。MSF 管理发布包中的 `cus/mosdns` 结构，包括 `config_custom.yaml`、`sub_config`、规则、生成数据、Web 信息和插件配置。

Go 后端继续对既有 WebUI 暴露 `/api/v1/mosdns/*` 契约，并改为读写新结构以及调用本地 MosDNS 插件/API。若 WebUI 中的某项能力在发布包里没有真实对应实现，后端必须明确返回“不支持”或“不可用”，不得伪造写入成功。

## 设备流量监控

MosDNS 侧栏新增独立的“流量监控”路由，沿用现有 MSF 工作台布局，提供：

- 流量代理健康状态和当前监听网卡状态。
- 总接收速率、总发送速率和活跃设备数。
- 按 IP 聚合、每秒刷新一次的设备列表。
- 每台设备的接收速率、发送速率、连接数、已观测协议及上游对端信息；具体字段以流量代理实际返回为准。
- 不暴露流量代理端口的设备详情视图。

MSF 提供受登录和角色权限保护的同源接口：

```text
GET /api/v1/mosdns/traffic/status
GET /api/v1/mosdns/traffic/snapshot
GET /api/v1/mosdns/traffic/clients
GET /api/v1/mosdns/traffic/client?ip={ip}
```

后端负责代理并标准化本地流量代理响应；浏览器请求继续使用既有 MSF 会话与权限校验。

## 错误处理

- URL 无效、下载失败、内容不是 ZIP、ZIP 格式错误、必需文件缺失或二进制架构不兼容时，必须在替换运行时前失败。
- 安装失败必须保留当前正在运行的 MosDNS 与流量代理组合。
- MosDNS 已成功启动但流量代理不可用时，MosDNS 可继续运行；流量监控页面必须清晰显示不可用状态及原因。
- 初始化只有在完整发布包成功安装，且两个必需可执行文件均存在时才能完成。

## 验证

- Go 测试覆盖 ZIP 解压、目录结构校验、amd64 ELF 校验、URL 与上传安装、暂存回滚和成对进程生命周期。
- HTTP 处理器测试覆盖受鉴权保护的流量代理接口与代理不可用场景。
- Web 测试覆盖初始化发布包来源控件、流量监控路由、加载/错误状态和标准化设备数据渲染。
- 最终验证构建 Linux amd64 tarball，运行 Go 与 Web 测试，并使用测试二进制验证 systemd 运行路径。
