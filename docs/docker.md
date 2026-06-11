# Docker 部署

`msf` 的 Docker 镜像目标是一比一复刻普通 Linux 二进制能力：WebUI、MosDNS、Mihomo、FakeIP、TProxy/Redirect、nftables 和策略路由都会在容器中可用。

## 运行要求

Docker 版必须使用宿主机网络命名空间：

```yaml
network_mode: host
cap_add:
  - NET_ADMIN
  - NET_RAW
```

不要使用 br0、macvlan、ipvlan、bridge 静态 IP 或端口映射模式作为等价部署方式。MSF 需要写入宿主机的 nftables 和策略路由；如果容器拥有独立网络命名空间，这些规则只会落在容器内部，不能完整接管宿主机和局域网流量。

容器内默认以 root 运行。绑定 MosDNS `:53`、写 nftables、写 `ip rule` / `ip route` 都需要网络管理权限。

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

Docker host 网络模式下，MSF 使用宿主机 IP 对外提供服务。路由器侧仍按普通 Linux 部署接入：

1. DHCP DNS 指向 MSF 宿主机 IP，默认 MosDNS 监听 `:53`。
2. FakeIP 静态路由指向 MSF 宿主机 IP。

默认 FakeIP 网段：

| 类型 | 网段 |
|---|---|
| IPv4 | `28.0.0.0/8` |
| IPv6 | `f2b0::/18` |

如果初始化时改过 FakeIP 网段，以 WebUI 中的实际配置为准。

## 网络清理

Docker 镜像默认设置：

```text
MSF_RUNTIME=docker
MSF_DOCKER_CLEANUP_NETWORK_ON_EXIT=true
```

正常 `docker stop`、`docker compose down`、WebUI 停止或重启会先停止 MosDNS/Mihomo，再清理 MSF 自己创建的网络资源：

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

## 更新方式

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
