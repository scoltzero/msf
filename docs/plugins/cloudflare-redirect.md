# Cloudflare Redirect CLI 插件

Cloudflare Redirect 是一个**命令行测试插件**，用于改善**不走代理的局域网客户端**访问用户指定的 Cloudflare 盾站时的直连连通性。它会从运行 `msf` 的这台机器出发，扫描本机网络到 Cloudflare CDN 的较快 IPv4/IPv6，然后把用户维护名单中的域名注入到 MosDNS 的“指定客户端直连”分支中。

请先明确它的边界：

- 它只对 MosDNS 当前判断为“指定客户端直连”的客户端生效。
- 代理客户端仍走原有 FakeIP / 代理分流，不会被此插件改写。
- 它不会自动判断哪些域名使用 Cloudflare，域名名单必须由用户手动维护或订阅提供。
- 它不做 TCP 转发，不改 WebUI，不把优选 IP 加入国内 DNS 上游。
- 它不写入全局 `configs/mosdns/rule/rewrite.txt`，而是使用独立生成文件。
- 这是测试功能，不保证所有网络环境都变快；如果访问变慢、IPv6 不通、规则冲突或 MosDNS 无法启动，请先 `stop` 回滚并反馈。

代理客户端访问 Cloudflare 盾站时，应由代理出口自行选择 Cloudflare 边缘节点；本插件只服务直连客户端。若同一域名同时存在于代理规则和 Cloudflare Redirect 名单中，代理客户端仍按原规则拿 FakeIP，直连客户端才会拿 Cloudflare 优选真实 IP。

## 配置文件位置

配置文件会在 `msf init`、安装脚本或 WebUI 初始化时自动创建：

```text
<数据目录>/configs/cloudflare-redirect/cfyouxuan.yaml
```

数据目录不是按 CPU 架构区分，而是按运行方式区分。常见位置如下：

| 部署方式 | 数据目录 | YAML 完整路径 |
|---|---|---|
| Linux systemd 安装包，含 amd64/arm64 | `/opt/msf` | `/opt/msf/configs/cloudflare-redirect/cfyouxuan.yaml` |
| Linux 安装包指定 `--data-dir` | 用户指定目录 | `<指定目录>/configs/cloudflare-redirect/cfyouxuan.yaml` |
| fnOS FPK | `/var/apps/msf/var` | `/var/apps/msf/var/configs/cloudflare-redirect/cfyouxuan.yaml` |
| Unraid PLG | `/mnt/user/appdata/msf` | `/mnt/user/appdata/msf/configs/cloudflare-redirect/cfyouxuan.yaml` |
| Docker Compose / `docker-run.sh` 宿主机 | 默认当前目录的 `./msf-data` | `./msf-data/configs/cloudflare-redirect/cfyouxuan.yaml` |
| Docker 容器内 | `/opt/msf` | `/opt/msf/configs/cloudflare-redirect/cfyouxuan.yaml` |
| 源码本地非 root 运行 | 通常是 `./data`，取决于 `-c` / `--config` | `./data/configs/cloudflare-redirect/cfyouxuan.yaml` |
| root 直接运行裸二进制且未设置环境变量 | `/opt/msf` | `/opt/msf/configs/cloudflare-redirect/cfyouxuan.yaml` |

实际优先级是：`MSF_DATA_DIR` > `MSM_FREE_DATA_DIR` > root 默认 `/opt/msf` > 非 root 默认 `./data`。如果是 systemd 安装，安装脚本通常会把 `MSF_DATA_DIR` 写进服务文件，所以以服务配置为准。

可以用下面的命令确认插件当前找到的配置文件路径：

```bash
sudo msf cloudflare-redirect status
```

输出里的 `config` 字段就是正在读取的 `cfyouxuan.yaml`。命令会自动从 `MSF_DATA_DIR`、Unraid 配置、systemd service 配置、`.msf` 兼容目录和常见安装目录中发现当前数据目录。通常不需要加 `--config`。如果自动发现失败，可以显式指定：

```bash
sudo msf cloudflare-redirect status --config /path/to/msf-data
sudo msf cloudflare-redirect --config /path/to/msf-data status
```

## 完整配置示例

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

## 配置字段说明

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

## 域名规则格式

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

## 命令说明

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

## 推荐使用流程

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

## 自动扫描时机

`start` 启动后会立即读取一次 `cfyouxuan.yaml`。如果 `enabled: true`，daemon 会立即重新扫描并应用一次；之后每分钟检查一次 YAML 是否变化，但后续自动重新扫描 Cloudflare CDN IP 仍按 `scan.interval` 执行，默认 `6h`。如果 daemon 已经在运行，再执行一次 `start` 也会同步触发一次 `scan + apply`。

## 生成文件

- `<数据目录>/data/cloudflare-redirect/state.json`
- `<数据目录>/data/cloudflare-redirect/cloudflare-redirect.pid`
- `<数据目录>/logs/cloudflare-redirect.log`
- `<数据目录>/configs/mosdns/rule/cloudflare_redirect.txt`
- `<数据目录>/configs/mosdns/rule/cloudflare_redirect_v6.txt`
- `<数据目录>/configs/mosdns/sub_config/cloudflare_redirect.yaml`

## 常见问题

- `apply` 提示 disabled：检查 `cfyouxuan.yaml` 是否为 `enabled: true`。
- `domain_count=0`：检查 `rules.manual` 或订阅是否为空，订阅 URL 是否能访问。
- `mosdns_injected=false`：先看 `hints`，通常是未启用、未扫描、域名为空或尚未 apply。
- IPv6 结果不理想：可以把 `scan.ipv6.enabled` 改成 `false`，只使用 IPv4 重定向。
- 访问变慢：优选 IP 是从 msf 本机网络测出来的，只适合直连客户端；如果效果不好，请 `stop` 停用并反馈网络环境、域名、扫描结果和 MosDNS 日志。
