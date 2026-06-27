# Docker TUN 实验部署

[English version](docker.en.md)

Docker 部署目前仍是实验性能力，尚未作为推荐安装方式。它适合熟悉 Docker、TUN、静态路由和旁路由接入的用户验证当前实现；生产或长期使用优先选择 [Linux tarball/systemd](install/linux.md)、[fnOS FPK](install/fnos-fpk.md) 或 [Unraid PLG](install/unraid-plg.md)。

当前版本：`v0.3.8`

当前 Docker 实验镜像：

```text
ghcr.io/scoltzero/msf:v0.3.8
```

这个实验镜像不会推送到 `latest`。拉取或部署 Docker 实验版时必须显式写出 `v0.3.8` tag。

## 当前状态

- Docker 版默认使用 Mihomo TUN，不再由 MSF 写入宿主机 nftables 或 policy routing。
- 支持两种容器网络：`host-tun` 和 `macvlan-tun`。
- `host-tun` 是默认入口，适合普通 Linux Docker 主机。
- `macvlan-tun` 让容器拥有独立 LAN IPv4，适合 Unraid Dockerman / br0 / 自定义网络场景。
- 运行数据必须映射到宿主机目录；容器内数据目录固定为 `/opt/msf`，默认示例映射到宿主机 `./msf-data`。
- 容器内禁用 `msf update` 和 WebUI 自更新安装；镜像升级必须通过 Docker / Compose / 容器管理器完成。

如果你的目标是稳定部署，请先使用 Linux、fnOS 或 Unraid PLG 安装方式。

## 运行要求

两种模式都需要 TUN 设备和网络管理权限：

```yaml
cap_add:
  - NET_ADMIN
  - NET_RAW
devices:
  - /dev/net/tun:/dev/net/tun
```

Docker 镜像默认设置：

```text
MSF_RUNTIME=docker
MSF_DOCKER_NETWORK_MODE=host-tun
MSF_DOCKER_CLEANUP_NETWORK_ON_EXIT=false
```

Docker TUN 模式下，Mihomo 配置会启用 `tun.auto-route`、`tun.auto-detect-interface` 和 `tun.route-address`，显式保持 `tun.dns-hijack=[]`、`tun.auto-redirect=false`，并配置 `dns.proxy-server-nameserver`。DNS 分流仍由 MosDNS 负责，Mihomo 只接管 Fake-IP 和必要公网目标。这意味着 MSF 不会写宿主机 `table inet msf`、`fwmark 1 table 100`、`ip rule` 或 `ip route`。

数据目录必须持久化映射：

```text
宿主机目录  ->  容器目录
./msf-data  ->  /opt/msf
```

MosDNS、Mihomo、Zashboard 下载文件、数据库、配置、日志和用户上传的 Mihomo 配置都会写入 `/opt/msf`。如果不映射这个目录，容器重建后这些数据会丢失，WebUI 中的组件下载和配置管理也无法可靠工作。

## 快速启动：host TUN

host TUN 使用宿主机 IP 对外提供 WebUI、DNS 和代理服务。

### Docker Compose

仓库根目录已经提供 `docker-compose.yml`。如果你需要手工创建文件，可以直接复制下面内容保存为 `docker-compose.yml`：

```yaml
services:
  msf:
    image: ghcr.io/scoltzero/msf:v0.3.8
    container_name: msf
    network_mode: host
    cap_add:
      - NET_ADMIN
      - NET_RAW
    devices:
      - /dev/net/tun:/dev/net/tun
    environment:
      MSF_RUNTIME: docker
      MSF_DATA_DIR: /opt/msf
      MSF_DOCKER_NETWORK_MODE: host-tun
      MSF_DOCKER_CLEANUP_NETWORK_ON_EXIT: "false"
    volumes:
      - ./msf-data:/opt/msf
    restart: unless-stopped
    stop_grace_period: 30s
```

启动：

```bash
mkdir -p msf-data
docker compose up -d
```

默认 compose 文件使用：

