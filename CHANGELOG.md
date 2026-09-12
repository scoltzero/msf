# 更新日志

## v0.6.5 - 2026-09-13

### 中文

#### MosDNS 缓存与分流稳定性

- 修复 FakeIP 响应长期滞留在 MosDNS 前置缓存的问题：`cache_all` 与 `cache_all_noleak` 不再持久化 FakeIP 网段，lazy 缓存保留期从约 3000 天调整为 1 天。
- 升级时会识别旧版缓存模板，清理旧的前置缓存 dump 和自动生成的 FakeIP 学习记忆；面板“清空 DNS 缓存”也会同步清理 `my_fakeiplist`，避免错误的 FakeIP 分流规则再次命中。
- 修复 MosDNS `fast_mark` 与全局开关位冲突导致指定客户端分支误匹配的问题。
- 将 MosDNS 预留给 Sing-box 的 DNS 端口从 `111` 调整为 `11101`，避免占用系统常见的 `rpcbind` 端口；当前版本仍未启用 Sing-box 管理能力。

#### Mihomo 与运行可靠性

- 修复 Mihomo Rule Provider 更新后访问不支持的单 Provider GET 接口而报 HTTP 405 的问题，改用 Provider 集合快照确认更新结果。
- 修复 MSF 会话 Authorization 头被转发到 Mihomo 控制器、导致控制器 401 被误判为 MSF 会话失效的问题。
- 修复容器环境 CPU 使用率计算不准确的问题，按 cgroup 限制和实际使用量计算监控指标。

#### 升级注意事项

- 已有安装升级后会自动修复旧 MosDNS 缓存模板并清理前置缓存与 FakeIP 学习记忆；首次相关查询需要重新建立缓存和分流记忆。
- 如果手工配置或外部 Sing-box 配置仍引用 `127.0.0.1:111`，请改为 `127.0.0.1:11101`；UDP 和 TCP 端口需要保持一致。

### English

#### MosDNS cache and routing stability

- Fixed Fake-IP answers remaining in MosDNS front caches indefinitely: `cache_all` and `cache_all_noleak` no longer persist the Fake-IP ranges, and the lazy-cache retention window is reduced from roughly 3000 days to one day.
- Upgrades detect the legacy cache template and clear old front-cache dumps and generated Fake-IP learning state. The WebUI "Clear DNS cache" action also flushes `my_fakeiplist`, preventing an incorrect Fake-IP routing rule from being reused.
- Fixed a `fast_mark` collision with the global switch bits that could make the designated-client branch match incorrectly.
- Moved the DNS port reserved for Sing-box in MosDNS from `111` to `11101` to avoid the system's commonly used `rpcbind` port. Sing-box management remains unavailable in this release.

#### Mihomo and runtime reliability

- Fixed Mihomo Rule Provider updates failing with HTTP 405 after MSF queried an unsupported single-provider GET endpoint; updates are now confirmed from the provider collection snapshot.
- Fixed the MSF session Authorization header being forwarded to the Mihomo controller, which could turn a controller 401 into an unintended MSF session logout.
- Fixed inaccurate container CPU usage by calculating monitoring metrics from cgroup limits and actual usage.

#### Upgrade notes

- Existing installations automatically repair the legacy MosDNS cache template and clear front-cache dumps and Fake-IP learning state during upgrade; the first related queries will rebuild cache and routing memory.
- If a manual configuration or external Sing-box configuration still references `127.0.0.1:111`, change it to `127.0.0.1:11101`; keep the UDP and TCP ports aligned.

## v0.6.4 - 2026-09-08

### 中文

#### 国内 UDP 内核直连

- 新增「国内 UDP 直连」能力（默认开启）：目的地为国内 IP 的 UDP 流量在 nftables 内核层直接放行，避免这些流量受代理核心 UDP 会话空闲超时影响，并减轻核心会话负担；不代表消除所有游戏断线原因。内置数据固定来自 CC0 授权的 ipverse RIR 委派快照（IPv4 5513 段 / IPv6 2033 段），支持运行时覆盖并提供可重复生成、逐行校验脚本。
- 设置页「系统管理 → UDP 直连」：新增总开关（即时热生效），原「游戏 UDP 直连端口」保留为补充覆盖（海外目标但需直连的场景，如自建语音服）。
#### DNS 上游现代化（forward 迁移 + 首次测速选优）

- MosDNS 上游从 aliapi 迁移到所用 MosDNS 分支内置的增强版 forward 插件，恢复常规 UDP/TCP 上游的兼容性，并支持逐上游超时和 SOCKS5 配置。forward 是内部转发插件，不是协议下拉框里的新协议。NXDOMAIN 等无地址回答可能等待其他并发上游结束；实际耗时取决于网络和超时配置，不承诺固定毫秒级返回。
- 国内默认池升级为跨供应商并发组合：阿里 UDP + 腾讯 UDP + 阿里 DoH（低延迟与加密兜底兼顾）；已有用户的上游配置原样保留、平滑兼容（裸 IP 自动补协议前缀，旧 aliapi 专用条目已不再支持并在保存时明确提示）。
- 新增 DNS 上游测速：安装向导"网络与 DNS"步骤内实测主流公共 DNS（UDP 与 IP 直连 DoH）+ 本网络网关/DHCP DNS，每候选 3 轮（含不存在域探测）自动剔除不可达者；推荐组合由纯延迟排序升级为「两条最快 UDP + 一条 DoH 加密兜底」，避免低延迟网关把加密上游挤出推荐；MosDNS 系统页新增同一测速面板，可随时重测并应用为国内上游。
- 上游编辑器移除 aliapi 协议选项；密钥字段的脱敏与保留机制不变。

#### 工程修复

- 更新前端构建/CLI 链的 Browserslist、postcss-selector-parser、qs 及相关锁定依赖，修复依赖审计报告的安全问题。

