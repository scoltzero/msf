# msf

[English README](README.en.md)

`msf` 是一个面向 MosDNS + Mihomo 工作流的 MSM 风格管理面板重构版。项目目标是提供可自部署、可审计的 DNS 分流、透明代理、Mihomo 管理和 Unraid 插件体验。

当前发布版本：`v0.3.5`

> **Tips：Cloudflare Redirect CLI 插件为测试功能。** `msf cloudflare-redirect` 用于让“不走代理的客户端”访问用户指定的 Cloudflare 盾站时，返回本机网络实测较快的 Cloudflare CDN IPv4/IPv6。该功能依赖本机网络、运营商路由、Cloudflare Anycast、域名名单质量和 MosDNS 当前配置，不保证一定比原解析更快或更稳定；如遇到解析异常、访问变慢、IPv6 不通、规则未生效等问题，请及时反馈。

## 功能概览

- 原版 MSM 风格 6 步初始化向导，支持管理员账号、系统参数、DNS、IPv6、Fake-IP、透明代理和组件安装配置。
- MosDNS + Mihomo 默认组合，暂不启用 sing-box。
- 按 mssb 风格生成 MosDNS + Mihomo 国内外分流链路：MosDNS `:53` 入口，Mihomo DNS `:6666`，Fake-IP `28.0.0.0/8`，TProxy `7896`，Redirect `7877`。
- 支持机场订阅，前端按 `名称|URL` 保存，后端会生成 Mihomo `proxy-providers`。
- 支持初始化阶段添加手动节点，手动节点会生成 `proxy_providers/msf_manual.yaml`，并作为 Mihomo 本地文件型供应商 `msf_manual` 使用。
- 手动节点分享链接基础解析支持 `ss`、`ssr`、`vmess`、`vless`、`trojan`、`hysteria`、`hysteria2`、`tuic`。
- 支持 MosDNS 客户端代理模式：关闭、白名单、黑名单。
- 支持 Cloudflare Redirect CLI 插件：为“不走代理的客户端”把指定 Cloudflare 盾站重定向到本机实测最快的 Cloudflare CDN IPv4/IPv6。
- 支持 Mihomo 节点、规则、连接、日志、配置页面。
- 支持 Mihomo 自定义配置：用户配置可导入、新建、命名、保存、应用和回滚，代理分组、规则集和规则可在 WebUI 中管理。
- 支持 CodeMirror YAML 配置编辑器，提供高亮、行号、撤销重做和搜索快捷键。
- 支持组件更新检查、自动检查间隔、自动下载、更新通知和升级方式配置。
- 支持 MosDNS、Mihomo、Zashboard 本地上传安装，网络困难时可用预下载核心离线安装。
- 支持 GitHub 组件下载代理和加速前缀，HTTP、HTTPS、SOCKS5 均可配置。
- 支持按运行架构下载组件核心，ARM64 版本会下载并校验 ARM64 MosDNS/Mihomo。
- 支持普通 Linux systemd 安装包。
- 支持 Unraid 插件安装方式。
- 支持 Docker host 网络部署方式。

## 下载

GitHub Release：

```text
https://github.com/scoltzero/msf/releases/tag/v0.3.5
```

Linux x86_64 安装包：

```text
https://github.com/scoltzero/msf/releases/download/v0.3.5/msf-linux-amd64.tar.gz
```

Linux ARM64 安装包：

```text
https://github.com/scoltzero/msf/releases/download/v0.3.5/msf-linux-arm64.tar.gz
```

Unraid 插件文件：

```text
https://github.com/scoltzero/msf/releases/download/v0.3.5/msf.plg
```

## Linux 安装

根据机器架构下载并解压。x86_64 / amd64 使用：

```bash
curl -L -o msf-linux-amd64.tar.gz \
  https://github.com/scoltzero/msf/releases/download/v0.3.5/msf-linux-amd64.tar.gz

tar -xzf msf-linux-amd64.tar.gz -C /tmp
sudo /tmp/msf-0.3.5-linux-amd64/install.sh
```

ARM64 / aarch64 使用：