- 镜像：`ghcr.io/scoltzero/msf:v0.3.8`
- 网络：`host`
- 数据目录：`./msf-data:/opt/msf`
- WebUI：`http://<宿主机IP>:7777`
- 运行标识：`MSF_RUNTIME=docker`
- Docker 网络模式：`MSF_DOCKER_NETWORK_MODE=host-tun`

### 普通 Docker 脚本

不适合使用 Docker Compose 的机器可以直接运行：

```bash
mkdir -p msf-data
./docker-run.sh
```

等价的核心参数是：

```bash
docker run -d \
  --name msf \
  --network host \
  --cap-add NET_ADMIN \
  --cap-add NET_RAW \
  --device /dev/net/tun:/dev/net/tun \
  --restart unless-stopped \
  --stop-timeout 30 \
  -e MSF_RUNTIME=docker \
  -e MSF_DOCKER_NETWORK_MODE=host-tun \
  -e MSF_DATA_DIR=/opt/msf \
  -v "$PWD/msf-data:/opt/msf" \
  ghcr.io/scoltzero/msf:v0.3.8
```

## 快速启动：macvlan TUN

macvlan TUN 给容器分配独立 LAN IPv4。路由器侧 DHCP DNS 和 FakeIP 静态路由都应指向这个容器 IPv4，而不是宿主机 IP。

### Docker Compose

仓库根目录已经提供 `docker-compose.macvlan.yml`。如果你需要手工创建文件，可以直接复制下面内容保存为 `docker-compose.macvlan.yml`：

```yaml
services:
  msf:
    image: ${MSF_IMAGE:-ghcr.io/scoltzero/msf:v0.3.8}
    container_name: ${MSF_CONTAINER_NAME:-msf}
    cap_add:
      - NET_ADMIN
      - NET_RAW
    devices:
      - /dev/net/tun:/dev/net/tun
    environment:
      MSF_RUNTIME: docker
      MSF_DATA_DIR: /opt/msf
      MSF_DOCKER_NETWORK_MODE: macvlan-tun
      MSF_DOCKER_CLEANUP_NETWORK_ON_EXIT: "false"
    volumes:
      - ${MSF_DOCKER_DATA_DIR:-./msf-data}:/opt/msf
    networks:
      msf_macvlan:
        ipv4_address: ${MSF_DOCKER_IPV4_ADDRESS:?set MSF_DOCKER_IPV4_ADDRESS}
    restart: unless-stopped
    stop_grace_period: 30s

networks:
  msf_macvlan:
    name: ${MSF_DOCKER_NETWORK_NAME:-msf-macvlan}
    driver: macvlan
    driver_opts:
      parent: ${MSF_DOCKER_PARENT_IFACE:?set MSF_DOCKER_PARENT_IFACE}
    ipam:
      config:
        - subnet: ${MSF_DOCKER_SUBNET:?set MSF_DOCKER_SUBNET}
          gateway: ${MSF_DOCKER_GATEWAY:?set MSF_DOCKER_GATEWAY}
```

复制示例环境变量并按你的 LAN 修改：

```bash
cp docker.env.example .env
```

也可以直接复制下面这个 macvlan compose `.env` 示例保存为 `.env` 后修改：

```text
MSF_IMAGE=ghcr.io/scoltzero/msf:v0.3.8
MSF_CONTAINER_NAME=msf
MSF_DOCKER_DATA_DIR=./msf-data
MSF_DOCKER_NETWORK_NAME=msf-macvlan
MSF_DOCKER_PARENT_IFACE=eth0
MSF_DOCKER_SUBNET=192.168.1.0/24
MSF_DOCKER_GATEWAY=192.168.1.1
MSF_DOCKER_IPV4_ADDRESS=192.168.1.10
```

macvlan 模式至少需要按你的 LAN 修改 `MSF_DOCKER_PARENT_IFACE`、`MSF_DOCKER_SUBNET`、`MSF_DOCKER_GATEWAY` 和 `MSF_DOCKER_IPV4_ADDRESS`。

启动：

```bash
mkdir -p msf-data
docker compose -f docker-compose.macvlan.yml up -d
```

### 普通 Docker 脚本

