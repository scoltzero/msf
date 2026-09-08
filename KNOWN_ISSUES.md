# MSF 已知问题清单（待修复）

> **来源**：2026-08-29 ~ 08-30 在真实部署环境（Debian 12 x86_64，KVM，200 节点 / 24 providers / 31 策略组）上的故障排查与代码审查。
> **基准版本**：v0.6.2（commit `7c84225`，文中行号均基于此）。
> **用途**：后续修复任务的输入。每个问题含：位置（文件:行号 / 函数名）、证据、影响、修复思路。
> **已提交 issue**：https://github.com/scoltzero/msf/issues/11（问题 ⑩⑪ 的完整分析）。
>
> **✅ 2026-09-02 修复进展**：① ~ ⑪ 已全部在本仓库工作区完成修复（基于 v0.6.2，待发版）。各问题详情末尾的「修复记录」注明实现位置。验证：linux 交叉编译 + Go 测试（与基线持平）+ 前端 244 测试全过 + WSL 实机冒烟（启动/gzip/secret 注入/优雅退出）。

---

## 背景：三次实际发生的事故

| # | 事故 | 触发 | 后果 |
|---|---|---|---|
| A | v0.6.1→v0.6.2 自动更新后启动崩溃循环 | 手动替换过 Smart 内核但 `system_setups.mihomo_core_type` 仍为 `meta`，0.6.2 新增启动校验 fatal | 面板/代理/DNS 全失联，自锁（唯一修复入口是起不来的面板） |
| B | mihomo 内核 `lgbm-auto-update` 删模型后 msf 二次崩溃 | 内核自动更新 LightGBM 模型：删旧→gh-proxy 下载失败→Model.bin 消失→回执校验 fatal | 同上 |
| C | 面板冷加载浏览器卡死 | 3.1MB 单包 JS + 3.3MB 冗余 proxies 响应 + 首轮渲染叠加 | Edge/Chrome/无头 Chromium 均 2 分钟以上无响应 |

---

## 问题清单

### 🔴 P1 安全

#### ① mihomo 控制器 `:9090` 无 secret，局域网完全开放
- **位置**：`internal/server/configgen.go:498`、`internal/server/mihomo_custom.go:747,812`
- **证据**：生成的配置强制 `external-controller: :9090` 且无 secret；实测局域网内无认证 `curl http://<host>:9090/proxies` 直接 200。zashboard（`:9090/ui`）同样无认证。
- **影响**：局域网任何设备（访客/IoT）可切换节点、改运行模式、**读取全部连接记录（浏览历史）**。
- **修复思路**：安装时生成随机 secret 并写入配置；MSF 自己连接控制器时从配置读取；或至少将控制器绑定 `127.0.0.1:9090`，zashboard 由 MSF 面板反代。

#### ② AI 助手工具链 = root shell + 第三方 LLM
- **位置**：`internal/server/assistant_eino_tools.go:373`（`runBash` → `/bin/sh -lc`，以 root 运行）
- **证据**：代码路径存在任意命令执行；虽有 `runHostWriteTool` 的审批中断机制（`assistant_pending_actions` 表），但审批仅展示命令文本。
- **影响**：LLM 后端为用户自配的第三方 API（中转站）时，其输出可被中转方操纵（prompt injection），诱导用户确认「看似无害」的命令；若执行模式设为自动则为直接 RCE。
- **修复思路**：命令白名单/沙箱（非 root 用户、能力裁剪）；自动模式禁用 bash 工具；审批 UI 展示命令的风险解析而非原文。

### 🟠 P2 健壮性

#### ③ 启动链任何错误 → `log.Fatal` 退出 → systemd 无限重启
- **位置**：`cmd/msf/main.go:54`；启动校验链 `internal/server/app.go:191`（`reconcileAppliedMihomoUserConfig`）→ `mihomo_custom.go:485` → `mihomo_smart_resources.go:490`
- **证据**：事故 A/B 两次触发；`systemctl status` 显示 exit-code 循环，每 4~5 秒一次。
- **修复思路**：区分「安装损坏」与「运行时状态不兼容」——后者应照常启动 HTTP 服务，将 mihomo 置 stopped 并在面板横幅展示错误。校验失败自动回滚配置到上一版本（config_histories 已存历史，可复用）。

#### ④ 升级/降级破坏数据库状态
- **位置**：`internal/server/db.go:388`（启动时重置非法 core_type）；0.6.1 的组件更新逻辑会把 `mihomo_core_type` 写回 `meta`（`persistMihomoCoreType`，`downloader.go:267`）
- **证据**：实测 0.6.1 运行数小时后 db 中 core_type 由 smart 变回 meta，再启动 0.6.2 即触发事故 A。
- **修复思路**：内核类型以二进制自检为准（`mihomo -v` 输出含 "smart" 可自动纠正）；或升级/降级时迁移检查。