```bash
curl -L -o msf-linux-arm64.tar.gz \
  https://github.com/scoltzero/msf/releases/download/v0.3.5/msf-linux-arm64.tar.gz

tar -xzf msf-linux-arm64.tar.gz -C /tmp
sudo /tmp/msf-0.3.5-linux-arm64/install.sh
```

安装脚本会完成这些操作：

- 安装二进制到 `/usr/local/bin/msf`
- 注册兼容命令 `/usr/local/bin/msm`
- 初始化数据目录 `/opt/msf`
- 安装 systemd 服务 `msf.service`
- 启动 WebUI，默认监听 `7777`

打开 WebUI：

```text
http://<服务器IP>:7777
```

首次进入会显示初始化向导。完成初始化后，`msf` 会持久化运行态；后续重启时会按配置恢复 Mihomo、MosDNS 和 nftables，除非用户在 WebUI 中显式停止服务或清除 nftables。

常用 systemd 命令：

```bash
sudo systemctl status msf
sudo systemctl stop msf
sudo systemctl restart msf
sudo journalctl -u msf -f
```

常用 CLI 命令：

```bash
sudo msf status
sudo msf stop
sudo msf restart
sudo msf logs
sudo msf logs --lines 200 mosdns
sudo msf logs --lines 200 mihomo
sudo msf doctor
sudo msf cloudflare-redirect status
sudo msf update
```

`msm` 和 `msf` 指向同一套 CLI。`msf stop` 会向正在运行的管理进程发送优雅停止信号，管理进程退出前会停止它托管的 MosDNS 和 Mihomo 子进程。

需要强制停止时：

```bash
sudo msf stop --timeout 20s --force
```

卸载：

```bash
sudo msf uninstall
```

`msf uninstall` 只面向 Linux tarball/systemd 安装。Docker、Unraid、fnOS FPK 请使用对应平台的容器、插件或应用管理器卸载。

交互式终端会询问是否删除 `/opt/msf` 数据目录；非交互环境默认保留数据。需要连配置、数据库、日志、组件二进制和 zashboard 一起删除时，显式执行：

```bash
sudo msf uninstall --purge --yes
```

如果还保留着解压后的发布包，也可以在包目录内运行：

```bash
sudo ./uninstall.sh
sudo ./uninstall.sh --purge --yes
```

## Unraid 插件安装

在 Unraid WebGUI 中打开 **Plugins / Install Plugin**，填入插件地址：

```text
https://github.com/scoltzero/msf/releases/download/v0.3.5/msf.plg
```

安装完成后打开 **Settings / MSF Free**，进入轻量插件控制页，再点击打开 WebUI。完整管理界面运行在独立 WebUI 中，不嵌入 Unraid Settings 页面。

Unraid 默认数据目录：

```text
/mnt/user/appdata/msf
```

Unraid 运行逻辑：

- 全新安装且尚未初始化时，只启动 `msf` 管理 WebUI。
- 完成初始化引导后，默认启用 Mihomo、MosDNS 和 nftables。
- Unraid 重启或插件服务重启后，`msf` 会按已保存状态恢复 Mihomo、MosDNS 和 nftables。
- 如果用户在 WebUI 中手动停止服务或清除 nftables，下次启动会尊重这个关闭状态。
- 在线安装 MosDNS、Mihomo、Zashboard 时会先校验 GitHub release asset SHA-256 digest；本地上传核心标记为 `local-upload`。

Unraid 停止服务：

```bash
/etc/rc.d/rc.msf stop
```

Unraid 卸载请在 WebGUI 的插件管理页面删除 `msf` 插件。插件卸载会停止 WebUI 服务并移除插件文件，默认保留 `/mnt/user/appdata/msf` 数据目录；如需彻底清理，需要手动删除该目录。

Unraid 上不要使用 `msf update` 或 `msf uninstall`，更新和卸载应通过 Unraid 插件管理页面完成，避免绕过 `.plg` 包状态。

## Docker 部署

Docker 镜像使用 host 网络一比一复刻普通 Linux 二进制能力，容器会写入宿主机 nftables 和策略路由。不要使用 br0、macvlan、ipvlan 或 bridge 静态 IP 作为等价部署方式。