```bash
MSF_DOCKER_NETWORK_MODE=macvlan-tun \
MSF_DOCKER_PARENT_IFACE=eth0 \
MSF_DOCKER_SUBNET=192.168.1.0/24 \
MSF_DOCKER_GATEWAY=192.168.1.1 \
MSF_DOCKER_IPV4_ADDRESS=192.168.1.10 \
./docker-run.sh
```

脚本会在 `msf-macvlan` 网络不存在时创建它。可用 `MSF_DOCKER_NETWORK_NAME` 覆盖网络名。

## Unraid Dockerman IPv4 macvlan

首版按 Unraid Dockerman 手工配置支持，不提供 Community Applications 容器模板。

1. 在 Unraid Docker 设置中启用自定义网络，并选择 `macvlan` 或你当前系统推荐的自定义网络实现。
2. 新建容器，镜像填写 `ghcr.io/scoltzero/msf:v0.3.8`。
3. Network Type 选择自定义 LAN 网络，例如 `br0`。
4. Fixed IP address 填写一个未被 DHCP 分配的静态 IPv4，例如 `192.168.1.10`。
5. Extra Parameters 或高级参数添加：

```text
--cap-add NET_ADMIN --cap-add NET_RAW --device /dev/net/tun:/dev/net/tun
```

6. 添加环境变量：

| 变量 | 值 |
|---|---|
| `MSF_RUNTIME` | `docker` |
| `MSF_DOCKER_NETWORK_MODE` | `macvlan-tun` |
| `MSF_DATA_DIR` | `/opt/msf` |

7. 添加路径映射：

| 宿主机路径 | 容器路径 |
|---|---|
| `/mnt/user/appdata/msf-docker` | `/opt/msf` |

WebUI 地址为 `http://<容器IPv4>:7777`。

## 路由接入

首次打开 WebUI 后完成初始化向导。Docker runtime 下初始化页默认选择 TUN 模式。

路由器侧需要：

1. DHCP DNS 指向 MSF 地址。
2. FakeIP 静态路由指向同一个 MSF 地址。

MSF 地址按网络模式选择：

| Docker 模式 | 路由器应指向 |
|---|---|
| `host-tun` | Docker 宿主机 LAN IP |
| `macvlan-tun` | 容器独立 LAN IPv4 |

默认 FakeIP 网段：

| 类型 | 网段 |
|---|---|
| IPv4 | `28.0.0.0/8` |
| IPv6 | `f2b0::/18` |

macvlan 首版只承诺 IPv4 接入。完整教程见 [路由器接入总览](guide/zh/router-integration.md)。

## 脚本变量

`docker-run.sh` 支持：

| 变量 | 默认值 | 用途 |
|---|---|---|
| `MSF_IMAGE` | `ghcr.io/scoltzero/msf:v0.3.8` | 容器镜像 |
| `MSF_CONTAINER_NAME` | `msf` | 容器名称 |
| `MSF_DOCKER_DATA_DIR` | `$PWD/msf-data` | 宿主机数据目录 |
| `MSF_DOCKER_NETWORK_MODE` | `host-tun` | `host-tun` 或 `macvlan-tun` |
| `MSF_DOCKER_NETWORK_NAME` | `msf-macvlan` | macvlan Docker network 名称 |
| `MSF_DOCKER_PARENT_IFACE` | 无 | macvlan 父接口 |
| `MSF_DOCKER_SUBNET` | 无 | macvlan IPv4 子网 |
| `MSF_DOCKER_GATEWAY` | 无 | macvlan IPv4 网关 |
| `MSF_DOCKER_IPV4_ADDRESS` | 无 | 容器静态 IPv4 |

如果同名容器已经存在，先停止并删除旧容器：

```bash
docker stop msf
docker rm msf
```

## 常见问题

### LXC / Proxmox 提示 `/dev/net/tun` 不存在

如果部署时报错：

```text
error gathering device information while adding custom device "/dev/net/tun": no such file or directory
```

说明 Docker daemon 所在的运行环境没有 `/dev/net/tun`。如果 Docker 跑在 LXC 里，需要在 LXC 容器内检查：

