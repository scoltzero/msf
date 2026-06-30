# fnOS FPK 安装

本页面适用于 fnOS / 飞牛系统上的 `.fpk` 安装包。fnOS FPK 由 `fnos-fpk` 分支在同步 `main` 后构建，运行时由 fnOS / 飞牛应用中心或 FPK 包管理器管理。

当前版本：`v0.3.9.1`

## 下载

Release 页面：

```text
https://github.com/scoltzero/msf/releases/tag/v0.3.9.1
```

| 架构 | FPK 资产 |
|---|---|
| x86 / amd64 | `https://github.com/scoltzero/msf/releases/download/v0.3.9.1/msf_0.3.9.1_x86.fpk` |
| ARM / arm64 | `https://github.com/scoltzero/msf/releases/download/v0.3.9.1/msf_0.3.9.1_arm.fpk` |

请按 fnOS 设备 CPU 架构选择对应安装包。发布时也会提供对应 `.sha256` 校验文件。

## 安装

在 fnOS / 飞牛应用中心中选择手动安装或本地安装，上传对应 `.fpk` 文件并确认安装。

安装后打开应用入口或访问默认 WebUI：

```text
http://<fnOS主机IP>:7777
```

首次进入会显示初始化向导。完成初始化后，`msf` 会按保存状态恢复 Mihomo、MosDNS 和 nftables。

## 运行方式

fnOS FPK 包会把二进制和数据放在 fnOS 应用目录内：

| 项目 | 路径 |
|---|---|
| 二进制 | `/var/apps/msf/target/msf` |
| 数据目录 | `/var/apps/msf/var` |
| systemd service | fnOS 注册的 `msf.service` |
| 默认 WebUI | `0.0.0.0:7777` |

FPK 运行需要 root 权限，因为 `msf` 需要绑定 MosDNS `:53`、写入 nftables、写入 `ip rule` / `ip route`，并管理透明代理相关网络状态。

## 更新和卸载

fnOS FPK 安装必须通过 fnOS / 飞牛应用中心或 FPK 包管理器更新、停止和卸载。

不要在 fnOS FPK 环境中执行这些 Linux tarball 命令：

```bash
sudo msf update
sudo msf uninstall
sudo msf service install
sudo msf service uninstall
```

这些命令在 fnOS FPK 环境中会被拦截并提示使用平台管理器。WebUI 自更新入口同样会提示通过 fnOS / 飞牛应用中心或 FPK 包管理器升级。

这样做是为了避免 Linux tarball 安装流程在 `/opt/msf` 创建另一套安装，或绕过 fnOS 的包状态。

## 常用排查

打开 WebUI 后如果还没有完成初始化，只会启动 `msf` 管理界面；完成初始化后才会按配置恢复 Mihomo、MosDNS 和 nftables。

如果需要确认数据目录，可在 CLI 或日志中查找：

```text
/var/apps/msf/var
```

Cloudflare Redirect 配置文件位于：

```text
/var/apps/msf/var/configs/cloudflare-redirect/cfyouxuan.yaml
```

运行目录和端口说明见 [运行参考](../reference/runtime.md)。