使用 Docker Compose：

```bash
docker compose up -d
```

没有 `docker compose` 时可以使用普通 Docker：

```bash
./docker-run.sh
```

两种方式默认数据目录均为当前目录下的 `./msf-data`，WebUI 仍为：

```text
http://<服务器IP>:7777
```

详细要求、普通 `docker run` 命令、关闭清理和升级方式见 [Docker 部署文档](docs/docker.md)。

## 初始化配置说明

初始化向导会写入系统配置、生成 MosDNS/Mihomo 配置，并保存到数据库。几个关键点：

- 机场订阅：保存为 `名称|URL` 换行格式，最终进入 Mihomo `proxy-providers`。
- 手动节点：保存到 `mihomo_proxies`，生成 `configs/mihomo/proxy_providers/msf_manual.yaml`。
- `msf_manual`：在 Mihomo 中作为 `type: file` 的本地 proxy provider 注册。
- GitHub 下载代理：只影响组件下载过程，不会修改代理服务本身的运行配置。
- 自定义 Mihomo 配置：用户配置保存在 `configs/mihomo/user_configs`，应用时会覆盖运行入口 `configs/mihomo/config.yaml` 并重启 Mihomo。
- 配置文件列表：WebUI 只展示用户可管理的配置文件，不直接展示内部启动文件 `config.yaml`。
- 本地上传组件：系统设置 / 系统更新 / 组件更新中可上传本机预下载的 MosDNS、Mihomo 或 Zashboard 包。

## Cloudflare Redirect CLI 插件

Cloudflare Redirect 是一个**命令行测试插件**，用于改善**不走代理的局域网客户端**访问用户指定的 Cloudflare 盾站时的直连连通性。它会从运行 `msf` 的这台机器出发，扫描本机网络到 Cloudflare CDN 的较快 IPv4/IPv6，然后把用户维护名单中的域名注入到 MosDNS 的“指定客户端直连”分支中。

请先明确它的边界：

- 它只对 MosDNS 当前判断为“指定客户端直连”的客户端生效。
- 代理客户端仍走原有 FakeIP / 代理分流，不会被此插件改写。
- 它不会自动判断哪些域名使用 Cloudflare，域名名单必须由用户手动维护或订阅提供。
- 它不做 TCP 转发，不改 WebUI，不把优选 IP 加入国内 DNS 上游。
- 它不写入全局 `configs/mosdns/rule/rewrite.txt`，而是使用独立生成文件。
- 这是测试功能，不保证所有网络环境都变快；如果访问变慢、IPv6 不通、规则冲突或 MosDNS 无法启动，请先 `stop` 回滚并反馈。

代理客户端访问 Cloudflare 盾站时，应由代理出口自行选择 Cloudflare 边缘节点；本插件只服务直连客户端。若同一域名同时存在于代理规则和 Cloudflare Redirect 名单中，代理客户端仍按原规则拿 FakeIP，直连客户端才会拿 Cloudflare 优选真实 IP。

### 配置文件位置

配置文件会在 `msf init`、安装脚本或 WebUI 初始化时自动创建：

```text
<数据目录>/configs/cloudflare-redirect/cfyouxuan.yaml
```

数据目录不是按 CPU 架构区分，而是按运行方式区分。常见位置如下：

| 部署方式 | 数据目录 | YAML 完整路径 |
|---|---|---|
| Linux systemd 安装包，含 amd64/arm64 | `/opt/msf` | `/opt/msf/configs/cloudflare-redirect/cfyouxuan.yaml` |
| Linux 安装包指定 `--data-dir` | 用户指定目录 | `<指定目录>/configs/cloudflare-redirect/cfyouxuan.yaml` |
| Unraid 插件 | `/mnt/user/appdata/msf` | `/mnt/user/appdata/msf/configs/cloudflare-redirect/cfyouxuan.yaml` |
| Docker Compose / `docker-run.sh` 宿主机 | 默认当前目录的 `./msf-data` | `./msf-data/configs/cloudflare-redirect/cfyouxuan.yaml` |
| Docker 容器内 | `/opt/msf` | `/opt/msf/configs/cloudflare-redirect/cfyouxuan.yaml` |
| 源码本地非 root 运行 | 通常是 `./data`，取决于 `-c` / `--config` | `./data/configs/cloudflare-redirect/cfyouxuan.yaml` |
| root 直接运行裸二进制且未设置环境变量 | `/opt/msf` | `/opt/msf/configs/cloudflare-redirect/cfyouxuan.yaml` |

