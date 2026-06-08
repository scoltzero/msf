# 更新日志

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
