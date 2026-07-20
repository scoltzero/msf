# Linux tarball/systemd 安装

本页面适用于普通 Linux 主机上的 `msf-linux-amd64.tar.gz` / `msf-linux-arm64.tar.gz` 安装包。Linux tarball/systemd 是当前推荐的通用安装方式，也是唯一支持 `msf update` 和 `msf uninstall` 的安装方式。

初始化向导支持 nftables 与 TUN。选择 TUN 时，宿主机必须以 root 运行并提供可用的 `/dev/net/tun`。

当前版本：`v0.3.9.5`

## 下载

| 架构 | 下载地址 |
|---|---|
| x86_64 / amd64 | `https://github.com/scoltzero/msf/releases/download/v0.3.9.5/msf-linux-amd64.tar.gz` |
| ARM64 / aarch64 | `https://github.com/scoltzero/msf/releases/download/v0.3.9.5/msf-linux-arm64.tar.gz` |

Release 页面：

```text
https://github.com/scoltzero/msf/releases/tag/v0.3.9.5
```

## 安装

x86_64 / amd64：

```bash
curl -L -o msf-linux-amd64.tar.gz \
  https://github.com/scoltzero/msf/releases/download/v0.3.9.5/msf-linux-amd64.tar.gz

tar -xzf msf-linux-amd64.tar.gz -C /tmp
sudo /tmp/msf-0.3.9.5-linux-amd64/install.sh
```

ARM64 / aarch64：

```bash
curl -L -o msf-linux-arm64.tar.gz \
  https://github.com/scoltzero/msf/releases/download/v0.3.9.5/msf-linux-arm64.tar.gz

tar -xzf msf-linux-arm64.tar.gz -C /tmp
sudo /tmp/msf-0.3.9.5-linux-arm64/install.sh
```

安装脚本默认完成这些操作：

- 安装二进制到 `/usr/local/bin/msf`
- 注册兼容命令 `/usr/local/bin/msm`
- 初始化数据目录 `/opt/msf`
- 安装 systemd 服务 `msf.service`
- 启动 WebUI，默认监听 `0.0.0.0:7777`

自定义数据目录、监听地址和端口：

```bash
sudo ./install.sh --data-dir /opt/msf --host 0.0.0.0 --port 7777
```

安装完成后打开：

```text
http://<服务器IP>:7777
```

首次进入会显示初始化向导。完成初始化后，`msf` 会持久化运行态；后续重启时会按配置恢复 Mihomo、MosDNS 和 nftables，除非用户在 WebUI 中显式停止服务或清除 nftables。

## 常用命令

systemd：

```bash
sudo systemctl status msf
sudo systemctl stop msf
sudo systemctl restart msf
sudo journalctl -u msf -f
```

CLI：

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

## 升级

推荐使用：

```bash
sudo msf update
```

也可以重新运行新版本安装包中的安装脚本：

```bash
sudo ./install.sh
```

安装脚本会覆盖二进制并重启服务，默认保留现有数据目录。`msf update` 会优先复用当前安装的真实数据目录、监听 host 和 port，避免更新后启动到空目录。

## 卸载

Linux tarball/systemd 安装可以直接使用：

```bash
sudo msf uninstall
```

交互式终端会询问是否删除 `/opt/msf` 数据目录；非交互环境默认保留数据。需要连配置、数据库、日志、组件二进制和 zashboard 一起删除时，显式执行：

```bash
sudo msf uninstall --purge --yes
```

如果还保留着解压后的发布包，也可以在包目录内运行：

```bash
sudo ./uninstall.sh
sudo ./uninstall.sh --purge --yes
```

`msf uninstall` 只面向 Linux tarball/systemd 安装。Docker、Unraid、fnOS FPK 请使用对应平台的容器、插件或应用管理器卸载。

## 数据目录

默认数据目录：

```text
/opt/msf
```

主要内容：

- `configs/mosdns`
- `configs/mihomo`
- `configs/network`
- `data/binaries`
- `logs`
- `database`
- `backups`

运行目录、端口和完整文件结构见 [运行参考](../reference/runtime.md)。