实际优先级是：`MSF_DATA_DIR` > `MSM_FREE_DATA_DIR` > root 默认 `/opt/msf` > 非 root 默认 `./data`。如果是 systemd 安装，安装脚本通常会把 `MSF_DATA_DIR` 写进服务文件，所以以服务配置为准。

可以用下面的命令确认插件当前找到的配置文件路径：

```bash
sudo msf cloudflare-redirect status
```

输出里的 `config` 字段就是正在读取的 `cfyouxuan.yaml`。命令会自动从 `MSF_DATA_DIR`、Unraid 配置、systemd 服务配置、`.msf` 兼容目录和常见安装目录中发现当前数据目录。通常不需要加 `--config`。如果自动发现失败，可以显式指定：

```bash
sudo msf cloudflare-redirect status --config /path/to/msf-data
sudo msf cloudflare-redirect --config /path/to/msf-data status
```

### 完整配置示例

默认配置是关闭状态。要生效，至少需要把 `enabled` 改成 `true`，并在 `rules.manual` 或 `rules.subscriptions` 中配置域名。

```yaml
enabled: true

scan:
  interval: 6h
  concurrency: 100
  timeout: 1s
  max_duration: 2s
  test_domain: cloudflaremirrors.com/debian
  expected_status: 200
  port: 443
  tls: true
  colo_allowlist: []

  ipv4:
    enabled: true
    candidate_source: baipiao
    result_count: 2
    random_per_cidr: 1

  ipv6:
    enabled: auto
    candidate_source: baipiao
    result_count: 2
    random_per_cidr: 1
    no_winner_policy: passthrough

rules:
  manual:
    - domain:m-team.cc
    - domain:m-team.io
    - domain:open.cd
    - domain:hdfans.org
    - domain:hhanclub.net
    - domain:audiences.me
    - domain:plex.tv
    - domain:hdsky.me
    - domain:parsec.app
    - domain:ourbits.club
    - full:springsunday.net
    - full:www.springsunday.net
    - domain:pterclub.net
    - domain:ptskit.org
    - domain:totheglory.im
  subscriptions:
    - name: cf-domains
      enabled: true
      url: https://example.com/cloudflare-domains.txt
      format: domain-list
      interval: 24h

apply:
  ttl: 60
  rewrite_a: true
  rewrite_aaaa: auto
  restart_mosdns: auto
```

### 配置字段说明

