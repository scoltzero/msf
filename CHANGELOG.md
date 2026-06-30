# 更新日志

## Unreleased

### 中文

### English

## v0.3.9.1 - 2026-06-30

### 中文

#### 说明

- 这是 `v0.3.9` 的小修补发布，用于修正 Mihomo 代理供应商管理与用户配置同步语义。
- 本版本 GitHub Release 资产数量与 v0.3.9 保持一致：Linux amd64/arm64 tarball、Unraid `.txz`/`.plg`，以及从同步后的 `fnos-fpk` 分支构建的 fnOS x86/arm `.fpk` 包，共 12 个 release assets。
- Docker 镜像额外以 `ghcr.io/scoltzero/msf:v0.3.9.1` 发布，不推送 `latest`。

#### 修复

- Mihomo“管理代理供应商”保存后，只把用户修改的 `proxy-providers` 引用字段同步到已应用的用户配置。
- 订阅下载后的供应商文件内容继续保存在 `configs/mihomo/proxy_providers/*.yaml` 并由 `proxy-providers` 引用，不再把下载后的节点内容合并进用户配置 YAML。
- 代理供应商、规则供应商和代理分组等面板保存配置 section 时，不再用内部运行副本 `configs/mihomo/config.yaml` 整份覆盖用户配置，避免运行态内容污染用户配置。

### English

#### Notes

- This is a small patch release for `v0.3.9`, fixing Mihomo proxy provider management and applied user config synchronization semantics.
- GitHub Release assets remain aligned with v0.3.9: Linux amd64/arm64 tarballs, Unraid `.txz`/`.plg`, and fnOS x86/arm `.fpk` packages built from the synced `fnos-fpk` branch, for 12 release assets total.
- The Docker image is additionally published as `ghcr.io/scoltzero/msf:v0.3.9.1`. The `latest` tag is not pushed.

#### Fixed

- Saving Mihomo proxy providers now syncs only the user-edited `proxy-providers` reference section into the applied user config.
- Downloaded subscription provider contents remain in `configs/mihomo/proxy_providers/*.yaml` and are referenced by `proxy-providers`; downloaded node contents are no longer merged into the user config YAML.
- Config section saves from provider, rule-provider, and proxy-group panels no longer overwrite the applied user config with the entire internal runtime copy `configs/mihomo/config.yaml`, avoiding runtime content leakage into user-managed config files.

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
- 新增数据目录自动发现：命令会优先读取 `MSF_DATA_DIR` / `MSM_FREE_DATA_DIR`，并兼容 Unraid 配置、systemd 服务配置、`.msf` 兼容目录和常见安装目录。
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
- Added data-directory auto-discovery from `MSF_DATA_DIR` / `MSM_FREE_DATA_DIR`, Unraid config, systemd service config, `.msf` compatibility paths, and common install directories.
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
- 新增 `make audit-compliance` 和 `scripts/audit-compliance.sh`，扫描源码与构建产物中的旧真实订阅、真实节点、真实 IP 和非 inert 代理 URL 样例。
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
- Added `make audit-compliance` and `scripts/audit-compliance.sh` to scan source and generated artifacts for old live subscriptions, live nodes, live IPs, and non-inert proxy URL samples.
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

- 项目品牌与工程标识从 `msm-free` / `MSM Free` 迁移为 `msf` / `MSF Free`，GitHub 仓库发布路径切换到 `scoltzero/msf`。
- Linux v0.2.2 用户可通过原有 WebUI 自更新入口升级：发布包继续提供 `msm-free-linux-amd64.tar.gz` 与 `msm-free-linux-arm64.tar.gz` 兼容副本，内容与新 `msf-*` 包逐字节一致。

### 新增

- 新增 `msf migrate` 一次性迁移命令，支持迁移旧数据目录、数据库文件、`update_info` 组件键、`msm_manual` Mihomo provider、旧 PID/日志文件与旧 nftables 表。
- Linux 安装脚本默认安装到 `/opt/msf`、`msf.service` 和 `/usr/local/bin/msf`，并保留 `/usr/local/bin/msm` CLI 兼容别名。
- 新增 `msf` Unraid 插件包与 CA 元数据，安装路径切换为 `/mnt/user/appdata/msf`、`rc.msf` 和 `/usr/local/emhttp/plugins/msf`。

### 修复

- 修复改名后发布链路和系统自更新资源名匹配问题，确保新旧 Linux 包名同时发布并生成校验文件。
- 修复 Unraid/fnOS 环境下网页自更新入口可能使用 Linux systemd 安装流程的问题，改为提示通过对应应用/插件管理入口升级。
- 修复前端标题、初始化向导、登录页、导航、storage key 和 API token 前缀中的旧 `MSM`/`msm` 标识残留。

## v0.2.2 - 2026-06-05

### 说明

- 这个版本意味着 `msm-free` 的主要功能已经基本稳定，初始化、MosDNS/Mihomo 管理、代理规则、更新与发布链路进入可持续迭代状态。

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
- 修复系统更新中 MSM 自身更新缺少“安装并重启”操作的问题，下载完成后可在 WebUI 触发安装并重启。
- 修复 MSM 自身更新下载未明确走 GitHub 加速的问题，WebUI 会展示实际加速后的下载地址。
- 修复命令行 `msm update` 不读取初始化 GitHub 代理/加速配置的问题，CLI 更新现在复用后端下载器和下载设置。

## v0.2.1 - 2026-06-04

### 修复

- 复刻原版 MSM 首次初始化向导，恢复 6 步初始化流程和原版视觉结构，并继续接入现有初始化 API。
- 修复订阅保存格式，前端按 `名称|URL` 换行提交，后端兼容旧格式并拒绝空 URL、`[]` 和非法协议，避免 Mihomo provider 出现 `unsupported protocol scheme ""`。
- 修复初始化页自定义节点输入，手动添加的节点会生成 `proxy_providers/msm_manual.yaml`，并作为 Mihomo 本地文件型供应商 `msm_manual` 注册。
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