```bash
ls -l /dev/net/tun
cat /dev/net/tun
```

正常情况下，`cat /dev/net/tun` 应返回类似 `File descriptor in bad state`。如果文件不存在，需要在外层宿主机加载并透传 TUN，例如 Proxmox LXC 可参考：

```bash
modprobe tun
```

```text
features: nesting=1
lxc.cgroup2.devices.allow: c 10:200 rwm
lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
```

修改 LXC 配置后重启容器。不同平台的 LXC 权限模型不完全一样，必要时请使用 privileged LXC 或 VM 测试。

### v0.3.7 Docker TUN 出现 DNS / Fake-IP 连接异常

`v0.3.7` 的 Docker TUN 默认配置存在缺陷：Mihomo 可能把节点服务器域名解析成 `28.0.0.x` 这类 Fake-IP，随后拨号失败；日志里也可能出现大量 `127.0.0.1:8888 connection refused` 或节点域名连接超时。

修复版本会统一 Linux TUN 生成逻辑：

- `tun.stack` 使用 `system`。
- `tun.dns-hijack` 保持空数组，由 MosDNS 继续负责 DNS 分流。
- `tun.route-address` 包含 Fake-IP 网段和必要公网目标。
- `tun.route-exclude-address` 排除 LAN、loopback、link-local 和常见国内 DNS。
- `dns.proxy-server-nameserver` 使用 `223.5.5.5`、`119.29.29.29`，避免节点服务器域名被 Fake-IP 污染。

升级到修复版本后，如果你仍使用生成配置模式，MSF 会在启动时自动修正旧的 TUN / DNS 配置块。若你已经切换到 Mihomo 自定义配置模式，MSF 不会自动覆盖你的文件，请按上面的字段手动调整，或在 WebUI 中恢复为生成配置后重新生成。

### macvlan 提示 `invalid subinterface vlan name`

如果部署时报错类似：

```text
invalid subinterface vlan name MSF_DOCKER_PARENT_IFACE:eth0, example formatting is eth0.10
```

说明 Docker 收到的 macvlan `parent` 不是实际网卡名。`parent` 必须是 Docker 所在宿主环境中的真实接口，例如 `eth0`、`ens18`、`br0` 或 VLAN 子接口 `eth0.10`。

`.env` 文件必须使用等号写法：

```text
MSF_DOCKER_PARENT_IFACE=eth0
```

不要写成：

```text
MSF_DOCKER_PARENT_IFACE:eth0
```

在 Portainer Stack 里，请把 `MSF_DOCKER_PARENT_IFACE` 作为环境变量名、`eth0` 作为值填写，不要把 `MSF_DOCKER_PARENT_IFACE:eth0` 当成一个完整值。可以先用下面命令确认 compose 展开结果：

```bash
MSF_DOCKER_PARENT_IFACE=eth0 \
MSF_DOCKER_SUBNET=192.168.1.0/24 \
MSF_DOCKER_GATEWAY=192.168.1.1 \
MSF_DOCKER_IPV4_ADDRESS=192.168.1.10 \
docker compose -f docker-compose.macvlan.yml config
```

输出中应能看到：

```yaml
driver_opts:
  parent: eth0
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
docker pull ghcr.io/scoltzero/msf:v0.3.8
docker stop msf
docker rm msf
./docker-run.sh
```

卸载时通过 Docker / Compose / 容器管理器删除容器。默认数据目录在宿主机当前目录的 `./msf-data`，需要彻底清理时再手动删除该目录。

MosDNS、Mihomo、Zashboard 的组件更新仍可在 WebUI 中使用。

## 常见端口

Docker TUN 默认不使用 TProxy/Redirect 端口。

| 端口 | 用途 |
|---|---|
| `7777` | MSF WebUI |
| `53/tcp,udp` | MosDNS |
| `7890` | Mihomo HTTP proxy |
| `7891` | Mihomo SOCKS proxy |
| `7892` | Mihomo mixed proxy |
| `9090` | Mihomo controller / Zashboard |
| `9099` | MosDNS observability |