| 字段 | 默认值 | 说明 |
|---|---|---|
| `enabled` | `false` | 插件总开关。`false` 时允许 `scan`，但 `apply` 会移除 MosDNS 注入。 |
| `scan.interval` | `6h` | 守护进程自动重新扫描 Cloudflare CDN IP 的间隔。`start` 时会立即扫描一次，不等这个间隔。 |
| `scan.concurrency` | `100` | 扫描候选 IP 时的并发数。过高可能触发网络波动或被上游限速。 |
| `scan.timeout` | `1s` | 单个 TCP 连接探测超时。 |
| `scan.max_duration` | `2s` | HTTP/HTTPS 校验请求最大耗时。 |
| `scan.test_domain` | `cloudflaremirrors.com/debian` | 用于确认候选 IP 是可用 Cloudflare 边缘节点的测试域名。 |
| `scan.expected_status` | `200` | 测试域名期望返回的 HTTP 状态码。 |
| `scan.port` | `443` | 校验候选 IP 时连接的端口。 |
| `scan.tls` | `true` | 是否使用 HTTPS 校验测试域名。 |
| `scan.colo_allowlist` | `[]` | 可选 Cloudflare 机房白名单，例如 `["HKG", "NRT", "SIN"]`。为空表示不限制。 |
| `scan.ipv4.enabled` | `true` | 是否扫描 IPv4。 |
| `scan.ipv4.candidate_source` | `baipiao` | IPv4 候选源。当前支持默认 `baipiao`，失败时会回退 Cloudflare 官方 IP 段。 |
| `scan.ipv4.result_count` | `2` | 保留几个最快 IPv4。 |
| `scan.ipv4.random_per_cidr` | `1` | 每个 IPv4 CIDR 随机抽样几个 IP。 |
| `scan.ipv6.enabled` | `auto` | IPv6 扫描开关。`auto` 会参考当前 MosDNS IPv6 设置；也可以写 `true` 或 `false`。 |
| `scan.ipv6.candidate_source` | `baipiao` | IPv6 候选源。当前支持默认 `baipiao`，失败时会回退 Cloudflare 官方 IP 段。 |
| `scan.ipv6.result_count` | `2` | 保留几个最快 IPv6。 |
| `scan.ipv6.random_per_cidr` | `1` | 每个 IPv6 CIDR 随机抽样几个 IP。 |
| `scan.ipv6.no_winner_policy` | `passthrough` | 没有 IPv6 结果时的策略。当前推荐保持 `passthrough`，即不改写 AAAA。 |
| `rules.manual` | `[]` | 手动域名规则列表。支持 `domain:`、`full:`、`keyword:`、`regexp:`，也兼容裸域名。 |
| `rules.subscriptions` | `[]` | 订阅列表。用于下载外部维护的域名名单。 |
| `rules.subscriptions[].name` | 无 | 订阅名称，只用于识别和错误提示。 |
| `rules.subscriptions[].enabled` | `false` | 是否启用该订阅。 |
| `rules.subscriptions[].url` | 无 | 订阅地址。 |
| `rules.subscriptions[].format` | `domain-list` | 订阅格式。当前按普通域名列表处理，支持注释、空行和常见规则前缀。 |
| `rules.subscriptions[].interval` | `24h` | 订阅刷新间隔预留字段；当前守护进程会在 apply 时读取订阅内容。 |
| `apply.ttl` | `60` | 预留字段。当前实际返回 TTL 取决于 MosDNS `rewrite` 插件行为。 |
| `apply.rewrite_a` | `true` | 是否生成 A 记录重定向。 |
| `apply.rewrite_aaaa` | `auto` | 是否生成 AAAA 重定向。`auto` 表示 IPv6 启用且扫描成功时才生成。 |
| `apply.restart_mosdns` | `auto` | apply / stop 后是否重启 MosDNS 使配置生效。`auto` 当前按需要重启。 |

### 域名规则格式

`rules.manual` 和订阅内容建议使用这些格式：

```text
domain:example.com        # 匹配 example.com 及其子域
full:www.example.org      # 只匹配完整域名
keyword:cloudflare-test   # 关键字匹配
regexp:^.+\.example\.net$ # 正则匹配
```

也兼容部分常见规则格式：

```text
example.com
DOMAIN-SUFFIX,example.com
DOMAIN,www.example.org
DOMAIN-KEYWORD,example
DOMAIN-REGEX,^.+\.example\.net$
```

不要把不确定的全局大名单直接塞进来。这个插件是把名单内域名强制返回 Cloudflare 优选真实 IP，名单质量会直接影响访问效果。

### 命令说明

常用命令：

```bash
sudo msf cloudflare-redirect status
sudo msf cloudflare-redirect start
sudo msf cloudflare-redirect stop
sudo msf cloudflare-redirect scan
sudo msf cloudflare-redirect apply
```

短别名：

```bash
sudo msf cf-redirect status
sudo msf cf-redirect scan
```