#### ⑤ 子进程死亡无自愈
- **位置**：supervisord 配置生成 `internal/server/layout.go`（子进程 `autostart=false autorestart=true`，但实测进程被杀后未重拉）
- **证据**：实测 `pkill mosdns` 后 53 端口消失、不自动恢复，只能 `systemctl restart msf`。
- **修复思路**：排查内嵌 supervisord 的 autorestart 生效条件；或增加健康检查 watchdog（systemd timer 探测 53/7890 端口并拉起）。

#### ⑥ nft 规则疑似无退出清理（待核实应用时机）
- **位置**：nft 表 `inet msf` 的 apply/clear 均为 HTTP handler（`internal/server/app.go:399-402`）；systemd unit 无 `ExecStopPost`；代码中无崩溃路径的删表逻辑
- **影响（推断）**：msf 进程死亡期间若规则残留且处于网关模式，所有 TCP redirect 到已死的 7877 → 全家断网直到 msf 恢复。
- **修复思路**：systemd `ExecStopPost=/usr/sbin/nft delete table inet msf`；或 mihomo 健康检查失败时自动 clear。

### 🟡 P3 资源增长

#### ⑦ 子服务日志无轮转（1.2GB 实锤）
- **位置**：`internal/server/layout.go:102,116` —— 生成的 supervisord ini 只有 `stdout_logfile=%s`，未设 `stdout_logfile_maxbytes/backups`
- **证据**：`mihomo.out.log` 35 天 1.2GB（log-level=info 时）；已临时以改 log-level=warning 缓解。
- **修复思路**：supervisord ini 增加 `stdout_logfile_maxbytes=50MB` + `stdout_logfile_backups=3`。

#### ⑧ config_histories / audit_logs 无上限
- **位置**：`internal/server/handlers_config.go:447,519`（仅分页查询与软删除，无 prune）
- **影响**：每条历史含完整配置内容（~25KB），只增不减；按年累计可达几十~上百 MB。
- **修复思路**：保留最近 N 条或按天数自动清理（迁移或启动时 prune）。

#### ⑨ 更新安装包残留
- **位置**：`data/updates/install-*` 目录无清理机制（实测 8 个目录 226MB）
- **修复思路**：更新成功后仅保留当前版本 + 上一版本。

### 🟢 P4 性能（已提交 issue #11，含完整数据）

#### ⑩ `/api/v1/mihomo/proxies` 响应 3.3MB、同一数据冗余约 8 份
- **位置**：`internal/server/mihomo_panels.go:720-757`（`mihomoProxiesPayload` 多别名字段）+ `internal/server/handlers_mihomo.go:455`（顶层提升复制）
- **证据**：逐字段体积分析见 issue #11；对照 mihomo 原生 `/proxies` 同数据仅 35KB（1/95）。
- **修复思路**：仅保留一份规范化结构（预期 ~400KB 内）+ 启用 gzip。

#### ⑪ 前端 3.1MB 单包、无代码分割
- **位置**：`web/vite.config.ts`（build 无 manualChunks）；`web/src/assets/index-*.js` 实测 3,112,971 B
- **修复思路**：路由级懒加载（React.lazy/动态 import）；vite manualChunks 拆分；首屏不应需要全量 bundle。冷加载卡死的复现步骤见 issue #11。

---

## 附：复现环境要点

- Debian 12（6.1 内核）x86_64、KVM 单臂旁路由、网关/DNS 指向本机
- msf v0.6.2（commit `7c84225`）+ vernesong Smart 内核（`alpha-smart-b750813`）+ 订阅规模 200 节点/24 providers
- 事故 A 修复记录：`system_setups.mihomo_core_type='smart'`（合法值仅 meta/smart，见 `internal/server/db.go:388`）
- 事故 B 修复记录：补 `Model.bin.msf-resource.json` 回执（`smartResourceReceipt`，`mihomo_smart_resources.go:62` 附近）；根治需 ②④ 类设计调整
- ③⑤ 的实机验证命令：`systemctl status msf`、`ss -tlnp | grep -E '53|7890'`、手动 `timeout 8 /usr/local/bin/msf serve --config /opt/msf --host 127.0.0.1 --port 17777` 抓启动 stderr

---

## 修复记录（2026-09-02，基于 v0.6.2 全量修复，待发版）

