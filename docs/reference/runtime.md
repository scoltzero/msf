# 运行参考

本页面汇总 `msf` 的常见数据目录、主要文件结构和默认端口。具体安装步骤请先看对应平台文档：

- [Linux tarball/systemd](../install/linux.md)
- [fnOS FPK](../install/fnos-fpk.md)
- [Unraid PLG](../install/unraid-plg.md)
- [Docker 实验部署](../docker.md)
- [macOS 菜单栏版](../install/macos.md)

## 数据目录

| 部署方式 | 默认数据目录 |
|---|---|
| Linux tarball/systemd | `/opt/msf` |
| fnOS FPK | `/var/apps/msf/var` |
| Unraid PLG | `/mnt/user/appdata/msf` |
| Docker Compose / `docker-run.sh` 宿主机 | 默认当前目录的 `./msf-data` |
| Docker 容器内 | `/opt/msf` |
| macOS root LaunchDaemon | `/Library/Application Support/MSF` |
| 源码本地非 root 运行 | 通常是 `./data`，取决于 `-c` / `--config` |

主要目录结构：

- `configs/mosdns`
- `configs/mihomo`
- `configs/network`
- `configs/cloudflare-redirect`
- `data/binaries`
- `logs`
- `database`
- `backups`

macOS 在 TUN 接管期间额外保存 `configs/network/darwin-state.json`，其中包含原始网络服务 DNS 与 `net.inet.ip.forwarding`。完全停止或守护进程正常退出时按快照恢复，而不是写死某个系统默认值。

## 服务端口分配

下表为本项目实际监听的端口（以 `internal/server` 中的诊断/健康检查清单为准）。supervisor 通过 unix socket 管理进程，不占用 TCP 端口，故未列入。

| 服务 | 端口 | 描述 |
|---|---|---|
| msf | `7777` | Web 管理界面（默认 `-p 7777`）；mosdns 亦复用它解析节点域名 |
| mosdns | `53` | DNS 服务入口 |
| mosdns | `2222` | 内部的国内 DNS 服务器 |
| mosdns | `3333` | 转发国外请求到内部带过期缓存的服务 |
| mosdns | `4444` | 带过期缓存的内部使用/外部使用的国外 DNS 服务器 |
| mosdns | `6666` | 与 mihomo/sing-box 的 DNS 对接 |
| mosdns | `8888` | 内部 DNS（代理核心的默认上游 `default-nameserver`） |
| mosdns | `9099` | MosDNS 统计 / API 接口 |
| mihomo/sing-box | `7890` | HTTP 代理 |
| mihomo/sing-box | `7891` | SOCKS5 代理 |
| mihomo/sing-box | `7892` | 混合端口（Mixed） |
| mihomo/sing-box | `7896` | TProxy 透明代理（nftables 策略使用；Linux TUN 模式默认不启用） |
| mihomo/sing-box | `7877` | Redirect 代理（nftables 策略使用；Linux TUN 模式默认不启用） |
| mihomo/sing-box | `9090` | 外部控制器 / Web 界面（zashboard） |

host 网络模式下没有端口映射隔离，因此 Docker host TUN 宿主机上也不能已有进程占用启用中的端口。Linux TUN 模式默认不启用 `7877` / `7896`。

macOS 后台管理页仅监听 `127.0.0.1:7777`；MosDNS 的 `53` 端口仍监听 LAN。macOS 不生成或加载 nftables，透明接管只使用 Mihomo `utun`、Fake-IP 路由、本机 DNS 与 IPv4 转发。

统一 Network Runtime API 为：

- `GET /api/v1/network/runtime`
- `POST /api/v1/network/runtime/enable`
- `POST /api/v1/network/runtime/disable`
- `POST /api/v1/network/runtime/restart`
- `POST /api/v1/network/runtime/stop`

其中 `disable` 表示 TUN/DNS 保活的直连状态，`stop` 才会拆除系统网络接管并停止组件。

## 初始化后的运行状态

首次进入 WebUI 会显示初始化向导。初始化会写入系统配置、生成 MosDNS/Mihomo 配置，并保存到数据库。

几个关键点：

- 机场订阅保存为 `名称|URL` 换行格式，最终进入 Mihomo `proxy-providers`。
- 手动节点保存到 `mihomo_proxies`，生成 `configs/mihomo/proxy_providers/msf_manual.yaml`。
- `msf_manual` 在 Mihomo 中作为 `type: file` 的本地 proxy provider 注册。
- GitHub 下载代理只影响组件下载过程，不会修改代理服务本身的运行配置。
- 自定义 Mihomo 配置保存在 `configs/mihomo/user_configs`，应用时会覆盖运行入口 `configs/mihomo/config.yaml` 并重启 Mihomo。
- WebUI 配置文件列表只展示用户可管理的配置文件，不直接展示内部启动文件 `config.yaml`。
- 本地上传组件在系统设置 / 系统更新 / 组件更新中上传，可用于离线安装 MosDNS、Mihomo 或 Zashboard。