| 命令 | 作用 |
|---|---|
| `status` | 输出 JSON 状态，包括是否运行、是否启用、扫描结果、是否已注入 MosDNS、下一次扫描时间和 `hints` 提示。 |
| `start` | 启动守护进程。若 `enabled: true`，会立即执行一次重新扫描和应用；如果已经运行，再执行一次 `start` 也会同步触发一次 `scan + apply`。 |
| `stop` | 停止守护进程，并移除 MosDNS 中由插件注入的配置片段。 |
| `scan` | 手动扫描 Cloudflare CDN IPv4/IPv6，并写入状态文件；不要求 `enabled: true`，也不会单独注入 MosDNS。 |
| `apply` | 根据当前扫描结果和域名名单注入 MosDNS。若 `enabled: false`，会跳过注入并清理旧注入。 |

`status` 中的 `hints` 用于提示常见问题。例如：

- `enabled=false`：配置还没启用，`apply` 不会注入。
- `no scanned Cloudflare IPs yet`：还没有扫描结果，需要 `scan` 或 `start`。
- `enabled=true but MosDNS is not injected yet`：已启用但还没应用，需要 `apply` 或重新 `start`。
- `domain_count=0`：域名名单为空，注入后也不会有实际域名生效。

### 推荐使用流程

```bash
# 1. 编辑配置。
sudo nano <数据目录>/configs/cloudflare-redirect/cfyouxuan.yaml

# 2. 设置 enabled: true，并添加 rules.manual 或 rules.subscriptions。

# 3. 启动插件。start 会立即 scan + apply 一次。
sudo msf cloudflare-redirect start

# 4. 查看状态，确认 hints 为空、mosdns_injected=true。
sudo msf cloudflare-redirect status
```

手动刷新：

```bash
sudo msf cloudflare-redirect scan
sudo msf cloudflare-redirect apply
```

回滚停用：

```bash
sudo msf cloudflare-redirect stop
```

### 自动扫描时机

`start` 启动后会立即读取一次 `cfyouxuan.yaml`。如果 `enabled: true`，daemon 会立即重新扫描并应用一次；之后每分钟检查一次 YAML 是否变化，但后续自动重新扫描 Cloudflare CDN IP 仍按 `scan.interval` 执行，默认 `6h`。如果 daemon 已经在运行，再执行一次 `start` 也会同步触发一次 `scan + apply`。

### 生成文件

- `<数据目录>/data/cloudflare-redirect/state.json`
- `<数据目录>/data/cloudflare-redirect/cloudflare-redirect.pid`
- `<数据目录>/logs/cloudflare-redirect.log`
- `<数据目录>/configs/mosdns/rule/cloudflare_redirect.txt`
- `<数据目录>/configs/mosdns/rule/cloudflare_redirect_v6.txt`
- `<数据目录>/configs/mosdns/sub_config/cloudflare_redirect.yaml`

### 常见问题

- `apply` 提示 disabled：检查 `cfyouxuan.yaml` 是否为 `enabled: true`。
- `domain_count=0`：检查 `rules.manual` 或订阅是否为空，订阅 URL 是否能访问。
- `mosdns_injected=false`：先看 `hints`，通常是未启用、未扫描、域名为空或尚未 apply。
- IPv6 结果不理想：可以把 `scan.ipv6.enabled` 改成 `false`，只使用 IPv4 重定向。
- 访问变慢：优选 IP 是从 msf 本机网络测出来的，只适合直连客户端；如果效果不好，请 `stop` 停用并反馈网络环境、域名、扫描结果和 MosDNS 日志。

### 服务端口分配

下表为本项目实际监听的端口（以 `internal/server` 中的诊断/健康检查清单为准）。supervisor 通过 unix socket 管理进程，不占用 TCP 端口，故未列入。