> 探索阶段的重要修正：**supervisord 从未被启动**——layout.go 生成的 ini 是死文件，真正的子进程管理在 `internal/server/process.go` 的 `ServiceManager`。因此 ⑤⑦ 的修复对象是 process.go 而非 supervisord 配置。

### ① 控制器 secret ✅
- 新增 `internal/server/mihomo_controller_secret.go`：首次启动生成 `randomHex(24)` 存设置项 `mihomo_controller_secret`（清空该设置=显式关闭认证）；secret 缓存在 App 内存（`renderMihomoYAML` 会在出厂重置事务内被调用，不能查库——这是修复过程中发现并消除的单连接死锁点）。
- 注入三处：`renderMihomoYAML`（generated 模板+fallback）、`syncMihomoActiveConfigFromAppliedUserConfig`（custom 应用时，用户自带 secret 优先）、`ensureActiveMihomoControllerSecret`（升级兼容：已存在的 config.yaml 无 secret 时补写）。
- MSF 客户端 `mihomoSecret()` 以活动配置为控制器真实来源；custom 配置自带值优先，generated 配置回落到缓存的托管值并自动携带 Bearer。custom 配置校验新增「未设置 secret」warning；`mihomoProtectedFields` 文案更新。
- 前端：Mihomo 概览页新增 zashboard 入口 + 「复制 Secret」按钮（secret 从 config 读取，仅登录可见）。
- **用户影响**：升级后 zashboard 首次连接需输入一次 secret（面板上有复制按钮）；脚本直接 curl 9090 需带 `Authorization: Bearer <secret>`。

### ② bash 审批风险标注 ✅（保持 full_auto 行为不变）
- `internal/server/assistant_eino_tools.go`：新增 `analyzeBashRisk()`（高危模式：rm -rf/dd/mkfs/fdisk/块设备写入/管道执行脚本/systemctl 操作 msf/防火墙修改/重启关机等；中危：包管理/服务管理/写 msf.db 等），产出 `risk_level + risk_notes` 存入审批单并随 `approval_required` 事件下发。
- 前端 `AssistantPanel.tsx`：审批卡片新增风险徽章（高/中/低 醒目配色）+ 命中模式列表。

### ③ 启动降级 + 修复指引 ✅
- `app.go` `EnsureBaseLayout`：`reconcileAppliedMihomoUserConfig` 失败不再上抛 Fatal → 降级为记录结构化 issue（settings `runtime.startup_issues`）+ 继续启动 HTTP。mkdir/ensureDefaultConfigs 等真安装损坏仍保持 Fatal；reconcile 在 HTTP 路径（备份恢复等）仍返回 error。reconcile 成功时自动清除对应 issue。
- 新增 `internal/server/startup_issues.go`：四类错误（core 不匹配/Smart 资源缺失/配置自检失败/二进制缺失）分别生成详细修复指引（含下载直链、目标路径、scp 命令、sqlite 兜底命令）；新 API `GET /api/v1/system/startup-issues`。
- 新增 `POST /api/v1/mihomo/smart-resources/verify`：**对已手动放置的 Model.bin/ASN.mmdb 计算 SHA-256 并写入回执**——解决「代理断了没网下载、放好文件又没有回执」的自举死结（事故 B 的根治路径）。
- 前端 `StartupIssuesBanner.tsx`：全局红色横幅 + 分步修复指引弹窗（命令可复制、链接可点、修复后可重新检测）。

### ④ core_type 二进制对账 ✅
- `downloader.go` `reconcileMihomoCoreTypeWithBinary()`：启动时执行 `mihomo -v`，输出含 "smart" → smart 否则 meta；与 DB 不一致时以二进制为准写回（复用 `persistMihomoCoreType`）。二进制缺失/执行失败（如 Windows 开发机）不动 DB。在 `New()` migrate 后调用。
- 与 ③ 组合后事故 A 场景闭环：db 被写回 meta 但二进制+配置都是 smart → 启动即自动纠正 db，reconcile 通过，mihomo 照常运行。

### ⑤ 子进程自愈 ✅
- `process.go`：Start 的 waiter goroutine 检测「desired 状态（service.X.enabled）仍为 true 时进程死亡」→ 自动退避重启（1s→2s→…→60s 封顶；稳定运行 2 分钟后重置退避；单服务单重启循环，幂等防竞态）。`Shutdown` 会先关闭恢复门，防止父进程退出阶段的待处理退避任务重新拉起子进程；Stop/Restart 语义不变。
- 验证方式：`pkill mosdns` 后应自动恢复（此前只能 `systemctl restart msf`）。