- 修复 cloudflareredirect 包的 Windows 交叉编译：进程组设置按平台拆分（Setpgid）。
- 修复 smart 内核资源校验测试在部分文件系统上因 mtime 粒度不足产生的间歇性失败。
- 修复开发版本（如未注入版本号编译出的 0.1.0-dev）检查更新时的误导性提示：此前会谎报"已是最新版本"、更新状态甚至显示"更新完成"，而实际存在更新只是按保护策略禁用了自更新；现在会如实提示"检测到新版本 vX，当前为开发版本，已禁用在线更新"。
- 完成 PR #13 合入前安全审计加固：GitHub Release 元数据不再经过公共镜像，自更新包要求独立可信的 GitHub SHA-256 摘要并在安装前复验；修复 `.lan/.local` 子串误匹配、DNS 测速接受 SERVFAIL/REFUSED、用户自带 Mihomo secret 被覆盖、只读用户写入全局自定义 CSS、gzip 协商与关闭阶段子进程重启竞态。
- 本周期主体功能由 [Timeink88](https://github.com/Timeink88) 通过 PR #13 贡献，维护者在原 PR 分支完成安全、兼容性、测试与来源审计修复。

#### 外观与皮肤系统

- 修复每次重启后外观被重置：登录 token 过期触发的会话清理不再连带删除主题/皮肤偏好，外观设置全量同步到后端 SQLite（重启/换浏览器/换设备均不丢）。
- 新增皮肤系统：琥珀暖白与经典玻璃两套，与明暗模式独立；设置页新增品牌主色调色盘（预设色板+取色器实时预览）。
- 默认皮肤保持经典玻璃（MSF 原生蓝）；选择琥珀暖白后，登录页动态波浪同步读取琥珀明暗色板，不再停留在经典蓝色。
- 调色工作台：主色全局化（侧栏/分段控件/图表五色/氛围光/文字选中色全部跟随主色）、氛围色相滑条、自定义 CSS 编辑器（模板一键填入、300ms 防抖实时预览、撤销预览）。

#### GitHub 下载可靠性与 Token

- GitHub Release 元数据始终通过 GitHub 官方 TLS 端点获取；资产下载只使用管理员主动填写的代理服务器或加速镜像源，系统不再内置、自动探测、排序或自动切换公共镜像。面板可按需检测当前手填的单一加速源，检测结果不改变线路；个人 Token 继续加密保存，资产仍需通过可信 SHA-256 校验。

#### 性能优化（速赢包）

- 波浪背景优先使用 OffscreenCanvas Worker，把 WebGL 初始化与逐帧渲染移出 UI 主线程；全屏三角形不再触发通用渲染器的无关扩展查询。保留原着色器、皮肤色板、画质预算、隐藏暂停和静态模式；不支持或启动失败时回退主线程渲染，无 WebGL 时保留静态底色。

- 优化 Mihomo 首次加载：分离波浪与地球依赖、并行预载目标路由，首屏数据提交后再启动持久背景。代理节点先于辅助接口显示；概览图表延后初始化，地球/规则/订阅随视口加载，完整运行快照仅在展开高级信息后获取。

- 静态资源缓存分级：带哈希的构建产物一年 immutable，固定名资源一小时，index.html 保持即时刷新——面板二次打开不再全量重下。
- Mihomo 默认日志级别 info→warning（此前 info 级月均可写穿 1.2GB 磁盘）；msf 日志中 URL 的 token/secret 参数脱敏后再落盘；日志轮转按磁盘剩余空间自动分档；Go 运行时默认 512MiB 软内存上限（GOMEMLIMIT 环境变量可覆盖）。
- 接口响应"别名复制"收尾：/mihomo/rules、/logs/{service}、/mosdns/logs 等接口去掉前端从不读取的重复字段，响应体积下降 47%-80%。

#### DNS 稳定性

- 根除 AAAA 五秒黑洞：IPv6 数据面关闭时 AAAA 查询立即返回空应答（原实现送国外 DNS 直连，被墙网络下每次等满 5 秒超时）。
- 调整原 aliapi 上游路径，避免已观察到的裸 IP 查询挂起问题；国内默认使用 UDP 与 IP 直连 DoH 混合上游。Windows 搜索域（*.lan/*.local）本地拒答，并按域名边界匹配，避免误伤包含相同字样的公共域名。
- 修复本机 DNS 接管诊断误报：resolv.conf 指向本机 LAN 地址（旁路由常见）时不再误判为"未接管"。

#### 运维基础设施

- Smart 核心资源缺失或校验失败不再崩溃循环，面板提供分步修复指引；mihomo 进程异常退出自动退避重启。
- mihomo external-controller 自动生成随机 secret（此前 9090 无认证暴露）；gzip 中间件（Content-Type 白名单，SSE/WebSocket 天然排除）；copytruncate 日志轮转；配置历史/审计日志/更新包保留清理；ExecStopPost 自动清理 nft 规则。
- 详见仓库内 KNOWN_ISSUES.md 的完整问题清单。

#### 升级注意事项

- **国内 UDP 直连默认开启**：若自定义了「国内 IP 的 UDP 走代理」规则（罕见，如国内中转），请在设置页关闭该开关。
- **旧配置中的 aliapi 专用上游（阿里私享 DoH API）不再受支持**：保存时会被明确拒绝，请改用 udp/tcp/tls/https 形式的上游；普通公共 DNS 上游不受影响。
- **Mihomo 控制器（:9090）默认启用随机 secret**：配置已有自定义 `secret` 时优先使用；缺少该字段时由 MSF 生成并保存，后续重启复用；显式设置顶层 `secret: ""` 表示不要求 Mihomo 控制器认证，建议保持认证。默认配置已加入这三条注释。直连工具可从「Mihomo 概览」复制 secret；`mihomo_controller_secret` 是 MSF 内部设置，单独清空它不会删除配置文件已有的 secret。修改配置后需应用或重启 Mihomo，自动生成文件的手工修改可能被后续生成覆盖。
- **Go 运行时默认 512MiB 软内存上限**：这是垃圾回收的软目标，不是硬性进程内存限制，也不保证避免 OOM；Docker/K8s 部署可通过 `GOMEMLIMIT` 环境变量调整或置 -1 关闭。
- **MosDNS 国内默认池为阿里 UDP + 腾讯 UDP + 阿里 IP 直连 DoH**：已有自定义覆盖配置保留，可在面板 DNS 上游设置中编辑。并发使用 DoH 与明文 UDP 不代表所有查询都已加密。
- **性能范围**：主内容优先加载与波浪 Worker 减少页面阻塞；不支持 Worker 时有兼容回退，地球等组件仍可能出现初始化长任务，不保证所有设备完全无卡顿。

### English

#### Kernel-level CN UDP bypass

- New "CN UDP direct" capability (on by default): UDP traffic destined for
  CN IPs is released at the nftables kernel layer and never enters the proxy
  tunnel, avoiding proxy-core UDP idle-timeout effects for that traffic and
  reducing core session load; this does not eliminate every cause of game
  disconnects. The embedded snapshot is pinned to the CC0 ipverse
  RIR-delegation data (5513 v4 / 2033 v6), supports runtime overrides, and has
  a reproducible per-CIDR validation script.
- Settings → System → "UDP direct": a master toggle (hot-applied), with the
  previous game-UDP port list kept as a supplemental override for
  direct-but-overseas targets (e.g. self-hosted voice servers).

#### DNS upstream modernization (forward migration + first-run benchmark)

- Migrate aliapi upstreams to the enhanced forward plugin already included
  in the selected MosDNS fork, restoring ordinary UDP/TCP compatibility
  with per-upstream timeouts and SOCKS5 options. Forward is an internal
  plugin, not a new protocol in the editor. NXDOMAIN and other address-free
  responses may wait for concurrent upstreams; latency depends on the
  network and configured timeouts, with no fixed millisecond guarantee.
- The default domestic pool is now a cross-vendor concurrent mix (Ali UDP +
  Tencent UDP + Ali DoH). Existing overrides are preserved and migrated
  transparently (bare IPs gain protocol prefixes; legacy aliapi-only
  entries are rejected with an explicit message).
- New DNS upstream benchmark: the setup wizard's Network & DNS step now
  probes major public resolvers (UDP and IP-direct DoH) plus the local
  gateway/DHCP DNS — three rounds per candidate including an NXDOMAIN
  probe — drops unreachable candidates, and recommends a cross-vendor
  Top3 that can be applied in one click; the recommended mix is now
  "two fastest UDP + one DoH fallback" instead of pure latency ordering,
  so a fast gateway can no longer push the encrypted upstream out of the
  recommendation. The same panel is available on the MosDNS system page
  for re-benchmarking at any time.
- The upstream editor no longer offers the aliapi protocol; secret
  redaction and preservation for stored overrides is unchanged.

#### Engineering fixes

- Update Browserslist, postcss-selector-parser, qs and related lockfile dependencies in the frontend build/CLI toolchain to address reported security advisories.

- Windows cross-compilation of the cloudflareredirect package fixed:
  process-group setup split per platform (Setpgid).
- Fixed intermittent smart-core resource verification test failures caused
  by insufficient mtime granularity on some filesystems.
- Fixed misleading update-check results on development builds (e.g. the
  untagged "0.1.0-dev" from a plain `go build`): the check used to claim
  "already latest" (and the status card even showed "completed") while a
  newer release existed and self-update was merely held back by design.
  It now honestly reports "new version detected; self-update is disabled
  on development builds".
- Hardened PR #13 before integration: GitHub Release metadata never transits
  public mirrors; self-update requires an independently trusted GitHub SHA-256
  digest and re-verifies it before installation. Also fixed `.lan/.local`
  substring overmatching, DNS benchmarks accepting SERVFAIL/REFUSED, custom
  Mihomo secret precedence, viewer writes to global custom CSS, gzip content
  negotiation, and child restart races during shutdown.
- The cycle's primary implementation was contributed by
  [Timeink88](https://github.com/Timeink88) in PR #13; maintainers completed
  the security, compatibility, test, and provenance hardening on that branch.

#### Appearance & skin system

- Fixed preferences being wiped on every restart: session cleanup triggered by token expiry no longer deletes appearance keys; appearance settings now fully synced to backend SQLite.
- Skin system: Amber (warm-white glass) and Classic glass skins, independent of light/dark mode; brand accent color picker with live preview.
- Classic glass (the original MSF blue) remains the default. Selecting Amber now also updates the login page's animated waves from the skin's light/dark palette.
- Color studio: globalized accent (sidebar/segments/chart palette/atmosphere/selection follow the accent), atmosphere hue slider, custom CSS editor with template fill, debounced live preview and undo.

#### GitHub download reliability & tokens

- GitHub Release metadata always comes from the official TLS endpoint. Asset downloads use only an administrator-supplied proxy or accelerator prefix; MSF no longer bundles, automatically probes, ranks, or switches public mirrors. The panel can explicitly test only the configured accelerator without changing routing. Personal tokens remain encrypted at rest, and assets still require a trusted SHA-256 digest.

#### Performance quick wins

- Prefer an OffscreenCanvas worker for wave initialization and rendering, keeping GPU setup off the UI thread and avoiding unrelated renderer extension discovery. Preserve the original shader, skin palette, pixel budgets, visibility pause and static mode; fall back to main-thread rendering when unsupported or startup fails, and retain the static surface without WebGL.

- Improve Mihomo cold loads: separate wave and globe dependencies, preload target route code alongside authentication, and start the persistent background after primary content. Publish proxy nodes before auxiliary requests; defer charts, load globe/rules/providers near the viewport, and fetch full runtime snapshots only when advanced details are opened.

- Tiered static caching: immutable for hashed bundles, one hour for fixed-name assets, index.html always fresh.
- Mihomo default log level info→warning; token/secret query params redacted from msf logs; log rotation tiered by free disk space; default 512MiB soft GOMEMLIMIT (env overridable).
- Dropped never-read response mirrors on /mihomo/rules, /logs/{service}, /mosdns/logs etc. (47%-80% smaller payloads).

#### DNS stability

- Killed the AAAA 5s black hole: with the IPv6 data plane off, AAAA is answered empty immediately instead of querying foreign DNS over blocked direct UDP.
- Replace the aliapi path associated with observed bare-IP query stalls; the domestic defaults mix UDP and IP-direct DoH. Windows search-suffix queries (*.lan/*.local) are rejected locally using domain boundaries, without matching unrelated public names containing similar text.
- Fixed a local DNS-takeover diagnostic false positive when resolv.conf points at the host's own LAN address.

#### Operations infrastructure

- Smart core resources missing or failing verification no longer crash-loop; the panel offers step-by-step recovery, and mihomo restarts with backoff after abnormal exits.
- Auto-generated random secret for the mihomo external controller; gzip middleware (Content-Type allowlist, SSE/WebSocket excluded); copytruncate log rotation; retention pruning for config history/audit logs/update packages; ExecStopPost nft cleanup. See KNOWN_ISSUES.md for the full list.

#### Upgrade notes

- CN UDP direct is enabled by default. If you have custom rules routing a CN
  IP's UDP through the proxy (rare, e.g. a CN relay), turn the toggle off.
- Legacy aliapi-specific upstreams (Ali private DoH API) are no longer
  supported and will be rejected on save; switch them to udp/tcp/tls/https
  servers. Regular public DNS upstreams are unaffected.
- The Mihomo controller (:9090) honors a custom top-level `secret`; when
  absent, MSF generates and stores one for reuse across restarts. An explicit
  `secret: ""` disables Mihomo controller authentication; keeping auth enabled
  is recommended. All three rules are documented in the default config.
  Direct clients can copy the secret from the Mihomo overview page.
  `mihomo_controller_secret` is an internal MSF setting; clearing it alone
  does not remove an existing secret from the YAML. Apply the config or
  restart Mihomo after changes; later regeneration can overwrite manual
  edits to generated files.
- A default 512MiB soft GOMEMLIMIT applies; it is a garbage-collection
  target, not a hard process limit or a guarantee against OOM. Override
  or disable (-1) through the environment variable.
- The domestic defaults are Ali UDP + Tencent UDP + Ali IP-direct DoH;
  existing custom overrides are preserved and remain editable. Mixing
  DoH and plaintext UDP does not encrypt all queries.
- Performance scope: primary-content scheduling and the wave worker reduce
  blocking, with a compatibility fallback when workers are unavailable.
  Globe initialization may still cause long tasks; not all devices are
  guaranteed to be completely jank-free.

## v0.6.3 - 2026-09-06

### 中文

#### 大规模代理页面性能与加载优化

- 精简 Mihomo 代理接口响应，移除重复别名和默认原始响应，并支持 gzip；搜索结果会同步裁剪 provider 节点，减少冷加载传输与解析开销。
- 主界面和各功能页面改为按路由懒加载；EarthRenderer、YamlEditor 等重型模块仅在需要时加载，降低首次进入登录页和管理页面的脚本开销。
- Mihomo 代理节点列表采用视口级内容跳过和分批渲染，减少大量节点同时参与布局、绘制和 React 更新。
- Mihomo 概览中的图表改为接近视口时初始化，连接拓扑更新增加防抖和低优先级调度，连接历史按批次显示，改善持续刷新时的交互流畅度。
- 保留登录页外观质量、场景和用户选择的动态背景设置，默认使用“动态场景 + 平衡”效果档位。

### English

#### Large proxy-page performance and loading improvements

- Reduced Mihomo proxy API responses by removing duplicate aliases and the default raw payload, added gzip support, and filtered provider nodes together with search results to lower cold-load transfer and parsing cost.
- Switched the main shell and feature pages to route-level lazy loading; heavy modules such as EarthRenderer and YamlEditor load only when needed, reducing initial script work.
- Added viewport-aware content skipping and batched rendering for Mihomo proxy nodes so large lists perform less layout, paint, and React work at once.
- Deferred Overview chart initialization near the viewport, debounced and deprioritized connection-topology updates, and batched connection-history rows to keep live refreshes interactive.
- Preserved login appearance, scene, and user-selected dynamic-background settings, with Dynamic scene + Balanced quality as the default.
## v0.6.2 - 2026-08-29

### 中文

#### Mihomo Smart 核心与配置流程完善

- 新增 Meta（官方稳定版）与 Smart（Alpha 核心）选择和切换，初始化页、配置管理、代理分组编辑与组件更新均可识别当前核心。
- Smart 核心支持 `smart` 代理分组编辑，并提供 LightGBM 模型与 ASN 数据的下载进度、取消和状态检查；Meta 核心会拒绝 Smart 专属字段和资源操作。
- 切换核心时先回到默认配置，保留用户配置以及已经下载的另一种核心，后续可直接切换回来；同时补全活动配置校验、启动失败回滚和旧版 Mihomo 二进制路径兼容。
- 修复默认配置修改后无法弹出“保存为用户配置”、Smart 字段保存后丢失、采样率默认值显示异常及设置页已开启拨钮颜色丢失等问题。
- 统一 GitHub 资源下载路径，改进 Smart 资源下载的超时、取消、轮询和摘要校验，减少重复读取与并发请求。
- 代理测速超时现在与前端设置同步，HTTP 链式代理不再被固定的 1500ms 前端等待提前判定为失败。
- 登录页更新公告升级为 v0.6.2 内容，并继续保留“本次关闭”和“不再显示”两种操作。

### English

#### Mihomo Smart core and configuration workflow improvements

- Added Meta (official stable) and Smart (alpha) core selection and switching across setup, configuration management, proxy-group editing, and component updates.
- Added Smart proxy-group editing plus progress, cancellation, and state checks for LightGBM model and ASN data downloads. Meta rejects Smart-only fields and resource operations.
- Core switching now returns to the default configuration while preserving user configurations and both downloaded core binaries, allowing an immediate switch back later. Active-config validation, startup rollback, and legacy Mihomo binary-path compatibility were also added.
- Fixed saving default-config changes as a user configuration, Smart-field round trips, the sample-rate default display, and missing enabled colors on Settings toggles.
- Unified GitHub resource download routing and improved Smart download timeouts, cancellation, polling, and digest validation while reducing repeated reads and overlapping requests.
- Synchronized proxy-test waiting with the configured timeout so HTTP chained proxies are no longer marked failed by a fixed 1500 ms frontend cutoff.
- Refreshed the login announcement for v0.6.2 while retaining separate session-close and permanent-dismiss actions.

## v0.6.1 - 2026-08-25

### 中文

#### AI Agent、动态质量档位与登录更新公告

- 接入首版 AI Agent 管理能力，支持 OpenAI Responses、自定义 Skill 与管理员专属入口。
- 视觉质量的“平衡”和“减少效果”档位继续保留动态背景，通过降低像素预算、DPR、采样和玻璃成本改善性能；新初始化默认使用“动态场景 + 平衡”。
- 用户保存过的场景与质量参数在启动、刷新和升级后保持不变。
- “纯净中性”恢复 v0.4.7.5/v0.4.7.7 的静态背景特效，并同步应用到主页与登录页。
- 登录页增加可按会话关闭或永久隐藏的版本更新公告，介绍 Mihomo 配置恢复和 AI Agent 能力。

### English

#### AI Agent, dynamic quality tiers, and login update announcement

- Added the first AI Agent management experience with OpenAI Responses, custom Skills, and an administrator-only entry point.
- Kept the background animated in the Balanced and Reduced Effects quality tiers while lowering pixel budgets, DPR, sampling, and glass cost; new installations now default to Dynamic scene + Balanced quality.
- Preserved user-selected scene and quality settings across startup, reloads, and upgrades.
- Restored the v0.4.7.5/v0.4.7.7 static background effect for the Neutral scene on both the main shell and login page.
- Added a versioned login update announcement that can be dismissed for the session or permanently hidden, covering Mihomo config recovery and the AI Agent.

## v0.6.0 - 2026-08-23

### 中文

#### 独立界面、来源说明与发布基线

- 全面重做登录、初始化、主框架、导航、MosDNS、Mihomo、日志、配置和设置界面，统一页面标题、响应式布局、背景与动效，并针对长列表、图表和代理页面优化渲染性能。
- 增加 MosDNS 一键本地回环诊断，改善客户端模式选择、规则列表、配置编辑器、日志展示和 Mihomo 页面设置的使用体验。
- 将运行时模板目录从历史命名调整为中性的 `runtime_templates`，移除旧项目名兼容入口、已停用的 Mihomo 旧页面和未使用的第三方图标；保留运行所需的 MosDNS/Mihomo 配置与规则数据。
- 补全双语 README、第三方来源与许可证清单、UI 来源记录和品牌政策；MSF 自有 Mizar Logo 与动效继续作为项目标识，第三方组件和改编代码按各自许可证标注。
- 更新 Mihomo 默认路由与恢复逻辑，并保持 MosDNS、Mihomo、Zashboard 下载来源及摘要验证可审计。
- 将 Mizar 源文件、当前动效、QA 记录和正式导出统一整理到 `logo_motion_mizar/`，删除重复概念稿、旧版动效和过时 UI 验收资料；品牌生成脚本现在同步生成完整 SHA-256 清单。
- 按品牌、合规、Docker 和发布职责重组仓库脚本，删除未接入的前端页面、组件和 Hook，并清除 Go 后端不可达的旧诊断、下载、面板及更新辅助代码。
- 清理前端未使用依赖并显式声明直接依赖，发布候选的 `npm audit` 保持零已知漏洞。
- 本版本从同一个干净的 `main` tag 构建 Linux、Unraid、fnOS、macOS 和 GHCR 镜像；旧项目名兼容入口已经删除，依赖该入口的外部脚本需要改用 `msf` 命令和当前数据目录。

### English

#### Independent UI, provenance, and release baseline

- Reworked the login, setup, application shell, navigation, MosDNS, Mihomo, logs, configuration, and settings interfaces with consistent page headers, responsive layouts, backgrounds, and motion, plus rendering improvements for long lists, charts, and proxy views.
- Added one-shot local-loop MosDNS diagnostics and refined client mode selection, rule lists, configuration editors, log presentation, and persistent Mihomo page preferences.
- Renamed the runtime template directory from its historical name to the neutral `runtime_templates`, removed legacy project-name compatibility entry points, retired Mihomo pages, and unused third-party icons while retaining the MosDNS and Mihomo configuration and rule data required at runtime.
- Expanded the bilingual README, third-party provenance and license notices, UI provenance record, and brand policy. MSF's Mizar logo and motion remain the project identity, while third-party components and adapted code are identified under their respective licenses.
- Refreshed default Mihomo routing and restore behavior while keeping MosDNS, Mihomo, and Zashboard download sources and digest verification auditable.
- Consolidated Mizar source artwork, current motion, QA records, and delivery exports under `logo_motion_mizar/`; removed duplicate concepts, retired motion work, and obsolete UI acceptance material; and made the brand generator refresh the complete SHA-256 manifest.
- Grouped repository scripts by brand, compliance, Docker, and release ownership; removed disconnected frontend pages, components, and hooks; and deleted unreachable legacy diagnostic, download, panel, and update helpers from the Go backend.
- Removed unused frontend dependencies, declared directly imported packages explicitly, and kept the release candidate at zero known `npm audit` vulnerabilities.
- Linux, Unraid, fnOS, macOS, and GHCR artifacts are built from the same clean `main` tag. Legacy project-name compatibility entry points have been removed; external scripts using them must switch to the `msf` command and current data directory.

## v0.5.0 - 2026-08-18

### 中文

#### 公开历史与来源合规清理

- 以当前独立维护的代码建立新的公开基线，停止公开分发旧版本、旧标签及其构建产物。
- 移除不再需要公开分发的历史设计研究材料、第三方页面副本、截图和旧品牌归档；这些材料不再进入源码包或发布产物。
- 审查当前 WebUI、品牌资源、第三方来源与许可证说明，保留 MosDNS、Mihomo、Zashboard 等实际依赖所需的来源和许可信息。
- 本版本不改变 v0.4.7.7 已有的网络、DNS、代理和组件更新行为；版本提升用于建立可审计的干净发布基线。

### English

#### Public-history and provenance cleanup

- Established a new public baseline from the independently maintained current code and stopped publicly distributing previous releases, tags, and their build artifacts.
- Removed obsolete historical design research, third-party page copies, screenshots, and retired brand archives from source archives and release artifacts.
- Reviewed the current WebUI, brand assets, third-party provenance, and license notices while retaining the attribution and license information required by actual MosDNS, Mihomo, and Zashboard dependencies.
- This release does not change the networking, DNS, proxy, or component-update behavior already present in v0.4.7.7; the version change establishes an auditable clean release baseline.

## v0.4.7.7 - 2026-08-17

### 中文

#### Mihomo AMD64 指令集版本选择修复

- 修复 Linux、Unraid 与 Docker 在未启用 AMD64 v3 优化时仍下载 Mihomo 无后缀 v3 二进制的问题；普通 x86_64 CPU 现在明确优先选择官方 `amd64-v1` 资产，避免老 CPU 因不支持 x86-64-v3 指令集而无法启动。
- 启用 AMD64 v3 时明确优先选择 `amd64-v3`，缺失时依次回退到 `amd64-v1` 和无后缀资产；未启用 v3 时仅按 `amd64-v1`、无后缀的顺序选择。回退只在 Release 中不存在首选资产时发生，下载地址或 SHA-256 digest 异常仍会直接报错。

### English

#### Mihomo AMD64 instruction-level selection fixes

- Fixed Linux, Unraid, and Docker downloading Mihomo's unversioned v3 binary even when AMD64 v3 optimization was disabled. Standard x86_64 systems now explicitly prefer the official `amd64-v1` asset, preventing older CPUs without x86-64-v3 support from failing to start Mihomo.
- When AMD64 v3 is enabled, MSF now prefers `amd64-v3` and falls back to `amd64-v1`, then the unversioned asset. Without v3 enabled, it selects `amd64-v1` before the unversioned asset. Fallback occurs only when the preferred asset is absent from the Release; an invalid download URL or SHA-256 digest still fails explicitly.

## v0.4.7.5 - 2026-08-16

### 中文

#### Mihomo 官方更新源修复

- 修复 Linux、Unraid、Docker 与 macOS 的 Mihomo 组件更新错误查询固定镜像 Release 的问题；现在统一查询 `MetaCubeX/mihomo` 官方最新 Release，并按系统架构和 Release 标签选择对应的版本化资产。
- 停止提供已停更的 Alpha 核心选项，现有 Alpha 配置会兼容迁移为 Meta；同时清除旧镜像地址的缓存更新信息，避免继续显示或下载过期来源。
- Mihomo 最新版本改为直接采用官方 Release 标签，并继续要求 GitHub Release 资产提供有效的 SHA-256 digest，确保自动更新来源与下载内容均可验证。

### English

#### Official Mihomo update source fixes

- Fixed Mihomo component updates on Linux, Unraid, Docker, and macOS querying a fixed mirror release. Updates now use the latest official `MetaCubeX/mihomo` release and select the matching versioned asset for the runtime platform, architecture, and release tag.
- Removed the discontinued Alpha core option. Existing Alpha configurations are migrated compatibly to Meta, and cached update metadata from the old mirror is cleared to prevent stale sources from being shown or downloaded.
- Mihomo's latest version now comes directly from the official release tag. Automatic updates continue to require a valid SHA-256 digest supplied by the GitHub Release asset so both the source and downloaded content remain verifiable.

## v0.4.7.4 - 2026-08-15

### 中文

#### Unraid Community Applications 模板修复

- 修复 CA 插件 XML 模板的 `PluginURL` 与发布版 `.plg` 内 `pluginURL` 不一致的问题；两者现在统一使用 `releases/latest/download/msf.plg`，避免插件被 CA 自动列入 blacklist。
- 将 Unraid 插件清单、CA 插件与 Docker 模板以及仓库 Profile 的 Support 入口统一为已公开的 MSF Plugin Support 主题，方便 Unraid 用户集中提交安装、兼容性和使用问题；GitHub Issues 继续用于项目缺陷跟踪。

### English

#### Unraid Community Applications template fixes

- Fixed the CA plugin XML `PluginURL` not matching the `pluginURL` embedded in the released `.plg`. Both now use `releases/latest/download/msf.plg`, preventing CA from automatically blacklisting the plugin for a manifest URL mismatch.
- Unified the Support destination used by the Unraid plugin manifest, CA plugin and Docker templates, and repository profile on the public MSF Plugin Support topic. Unraid users now have one place for installation, compatibility, and usage questions, while GitHub Issues remains available for project defect tracking.

## v0.4.7.3 - 2026-08-14

### 中文

#### MosDNS 文本分流规则修复

- 修复 Loyalsoldier 文本分流规则中 `:@cn` / `:@!cn` 属性被误判为非法域名的问题；MSF 现在会解析属性、验证规则并在落盘前编译为 MosDNS `sd_set_light` 可实际加载的 SRS。
- 修复 MosDNS 规则源更新失败提示仍显示绿色成功图标的问题，失败现在显示红色警告图标。

### English

#### MosDNS text routing rule fixes

- Fixed Loyalsoldier text routing rule attributes such as `:@cn` and `:@!cn` being rejected as invalid domains. MSF now parses the attributes, validates the rules, and compiles them into SRS files that MosDNS `sd_set_light` can load before writing them to disk.
- Fixed failed MosDNS rule-source updates still showing a green success icon. Failed updates now display a red warning icon.

## v0.4.7.2 - 2026-08-13

### 中文

#### 恢复出厂设置优先级与可靠性修复

- 修复 MosDNS 在线分流规则源只接受 SRS 二进制的限制；现在同时支持内容合法的 SRS 和 TXT，并以实际内容而非 URL/文件扩展名判定格式。
- 更新 MosDNS 在线分流的 5 个默认来源：国内加速域名和国外专属域名改用 Loyalsoldier 文本源，中国 IP、中国域名和非中国域名保持 MetaCubeX SRS 源；旧内置 URL 会兼容迁移到新源。
- 合并更新 MosDNS 默认直连与代理规则，保留旧规则并增加新的软件、硬件、游戏、微软与流媒体域名；跨列表冲突按新规则归属去重。
- 恢复出厂设置现在拥有最高操作优先级：发起后会立即接管系统、取消正在执行的可取消写操作，并拒绝新的状态变更请求，不再因其他功能占用而持续显示“正在重置”。
- 重置请求会先以持久化标记落盘，再重新执行当前 MSF 进程；新进程会在恢复任何运行态之前完成清理。即使进程切换或中途异常，重启后也会继续处理该请求，并在连续失败时进入可诊断的安全模式。
- 增加恢复出厂设置状态接口与前端生命周期轮询，界面可持续跟踪请求、执行、失败和完成状态；重置完成后旧登录令牌立即失效，MosDNS 与 Mihomo 不会被旧运行态重新拉起。
- 将后台自更新任务纳入重置接管范围，并把 MSF 二进制与 Zashboard 更新改为暂存后原子替换，避免强制停止期间留下截断的可执行文件或不完整的界面目录。
- 修复 Linux 子进程已退出但尚未回收时被误判为仍在运行的问题，避免恢复出厂设置错误报告组件停止失败。

### English

#### Factory Reset priority and reliability fixes

- Removed the SRS-only restriction from MosDNS online routing sources. Valid SRS and TXT content are now both accepted, with format detection based on actual content instead of the URL or filename extension.
- Updated the five default MosDNS online routing sources: China acceleration and overseas-only domains now use Loyalsoldier text sources, while China IP, China domains, and non-China domains retain MetaCubeX SRS sources. Legacy built-in URLs are migrated compatibly.
- Merged and refreshed the default MosDNS direct and proxy rules, preserving existing entries while adding software, hardware, gaming, Microsoft, and streaming domains. Cross-list conflicts are deduplicated according to the new ownership rules.
- Factory Reset now has the highest operation priority. Once accepted, it takes control immediately, cancels active cancellable writes, and rejects new state-changing requests instead of remaining stuck behind another feature.
- Reset intent is durably recorded before the MSF process re-executes. The replacement process completes cleanup before restoring any runtime state, resumes an interrupted request after restart, and enters a diagnosable safe mode after repeated failures.
- Added a Factory Reset status endpoint and frontend lifecycle polling for requested, running, failed, and completed states. A completed reset invalidates previous login tokens and does not restore the prior MosDNS or Mihomo runtime.
- Brought detached self-update tasks under reset control and changed MSF binary and Zashboard updates to staged atomic replacement, preventing truncated executables or partial UI directories when operations are stopped.
- Fixed Linux child processes that had exited but were not yet reaped being mistaken for live processes, preventing false component-stop failures during Factory Reset.

## v0.4.7.1 - 2026-08-13

### 中文

#### 用户体验修复小版本

- 修复 MosDNS DDNS、直连、拦截、代理、直连 IP 与重定向 IP 等规则列表的格式兼容与运行时热同步；订阅更新后会校验实际运行态，并刷新前置 DNS 缓存，避免文件已更新但规则未生效。
- 统一导入域名规则的 `full`、`domain`、`keyword` 与 `regexp` 格式处理，修复对象或非标准条目进入规则文件后无法匹配的问题。
- 在 DNS 查询日志中增加独立的“查询结果”列，显示实际应答值并去除重复的记录类型与 TTL；保留原表格列宽关系，并修复对象应答显示为 `[object Object]`。
- 新增明确的“清空 DNS 缓存”操作，逐项清理全部七个 MosDNS 运行时缓存并报告具体失败项；原有操作更名为“清空生成规则”，避免误认为会清除 DNS 缓存。
- 清空 DNS 缓存不会删除规则、订阅、配置、自动生成规则或 Mihomo Fake-IP 数据库；相关操作增加独立确认提示和重复点击保护。

### English

#### User experience maintenance release

- Fixed format compatibility and runtime hot synchronization for MosDNS DDNS, direct, block, proxy, direct-IP, and redirect-IP rule lists. Subscription updates now validate the live runtime state and flush front DNS caches so updated files take effect immediately.
- Unified imported domain-rule handling for `full`, `domain`, `keyword`, and `regexp` entries, preventing object-shaped or nonstandard values from becoming ineffective rules.
- Added a dedicated DNS answer column to the query log, showing only response values without redundant record types or TTLs. The original table proportions are preserved, and object answers no longer render as `[object Object]`.
- Added an explicit “Clear DNS Cache” action that flushes all seven MosDNS runtime caches and reports individual failures. The previous action is now named “Clear Generated Rules” to avoid implying that it clears DNS caches.
- Clearing DNS caches does not delete rules, subscriptions, configuration, generated routing rules, or the Mihomo Fake-IP database. Both destructive actions now have distinct confirmations and duplicate-click protection.

## v0.4.7 - 2026-08-13

### 中文

#### 稳定性与配置安全更新

- 修复 Mihomo 代理组结构化编辑可能把 Controller 运行时展开的订阅节点写入静态配置的问题。保存前现在会检查代理组引用，并调用 Mihomo 核心测试候选配置；无效配置会在写入或重启前被拦截并返回实际错误。
- 修复服务替换期间旧进程退出可能删除新进程 PID 文件或清除新进程状态的问题。启动失败提示现在只读取本次启动新增的标准输出和错误日志，避免旧日志干扰判断。
- 为 MosDNS 增加安全的 ALIAPI 上游凭据编辑，支持账户 ID、Access Key、服务器地址和 ECS Mask 校验；Secret 不通过 API 回显，编辑时留空可保留原值，凭据文件权限限制为 `0600`。
- 修复 Mihomo TProxy 与 Redirect 端口健康检查误报和回环告警：透明代理端口改为读取系统监听表并核对服务进程，不再主动连接端口进行探测。
- 将默认测速和 Provider 健康检查地址统一为 `https://www.gstatic.com/generate_204`；结构化写回 Mihomo 配置时保持默认模板顺序，并始终把 `proxy-providers` 放在顶层配置末尾。

### English

#### Stability and configuration safety update

- Fixed structured Mihomo proxy-group editing accidentally persisting subscription nodes expanded by the Controller into static configuration. Group references are now checked and candidate configurations are tested by the Mihomo core before any write or restart, with real validation errors returned to the user.
- Fixed a replaced service process losing its PID file or managed state when the previous process exited. Startup failures now report only stdout and stderr produced by the current attempt, preventing stale logs from masking the cause.
- Added secure MosDNS ALIAPI upstream credential editing with validation for account ID, access keys, server address, and ECS mask. Secrets are never returned by the API, an empty edit preserves the stored value, and the credential file is restricted to mode `0600`.
- Fixed false Mihomo TProxy and Redirect health results and loopback warnings. Transparent proxy ports are now verified from the system listener table and managed process identity instead of being actively connected to.
- Standardized default latency tests and Provider health checks on `https://www.gstatic.com/generate_204`. Structured Mihomo writes now follow the default template order and always emit `proxy-providers` as the final top-level section.

## v0.4.6 - 2026-08-11

### 中文

#### 用户体验小更新

- 修复 Mihomo 订阅 Provider 未填写“本地路径”时把空路径写入配置的问题。现在会根据 Provider 名称自动生成 `./proxy_providers/<名称>.yaml`，避免 Mihomo 回退到 `proxies/` 目录并产生不透明的缓存文件名；自定义相对路径仍会原样保留。
- Provider 编辑器会随名称实时提示建议保存路径，并明确说明路径可以留空自动生成。旧版本用户升级后，可重新添加订阅，或把已有 Provider 的本地路径手动改为 `./proxy_providers/<名称>.yaml` 后保存并更新订阅。
- 重构通用配置与 MosDNS 服务配置的文件索引：显示真实数据目录和文件数量，支持逐级展开、收起及一键展开/收起全部目录，并完整展示深层配置文件；Mihomo 运行时配置继续可见但保持只读，避免误改生成文件。
- 恢复 MosDNS 客户端列表的拖动操作，并增加半透明拖动条幅反馈，让移动目标和落点在拖动过程中保持清晰可见。

### English

#### User experience update

- Fixed Mihomo subscription Providers persisting an empty local path. A blank path now becomes `./proxy_providers/<provider-name>.yaml`, preventing Mihomo from falling back to opaque cache filenames under `proxies/`; explicitly configured relative paths remain unchanged.
- Added a live suggested-path placeholder and guidance to the Provider editor. Existing users can re-add a subscription after upgrading or edit its local path to `./proxy_providers/<provider-name>.yaml`, then save and update the Provider.
- Reworked the general and MosDNS configuration indexes into complete collapsible directory trees with resolved data roots, file counts, deep-file visibility, and expand/collapse-all controls. The generated Mihomo runtime configuration remains visible but read-only.
- Restored MosDNS client drag-and-drop and added a translucent drag banner so the moving item and destination remain visible throughout the interaction.

## v0.4.5 - 2026-08-10

### 中文

#### 用户体验小更新

- 修复 Mihomo 代理节点卡片只能点击名称切换的问题，现在整张卡片均可选择节点，并保留延迟测试按钮的独立操作。
- 恢复完整英文模式，语言选择会同步保存到外观设置，并在页面跳转、刷新和重新登录后继续生效。
- 修复 MosDNS 在线路由与广告拦截规则显示固定旧日期的问题，更新时间现在取自实际安装的本地规则文件。
- 修复 3 个已失效的内置路由规则订阅地址；单条或批量更新失败时，界面会准确显示失败状态及对应规则源，不再误报更新成功。

### English

#### User experience update

- Fixed Mihomo proxy selection so the entire node card is clickable while keeping latency tests as a separate action.
- Restored complete English mode with language preferences persisted across navigation, reloads, and new sessions.
- Fixed MosDNS routing and ad-blocking sources showing a stale hard-coded date; timestamps now reflect the installed local rule files.
- Repaired three obsolete built-in routing subscription URLs and made single or batch update failures identify the affected rule sources instead of reporting false success.

## v0.4.4 - 2026-08-10

### 中文

> 赠言：事事如意，事事顺遂

#### 说明

- v0.4.4 集中升级仪表盘、Mihomo 管理与实时可观测能力，并统一桌面、分屏和移动端的页面起点、图表布局与 Liquid Glass 内容层级。
- Linux、Unraid、fnOS、macOS 与 Docker 继续从 `main` 的同一个干净 tag 构建；GitHub Release 发布完整安装资产及 SHA-256 文件，GHCR 同时发布 `v0.4.4` 与 `latest` 多架构镜像。
- macOS App 仍为未使用 Apple Developer ID 签名或公证的 TUN-only Beta，首次打开需要用户手动允许。

#### 仪表盘与图表

- 新增可组合仪表盘网格、组件选择器、集合切换、拖动缩放、持久化布局和错误隔离，补齐系统、MosDNS、Mihomo 的实时、统计与控制组件。
- 重构系统资源、主机速率、MosDNS 查询和 Mihomo 连接图的数据采样与时间窗口，稳定 ECharts 生命周期、实时曲线和半宽卡片布局。
- 统一所有实时图表的时间选择器为等宽六段控件，在桌面双列与移动端均保留安全边距，避免图例、选择栏和卡片外框互相遮挡。

#### Mihomo

- Mihomo UI 重构（包括概览页面）借鉴并复用了 [Zephyruso/zashboard](https://github.com/Zephyruso/zashboard) 的部分源码与交互设计，特此感谢原作者的无私开源。
- 重建 Mihomo 概览与连接可观测界面，新增全球连接地球、实时流量、连接历史、延迟、拓扑、规则命中和 Provider 流量等视图。
- 重构代理节点与规则管理，增加配置权威状态、Provider 与手动节点编辑、测速计划、渐进加载、搜索排序、运行规则详情和 YAML 安全处理。
- 补齐后端代理与规则运行时接口、配置规范化、事务式保存和测试覆盖，并优化连接详情在桌面、平板与移动端的响应式布局。

#### MosDNS、系统与发布

- 新增 MosDNS 客户端和规则变更的运行时热同步，修复状态页版本展示，并统一服务管理页面与内容面板材质。
- 统一所有页面的桌面起始高度，修复帮助文档导航、图表底栏和内容边界细节；安装文档改为跟随 Latest Release 或版本通配符。
- 强化 Unraid 资产校验、更新清单生成和发布后自动同步，插件清单改为跟随 Latest Release，Docker CA 模板继续使用多架构 `latest` 镜像。

### English

> Release wish: 事事如意，事事顺遂

#### Notes

- v0.4.4 is a focused upgrade to the dashboard, Mihomo management, and real-time observability, with consistent page offsets, chart layouts, and Liquid Glass content hierarchy across desktop, split-screen, and mobile views.
- Linux, Unraid, fnOS, macOS, and Docker are built from the same clean tag on `main`. GitHub Release publishes the complete install assets and SHA-256 files, while GHCR publishes multi-architecture `v0.4.4` and `latest` images.
- The macOS app remains an unsigned and unnotarized TUN-only Beta. Users must explicitly allow its first launch.

#### Dashboard and charts

- Added a composable dashboard grid with widget selection, collections, drag-and-resize editing, persistent layouts, error isolation, and system, MosDNS, and Mihomo monitoring and control widgets.
- Reworked sampling and time windows for system resources, host rates, MosDNS queries, and Mihomo connections while stabilizing ECharts lifecycles, live curves, and half-width card layouts.
- Standardized every live-chart time selector as an equal-width six-segment control with safe desktop and mobile insets so legends, selectors, and card frames no longer overlap or clip.

#### Mihomo

- Parts of the Mihomo UI refactor, including the overview page, reference and reuse source code and interaction design from [Zephyruso/zashboard](https://github.com/Zephyruso/zashboard). Special thanks to the original author for generously sharing the project as open source.
- Rebuilt Mihomo overview and connection observability with a global connection globe, live traffic, connection history, latency, topology, rule-hit, and provider-traffic views.
- Refactored proxy and rule management with configuration authority state, provider and manual-node editing, speed-test planning, progressive loading, search and ordering, runtime rule details, and YAML safety.
- Added backend proxy and rule runtime APIs, normalization, transactional persistence, and test coverage, and refined connection details across desktop, tablet, and mobile layouts.

#### MosDNS, system, and release engineering

- Added runtime hot synchronization for MosDNS client and rule changes, fixed status-page version reporting, and unified service-management pages and content materials.
- Standardized desktop page offsets, fixed README help navigation, chart footers, and content boundaries, and changed installation documentation to Latest Release links or version wildcards.
- Hardened Unraid asset verification, manifest generation, and post-release synchronization. The plugin follows Latest Release while the Docker CA template continues to use the multi-architecture `latest` image.

## v0.4.3 - 2026-08-07

### 中文

#### 说明

- v0.4.3 是针对 v0.4.2 的 MosDNS 主查询链路和 Web 会话路由修复版：恢复 IPv4/IPv6 优先策略，保留真实客户端 IP，并移除未使用的 `127.0.0.1:5656` 回环入口。
- Linux、Unraid、fnOS、macOS 与 Docker 继续从 `main` 上同一个干净 tag 构建；GitHub Release 提供 20 个安装产物及 SHA-256 文件，GHCR 同时发布 `v0.4.3` 和 `latest` 多架构镜像。
- macOS App 仍为未使用 Apple Developer ID 签名或公证的 TUN-only Beta，首次打开需要用户手动允许。

#### MosDNS

- MosDNS 组件更新源切换为 `yyysuo/mosdns` 正式 Release，支持 `v5-ph-srs-*` 版本标签、架构资产选择和 GitHub SHA-256 digest 验证。
- 修复 v0.4.2 将客户端 `:53` 查询经 `sequence_client` 二次转发到 `127.0.0.1:5656`，导致 MosDNS `client_ip` 只能看到回环地址的问题。UDP/TCP `:53` 现在直接进入 `sequence_6666`。
- 恢复 `prefer_ipv4` / `prefer_ipv6` 在主分流序列内执行，保留自动、IPv4 优先和 IPv6 优先完整功能，并调整执行顺序，避免 DDNS、客户端直连和真实 AAAA 兜底提前退出而绕过优先策略。
- 为客户端 UDP `:53` 显式启用新内核 `fast_accel` 落点，并删除未被 include 或正式 sequence 使用的 `forward_2.yaml`、`forward_all_in`、`udp_main/tcp_main` 和 5656 端口。
- 新增启动兼容迁移，自动备份并清理 v0.4.2 旧入口配置，同时将 IPv4/IPv6 优先规则恢复到正确位置。

#### WebUI 与认证

- 修复 Token 缺失、过期或无效时被误判为系统未初始化并跳转 `/setup` 的问题；已初始化系统现在正确进入 `/login`，初始化状态检查失败时显示可重试错误页。
- 新增认证路由 E2E 覆盖，保留登录前的安全站内路径，登录后可返回原页面。
- 统一设置、规则、客户端、上游 DNS、Mihomo 配置与节点页面的视口级弹窗容器，避免弹窗被页面布局、滚动区域或移动端视口截断。

### English

#### Notes

- v0.4.3 is a corrective release for the MosDNS primary query path and Web session routing introduced around v0.4.2. It restores IPv4/IPv6 preference handling, preserves the real client address, and removes the unused `127.0.0.1:5656` loopback entry.
- Linux, Unraid, fnOS, macOS, and Docker continue to be built from one clean tag on `main`. GitHub Release publishes 20 installation and SHA-256 assets, while GHCR publishes the multi-architecture `v0.4.3` and `latest` images.
- The macOS app remains an unsigned and unnotarized TUN-only Beta. Users must explicitly allow its first launch.

#### MosDNS

- Switched MosDNS component updates to official `yyysuo/mosdns` releases, including `v5-ph-srs-*` version parsing, architecture-specific asset selection, and GitHub SHA-256 digest validation.
- Fixed the v0.4.2 client path that sent `:53` through `sequence_client` and a second UDP query to `127.0.0.1:5656`, which replaced the original client address before `client_ip` matching. UDP and TCP `:53` now enter `sequence_6666` directly.
- Restored `prefer_ipv4` / `prefer_ipv6` inside the primary sequence, preserving automatic, IPv4-preferred, and IPv6-preferred behavior. Execution order now prevents DDNS, client-direct, and real-AAAA fallback branches from bypassing address preference.
- Marked client-facing UDP `:53` as the explicit `fast_accel` landing point and removed the unused `forward_2.yaml`, `forward_all_in`, `udp_main/tcp_main`, and port 5656 definitions.
- Added startup migration that backs up and repairs v0.4.2-generated configurations, restores inline preference rules, and removes obsolete loopback entries and files.

#### WebUI and authentication

- Fixed missing, expired, or invalid tokens being mistaken for an uninitialized system and redirected to `/setup`. Initialized installations now correctly redirect to `/login`, while initialization-check failures show a retryable error state.
- Added authentication-routing E2E coverage and safe return-to-page behavior after login.
- Unified viewport-level modal containers across settings, rules, clients, upstream DNS, Mihomo configuration, and proxy pages so dialogs are not clipped by page layout, scroll containers, or mobile viewports.

## v0.4.2 - 2026-08-03

### 中文

#### 说明

- v0.4.2 完成 IPv6、FakeIPv6 与 MosDNS 配置链路的端到端修复，使 WebUI、数据库、Mihomo、MosDNS、nftables、TUN、策略路由与 Docker host-tun 使用一致的启用状态和 FakeIP 网段。
- Linux、Unraid、fnOS、macOS 与 Docker 继续从 `main` 上同一个干净 tag 构建。GitHub Release 提供与 v0.4.1 一致的 20 个安装资产及 SHA-256 文件，GHCR 同时发布 `v0.4.2` 与 `latest` 多架构镜像。
- macOS App 仍为未使用 Apple Developer ID 签名或公证的 TUN-only Beta；首次打开需要用户手动允许。

#### 新增

- 新增统一的 IPv4/IPv6 FakeIP CIDR 规范化、地址族校验和运行配置一致性检查，自定义 FakeIPv6 网段可确定性写入 Mihomo、MosDNS、network.yaml、nftables、TUN 与 Docker 路由。
- 新增 MosDNS 托管配置渲染，支持 ECS 与上游覆盖写入实际运行 YAML，并明确区分 IPv6 主开关、阻止 AAAA、自动、IPv4 优先和 IPv6 优先策略。
- 新增 DNS fixture、IPv6 设置 E2E 脚本和后端完整性测试，覆盖 partial save、FakeIP cache 回退、IPv6 路由清理、A/AAAA 策略以及 generated/custom 配置一致性。

#### 修复

- 修复关闭 IPv6 后仍残留 IPv6 nftables、TUN、fwmark rule 或 table 100 local route，以及 FakeIPv6 网段在不同组件之间不一致的问题。
- 修复设置和初始化接口遗漏字段时重置 FakeIP 网段、订阅、节点或其他配置的问题；配置变更现在串行执行，并在生成、缓存处理、网络应用或服务重启失败时安全回滚。
- 修复 Mihomo controller 不支持 FakeIP cache 热清理时阻止网段切换的问题，增加停服重建缓存的事务式回退；同时修正系统设置中的 IPv6 状态说明与相关交互反馈。
- 修复 MosDNS 规则编辑弹窗受页面布局影响而无法稳定居中于视口的问题。

#### 文档

- 补充 IPv6 数据面控制、AAAA 直连风险、FakeIP 网段切换与 MosDNS 协议优先级说明，并保留完整实施和验证计划。
- README 改用透明背景的 Mizar 动态 Logo，改善浅色与深色页面中的展示效果。

### English

#### Notes

- v0.4.2 completes the end-to-end IPv6, FakeIPv6, and MosDNS configuration flow so the WebUI, database, Mihomo, MosDNS, nftables, TUN, policy routing, and Docker host-tun share one effective state and FakeIP prefix set.
- Linux, Unraid, fnOS, macOS, and Docker continue to be built from one clean tag on `main`. GitHub Release provides the same 20 installation and SHA-256 assets as v0.4.1, while GHCR publishes the multi-architecture `v0.4.2` and `latest` images.
- The macOS app remains an unsigned and unnotarized TUN-only Beta. Users must explicitly allow its first launch.

#### Added

- Added shared IPv4/IPv6 FakeIP CIDR normalization, address-family validation, and runtime consistency checks. Custom FakeIPv6 prefixes are now rendered deterministically across Mihomo, MosDNS, network.yaml, nftables, TUN, and Docker routes.
- Added managed MosDNS rendering for ECS and upstream overrides, with explicit separation between the main IPv6 switch, AAAA blocking, automatic selection, IPv4 preference, and IPv6 preference.
- Added DNS fixtures, an IPv6 settings E2E script, and backend coverage for partial saves, FakeIP cache fallback, IPv6 route cleanup, A/AAAA policy, and generated/custom configuration consistency.

#### Fixed

- Fixed stale IPv6 nftables, TUN, fwmark rules, and table 100 local routes remaining after IPv6 was disabled, along with mismatched FakeIPv6 prefixes between runtime components.
- Fixed settings and setup requests resetting FakeIP prefixes, subscriptions, nodes, or other omitted fields. Configuration mutations are now serialized and safely rolled back when generation, cache handling, network application, or service restart fails.
- Fixed FakeIPv6 prefix changes being blocked when the Mihomo controller lacks hot FakeIP-cache deletion by adding a transactional stopped-service cache rebuild fallback. Also corrected IPv6 state descriptions and related interaction feedback in system settings.
- Fixed MosDNS rule editor dialogs being positioned by page layout instead of remaining centered in the viewport.

#### Documentation

- Documented IPv6 data-plane controls, real-AAAA bypass risk, FakeIP prefix changes, and MosDNS protocol preference behavior, together with the complete implementation and validation plans.
- Updated the README to use the transparent animated Mizar logo for improved presentation on light and dark surfaces.

## v0.4.1 - 2026-08-02

### 中文

#### 说明

- v0.4.1 是一次以 WebUI 视觉重构和项目品牌更新为主的版本；本版本不包含其他 session 中尚未完成的 IPv6 修复，网络与 IPv6 行为继续保持 v0.4.0 的实现。
- Linux、Unraid、fnOS、macOS 与 Docker 继续从 `main` 上同一个干净 tag 构建。GitHub Release 提供 20 个安装资产及 SHA-256 文件，GHCR 同时发布 `v0.4.1` 与 `latest` 多架构镜像。
- macOS App 仍为未使用 Apple Developer ID 签名或公证的 Beta，只提供 TUN 模式；首次打开需要用户手动允许。

#### UI

- WebUI 改用独立设计的 Gary Liquid Glass 视觉体系，重构应用外壳、侧边栏、移动导航、页头、仪表盘、MosDNS 概览、系统设置、登录与初始化等主要界面。
- 新增统一的玻璃材质、折射滤镜、场景背景、按钮、表单、分段控制器、对话框和实体内容板组件，并统一透明度、间距、圆角、层级、动效和响应式行为。
- 优化仪表盘卡片、导航状态、设置操作区和实用工具页面的信息层级与交互反馈，同时保留原有业务能力和操作路径。

#### 品牌

- 将项目 Logo 重构为全新的 Mizar 丝带交织标识，并统一替换 WebUI、登录动画、favicon、PWA 图标、macOS AppIcon、Unraid 图标、README 与安装资产中的品牌图形。
- 新增可复用的 SVG、透明 PNG、应用图标、favicon、动效预览和 SHA-256 清单，并统一使用当前 Mizar 品牌资源。
- 补充项目免责声明与使用边界说明，进一步明确本项目为独立开源实现，与其他项目不存在官方隶属、授权或背书关系。

#### 修复

- 修复 macOS `MSF.app` 发布包缺少应用图标的问题；加入完整的 `AppIcon` 资源集，并在 Release 验证中强制检查 `AppIcon.icns`、Asset Catalog 和 `CFBundleIconName`，避免无图标构建再次进入发布资产。
- 将 macOS AppIcon 调整为规范的圆角方形图标，使用透明外角、统一安全边距和适合 macOS 桌面的浅色背景，并在本版本统一切换为新的 Mizar 标识。

### English

#### Notes

- v0.4.1 focuses on the WebUI redesign and the new project identity. It intentionally excludes the unfinished IPv6 work from another session, so network and IPv6 behavior remain aligned with v0.4.0.
- Linux, Unraid, fnOS, macOS, and Docker continue to be built from one clean tag on `main`. GitHub Release provides 20 installation and SHA-256 assets, while GHCR publishes the multi-architecture `v0.4.1` and `latest` images.
- The macOS app remains an unsigned and unnotarized TUN-only Beta. Users must explicitly allow its first launch.

#### UI

- Introduced an independently designed Gary Liquid Glass visual system across the app shell, sidebar, mobile navigation, page headers, dashboard, MosDNS overview, settings, login, and setup surfaces.
- Added shared glass materials, refraction filters, scene backdrops, buttons, fields, segmented controls, dialogs, and solid content plates, with consistent transparency, spacing, radii, layering, motion, and responsive behavior.
- Improved information hierarchy and interaction feedback throughout dashboard cards, navigation states, settings actions, and utility pages while preserving existing product capabilities and workflows.

#### Brand

- Rebuilt the project identity around the new Mizar orbit-weave ribbon mark and rolled it out to the WebUI, login motion, favicons, PWA icons, macOS AppIcon, Unraid artwork, READMEs, and packaged assets.
- Added reusable SVG, transparent PNG, app-icon, favicon, motion-preview, and SHA-256 asset sets for the current Mizar identity.
- Added a fuller disclaimer and usage-boundary documentation to make clear that this is an independent open-source implementation with no official affiliation, authorization, or endorsement from other projects.

#### Fixed

- Fixed the missing application icon in macOS `MSF.app` release bundles. Added the complete `AppIcon` asset set and release checks for `AppIcon.icns`, the compiled asset catalog, and `CFBundleIconName` so iconless builds cannot be packaged again.
- Refined the macOS AppIcon into a standard rounded-square icon with transparent outer corners, consistent safe-area spacing, and a macOS-appropriate light background, then updated it to the new Mizar mark for this release.

## v0.4.0 - 2026-07-29

### 中文

#### 说明

- v0.4.0 首次加入 macOS 15–26 菜单栏 App 支持；macOS App 第一版为 Beta，仅提供 TUN 模式，不提供系统代理模式，有问题请及时反馈。
- 本版本从 `main` 的同一个干净 tag 构建 Linux、Unraid、fnOS、macOS 与 Docker；GitHub Release 增加名称带 `-unsigned` 的 Universal 2 DMG/ZIP 及 SHA-256。首个 macOS Beta 未使用 Apple Developer ID 或公证，首次打开需要用户手动允许。

#### 新增

- 新增原生 SwiftUI Universal 2 菜单栏 App，覆盖 Apple Silicon 与 Intel，支持启动、LAN 直连保活停止、重启、完全停止、打开网页管理页和实时上下行速度。
- 新增 root LaunchDaemon 和统一 Network Runtime API；未签名 Beta 通过管理员授权的 legacy Installer 安装到 `/Library`，默认不调用 `SMAppService`。macOS 启用时保存并恢复网络服务 DNS 与原始 IPv4 转发状态，允许系统动态分配 `utunN`，并验证 DNS、Fake-IP 路由和 IPv4 转发状态。
- 组件下载增加 Mihomo 官方 Darwin 资产、带有必需扩展插件的 MosDNS Darwin 资产、GitHub SHA-256 digest 和 Mach-O 架构校验；Web 初始化与系统设置在 macOS 下强制 TUN 并隐藏 nftables。

#### 修复

- 修复 macOS Keychain 在缺少 Data Protection entitlement 时无法保存 `operate` Token 的问题；管理员密码只用于当前登录，不会保存。
- 修复 macOS provider 订阅下载更新，以及仪表盘硬件信息、系统资源、实时速率、运行时间、MosDNS/Mihomo 状态与运行统计兼容问题。
- 修复 MosDNS 可观测性解析把时间戳、端口和规则文件名误算为查询域名的问题。

### English

#### Notes

- v0.4.0 introduces the macOS 15–26 menu bar app. The first macOS release is Beta, supports TUN only, does not provide system-proxy mode, and users are encouraged to report problems promptly.
- Linux, Unraid, fnOS, macOS, and Docker are built from the same clean tag on `main`. GitHub Release includes Universal 2 DMG/ZIP assets named with `-unsigned` plus SHA-256 files. The first macOS Beta is not Developer ID signed or notarized, so users must explicitly allow the first launch.

#### Added

- Added a native SwiftUI Universal 2 menu bar app for Apple Silicon and Intel with start, LAN-safe direct stop, restart, full stop, WebUI access, and live upload/download speed.
- Added a root LaunchDaemon and unified Network Runtime API. The unsigned Beta installs it into `/Library` through an administrator-authorized legacy installer and does not call `SMAppService` by default. macOS activation snapshots and restores network-service DNS and the original IPv4 forwarding value, lets the system allocate `utunN`, and validates DNS, Fake-IP routing, and forwarding readiness.
- Component downloads now use official Mihomo Darwin assets and MosDNS Darwin builds with the required extension plugins, GitHub SHA-256 digests, and Mach-O architecture validation. Web setup/settings force TUN and hide nftables on macOS.

#### Fixed

- Fixed `operate` Token storage when the Data Protection Keychain entitlement is unavailable. Administrator passwords are only used for the current login and are never stored.
- Fixed macOS provider updates and dashboard compatibility for hardware, resources, live traffic, uptime, and MosDNS/Mihomo status and runtime statistics.
- Fixed MosDNS observability parsing that could count timestamps, ports, and rule filenames as queried domains.

## v0.3.9.5 - 2026-07-20

### 中文

#### 说明

- 这是一次 Factory Reset 与全平台 TUN 一致性修复发布，重点解决 nftables 模式重置后重新选择 TUN，但旧用户数据、配置引用或网络状态仍让 Mihomo 保持 nftables 配置的问题。
- 本版本发布 16 个 GitHub Release assets：Linux amd64/arm64 tarball 及旧名称兼容副本、Unraid `.txz`/`.plg`、fnOS x86/arm `.fpk`，每个安装资产同时提供 `.sha256`。
- Docker 镜像以 `ghcr.io/scoltzero/msf:v0.3.9.5` 与 `latest` 发布；Docker 正式收口为 TUN-only，只支持 `host-tun` 与 `macvlan-tun`。
- Linux、Unraid、fnOS 与 Docker 统一从同一个干净 tag checkout 构建；二进制和镜像嵌入源码 commit，发布门禁会拒绝 dirty 构建、来源不一致和摘要错误的资产。

#### 修复

- “重置系统”升级为真正的 factory reset：验证当前管理员密码，停止 MosDNS/Mihomo，清理 `table inet msf`、IPv4/IPv6 fwmark rule 与 table 100 路由，并事务性清空用户、JWT/refresh/API token、审计、设置、配置历史、MosDNS 状态、更新状态、provider、备份、日志和下载缓存。
- 重置默认保留 MosDNS、Mihomo 与 Zashboard；勾选“删除组件”后会一并删除。重置过程使用原子 trash、恢复 marker、数据库事务和新 JWT secret，服务停止、文件或数据库失败时不会留下半重置状态。
- 重置成功后 WebUI 清除全部 `msf*` local/session storage，并使用硬跳转进入 `/setup`，避免旧 React/Auth 状态继续使用已失效令牌。
- 初始化强制使用 generated Mihomo 配置并清除 custom/applied 引用；TUN 与 nftables 的数据库、`network.yaml`、Mihomo YAML、`network.nft` 和 desired state 必须一致，否则禁止激活服务。generated 漂移会自动修复一次，custom 冲突会明确报错。
- TUN 配置固定启用 `tun.enable=true`、`stack=system`、route address/exclude 与 `dns.proxy-server-nameserver`，并移除 `redir-port`、`tproxy-port`、`routing-mark` 和 `network.nft`；nftables 配置则强制相反的不变量。
- Docker 正式收口为 TUN-only：前端隐藏 nftables，后端拒绝 nft 请求，启动恢复永不恢复 nftables；预检增加 `/dev/net/tun`、root、`CAP_NET_ADMIN`、`CAP_NET_RAW` 和 `host-tun` / `macvlan-tun` 检查。
- 启动期兼容迁移覆盖 v0.1.x–v0.3.6 generated 配置重建、v0.3.7 旧 TUN/DNS block 升级，以及 v0.3.8–v0.3.9.3 数据库与运行 YAML 漂移检测；真实 custom 配置不会被自动覆盖，但冲突会阻止错误网络规则恢复。

#### 受影响用户

- 从 v0.1.x 至 v0.3.9.3 升级、曾在 nftables/TUN 间切换、执行过“重置系统”或存在 generated 配置漂移的用户都应升级；升级后无需重写历史 Release 资产。
- 使用真实自定义 Mihomo 配置的用户不会被自动覆盖；如果配置与目标代理模式冲突，系统会明确阻止激活或切换，并要求恢复默认配置或手工修正。
- Linux、Unraid 与 fnOS 均支持 nftables 和 TUN；Docker 用户必须提供 `/dev/net/tun`、`CAP_NET_ADMIN`、`CAP_NET_RAW` 以及受支持的网络模式。

### English

#### Notes

- This release fixes Factory Reset and cross-platform TUN consistency, especially the case where a user resets an nftables installation, selects TUN during reinitialization, but stale user data, config references, or network state keep Mihomo in nftables mode.
- It publishes 16 GitHub Release assets: Linux amd64/arm64 tarballs plus legacy-name compatibility copies, Unraid `.txz`/`.plg`, and fnOS x86/arm `.fpk` packages, each with a matching `.sha256`.
- Docker is published as `ghcr.io/scoltzero/msf:v0.3.9.5` and `latest`. Docker is now TUN-only and supports the `host-tun` and `macvlan-tun` modes.
- Linux, Unraid, fnOS, and Docker are built from the same clean tagged checkout. Binaries and images embed the source commit, and release gates reject dirty builds, provenance mismatches, and invalid asset digests.

#### Fixed

- “Reset system” is now a real factory reset. It verifies the current admin password, stops MosDNS/Mihomo, clears the `inet msf` table plus IPv4/IPv6 fwmark rules and table 100 routes, and transactionally removes users, JWT/refresh/API tokens, audits, settings, histories, MosDNS state, update state, providers, backups, logs, and download caches.
- Components and Zashboard are retained by default and removed only when explicitly selected. Atomic trash staging, a recovery marker, a database transaction, and JWT-secret rotation prevent partial reset states.
- Setup always re-enters generated Mihomo mode. Database intent, `network.yaml`, Mihomo YAML, `network.nft`, and runtime desired state must satisfy the complete TUN/nftables invariants before activation. Generated drift is repaired once; custom-config conflicts are reported and blocked.
- Docker is now TUN-only. The UI hides nftables, the API rejects Docker nft requests, runtime restore never restores nftables, and preflight validates `/dev/net/tun`, root, `CAP_NET_ADMIN`, `CAP_NET_RAW`, and the `host-tun` / `macvlan-tun` mode.
- Startup compatibility migration rebuilds v0.1.x–v0.3.6 generated configs, upgrades the v0.3.7 TUN/DNS block, and detects database/runtime-YAML drift from v0.3.8 through v0.3.9.3. Genuine custom configs are not overwritten, but conflicts block incorrect network-rule restoration.

#### Affected Users

- Users upgrading from v0.1.x through v0.3.9.3, switching between nftables and TUN, using “Reset system,” or carrying generated-config drift should upgrade. Historical Release assets remain immutable.
- Genuine custom Mihomo configs are never silently overwritten. If one conflicts with the target proxy mode, activation or mode switching is blocked until the generated config is restored or the custom YAML is corrected manually.
- Linux, Unraid, and fnOS support both nftables and TUN. Docker requires `/dev/net/tun`, `CAP_NET_ADMIN`, `CAP_NET_RAW`, and a supported Docker network mode.

## v0.3.9.3 - 2026-07-18

### 中文

#### 说明

- 这是一次 Mihomo `v1.19.28` REST API 兼容性修复发布。该核心版本恢复原 Clash 行为，不再把代理供应商节点合并到 `/proxies`。
- 本版本继续发布 12 个 GitHub Release assets：Linux amd64/arm64 tarball、Unraid `.txz`/`.plg`，以及 fnOS x86/arm `.fpk`，每个安装资产同时提供 `.sha256`。
- Docker 镜像额外以 `ghcr.io/scoltzero/msf:v0.3.9.3` 发布，不推送 `latest`。

#### 修复

- 代理节点运行时数据现在同时聚合 Mihomo `/proxies` 与 `/providers/proxies`：非 `Compatible` 供应商的 `proxies[]` 会补入 MSF 节点表，恢复代理组内 provider 节点、类型、存活状态与延迟显示。
- 保持旧核心兼容：如果节点已经由 `/proxies` 返回，MSF 保留该运行时对象，不重复覆盖；`Compatible` 伪供应商中的代理组条目不会被错误当作独立节点。
- 补充回归测试，覆盖 Mihomo `v1.19.27` 及更早版本的合并式接口，以及 `v1.19.28` 起拆分 provider 节点的接口结构。

#### 受影响用户

- 使用 MSF `v0.3.9.2` 并将 Mihomo 更新到 `v1.19.28` 的用户，代理转发和订阅本身仍可工作，但 MSF 自带代理页面可能只剩内置节点，provider 节点无法正常显示。升级 MSF 后无需重新添加订阅或修改配置。

### English

#### Notes

- This is a compatibility release for the Mihomo `v1.19.28` REST API. That core release restored the original Clash behavior and no longer merges proxy-provider nodes into `/proxies`.
- This release continues to ship 12 GitHub Release assets: Linux amd64/arm64 tarballs, Unraid `.txz`/`.plg`, and fnOS x86/arm `.fpk` packages, with a matching `.sha256` for every install asset.
- The Docker image is additionally published as `ghcr.io/scoltzero/msf:v0.3.9.3`. The `latest` tag is not pushed.

#### Fixed

- The proxies runtime payload now aggregates both Mihomo `/proxies` and `/providers/proxies`. Nodes from non-`Compatible` providers are added back to the MSF node map, restoring provider nodes, types, health, and latency inside proxy groups.
- Older cores remain compatible: when `/proxies` already contains a node, its runtime object takes precedence and is not overwritten; proxy-group entries exposed through `Compatible` pseudo-providers are not treated as standalone nodes.
- Regression coverage now includes the merged response used by Mihomo `v1.19.27` and earlier, plus the split provider-node response introduced in `v1.19.28`.

#### Affected Users

- With MSF `v0.3.9.2` and Mihomo `v1.19.28`, proxy routing and subscriptions can continue working while the built-in MSF proxies page only shows built-in nodes and omits provider nodes. Upgrading MSF restores the page without recreating subscriptions or changing config.

## v0.3.9.2 - 2026-06-30

### 中文

#### 说明

- 这是一次 Mihomo 配置管理热修复发布，用于替换并下架存在 provider 同步问题的 v0.3.9 / v0.3.9.1。
- 本版本 GitHub Release 资产数量与 v0.3.9 保持一致：Linux amd64/arm64 tarball、Unraid `.txz`/`.plg`，以及从同步后的 `fnos-fpk` 分支构建的 fnOS x86/arm `.fpk` 包，共 12 个 release assets。
- Docker 镜像额外以 `ghcr.io/scoltzero/msf:v0.3.9.2` 发布，不推送 `latest`。

#### 包含 v0.3.9 的正确改动

- Docker `host-tun` + Mihomo TUN 启动后自动补齐 FakeIP IPv4 路由，例如 `28.0.0.0/8 dev mihomo src 28.0.0.1`，避免客户端 FakeIP 流量到达 Docker 宿主机后没有进入 `mihomo` TUN。
- Docker `host-tun` + Mihomo TUN 在显式启用 IPv6 时自动补齐 FakeIP IPv6 路由，例如 `f2b0::/18 dev mihomo src f2b0::1`；IPv4 / IPv6 任一路由修复失败都只写 warning，不阻断服务启动。
- Docker `host-tun` + Mihomo TUN 会尝试关闭默认出口网卡的 `rp_filter`；失败时只写 warning，不阻断 Mihomo 启动。
- Mihomo 配置管理不再把内部运行副本 `configs/mihomo/config.yaml` 当作用户配置展示；打开页面会优先显示正在应用的用户配置，没有用户配置时显示“默认配置”。
- 默认 Mihomo 配置只允许修改 `proxy-providers` 并继续保持默认模式；其他 YAML 字段一旦保存会转为用户自定义配置。
- 保存、覆盖或复制已应用的 Mihomo 用户配置时会同步内部运行副本，避免配置列表与实际运行配置漂移。
- MosDNS、MSF 通用配置管理和 Mihomo 配置管理共用的 YAML 编辑器高亮对齐 VS Code Dark+ 风格，改善 key、字符串、数字、布尔、注释、锚点和 tag 的颜色识别。

#### v0.3.9.2 修复

- Mihomo 初始化配置里的订阅链接/自定义节点与“代理节点 > 管理代理供应商”统一同步到顶层 `proxy-providers` 引用字段；已应用用户配置只替换该 section，不再写入订阅下载后的节点内容。
- 自定义节点分享链接再次打开仍保持“分享链接模式”，不会被运行用的 `msf_manual.yaml` 反向覆盖成 `proxies:` YAML 文本。
- Mihomo 配置页“运行中”旁恢复配置模式标签，用“默认配置 / 用户自定义配置”区分当前运行配置来源，同时继续隐藏内部运行副本 `configs/mihomo/config.yaml`。

#### 说明

- 程序不会自动重启 `firewalld`、`nftables` 或 `ufw`。如果防火墙服务会缓存或重放规则，仍需按 Docker 文档手动重启对应防火墙服务。
- Docker IPv6 默认仍保持关闭；只有用户显式启用 IPv6 后才会生成并修复 `f2b0::/18`。
- 内部 Mihomo 运行副本仍然存在并用于启动核心，只是不再作为普通配置文件让用户直接管理。

#### 受影响用户

- 如果您在 v0.3.9 或 v0.3.9.1 期间通过系统设置或“代理节点 > 管理代理供应商”添加/管理过代理订阅链接，已应用的用户配置可能被错误写入订阅下载后的节点内容。
- MSF 不会自动猜测和修复这类污染配置。请删除受污染的用户配置后重新创建，避免继续编辑或沿用错误内容。

### English

#### Notes

- This is a Mihomo config-management hotfix release that replaces and retires v0.3.9 / v0.3.9.1, which had incorrect provider synchronization behavior.
- GitHub Release assets remain aligned with v0.3.9: Linux amd64/arm64 tarballs, Unraid `.txz`/`.plg`, and fnOS x86/arm `.fpk` packages built from the synced `fnos-fpk` branch, for 12 release assets total.
- The Docker image is additionally published as `ghcr.io/scoltzero/msf:v0.3.9.2`. The `latest` tag is not pushed.

#### Included From The Valid v0.3.9 Changes

- Docker `host-tun` + Mihomo TUN now restores the FakeIP IPv4 route after Mihomo starts, for example `28.0.0.0/8 dev mihomo src 28.0.0.1`, so client FakeIP traffic reaching the Docker host can enter the `mihomo` TUN interface.
- Docker `host-tun` + Mihomo TUN now restores the FakeIP IPv6 route when IPv6 is explicitly enabled, for example `f2b0::/18 dev mihomo src f2b0::1`; IPv4 and IPv6 route failures are logged as warnings and do not fail service startup.
- Docker `host-tun` + Mihomo TUN now tries to disable `rp_filter` on the default egress interface; failures are logged as warnings and do not fail Mihomo startup.
- Mihomo config management no longer exposes the internal runtime copy `configs/mihomo/config.yaml` as a user config. The page opens the applied user config first, or shows “Default config” when no user config is applied.
- Default Mihomo config mode now only permits `proxy-providers` edits while staying in generated mode; saving any other YAML field becomes a user custom config.
- Saving, overwriting, or copying the applied Mihomo user config now syncs the internal runtime copy, avoiding drift between the config list and the running config.
- The shared YAML editor used by MosDNS, generic MSF config management, and Mihomo config management now uses VS Code Dark+ style highlighting for keys, strings, numbers, booleans, comments, anchors, and tags.

#### v0.3.9.2 Fixed

- Mihomo setup subscriptions/manual nodes and “Proxies > Provider management” now synchronize the top-level `proxy-providers` references consistently. Applied user configs only have that section replaced, and downloaded subscription node payloads are no longer written back.
- Manual proxy share links remain editable in share-link mode when reopening the settings page, instead of being replaced by the generated `msf_manual.yaml` `proxies:` YAML.
- The Mihomo config page again shows a running-config mode badge, distinguishing “Default config” from “User custom config” while still hiding the internal runtime copy `configs/mihomo/config.yaml`.

#### Notes

- MSF does not automatically restart `firewalld`, `nftables`, or `ufw`. If a firewall service caches or replays rules, restart the active firewall service manually as documented in the Docker guide.
- Docker IPv6 remains disabled by default; `f2b0::/18` is generated and repaired only after the user explicitly enables IPv6.
- The internal Mihomo runtime copy still exists and is used to start the core; it is just no longer directly managed as a normal user-facing config file.

#### Affected Users

- If you added or managed proxy subscription URLs through system settings or “Proxies > Provider management” while running v0.3.9 or v0.3.9.1, your applied user config may have been polluted with downloaded subscription node content.
- MSF will not try to guess and repair these polluted configs automatically. Delete the polluted user config and recreate it instead of continuing to edit or use the bad content.

## v0.3.9 - 2026-06-30

### 中文

#### 说明

- 这是一次 Docker host-tun 路由、Mihomo 用户配置管理和 YAML 编辑器体验修复发布。
- 本版本 GitHub Release 资产数量与 v0.3.8 保持一致：Linux amd64/arm64 tarball、Unraid `.txz`/`.plg`，以及从同步后的 `fnos-fpk` 分支构建的 fnOS x86/arm `.fpk` 包，共 12 个 release assets。
- Docker 镜像额外以 `ghcr.io/scoltzero/msf:v0.3.9` 发布，不推送 `latest`。

#### 修复

- Docker `host-tun` + Mihomo TUN 启动后自动补齐 FakeIP IPv4 路由，例如 `28.0.0.0/8 dev mihomo src 28.0.0.1`，避免客户端 FakeIP 流量到达 Docker 宿主机后没有进入 `mihomo` TUN。
- Docker `host-tun` + Mihomo TUN 在显式启用 IPv6 时自动补齐 FakeIP IPv6 路由，例如 `f2b0::/18 dev mihomo src f2b0::1`；IPv4 / IPv6 任一路由修复失败都只写 warning，不阻断服务启动。
- Docker `host-tun` + Mihomo TUN 会尝试关闭默认出口网卡的 `rp_filter`；失败时只写 warning，不阻断 Mihomo 启动。
- Mihomo 配置管理不再把内部运行副本 `configs/mihomo/config.yaml` 当作用户配置展示；打开页面会优先显示正在应用的用户配置，没有用户配置时显示“默认配置”。
- 默认 Mihomo 配置只允许修改 `proxy-providers` 并继续保持默认模式；其他 YAML 字段一旦保存会转为用户自定义配置。
- 保存、覆盖或复制已应用的 Mihomo 用户配置时会同步内部运行副本，避免配置列表与实际运行配置漂移。
- MosDNS、MSF 通用配置管理和 Mihomo 配置管理共用的 YAML 编辑器高亮对齐 VS Code Dark+ 风格，改善 key、字符串、数字、布尔、注释、锚点和 tag 的颜色识别。

#### 说明

- 程序不会自动重启 `firewalld`、`nftables` 或 `ufw`。如果防火墙服务会缓存或重放规则，仍需按 Docker 文档手动重启对应防火墙服务。
- Docker IPv6 默认仍保持关闭；只有用户显式启用 IPv6 后才会生成并修复 `f2b0::/18`。
- 内部 Mihomo 运行副本仍然存在并用于启动核心，只是不再作为普通配置文件让用户直接管理。

### English

#### Notes

- This is a fix release for Docker host-tun routing, Mihomo user config management, and YAML editor usability.
- GitHub Release assets remain aligned with v0.3.8: Linux amd64/arm64 tarballs, Unraid `.txz`/`.plg`, and fnOS x86/arm `.fpk` packages built from the synced `fnos-fpk` branch, for 12 release assets total.
- The Docker image is additionally published as `ghcr.io/scoltzero/msf:v0.3.9`. The `latest` tag is not pushed.

#### Fixed

- Docker `host-tun` + Mihomo TUN now restores the FakeIP IPv4 route after Mihomo starts, for example `28.0.0.0/8 dev mihomo src 28.0.0.1`, so client FakeIP traffic reaching the Docker host can enter the `mihomo` TUN interface.
- Docker `host-tun` + Mihomo TUN now restores the FakeIP IPv6 route when IPv6 is explicitly enabled, for example `f2b0::/18 dev mihomo src f2b0::1`; IPv4 and IPv6 route failures are logged as warnings and do not fail service startup.
- Docker `host-tun` + Mihomo TUN now tries to disable `rp_filter` on the default egress interface; failures are logged as warnings and do not fail Mihomo startup.
- Mihomo config management no longer exposes the internal runtime copy `configs/mihomo/config.yaml` as a user config. The page opens the applied user config first, or shows “Default config” when no user config is applied.
- Default Mihomo config mode now only permits `proxy-providers` edits while staying in generated mode; saving any other YAML field becomes a user custom config.
- Saving, overwriting, or copying the applied Mihomo user config now syncs the internal runtime copy, avoiding drift between the config list and the running config.
- The shared YAML editor used by MosDNS, generic MSF config management, and Mihomo config management now uses VS Code Dark+ style highlighting for keys, strings, numbers, booleans, comments, anchors, and tags.

#### Notes

- MSF does not automatically restart `firewalld`, `nftables`, or `ufw`. If a firewall service caches or replays rules, restart the active firewall service manually as documented in the Docker guide.
- Docker IPv6 remains disabled by default; `f2b0::/18` is generated and repaired only after the user explicitly enables IPv6.
- The internal Mihomo runtime copy still exists and is used to start the core; it is just no longer directly managed as a normal user-facing config file.

## v0.3.8 - 2026-06-27

### 中文

#### 说明

- 这是一次 Linux TUN / Docker TUN DNS 与 Fake-IP 路由修复发布。
- 本版本 GitHub Release 资产数量与 v0.3.7 保持一致：Linux amd64/arm64 tarball、Unraid `.txz`/`.plg`，以及从同步后的 `fnos-fpk` 分支构建的 fnOS x86/arm `.fpk` 包，共 12 个 release assets。
- Docker 镜像额外以 `ghcr.io/scoltzero/msf:v0.3.8` 发布，不推送 `latest`。

#### 修复

- 统一修复 Linux TUN 生成配置：`tun.stack` 改为 `system`，`tun.dns-hijack` 保持空数组，由 MosDNS 继续负责 DNS 分流，Mihomo 通过 `route-address` 接管 Fake-IP 和必要公网目标。
- TUN 模式新增 `dns.proxy-server-nameserver`，避免节点服务器域名被 Fake-IP 污染后解析成 `28.0.0.x` 导致拨号失败。
- TUN 模式新增 `route-exclude-address` 默认排除 loopback、LAN、link-local、ULA 和常见国内 DNS。
- 修复已初始化的 v0.3.7 Docker TUN 生成配置升级后仍保留旧 TUN / DNS block 的问题；生成配置模式会在启动期自动修正，自定义 Mihomo 配置不会被自动覆盖。
- 补充 Docker `host-tun` 网关部署的 FakeIP 路由说明：如果宿主机只生成 `28.0.0.0/30 dev mihomo`，需要额外把 `28.0.0.0/8` 路由到 `mihomo`，并关闭出口网卡 `rp_filter`。Docker 文档已加入临时验证命令、systemd 持久化方案和防火墙重启防呆命令。

### English

#### Notes

- This is a Linux TUN / Docker TUN DNS and Fake-IP routing fix release.
- GitHub Release assets remain aligned with v0.3.7: Linux amd64/arm64 tarballs, Unraid `.txz`/`.plg`, and fnOS x86/arm `.fpk` packages built from the synced `fnos-fpk` branch, for 12 release assets total.
- The Docker image is additionally published as `ghcr.io/scoltzero/msf:v0.3.8`. The `latest` tag is not pushed.

#### Fixed

- Unified Linux TUN generated config: `tun.stack` now uses `system`, `tun.dns-hijack` stays empty so MosDNS continues DNS splitting, and Mihomo takes over Fake-IP plus required public targets through `route-address`.
- Added `dns.proxy-server-nameserver` in TUN mode so proxy server domains are not resolved into Fake-IP addresses such as `28.0.0.x`.
- Added default `route-exclude-address` entries for loopback, LAN, link-local, ULA, and common China DNS addresses.
- Fixed already-initialized v0.3.7 Docker TUN generated configs keeping the old TUN / DNS blocks after upgrade; generated config mode is repaired at startup, while custom Mihomo config is not overwritten.
- Documented the Docker `host-tun` gateway FakeIP route workaround: if the host only creates `28.0.0.0/30 dev mihomo`, route the full `28.0.0.0/8` range to `mihomo` and disable `rp_filter` on the egress interface. The Docker docs now include temporary verification commands, a systemd persistence setup, and a firewall restart guardrail.

## v0.3.7 - 2026-06-27

### 中文

#### 说明

- 这是一次 Docker TUN 实验部署、文档入口和社区致谢更新发布。
- 本版本 GitHub Release 资产数量与 v0.3.6 保持一致：Linux amd64/arm64 tarball、Unraid `.txz`/`.plg`，以及从同步后的 `fnos-fpk` 分支构建的 fnOS x86/arm `.fpk` 包，共 12 个 release assets。
- Docker 镜像额外以 `ghcr.io/scoltzero/msf:v0.3.7` 发布，不推送 `latest`。

#### 新增

- 新增 Docker TUN 实验运行时，支持 `host-tun` 和 IPv4 `macvlan-tun` 两种入口。
- 新增 `docker-compose.yml`、`docker-compose.macvlan.yml`、`docker.env.example` 和增强版 `docker-run.sh`，同时支持 Compose 与普通 Docker 脚本启动。
- 新增 Docker 中英文部署文档，覆盖数据目录映射、host TUN、macvlan TUN、Unraid Dockerman IPv4 手工配置，以及 LXC / Portainer 常见问题。
- 新增 README 常见问题入口与双语 FAQ 页面，首个问题说明 53 端口占用排查和 `systemd-resolved` 常见处理方式。
- 新增 README 架构原理图，并为英文 README 提供英文版架构图。
- 新增 linux.do 社区徽章和 Gzh256 测试验证致谢。

#### 变更

- Docker runtime 下初始化默认使用 Mihomo TUN；非 Docker 环境默认仍保持 nftables / TProxy / Redirect 模式。
- Docker TUN 配置启用 `tun.auto-route`、`tun.auto-detect-interface` 和 `tun.dns-hijack`，并禁用 `tun.auto-redirect`，避免由 MSF 写入宿主机 nftables 或 policy routing。
- Docker TUN 下不再生成或暴露 `redir-port`、`tproxy-port`、`routing-mark`，初始化预检也不再检查 `7877` / `7896`。
- Docker 容器内禁用 `msf update` 和 WebUI 自更新安装；镜像升级需通过 Docker / Compose / 容器管理器完成。
- GHCR workflow 保持手动闲置；Docker 镜像发布改为在正式 release 资产确认后手动构建并推送版本 tag。

#### 修复

- 修复 Docker TUN 场景下继续生成 `network.nft` 或尝试恢复宿主 nftables 的风险。
- 修复 Mihomo 自定义配置校验在 TUN 模式下仍要求 `redir-port` / `tproxy-port` 的问题。
- 修复 Docker macvlan 示例缺少完整 compose / `.env` 参考导致用户需要纯手写配置的问题。

### English

#### Notes

- This release adds the experimental Docker TUN runtime, documentation entry updates, and community acknowledgements.
- GitHub Release assets remain aligned with v0.3.6: Linux amd64/arm64 tarballs, Unraid `.txz`/`.plg`, and fnOS x86/arm `.fpk` packages built from the synced `fnos-fpk` branch, for 12 release assets total.
- The Docker image is additionally published as `ghcr.io/scoltzero/msf:v0.3.7`. The `latest` tag is not pushed.

#### Added

- Added the experimental Docker TUN runtime with `host-tun` and IPv4 `macvlan-tun` entry points.
- Added `docker-compose.yml`, `docker-compose.macvlan.yml`, `docker.env.example`, and an enhanced `docker-run.sh` so both Compose and plain Docker script startup are supported.
- Added Chinese and English Docker deployment docs covering data volume mapping, host TUN, macvlan TUN, manual Unraid Dockerman IPv4 setup, and LXC / Portainer troubleshooting.
- Added README FAQ entry points and bilingual FAQ pages, starting with port 53 occupancy diagnosis and the common `systemd-resolved` mitigation.
- Added the README architecture diagram and a dedicated English architecture diagram for README.en.
- Added the linux.do community badge and thanks to Gzh256 for multi-version testing.

#### Changed

- Docker runtime now defaults setup to Mihomo TUN, while non-Docker environments continue to default to nftables / TProxy / Redirect mode.
- Docker TUN config enables `tun.auto-route`, `tun.auto-detect-interface`, and `tun.dns-hijack`, and disables `tun.auto-redirect` to avoid MSF writing host nftables or policy routing.
- Docker TUN no longer generates or exposes `redir-port`, `tproxy-port`, or `routing-mark`, and setup preflight no longer checks `7877` / `7896`.
- `msf update` and WebUI self-update installation are disabled inside Docker containers; image upgrades must go through Docker, Compose, or the container manager.
- The GHCR workflow remains manual/idle. Docker image publication is now a manual version-tag push after release assets are confirmed.

#### Fixed

- Fixed the risk of Docker TUN still generating `network.nft` or restoring host nftables state.
- Fixed Mihomo custom-config validation still requiring `redir-port` / `tproxy-port` in TUN mode.
- Fixed Docker macvlan examples lacking complete compose / `.env` references and forcing users to hand-write configuration.

## v0.3.6 - 2026-06-25

### 中文

#### 说明

- 这是一次文档结构、登录页品牌动效、初始化 53 端口预检和首页 CPU 展示修复发布。
- 本版本发布资产数量与 v0.3.5 保持一致：Linux amd64/arm64 tarball、Unraid `.txz`/`.plg`，以及从同步后的 `fnos-fpk` 分支构建的 fnOS x86/arm `.fpk` 包，共 12 个 release assets。

#### 新增

- 新增登录页白底区域的动态 MSF Logo，保持原静态 Logo 的视觉尺寸，并加入 1000ms 延迟和 0.75x 播放节奏。
- 新增 README 顶部动态 Logo 展示，让项目简介区域直接呈现当前品牌动效。
- 新增独立安装文档入口：Linux tarball/systemd、fnOS FPK、Unraid PLG 和 Docker 实验部署拆分为分页面说明。
- 新增 53 端口预检诊断字段 `reason`、`probe_error` 和 bind probe 来源错误，便于用户截图反馈真实原因。

#### 变更

- README / README.en 改为入口页：保留项目能力、当前版本、平台支持矩阵、下载入口和详细文档链接，减少首页操作手册堆叠。
- 平台支持说明明确 Linux tarball/systemd、fnOS FPK、Unraid PLG 和 Docker host network 的状态差异；Docker 当前标记为实验性部署，不再作为主推安装方式。
- fnOS FPK、Unraid PLG 的更新和卸载说明统一改为由平台管理器负责；`msf update` / `msf uninstall` 继续只面向 Linux tarball/systemd 安装。
- MosDNS 启动前的 53 端口检查只在真实监听占用或 bind 返回 `EADDRINUSE` 时提前阻断；权限、capability 或其他探测异常改为警告，允许 MosDNS 直接尝试启动并返回真实运行结果。
- 首页和服务状态中的进程 CPU 百分比改为按可用 vCPU/逻辑 CPU 容量归一化，并限制在 0-100%，避免 PVE / 多 vCPU 环境出现 350% 这类单核累计百分比。

#### 修复

- 修复 Unraid 插件页面入口在 WebGUI 中显示位置不正确的问题。
- 修复初始化前 53 端口预检把 `EACCES`、`EPERM` 或其他 bind probe 错误误报为“未知进程占用”的问题。
- 修复模板、配置文本中出现 `systemd-resolved` / `dnsmasq` / `:53` 字样时可能被未来解析路径误判为监听输出的风险。
- 修复初始化页只用红/绿状态展示 53 端口结果的问题；非阻断探测异常现在以黄色警告展示，不禁用初始化按钮。
- 修复 PVE / 多 vCPU 环境下首页服务 CPU 显示可能超过 100% 的问题。

### English

#### Notes

- This is a documentation, login-branding, setup preflight, and dashboard CPU-display release.
- Release asset count remains aligned with v0.3.5: Linux amd64/arm64 tarballs, Unraid `.txz`/`.plg`, and fnOS x86/arm `.fpk` packages built from the synced `fnos-fpk` branch, for 12 release assets total.

#### Added

- Added the animated MSF Logo to the white logo area on the login page, preserving the previous static logo's visual size with a 1000ms start delay and 0.75x playback pacing.
- Added the animated logo to the README header so the project introduction reflects the current branding.
- Added dedicated install documentation pages for Linux tarball/systemd, fnOS FPK, Unraid PLG, and experimental Docker deployment.
- Added DNS port 53 preflight diagnostics: `reason`, `probe_error`, and bind-probe source errors for clearer user reports.

#### Changed

- README / README.en are now entry pages focused on project capabilities, current version, platform support, downloads, and links to detailed docs.
- Platform support text now clearly separates Linux tarball/systemd, fnOS FPK, Unraid PLG, and Docker host-network status. Docker is marked experimental and is not the recommended install path.
- fnOS FPK and Unraid PLG update/removal guidance now consistently points to the platform manager; `msf update` / `msf uninstall` remain Linux tarball/systemd-only.
- MosDNS startup preflight now blocks only on real listeners or bind `EADDRINUSE`. Permission, capability, and other probe errors are warnings, allowing MosDNS to attempt startup and report the real runtime error.
- Dashboard/service process CPU usage is normalized by available vCPU/logical CPU capacity and clamped to 0-100%, avoiding single-core accumulated values such as 350% on PVE / multi-vCPU systems.

#### Fixed

- Fixed the Unraid plugin WebGUI page entry location.
- Fixed setup DNS port 53 preflight misreporting `EACCES`, `EPERM`, or other bind-probe errors as unknown process occupancy.
- Fixed the risk of future parser paths treating template/config text containing `systemd-resolved`, `dnsmasq`, or `:53` as listener output.
- Fixed setup-page DNS53 display using only red/green states. Non-blocking probe issues now render as yellow warnings and do not disable setup completion.
- Fixed dashboard service CPU usage sometimes exceeding 100% on PVE / multi-vCPU environments.

## v0.3.5 - 2026-06-17

### 中文

#### 说明

- 这是一次热更新可靠性、更新状态可视化和 Mihomo 默认运行兼容性修复发布，重点解决 `msf update` 后用户配置丢失或需要重新设置、WebUI 下载更新等待阶段无反馈，以及 Mihomo GEO 初始化阻塞 / TProxy 健康检查在部分环境下启动或测速异常的问题。
- 本版本发布资产数量与 v0.3.4 保持一致：Linux amd64/arm64 tarball、Unraid `.txz`/`.plg`，以及从同步后的 `fnos-fpk` 分支构建的 fnOS x86/arm `.fpk` 包，共 12 个 release assets。

#### 新增

- 新增自更新状态细分字段：`phase`、`message`、`events`，用于区分检查、连接下载、下载中、已下载、安装中、重启中、完成和失败等阶段。
- 新增 `update_info` 的 `phase`、`message`、`event_log` 兼容迁移，保留最近 20 条更新事件，便于 WebUI 和管理员排查。
- 新增 WebUI “更新状态”卡片的动态状态图标、总流程条、持续进度条和最近日志展示，下载/安装/重启期间状态图标会持续旋转。
- 新增 WebUI 下载和安装的乐观状态更新与 1 秒轮询，点击下载后即显示“正在连接下载地址”，即使网络连接或 GitHub 响应卡住也不会空白。
- 新增 Mihomo GEO 初始化行为测试覆盖，确保默认配置不会在安装或首次初始化阶段创建、下载 `GeoSite.dat` / `GeoIP.dat`。

#### 变更

- `msf update` 现在会优先使用显式 `--config`，否则自动从已安装的 systemd service、`MSF_DATA_DIR`、`ExecStart --config` / `-c` 等信息解析真实用户数据目录，避免热更新后启动到默认目录导致重新初始化。
- `msf update` 会复用已安装服务的 `--host` 和 `--port`，除非命令行显式传入，确保更新后的服务继续使用原监听地址和端口。
- `msf update` 只面向 Linux tarball/systemd 安装；Docker、Unraid 和 fnOS FPK 环境会提示通过各自平台管理器升级。
- 自更新下载流程在真正发起 HTTP 请求前先写入 `connecting` 状态，拿到响应后写入 `downloading`，未知 Content-Length 时也保持活动状态和日志。
- 自更新安装流程会写入准备安装、解压、交给 `systemd-run` / 执行安装脚本、重启中等状态，让 WebUI 可以持续反馈服务重启前的阶段。
- Mihomo 默认配置和生成配置继续保留 MetaCubeX `geox-url`，但默认将 `geo-auto-update` 设为 `false`，避免新机器首次初始化时被 GeoSite/GeoIP 下载阻塞。
- Mihomo provider 健康检查地址改为 `http://detectportal.firefox.com/success.txt`，降低在国内或受限网络下误判节点不可用的概率。
- 系统初始化和默认配置生成不再主动下载 Mihomo GEO 数据文件；用户后续手动将 `geo-auto-update` 改回 `true` 时，MSF 不会覆盖该选择，Mihomo 会按配置中的 `geox-url` 自行更新。

#### 修复

- 修复 v0.3.3/v0.3.4 中命令行 `msf update` 可能没有保留用户数据目录，导致更新后 WebUI 看起来被重置、需要重新设置的问题。
- 修复 `msf update` 在 systemd 服务里使用环境变量或短参数指定数据目录时无法正确继承的问题。
- 修复 WebUI 点击“下载更新”后，TCP timeout 或连接 GitHub 等待期间“更新状态”卡片没有动画、没有当前状态、没有日志的问题。
- 修复下载失败只显示最终错误、缺少“开始连接下载地址”等阶段日志的问题。
- 修复旧数据库中已有 `status=downloaded/failed/installing` 但新增 `phase` 默认 `idle` 时，状态接口可能无法正确推导展示阶段的问题。
- 修复通用下载器只有在 Content-Length 可用且收到数据后才发出进度事件的问题；现在连接成功和未知大小下载也会触发进度回调。
- 修复组件更新复用下载器时可能被新连接事件污染为未知状态的问题，连接事件仍保持 `running` 状态，仅通过 message 标识。
- 修复 v0.3.5 新机器命令行安装后可能等待 GeoSite/GeoIP 下载超时，导致 WebUI 地址提示延迟 2-3 分钟才出现的问题。

### English

#### Notes

- This is a reliability and visibility release for self-update, update-progress feedback, and default Mihomo runtime compatibility. It focuses on preserving user configuration after `msf update`, keeping the WebUI informative while downloads are connecting or stuck, and avoiding Mihomo GEO initialization blocking / TProxy health-check issues in restricted environments.
- Release asset count remains aligned with v0.3.4: Linux amd64/arm64 tarballs, Unraid `.txz`/`.plg`, and fnOS x86/arm `.fpk` packages built from the synced `fnos-fpk` branch, for 12 release assets total.

#### Added

- Added finer-grained self-update state fields: `phase`, `message`, and `events`, covering checking, connecting, downloading, downloaded, installing, restarting, completed, and failed phases.
- Added compatible `update_info` migration columns for `phase`, `message`, and `event_log`, retaining the latest 20 update events for WebUI display and admin troubleshooting.
- Added dynamic icons, an overall process bar, an always-visible progress indicator, and recent event logs to the WebUI Update Status card.
- Added optimistic WebUI state and 1-second polling for download/install actions, so clicking download immediately shows “connecting to download URL” even before the HTTP request returns.
- Added Mihomo GEO initialization tests to ensure default setup does not create or download `GeoSite.dat` / `GeoIP.dat` during install or first initialization.

#### Changed

- `msf update` now prefers explicit `--config`; otherwise it resolves the installed user data directory from the systemd service, `MSF_DATA_DIR`, and `ExecStart --config` / `-c` arguments, preventing updates from restarting into a default empty data directory.
- `msf update` now preserves the installed service `--host` and `--port` unless the command line explicitly overrides them.
- `msf update` is limited to Linux tarball/systemd installs; Docker, Unraid, and fnOS FPK environments are directed to their platform managers.
- Self-update download now persists `connecting` before the HTTP request, switches to `downloading` after a response, and keeps an active state/log even when Content-Length is unknown.
- Self-update install now records preparation, extraction, `systemd-run` / background installer handoff, and restarting phases so the WebUI can keep reporting progress before service restart.
- Default and generated Mihomo configs still include MetaCubeX `geox-url`, but now default `geo-auto-update` to `false` so first-time setup is not blocked by GeoSite/GeoIP downloads.
- Mihomo provider health checks now use `http://detectportal.firefox.com/success.txt` instead of Google/Fastly-style endpoints, reducing false negatives in restricted networks.
- Setup/default generation no longer downloads Mihomo GEO data files. If users later set `geo-auto-update` back to `true`, MSF will not override that choice and Mihomo will update through the configured `geox-url`.

#### Fixed

- Fixed `msf update` in v0.3.3/v0.3.4 potentially not preserving the user data directory, making the WebUI appear reset after update.
- Fixed `msf update` failing to inherit data directories declared through systemd environment variables or short `-c` arguments.
- Fixed the WebUI Update Status card showing no animation, current state, or logs while a download was waiting on GitHub or eventually timing out.
- Fixed download failures lacking stage logs such as “started connecting to download URL.”
- Fixed legacy database rows with `status=downloaded/failed/installing` and default `phase=idle` not being displayed with the correct phase.
- Fixed the downloader emitting progress only when Content-Length existed and body bytes were received; connection success and unknown-size downloads now emit progress events too.
- Fixed component updates seeing the new connection event as an unknown status; connection progress remains `running` and is identified through the message.
- Fixed first-time CLI installs on new machines taking 2-3 minutes before printing the WebUI URL because GeoSite/GeoIP downloads could wait for network timeouts during initialization.

## v0.3.4 - 2026-06-15

### 中文

#### 说明

- 这是一次修复与体验发布，重点覆盖 Linux 卸载清理、平台卸载边界、Mihomo 默认配置、MosDNS FakeIP 上游编辑、MosDNS 系统开关映射和客户端扫描重置。
- 本版本发布资产数量与 v0.3.3 保持一致：Linux amd64/arm64 tarball、Unraid `.txz`/`.plg`，以及从同步后的 `fnos-fpk` 分支构建的 fnOS x86/arm `.fpk` 包，共 12 个 release assets。

#### 新增

- 新增 MosDNS 上游 DNS 添加/编辑弹窗，替代浏览器 `prompt`，支持名称、协议、地址和启用状态的结构化编辑，并在编辑弹窗内提供删除入口。
- 新增 MosDNS 上游分组级启用/禁用开关，可一次切换同一分组下全部上游服务器。
- 新增 FakeIP 上游 tag 规范化逻辑：`nocnfake`、`cnfake` 会兼容旧的 `sing-box`、`mihomo`、`foreign-fakeip`、`cn-fakeip` 等历史名称并保存为规范 tag。
- 新增 Linux 卸载交互确认与自动化参数：`msf uninstall` 会在交互式终端询问是否删除数据目录，自动化场景可使用 `--purge --yes` 明确清理，或使用 `--keep-data` 明确保留数据。
- 新增卸载时从 systemd service 自动识别数据目录的能力；只有显式传入 `--config` 时才强制使用用户给定目录。
- 新增卸载时清理托管组件进程的能力：会根据 Mihomo/MosDNS PID 文件和数据目录下的组件二进制路径终止残留进程，并处理僵尸进程状态判断。
- 新增 fnOS FPK 运行环境识别，阻止在 fnOS FPK 安装中执行 Linux systemd service install/uninstall 或 Linux tarball uninstall。
- 新增 Mihomo 默认配置中的 sniffing 配置、IPv6 FakeIP 网段、DNS nameserver、Google 专用策略组、私有域名/IP 规则源、AI 域名规则源、PT 非中国规则源、Microsoft 中国规则源和游戏下载中国规则源。

#### 变更

- 调整 MosDNS FakeIP 上游默认配置：`nocnfake` 默认指向 `udp://127.0.0.1:6666` 且启用，`cnfake` 默认指向 `udp://127.0.0.1:1053` 且关闭，避免国内/代理 FakeIP 上游语义反置。
- MosDNS 上游页面现在按固定顺序展示 `domestic`、`foreign`、`foreignecs`、`nocnfake`、`cnfake`，FakeIP 分组默认展开。
- MosDNS 上游保存会保留原始 server 字段结构，并根据原始配置选择 `addr` 或 `server_addr` 写回，减少编辑后丢失额外字段的风险。
- Mihomo 默认 GEO 数据地址改为 MetaCubeX GitHub release 直链，默认 `proxy-providers` 改为空对象，移除旧的示例机场订阅占位。
- Mihomo 默认路由补充局域网网段直连、私有域名/IP 直连、`gh-proxy.com` 直连、`8.8.4.4` / `1.0.0.1` 代理规则、Google 独立策略、AI 域名、Microsoft-CN、GameDownload-CN 和 PT-!CN 规则。
- Mihomo 默认美国节点筛选增加 `UWest` / `UEast` 关键字，`机场节点` 分组保留 include-all/provider 逻辑但不再额外硬编码 `DIRECT`。
- README 和 Linux tarball README 更新卸载说明，明确 `msf uninstall` 只面向 Linux tarball/systemd 安装，Docker、Unraid、fnOS FPK 需要使用对应平台管理器卸载。

#### 修复

- 修复 MosDNS 系统设置页开关映射错误，`requestBlock`、`typeBlock`、`ipv6Block`、`adBlock`、过期缓存开关现在对应正确的 `switch` 配置。
- 修复 MosDNS 客户端扫描重置只清空 `mosdns_clients`、未清空 `mosdns_client_ips` 和 `client_ip.txt` 的问题，重置后客户端 IP 白名单文件会同步刷新。
- 修复 Linux 卸载默认行为过于激进或不清晰的问题：非交互环境默认保留数据，`--purge` 在非交互场景必须搭配 `--yes`。
- 修复卸载脚本在 Docker、Unraid、fnOS FPK 环境中可能误走 Linux systemd/tarball 卸载流程的问题。
- 修复卸载过程中可能只停止 `msf` 主进程、未可靠终止 Mihomo/MosDNS 子进程或残留组件进程的问题。
- 修复 `safeRemoveAll` 宽路径保护不足的问题，进一步拒绝 `/opt/`、`/usr`、`/mnt`、`/mnt/cache` 等高风险路径。

### English

#### Notes

- This is a fix and usability release focused on Linux uninstall cleanup, platform uninstall boundaries, the default Mihomo config, MosDNS FakeIP upstream editing, MosDNS system switch mapping, and client scan reset behavior.
- Release asset count remains aligned with v0.3.3: Linux amd64/arm64 tarballs, Unraid `.txz`/`.plg`, and fnOS x86/arm `.fpk` packages built from the synced `fnos-fpk` branch, for 12 release assets total.

#### Added

- Added a structured MosDNS upstream DNS add/edit dialog to replace browser `prompt`, covering name, protocol, address, enabled state, and deletion from the edit dialog.
- Added group-level enable/disable switches for MosDNS upstream groups, allowing all servers in a group to be toggled together.
- Added FakeIP upstream tag normalization: `nocnfake` and `cnfake` now accept legacy names such as `sing-box`, `mihomo`, `foreign-fakeip`, and `cn-fakeip`, then save canonical tags.
- Added interactive Linux uninstall confirmation and automation flags: `msf uninstall` asks whether to remove the data directory on an interactive terminal, while automation can pass `--purge --yes` to remove it or `--keep-data` to retain it.
- Added uninstall data-directory discovery from the systemd service. A user-provided directory is forced only when `--config` is explicitly passed.
- Added cleanup of managed component processes during uninstall: Mihomo/MosDNS PID files and component binary paths under the data directory are used to terminate leftovers, with zombie-process detection handled correctly.
- Added fnOS FPK runtime detection to block Linux systemd service install/uninstall and Linux tarball uninstall inside fnOS FPK installs.
- Added default Mihomo config coverage for sniffing, IPv6 FakeIP range, DNS nameserver, a dedicated Google policy group, private domain/IP providers, AI domain provider, PT non-China provider, Microsoft China provider, and game-download China provider.

#### Changed

- Adjusted the default MosDNS FakeIP upstream config: `nocnfake` now points to `udp://127.0.0.1:6666` and is enabled, while `cnfake` points to `udp://127.0.0.1:1053` and is disabled, fixing the reversed domestic/proxy FakeIP semantics.
- MosDNS upstream groups now render in a fixed order: `domestic`, `foreign`, `foreignecs`, `nocnfake`, and `cnfake`; FakeIP groups are expanded by default.
- MosDNS upstream saves now preserve the original server field structure and write back through either `addr` or `server_addr` based on the source record, reducing the chance of dropping extra fields during edits.
- The default Mihomo GEO data URLs now use MetaCubeX GitHub release download links. The default `proxy-providers` value is now an empty object, removing the old sample airport subscription placeholder.
- Default Mihomo routing now includes LAN direct routes, private domain/IP direct rules, direct routing for `gh-proxy.com`, proxy rules for `8.8.4.4` / `1.0.0.1`, an independent Google policy, AI domain routing, Microsoft-CN, GameDownload-CN, and PT-!CN rules.
- The default Mihomo US node filter now includes `UWest` / `UEast`; the airport group keeps include-all/provider behavior without hard-coding `DIRECT`.
- README and the Linux tarball README now clarify that `msf uninstall` is only for Linux tarball/systemd installs; Docker, Unraid, and fnOS FPK installs must be removed through their platform managers.

#### Fixed

- Fixed incorrect MosDNS system setting switch mappings. `requestBlock`, `typeBlock`, `ipv6Block`, `adBlock`, and expired-cache toggles now target the correct `switch` configs.
- Fixed MosDNS client scan reset clearing only `mosdns_clients` while leaving `mosdns_client_ips` and `client_ip.txt` intact. The client IP allowlist file is now refreshed after reset.
- Fixed ambiguous or overly destructive Linux uninstall behavior: non-interactive uninstall keeps data by default, and non-interactive `--purge` must be paired with `--yes`.
- Fixed uninstall scripts potentially running the Linux systemd/tarball uninstall path inside Docker, Unraid, or fnOS FPK environments.
- Fixed uninstall cleanup so Mihomo/MosDNS child processes and leftover component processes are reliably terminated instead of only stopping the `msf` main process.
- Fixed broad-path protection in `safeRemoveAll` by rejecting additional high-risk paths such as `/opt/`, `/usr`, `/mnt`, and `/mnt/cache`.

## v0.3.3 - 2026-06-15

### 中文

#### 说明

- 这是一次功能与修复发布，包含 Cloudflare Redirect CLI 测试插件、初始化预检、MosDNS 规则管理、组件更新校验状态、自更新安装流程和前端交互体验改进。
- Cloudflare Redirect 面向“不走代理的局域网客户端”访问用户指定 Cloudflare 盾站的直连解析优化场景。该功能依赖 msf 所在机器的本机网络、运营商路由、Cloudflare Anycast、IPv4/IPv6 可达性、域名名单质量和 MosDNS 当前配置，不保证所有环境都更快或更稳定；如遇访问变慢、IPv6 不通或规则未命中，请先停用插件并反馈扫描结果与日志。
- 本版本发布资产继续与 v0.3.2 保持一致：Linux amd64/arm64 tarball、Unraid `.txz`/`.plg`，以及从同步后的 `fnos-fpk` 分支构建的 fnOS x86/arm `.fpk` 包。

#### 新增

- 新增 `msf cloudflare-redirect` 命令行插件，并提供短别名 `msf cf-redirect`。
- 新增 `start`、`stop`、`scan`、`apply`、`status` 子命令：支持守护进程启停、手动扫描、手动应用、状态查询和 MosDNS 注入回滚。
- 新增 Cloudflare CDN IPv4/IPv6 扫描能力：支持候选 CIDR 抽样、TCP 延迟探测、HTTPS 测试域名校验、`CF-RAY` colo 提取、机房白名单和最快结果排序。
- 新增独立配置文件 `configs/cloudflare-redirect/cfyouxuan.yaml`，默认关闭插件，但内置一组可编辑的初始手动域名名单，便于用户直接修改后启用。
- 新增手动域名和订阅域名合并逻辑，支持 `domain:`、`full:`、`keyword:`、`regexp:`、裸域名和常见 `DOMAIN-SUFFIX,...` 规则格式。
- 新增 MosDNS 专用生成文件和子配置：插件只把 Cloudflare Redirect 注入到“指定客户端直连”分支，不写入全局 `rewrite.txt`，也不影响代理客户端的 FakeIP / 代理分流。
- 新增状态文件、PID 文件和日志文件，`status` 会返回运行状态、PID、IPv4/IPv6 最优 IP、域名数量、最近扫描/应用时间、下一次扫描时间、MosDNS 注入状态和 `hints` 诊断提示。
- 新增数据目录自动发现：命令会优先读取 `MSF_DATA_DIR`，并兼容 Unraid 配置、systemd 服务配置、`.msf` 兼容目录和常见安装目录。
- 新增初始化预检接口与前端流程：初始化前检查 root 权限、宿主机时区、53 端口、MosDNS/Mihomo/Zashboard 相关保留端口占用，并在可处理时自动修复 systemd-resolved DNS stub 占用 53 端口的问题。
- 新增宿主机时区设置能力：初始化和系统设置可读取、保存并应用时区，默认保持 `Asia/Shanghai`。
- 新增 MosDNS 规则源添加弹窗，替代浏览器 `prompt`，支持广告拦截和在线分流规则源的名称、类型、URL、本地文件路径、自动更新与更新间隔配置。
- 新增 MosDNS 规则页面通过 URL query 记住当前 tab 的能力，例如在线分流和广告拦截页面可直接进入对应视图。
- 新增组件更新卡片的上游发布页链接，方便直接打开 MosDNS、Mihomo、Zashboard 的对应 release 页面。

#### 变更

- `msf init`、安装脚本和 WebUI 基础布局准备流程现在会确保默认 `cfyouxuan.yaml` 存在，但不会默认启用 Cloudflare Redirect。
- `start` 在 `enabled: true` 时会立即执行一次重新扫描和应用；守护进程运行中再次执行 `start` 也会同步触发一次 `scan + apply`，减少用户手动操作。
- `apply` 在 `enabled: false` 时会清理插件注入并提示原因，避免用户误以为 MosDNS 拒绝注入。
- 初始化提交会在阻塞性预检失败时返回明确的 `preflight_blocked` 信息，避免写入配置后才发现 53 端口、权限或时区问题。
- 系统设置保存局部配置时会保留已有 GitHub 下载代理和加速配置，避免未提交字段被默认值覆盖。
- 组件更新完成后会自动刷新检查状态，更新按钮文案和校验状态展示也区分“已安装核心校验”“本地上传未项目校验”和“未校验”。
- 侧边栏分组展开/收起状态改为 sessionStorage 持久化，页面切换后不再丢失用户折叠状态。
- MosDNS 规则源列表的启用开关布局和在线分流规则源添加流程做了交互优化，减少错位和误填。
- README 和 README.en 增加 Cloudflare Redirect 的测试功能提示、完整使用方式、配置字段说明、不同部署方式下的 YAML 路径、命令说明、自动扫描时机和常见问题。

#### 修复

- 修复 systemd 环境下 WebUI 自更新安装器可能被当前服务生命周期影响的问题：自更新改为 `systemd-run --no-block` 脱离执行，并在短暂延迟后运行安装脚本。
- 修复组件更新检查失败、无更新或 digest 未变化时，已安装核心的 `installed_verified_digest`、`installed_verification_source` 和 `installed_verified_at` 状态可能丢失的问题。
- 修复本地上传组件后校验来源状态不够明确的问题，本地上传现在会保留为 `local-upload` 且不会声明为项目校验。
- 修复 MosDNS 个性化名单中的 `redirect` / `rewrite` 分类映射，确保对应规则写入 `configs/mosdns/rule/rewrite.txt`。
- 修复初始化和系统设置中时区字段读取、保存、默认值和应用链路不完整的问题。

### English

#### Notes

- This is a feature and fix release covering the experimental Cloudflare Redirect CLI plugin, setup preflight checks, MosDNS rule management, component verification state, self-update installation, and frontend interaction refinements.
- Cloudflare Redirect targets direct LAN clients that do not use the proxy and need selected Cloudflare-protected domains resolved to locally tested Cloudflare CDN IPs. Results depend on the msf host's own network path, ISP routing, Cloudflare Anycast behavior, IPv4/IPv6 reachability, domain-list quality, and the active MosDNS configuration. It is not guaranteed to improve every environment; if access becomes slower, IPv6 fails, or rules do not match, stop the plugin and report scan results and logs.
- Release assets remain aligned with v0.3.2: Linux amd64/arm64 tarballs, Unraid `.txz`/`.plg`, and fnOS x86/arm `.fpk` packages built from the synced `fnos-fpk` branch.

#### Added

- Added the `msf cloudflare-redirect` CLI plugin, with `msf cf-redirect` as a short alias.
- Added `start`, `stop`, `scan`, `apply`, and `status` subcommands for daemon control, manual scanning, manual application, status inspection, and MosDNS injection rollback.
- Added Cloudflare CDN IPv4/IPv6 scanning with candidate CIDR sampling, TCP latency probing, HTTPS test-domain validation, `CF-RAY` colo extraction, colo allowlists, and fastest-result ranking.
- Added the dedicated `configs/cloudflare-redirect/cfyouxuan.yaml` config file. The plugin remains disabled by default, while the file includes an editable initial manual domain list for easier testing.
- Added manual and subscription domain merging with support for `domain:`, `full:`, `keyword:`, `regexp:`, bare domains, and common `DOMAIN-SUFFIX,...` rule formats.
- Added generated MosDNS rule files and sub-config injection scoped only to the existing direct-client branch. The plugin does not write global `rewrite.txt` and does not affect proxy clients using FakeIP/proxy routing.
- Added state, PID, and log files. `status` now reports running state, PID, best IPv4/IPv6 IPs, domain count, last scan/apply time, next scan time, MosDNS injection state, and diagnostic `hints`.
- Added data-directory auto-discovery from `MSF_DATA_DIR`, Unraid config, systemd service config, `.msf` compatibility paths, and common install directories.
- Added setup preflight checks in the API and frontend: root permission, host timezone, port 53, and MosDNS/Mihomo/Zashboard reserved-port occupancy are checked before setup. systemd-resolved DNS stub conflicts on port 53 can be remediated automatically when supported.
- Added host timezone management for setup and system settings, including reading, persisting, and applying the configured timezone with `Asia/Shanghai` as the default.
- Added a MosDNS rule-source creation dialog to replace browser prompts, covering adblock and online routing sources with name, type, URL, local file path, auto-update, and update interval fields.
- Added URL query support for the MosDNS rules page tab, so adblock and online routing views can be opened directly.
- Added upstream release links to component update cards for MosDNS, Mihomo, and Zashboard.

#### Changed

- `msf init`, installer setup, and WebUI base layout preparation now ensure the default `cfyouxuan.yaml` exists, without enabling Cloudflare Redirect by default.
- `start` now runs an immediate scan and apply when `enabled: true`; running `start` again while the daemon is already active also triggers one synchronous `scan + apply`.
- `apply` now removes plugin injection and explains the disabled state when `enabled: false`, instead of looking like MosDNS rejected the configuration.
- Setup submission now returns explicit `preflight_blocked` details for blocking failures, avoiding partially written configuration when permissions, timezone, or port 53 are not ready.
- Partial system-settings saves now preserve existing GitHub download proxy and accelerator fields instead of overwriting omitted fields with defaults.
- Component update completion now refreshes the status immediately. The update UI distinguishes installed-core verification, local-upload provenance, and unverified states.
- Sidebar group open/closed state is persisted in sessionStorage, so navigation no longer resets collapsed groups after page changes.
- MosDNS rule-source switches and online routing source creation were refined to reduce layout issues and accidental bad input.
- README and README.en now document the experimental status, full usage flow, configuration fields, YAML paths for each deployment mode, command behavior, automatic scan timing, and common troubleshooting cases.

#### Fixed

- Fixed self-update installation under systemd by launching the installer through detached `systemd-run --no-block` with a short grace delay, preventing the current service lifecycle from interrupting the update.
- Fixed loss of installed component verification fields (`installed_verified_digest`, `installed_verification_source`, and `installed_verified_at`) after failed checks, no-update checks, or unchanged GitHub asset digests.
- Fixed local component uploads so their provenance remains `local-upload` and is not presented as project-verified.
- Fixed MosDNS `redirect` / `rewrite` category mapping so personalized rewrite rules target `configs/mosdns/rule/rewrite.txt`.
- Fixed incomplete timezone read/save/default/apply handling in setup and system settings.

## v0.3.2 - 2026-06-12

### 中文

#### 说明

- 这是一次小型修复发布，基于 v0.3.1 的 CA 合规版本继续修正组件校验状态展示和初始化向导体验。
- 本版本发布资产继续包含 Linux amd64/arm64 tarball、Unraid `.txz`/`.plg`，以及从同步后的 `fnos-fpk` 分支构建的 fnOS x86/arm `.fpk` 包。

#### 修复

- 修复 MosDNS、Mihomo、Zashboard 在线安装校验成功后，后续更新检查可能把同一 digest 的已验证状态重置为“待安装校验”的问题。
- 修复组件更新状态在无新版本且 digest 未变化时的 `verified_digest`、`verified` 和 `verification_source` 保留逻辑。

#### 变更

- 改进初始化向导校验流程：提交时弹出需要修改的步骤提示，用户点击后再跳转到对应步骤。
- 初始化管理员密码只要求非空和两次输入一致，不再强制最少 8 位。
- 初始化密码输入框增加显示/隐藏切换。

### English

#### Notes

- This is a small fix release on top of the v0.3.1 CA compliance release, focused on component verification state display and setup wizard usability.
- Release assets continue to include Linux amd64/arm64 tarballs, Unraid `.txz`/`.plg`, and fnOS x86/arm `.fpk` packages built from the synced `fnos-fpk` branch.

#### Fixed

- Fixed MosDNS, Mihomo, and Zashboard status checks resetting a successfully installed and verified same-digest component back to a pending verification state.
- Fixed preservation of `verified_digest`, `verified`, and `verification_source` when no update is available and the GitHub asset digest is unchanged.

#### Changed

- Improved setup wizard validation: invalid submissions now show a modal with the step that needs attention, then jump there when confirmed.
- Setup administrator passwords now only require a non-empty value and matching confirmation; the previous minimum length requirement is no longer enforced.
- Added show/hide controls for setup password fields.

## v0.3.1 - 2026-06-11

### 中文

#### 说明

- 这是一次以 Unraid CA 合规为主的修复发布，同时补齐 v0.3.0 之后已经进入 `main` 的 Docker、文档、发布流程和运行时修复。
- 本版本发布资产包含 Linux amd64/arm64 tarball、Unraid `.txz`/`.plg`，以及从同步后的 `fnos-fpk` 分支构建的 fnOS x86/arm `.fpk` 包。

#### 新增

- 新增在线组件下载完整性校验：MosDNS、Mihomo、Zashboard 在线安装会读取 GitHub Release API asset `digest`，只接受合法 `sha256:<hex>`，下载后哈希匹配才会解压或覆盖现有核心。
- 新增组件校验状态字段：组件更新状态会返回并持久化 `download_digest`、`verified_digest`、`verified` 和 `verification_source`。
- 新增本地上传来源标记：手动上传核心仍保留 ELF/架构校验，但会显示为 `local-upload` 且 `verified=false`，不声明由项目验证。
- 新增 `make audit-compliance` 和 `scripts/compliance/audit-compliance.sh`，扫描源码与构建产物中的旧真实订阅、真实节点、真实 IP 和非 inert 代理 URL 样例。
- 新增 Docker host-network 部署支持，包含 `Dockerfile`、`docker-compose.yml`、`docker-run.sh`、GHCR workflow 与 Docker 部署文档。
- 新增 Docker runtime 检测与保护：容器内禁用主机级 `msf update`、`msf uninstall` 和 systemd service install/uninstall。
- 新增路由器集成文档，覆盖 OpenWrt、RouterOS、iKuai、UniFi 的中英文 DHCP / 静态路由配置说明。
- 新增手动发布 runbook，并在 README 中补充服务端口占用表。

#### 变更

- 清空默认初始化配置中的真实订阅链接、真实分享节点和 YAML 节点；输入占位与 MosDNS 规则演示数据统一改为 `example.invalid`、`198.51.100.0/24`、`203.0.113.0/24` 等 inert 示例。
- Unraid Settings 入口保留为独立轻量插件控制页，只提供启停、监听地址、端口、数据目录、状态和 `Open WebUI`；完整管理界面运行在独立 MSF WebUI。
- 更新 Unraid CA 模板、`ca_profile.xml`、README 和 `.plg` release notes，明确核心下载校验、本地上传语义和 Settings 控制页边界。
- 将项目描述统一调整为 free and open-source DNS & proxy management tool。
- 移除 GitHub Actions release workflow，发布改为手动 runbook 流程。
- 从版本库移除 `.codex`、graphify 等本地工具产物，并通过 `.gitignore` 阻止再次纳入。

#### 修复

- 修复 MosDNS 缓存统计读取与展示逻辑。
- 修复 nftables / policy routing 应用逻辑：应用前清理旧 `table inet msf` 与重复 fwmark rule，路由使用 `replace`，清理时同时处理 IPv4/IPv6 policy route。
- 修复 daemon stop/restart 与进程退出路径，统一走 `ShutdownRuntime` 清理运行时状态。
- 修复 Unraid CA submission scanner 对模板/profile XML 的识别问题。
- 修复 `component_update_info` 旧数据库缺少新增校验列时的迁移兼容。

### English

#### Notes

- This is primarily an Unraid CA compliance release, while also documenting the Docker, runtime, release-process, and documentation changes that landed after v0.3.0.
- Release assets include Linux amd64/arm64 tarballs, Unraid `.txz`/`.plg`, and fnOS x86/arm `.fpk` packages built from the synced `fnos-fpk` branch.

#### Added

- Added integrity verification for online component downloads: MosDNS, Mihomo, and Zashboard installs now read the GitHub Release API asset `digest`, require a valid `sha256:<hex>` value, and install only after the downloaded file hash matches.
- Added component verification state fields: `download_digest`, `verified_digest`, `verified`, and `verification_source` are persisted and returned by the component update APIs.
- Added explicit local-upload provenance: manually uploaded cores still go through ELF/architecture checks, but are shown as `local-upload` with `verified=false` instead of being presented as project-verified downloads.
- Added `make audit-compliance` and `scripts/compliance/audit-compliance.sh` to scan source and generated artifacts for old live subscriptions, live nodes, live IPs, and non-inert proxy URL samples.
- Added Docker host-network deployment support with `Dockerfile`, `docker-compose.yml`, `docker-run.sh`, a GHCR workflow, and Docker deployment documentation.
- Added Docker runtime detection and safeguards: host-level `msf update`, `msf uninstall`, and systemd service install/uninstall commands are disabled inside containers.
- Added bilingual router integration guides for OpenWrt, RouterOS, iKuai, and UniFi DHCP/static-route setup.
- Added a manual release runbook and documented service port allocation in the README.

#### Changed

- Removed live subscription URLs, live share nodes, and YAML node samples from the default initialization config; UI placeholders and MosDNS rule demo data now use inert examples such as `example.invalid`, `198.51.100.0/24`, and `203.0.113.0/24`.
- Kept the Unraid Settings entry as a separate lightweight plugin control page for service enablement, listen address, port, data directory, status, and `Open WebUI`; the full management interface runs in the standalone MSF WebUI.
- Updated the Unraid CA template, `ca_profile.xml`, README text, and `.plg` release notes to describe core hash verification, local-upload semantics, and the Settings page boundary.
- Standardized the project description as a free and open-source DNS & proxy management tool.
- Removed the GitHub Actions release workflow; releases now follow the manual runbook.
- Removed local tooling artifacts such as `.codex` and graphify output from version control and ignored them going forward.

#### Fixed

- Fixed MosDNS cache statistics parsing and display.
- Fixed nftables / policy routing application: old `table inet msf` and duplicate fwmark rules are cleared before apply, routes use `replace`, and cleanup now covers both IPv4 and IPv6 policy routes.
- Fixed daemon stop/restart and shutdown paths to use `ShutdownRuntime` for runtime cleanup.
- Fixed Unraid CA submission scanner detection for the template/profile XML files.
- Fixed database migration compatibility for existing `component_update_info` tables that lack the new verification columns.

## v0.3.0 - 2026-06-08

### 说明

- 项目品牌与工程标识从 早期项目标识 迁移为 `msf` / `MSF Free`，GitHub 仓库发布路径切换到 `scoltzero/msf`。
- Linux v0.2.2 用户可通过原有 WebUI 自更新入口升级：发布包继续提供 旧名称兼容副本，内容与新 `msf-*` 包逐字节一致。

### 新增

- 新增 `msf migrate` 一次性迁移命令，支持迁移旧数据目录、数据库文件、`update_info` 组件键、`msf_manual` Mihomo provider、旧 PID/日志文件与旧 nftables 表。
- Linux 安装脚本默认安装到 `/opt/msf`、`msf.service` 和 `/usr/local/bin/msf`，并保留 旧版 CLI 兼容别名。
- 新增 `msf` Unraid 插件包与 CA 元数据，安装路径切换为 `/mnt/user/appdata/msf`、`rc.msf` 和 `/usr/local/emhttp/plugins/msf`。

### 修复

- 修复改名后发布链路和系统自更新资源名匹配问题，确保新旧 Linux 包名同时发布并生成校验文件。
- 修复 Unraid/fnOS 环境下网页自更新入口可能使用 Linux systemd 安装流程的问题，改为提示通过对应应用/插件管理入口升级。
- 修复前端标题、初始化向导、登录页、导航、storage key 和 API token 前缀中的旧项目标识残留。

## v0.2.2 - 2026-06-05

### 说明

- 这个版本意味着 早期版本 的主要功能已经基本稳定，初始化、MosDNS/Mihomo 管理、代理规则、更新与发布链路进入可持续迭代状态。

### 新增

- 新增 Mihomo 自定义配置能力：支持导入、新建、保存、命名、覆盖和应用用户配置；运行时仍以 `configs/mihomo/config.yaml` 作为启动文件，用户配置统一保存在 `configs/mihomo/user_configs`。
- 新增 Mihomo 代理分组、代理供应商、规则集和规则的可视化管理入口，WebUI 可读取并展示用户自定义的 `proxy-groups`、`proxy-providers`、`rule-providers` 和 `rules`。
- 新增组件本地上传安装能力：MosDNS、Mihomo 支持上传原始二进制、`.tar.gz`、`.zip`；Zashboard 支持上传 zip 包，方便网络困难时离线安装核心和 UI。
- 新增 Mihomo 配置编辑器的 CodeMirror 6 实现，支持 YAML 高亮、行号、可见光标、撤销重做和搜索快捷键。

### 修复

- 修复 ARM64 发布包下载组件时可能拉取非对应架构核心的问题；ARM64 系统会下载并校验 ARM64 版本的 MosDNS/Mihomo。
- 修复初始化 6 步完成后的核心下载流程，成功后再进入登录；失败时停留在下载页并提示可登录后到系统设置手动下载。
- 修复 Mihomo 代理节点展开后只能点击小圆圈切换的问题，现在整张节点卡片可选择，延迟按钮仍只触发测速。
- 修复代理节点列表中少量节点自适应撑满整行导致视觉不稳定的问题，节点卡片宽度保持稳定。
- 修复 MosDNS 客户端识别来源展示，ARP 与 MosDNS 查询日志来源可合并显示。
- 修复 Mihomo 配置文件列表展示逻辑，隐藏内部启动文件 `config.yaml`，只展示用户可管理的配置文件。
- 修复管理服务自身更新缺少“安装并重启”操作的问题，下载完成后可在 WebUI 触发安装并重启。
- 修复管理服务自身更新下载未明确走 GitHub 加速的问题，WebUI 会展示实际加速后的下载地址。
- 修复命令行 `msf update` 不读取初始化 GitHub 代理/加速配置的问题，CLI 更新现在复用后端下载器和下载设置。

## v0.2.1 - 2026-06-04

### 修复

- 重构首次初始化向导，提供 6 步配置流程并继续接入现有初始化 API。
- 修复订阅保存格式，前端按 `名称|URL` 换行提交，后端兼容旧格式并拒绝空 URL、`[]` 和非法协议，避免 Mihomo provider 出现 `unsupported protocol scheme ""`。
- 修复初始化页自定义节点输入，手动添加的节点会生成 `proxy_providers/msm_manual.yaml`，并作为 Mihomo 本地文件型供应商 `msf_manual` 注册。
- 补充常见手动节点分享链接解析，支持 `ss`、`ssr`、`vmess`、`vless`、`trojan`、`hysteria`、`hysteria2`、`tuic` 的基础转换。
- 修复初始化配置参数页 DNS 与 IPv6 滑动按钮偏移问题。
- 修复 GitHub 下载加速初始化配置，恢复原版勾选框样式；勾选后可填写 HTTP、HTTPS、SOCKS5 代理或 GitHub 加速前缀。
- 修复下载器读取 SOCKS5 代理配置，GitHub 组件下载代理不再只支持 HTTP/HTTPS。
- 校准 MosDNS 代理模式语义：关闭模式默认全部可访问外网；白名单模式仅名单内可访问外网；黑名单模式仅名单内不可访问外网。
- 修复 Mihomo 代理节点页在 13 寸 MacBook 宽度下的节点卡片自适应布局，减少内容挤压。
- 修复左侧导航栏点击底部菜单后滚动位置跳回顶部的问题。
- 修复系统更新页“可更新”误判，只以后端明确返回的 `has_update` 为准。
- 接通更新配置页的自动检查、检查间隔、自动下载、更新通知和升级方式保存回显。

### 暂缓

- 完全自定义 Mihomo `config.yaml` 模式暂未进入本版本。
- 自定义代理分组、规则集、在线 ruleset 的可视化管理暂未进入本版本。
- 升级时保护用户自定义 Mihomo `proxy-groups`、`rule-providers`、`rules` 的完整策略暂未进入本版本。