| 服务 | 端口 | 描述 |
|---|---|---|
| msf | 7777 | Web 管理界面（默认 `-p 7777`）；mosdns 亦复用它解析节点域名 |
| mosdns | 53 | DNS 服务入口 |
| mosdns | 2222 | 内部的国内 DNS 服务器 |
| mosdns | 3333 | 转发国外请求到内部带过期缓存的服务 |
| mosdns | 4444 | 带过期缓存的内部使用/外部使用的国外 DNS 服务器 |
| mosdns | 5656 | 主分流服务器 |
| mosdns | 6666 | 与 mihomo/sing-box 的 DNS 对接 |
| mosdns | 8888 | 内部 DNS（代理核心的默认上游 `default-nameserver`） |
| mosdns | 9099 | MosDNS 统计 / API 接口 |
| mihomo/sing-box | 7890 | HTTP 代理 |
| mihomo/sing-box | 7891 | SOCKS5 代理 |
| mihomo/sing-box | 7892 | 混合端口（Mixed） |
| mihomo/sing-box | 7896 | TProxy 透明代理（nftables 策略使用） |
| mihomo/sing-box | 7877 | Redirect 代理（nftables 策略使用） |
| mihomo/sing-box | 9090 | 外部控制器 / Web 界面（zashboard） |

## 路由器接入（让局域网设备走 msf）

msf 默认以**旁路由**方式工作：它本身不是主网关，由主路由把 **DNS 查询**和**需要代理的流量**引导到 msf 主机。要让局域网设备生效，主路由需要完成两步：

1. **DHCP DNS 重定向**：把客户端 DNS 指向 msf 主机（MosDNS `:53`）。
2. **FakeIP 静态路由**：把 FakeIP 网段的下一跳指向 msf 主机。

| 类型 | 目标网段（msf 默认值） | 下一跳 |
|---|---|---|
| IPv4 | `28.0.0.0/8` | msf 主机 IPv4 |
| IPv6 | `f2b0::/18` | msf 主机 IPv6 |

> 只配 DNS 不配静态路由不行：FakeIP 是虚拟地址，缺少回程路由会被丢弃或直连出去。两步缺一不可。FakeIP 网段需与初始化向导里的实际配置一致。

按主路由系统查看分步教程：

- [路由器接入总览](docs/guide/zh/router-integration.md)
- [RouterOS（MikroTik）](docs/guide/zh/routeros.md)
- [爱快 iKuai](docs/guide/zh/ikuai.md)
- [OpenWrt](docs/guide/zh/openwrt.md)
- [UniFi（Ubiquiti）](docs/guide/zh/unifi.md)

验证：客户端执行 `nslookup google.com` 结果应落在 `28.0.0.0/8`，`dig AAAA google.com` 落在 `f2b0::/18`。

## 运行目录

普通 Linux 默认数据目录：

```text
/opt/msf
```

Unraid 默认数据目录：

```text
/mnt/user/appdata/msf
```

主要目录结构：

- `configs/mosdns`
- `configs/mihomo`
- `configs/network`
- `data/binaries`
- `logs`
- `database`
- `backups`

## 从源码构建

本地运行：

```bash
go run ./cmd/msf serve -c ./data -p 7777
```

构建 Linux x86_64 压缩包：

```bash
make package VERSION=0.3.5 GOOS=linux GOARCH=amd64
```

构建 Linux ARM64 压缩包：

```bash
make package VERSION=0.3.5 GOOS=linux GOARCH=arm64
```

构建 Unraid 插件产物：

```bash
make unraid VERSION=0.3.5 UNRAID_VERSION=0.3.5 GITHUB_REPO=scoltzero/msf RELEASE_TAG=v0.3.5
```

构建产物：

- `dist/msf-linux-amd64.tar.gz`
- `dist/msf-linux-arm64.tar.gz`
- `dist/unraid/msf-0.3.5-x86_64-1.txz`
- `dist/unraid/msf.plg`
- `msf.plg`

发布时，Linux `.tar.gz`、Unraid `.txz` 和 `.plg` 上传到 GitHub Release。根目录 `msf.plg` 可用于仓库分支安装入口。

## 说明

`msf` 不包含 MSM 的闭源后端代码。项目目标是做一个非商业用途的开放重构版：外观和使用体验参考 MSM，后端行为围绕 mssb 风格的 MosDNS + Mihomo 工作流重新实现。

## 鸣谢

感谢这些项目提供参考：

- `msm9527/msm-wiki`：作为 MSM 管理体验和功能组织的公开参考。
- `baozaodetudou/mssb`：作为 MosDNS + Mihomo 后端工作流的公开参考。

本项目与 MSM、mssb 上游项目没有隶属关系。