### ⑥ nft 退出清理 ✅（双保险）
- Go 侧 `runtime_env.go` `ShutdownRuntime`：linux 非 Docker（或 Docker 未显式保留）时执行 `clearNFT`——覆盖 SIGTERM 优雅退出。
- systemd unit 四处模板（`packaging/systemd/msf.service`、`packaging/fnos/systemd/msf.service`、`packaging/install.sh`、`cmd/msf/main.go`）新增 `ExecStopPost=-/bin/sh -c '...'`：删 `inet msf` 表 + 循环清 IPv4/IPv6 fwmark 策略路由——覆盖 SIGKILL/crash。清表=流量直连不断网，重启后由 RestoreConfiguredRuntime 恢复。
- **注意**：升级到本版本后需 `systemctl daemon-reload` 使新 unit 生效（二进制自更新安装流程会自动处理）。

### ⑦ 日志轮转 ✅（copytruncate）
- 新增 `internal/server/logrotation.go`：对 mihomo/mosdns 的 out/err、msf.log、supervisord.log——超 50MB 时备份链轮转（.3 删/.2→.3/.1→.2，当前文件 copy→.1 后 truncate）。子进程以 O_APPEND 持有 fd，truncate 后继续正确写入（rename 式轮转做不到）。启动时+每小时检查。
- 顺带在 layout.go 的 supervisord ini 补了 `stdout_logfile_maxbytes/backups`（死文件对齐）。

### ⑧⑨ 数据保留 ✅
- 新增 `internal/server/retention.go`（`StartMaintenanceTasks` 随 serve 启动，启动即执行+每日循环）：
  - config_histories：物理删软删除超 30 天行；未删除且非加精（is_stable）保留最近 500 条
  - audit_logs：删 90 天前 + 上限 20000 条
  - `data/updates/`：install-* 目录与安装包各保留最近 2 个

### ⑩ proxies API 去冗余 ✅
- `handlers_mihomo.go` `handleMihomoProxies`：删除根级 5 个提升键（前端 `unwrapSnapshot` 只读 `payload.data`，从未消费）。
- `mihomo_panels.go` `mihomoProxiesPayload`：删除 `proxy_groups`/`nodes` 别名、`raw` 整包、`group_test_policy`（前端零引用）、行级 `raw`。保留 groups/proxy_list/proxies/providers/test_policy/config_authority。`overview?full=1`、`proxy-groups-config` 复用同一构造自动受益。
- `mihomoConnectionsPayload`：删除 `items` 别名（同一数组序列化两份）、snake_case totals 重复、payload 级 `raw`（未过滤完整控制器响应）。行级 raw 保留（ConnectionDetail 消费）。
- 前端 normalize 的多级 fallback 链天然向后兼容，无需改动（已由 244 个前端测试验证）。

### ⑪ 前端代码分割 + gzip ✅
- `web/src/App.tsx`：全部 20+ 路由改 React.lazy，Suspense 统一挂在 `protectedRoute`（登录/Setup 亦懒加载）。
- `web/vite.config.ts`：manualChunks 拆 react-vendor/echarts/editor/graphics/markdown。构建产物：单包 3.1MB → 首屏 index(155KB)+react-vendor(231KB)+AppShell(217KB)≈600KB（gzip 后约 195KB）；echarts 1.1MB/editor 394KB/graphics 924KB 均按需加载。
- 新增 `internal/server/gzip.go`：Content-Type 白名单（json/html/css/js/svg）+ 正确处理 q 值的 Accept-Encoding 协商、`Vary: Accept-Encoding` 和 gzip writer 池化（SSE 与 WebSocket 天然排除）。JSON 与静态资源透明压缩（3.3MB JSON 预期 → 数百 KB）。

### 验证记录
- `CGO_ENABLED=0 GOOS=linux go build ./...` ✓、`go vet` ✓
- Go 测试（WSL 内运行 linux 二进制）：internal/server、cmd/msf 与**基线逐一持平**（基线在 WSL 同样失败的 4 个测试均为环境依赖：硬编码 Windows 路径的 route-inventory 测试、/mnt/c mtime 特性、Docker 脚本测试）；assistant 系列/cloudflareredirect 全过。修复过程中曾引入 renderMihomoYAML 在出厂重置事务内查库导致的死锁（`TestCompletePendingFactoryResetBeforeRuntimeRestore`），已通过内存缓存 secret 消除并复测通过。
- 前端：`tsc --noEmit` ✓、vitest 244/244 ✓、`vite build` ✓
- WSL 实机冒烟：服务启动、`/api/v1/version` 正常、JSON/HTML 均返回 `Content-Encoding: gzip`、config.yaml 自动注入 `secret:`、SIGTERM 优雅退出
