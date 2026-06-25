# Docker 实验部署

Docker host-network 部署目前是实验性能力，尚未作为推荐安装方式。它适合熟悉 Docker、nftables、策略路由和透明代理行为的用户验证当前实现；生产或长期使用优先选择 [Linux tarball/systemd](install/linux.md)、[fnOS FPK](install/fnos-fpk.md) 或 [Unraid PLG](install/unraid-plg.md)。

当前版本：`v0.3.6`

## 当前状态

- Docker 镜像会以 host 网络运行，并尝试在宿主机网络命名空间中管理 MosDNS、Mihomo、FakeIP、TProxy/Redirect、nftables 和策略路由。
- Docker 实现还没有完全完成，不承诺与 Linux tarball/systemd 完全等价。
- 不支持把 br0、macvlan、ipvlan、bridge 静态 IP 或端口映射模式当作等价部署方式。
- 容器内禁用 `msf update` 和 WebUI 自更新安装；镜像升级必须通过 Docker / Compose / 容器管理器完成。

如果你的目标是稳定部署，请先使用 Linux、fnOS 或 Unraid 安装方式。

## 运行要求

Docker 版必须使用宿主机网络命名空间：

```yaml
network_mode: host
cap_add:
  - NET_ADMIN
  - NET_RAW
```

MSF 需要绑定 MosDNS `:53`、写入宿主机 nftables、写入 `ip rule` / `ip route`，所以容器需要网络管理权限。若容器拥有独立网络命名空间，相关规则只会落在容器内部，不能完整接管宿主机和局域网流量。

## 快速启动：Docker Compose

```bash
mkdir -p msf-data
docker compose up -d
```

默认 compose 文件使用：

- 镜像：`ghcr.io/scoltzero/msf:latest`
- 数据目录：`./msf-data:/opt/msf`
- WebUI：`http://<宿主机IP>:7777`
- 停止宽限期：`30s`
- 运行标识：`MSF_RUNTIME=docker`

首次打开 WebUI 后完成初始化向导。完成初始化后，MSF 会按保存状态恢复 MosDNS、Mihomo 和 nftables。

## 快速启动：普通 Docker

没有 `docker compose` 或 Docker Compose plugin 的机器可以直接使用 `docker run`：

```bash
mkdir -p msf-data
docker run -d \
  --name msf \
  --network host \
  --cap-add NET_ADMIN \
  --cap-add NET_RAW \
  --restart unless-stopped \
  --stop-timeout 30 \
  -e MSF_RUNTIME=docker \
  -e MSF_DATA_DIR=/opt/msf \
  -e MSF_DOCKER_CLEANUP_NETWORK_ON_EXIT=true \
  -v "$PWD/msf-data:/opt/msf" \
  ghcr.io/scoltzero/msf:latest
```

仓库根目录也提供了同等参数的脚本：

```bash
./docker-run.sh
```

脚本可用环境变量覆盖默认值：

| 变量 | 默认值 | 用途 |
|---|---|---|
| `MSF_IMAGE` | `ghcr.io/scoltzero/msf:latest` | 容器镜像 |
| `MSF_CONTAINER_NAME` | `msf` | 容器名称 |
| `MSF_DOCKER_DATA_DIR` | `$PWD/msf-data` | 宿主机数据目录 |
| `MSF_DOCKER_CLEANUP_NETWORK_ON_EXIT` | `true` | 正常退出时是否清理 MSF 网络规则 |

如果同名容器已经存在，先停止并删除旧容器：

```bash
docker stop msf
docker rm msf
```

## 路由接入

Docker host 网络模式下，MSF 使用宿主机 IP 对外提供服务。路由器侧按普通 Linux 部署接入：

1. DHCP DNS 指向 MSF 宿主机 IP，默认 MosDNS 监听 `:53`。
2. FakeIP 静态路由指向 MSF 宿主机 IP。

默认 FakeIP 网段：

| 类型 | 网段 |
|---|---|
| IPv4 | `28.0.0.0/8` |
| IPv6 | `f2b0::/18` |

如果初始化时改过 FakeIP 网段，以 WebUI 中的实际配置为准。完整教程见 [路由器接入总览](guide/zh/router-integration.md)。

## 网络清理

Docker 镜像默认设置：

```text
MSF_RUNTIME=docker
MSF_DOCKER_CLEANUP_NETWORK_ON_EXIT=true
```

正常 `docker stop`、`docker compose down`、WebUI 停止或重启会先停止 MosDNS/Mihomo，再尝试清理 MSF 自己创建的网络资源：

- `table inet msf`
- `fwmark 1 table 100` 策略路由规则
- table `100` 的 IPv4/IPv6 local route

不会清理或重写宿主机其他 nftables 表。`kill -9`、宿主机断电、内核崩溃等异常场景无法保证进程级清理；如果发生这种情况，可重新启动容器后在 WebUI 清除 nftables，或手动删除 `table inet msf` 和 table `100` 相关规则。

如果确实需要保留规则，可显式设置：

```yaml
environment:
  MSF_DOCKER_CLEANUP_NETWORK_ON_EXIT: "false"
```

普通 `docker run` 可使用：

```bash
-e MSF_DOCKER_CLEANUP_NETWORK_ON_EXIT=false
```

## 更新和卸载

Docker 容器内禁用 `msf update` 和 WebUI 自更新安装。镜像升级应通过拉取新镜像并重建容器完成。

Docker Compose：

```bash
docker compose pull
docker compose up -d
```

普通 Docker：

```bash
docker pull ghcr.io/scoltzero/msf:latest
docker stop msf
docker rm msf
./docker-run.sh
```

卸载时通过 Docker / Compose / 容器管理器删除容器。默认数据目录在宿主机当前目录的 `./msf-data`，需要彻底清理时再手动删除该目录。

MosDNS、Mihomo、Zashboard 的组件更新仍可在 WebUI 中使用。

## 常见端口

host 网络模式没有 Docker 端口映射隔离，宿主机上不能已有进程占用这些端口：

| 端口 | 用途 |
|---|---|
| `7777` | MSF WebUI |
| `53/tcp,udp` | MosDNS |
| `7890` | Mihomo HTTP proxy |
| `7891` | Mihomo SOCKS proxy |
| `7892` | Mihomo mixed proxy |
| `7877` | Redirect |
| `7896` | TProxy |
| `9090` | Mihomo controller / Zashboard |
| `9099` | MosDNS observability |
