# Unraid PLG 安装

本页面适用于 Unraid WebGUI 的 `.plg` 插件安装方式。Unraid PLG 是稳定支持的安装方式，更新和卸载都应通过 Unraid 插件管理页面完成。

Unraid 版本支持 nftables 与 TUN；选择 TUN 时初始化预检会确认 `/dev/net/tun` 与运行权限。

当前版本：`v0.3.9.5`

## 安装

在 Unraid WebGUI 中打开 **Plugins / Install Plugin**，填入插件地址：

```text
https://github.com/scoltzero/msf/releases/download/v0.3.9.5/msf.plg
```

安装完成后打开 **Settings / MSF Free**，进入轻量插件控制页，再点击打开 WebUI。完整管理界面运行在独立 WebUI 中，不嵌入 Unraid Settings 页面。

默认 WebUI：

```text
http://<Unraid主机IP>:7777
```

## 运行方式

Unraid 插件默认路径：

| 项目 | 路径 |
|---|---|
| 插件二进制 | `/usr/local/emhttp/plugins/msf/bin/msf` |
| 兼容命令 | `/usr/local/bin/msf` |
| 控制脚本 | `/etc/rc.d/rc.msf` |
| 插件配置 | `/boot/config/plugins/msf/msf.cfg` |
| 默认数据目录 | `/mnt/user/appdata/msf` |

Unraid 运行逻辑：

- 全新安装且尚未初始化时，只启动 `msf` 管理 WebUI。
- 完成初始化引导后，默认启用 Mihomo、MosDNS 和 nftables。
- Unraid 重启或插件服务重启后，`msf` 会按已保存状态恢复 Mihomo、MosDNS 和 nftables。
- 如果用户在 WebUI 中手动停止服务或清除 nftables，下次启动会尊重这个关闭状态。
- 在线安装 MosDNS、Mihomo、Zashboard 时会先校验 GitHub release asset SHA-256 digest；本地上传核心标记为 `local-upload`。

## 停止和重启

停止 Unraid 服务但不删除文件：

```bash
/etc/rc.d/rc.msf stop
```

重启：

```bash
/etc/rc.d/rc.msf restart
```

常用 CLI：

```bash
msf status --config /mnt/user/appdata/msf
msf logs --config /mnt/user/appdata/msf --lines 200 mosdns
msf logs --config /mnt/user/appdata/msf --lines 200 mihomo
msf doctor --config /mnt/user/appdata/msf
```

## 更新和卸载

Unraid 上不要使用：

```bash
msf update
msf uninstall
```

更新和卸载应通过 Unraid 插件管理页面完成，避免绕过 `.plg` 包状态。

卸载请在 WebGUI 的插件管理页面删除 `msf` 插件。插件卸载会停止 WebUI 服务并移除插件文件，默认保留应用数据目录：

```text
/mnt/user/appdata/msf
```

只有在确定要删除配置、数据库、日志、下载组件和备份时，才手动删除该目录。

## 发布资产

Unraid 发布资产包括：

- `msf.plg`
- `msf-0.3.9.5-x86_64-1.txz`
- 对应 `.sha256` 校验文件

Unraid 打包开发说明见 [packaging/unraid/README.md](../../packaging/unraid/README.md)。运行目录和端口说明见 [运行参考](../reference/runtime.md)。
