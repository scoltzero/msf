# msm-free

[English README](README.en.md)

`msm-free` 是一个面向 MosDNS + Mihomo 工作流的 MSM 风格管理面板重构版。项目目标是提供可自部署、可审计的 DNS 分流、透明代理、Mihomo 管理和 Unraid 插件体验。

当前发布版本：`v0.2.1`

## 功能概览

- 原版 MSM 风格 6 步初始化向导，支持管理员账号、系统参数、DNS、IPv6、Fake-IP、透明代理和组件安装配置。
- MosDNS + Mihomo 默认组合，暂不启用 sing-box。
- 按 mssb 风格生成 MosDNS + Mihomo 国内外分流链路：MosDNS `:53` 入口，Mihomo DNS `:6666`，Fake-IP `28.0.0.0/8`，TProxy `7896`，Redirect `7877`。
- 支持机场订阅，前端按 `名称|URL` 保存，后端会生成 Mihomo `proxy-providers`。
- 支持初始化阶段添加手动节点，手动节点会生成 `proxy_providers/msm_manual.yaml`，并作为 Mihomo 本地文件型供应商 `msm_manual` 使用。
- 手动节点分享链接基础解析支持 `ss`、`ssr`、`vmess`、`vless`、`trojan`、`hysteria`、`hysteria2`、`tuic`。
- 支持 MosDNS 客户端代理模式：关闭、白名单、黑名单。
- 支持 Mihomo 节点、规则、连接、日志、配置页面。
- 支持组件更新检查、自动检查间隔、自动下载、更新通知和升级方式配置。
- 支持 GitHub 组件下载代理和加速前缀，HTTP、HTTPS、SOCKS5 均可配置。
- 支持普通 Linux systemd 安装包。
- 支持 Unraid 插件安装方式。

## 下载

GitHub Release：

```text
https://github.com/scoltzero/msm-free/releases/tag/v0.2.1
```

Linux x86_64 安装包：

```text
https://github.com/scoltzero/msm-free/releases/download/v0.2.1/msm-free-linux-amd64.tar.gz
```

Linux ARM64 安装包：

```text
https://github.com/scoltzero/msm-free/releases/download/v0.2.1/msm-free-linux-arm64.tar.gz
```

Unraid 插件文件：

```text
https://github.com/scoltzero/msm-free/releases/download/v0.2.1/msm-free.plg
```

## Linux 安装

根据机器架构下载并解压。x86_64 / amd64 使用：

```bash
curl -L -o msm-free-linux-amd64.tar.gz \
  https://github.com/scoltzero/msm-free/releases/download/v0.2.1/msm-free-linux-amd64.tar.gz

tar -xzf msm-free-linux-amd64.tar.gz -C /tmp
sudo /tmp/msm-free-0.2.1-linux-amd64/install.sh
```

ARM64 / aarch64 使用：

```bash
curl -L -o msm-free-linux-arm64.tar.gz \
  https://github.com/scoltzero/msm-free/releases/download/v0.2.1/msm-free-linux-arm64.tar.gz

tar -xzf msm-free-linux-arm64.tar.gz -C /tmp
sudo /tmp/msm-free-0.2.1-linux-arm64/install.sh
```

安装脚本会完成这些操作：

- 安装二进制到 `/usr/local/bin/msm-free`
- 注册兼容命令 `/usr/local/bin/msm`
- 初始化数据目录 `/opt/msm-free`
- 安装 systemd 服务 `msm-free.service`
- 启动 WebUI，默认监听 `7777`

打开 WebUI：

```text
http://<服务器IP>:7777
```

首次进入会显示初始化向导。完成初始化后，`msm-free` 会持久化运行态；后续重启时会按配置恢复 Mihomo、MosDNS 和 nftables，除非用户在 WebUI 中显式停止服务或清除 nftables。

常用 systemd 命令：

```bash
sudo systemctl status msm-free
sudo systemctl stop msm-free
sudo systemctl restart msm-free
sudo journalctl -u msm-free -f
```

常用 CLI 命令：

```bash
sudo msm status
sudo msm stop
sudo msm restart
sudo msm logs
sudo msm logs --lines 200 mosdns
sudo msm logs --lines 200 mihomo
sudo msm doctor
sudo msm update
```

`msm` 和 `msm-free` 指向同一套 CLI。`msm stop` 会向正在运行的管理进程发送优雅停止信号，管理进程退出前会停止它托管的 MosDNS 和 Mihomo 子进程。

需要强制停止时：

```bash
sudo msm stop --timeout 20s --force
```

卸载：

```bash
sudo msm uninstall
```

默认卸载只删除 systemd 服务和 `/usr/local/bin/msm-free`，会保留 `/opt/msm-free` 数据目录。需要连配置、数据库、日志、组件二进制一起删除时再显式执行：

```bash
sudo msm uninstall --purge
```

如果还保留着解压后的发布包，也可以在包目录内运行：

```bash
sudo ./uninstall.sh
sudo ./uninstall.sh --purge
```

## Unraid 插件安装

在 Unraid WebGUI 中打开 **Plugins / Install Plugin**，填入插件地址：

```text
https://github.com/scoltzero/msm-free/releases/download/v0.2.1/msm-free.plg
```

安装完成后打开 **Settings / MSM Free**，进入插件设置页，再点击打开 WebUI。

Unraid 默认数据目录：

```text
/mnt/user/appdata/msm-free
```

Unraid 运行逻辑：

- 全新安装且尚未初始化时，只启动 `msm-free` 管理 WebUI。
- 完成初始化引导后，默认启用 Mihomo、MosDNS 和 nftables。
- Unraid 重启或插件服务重启后，`msm-free` 会按已保存状态恢复 Mihomo、MosDNS 和 nftables。
- 如果用户在 WebUI 中手动停止服务或清除 nftables，下次启动会尊重这个关闭状态。

Unraid 停止服务：

```bash
/etc/rc.d/rc.msm-free stop
```

Unraid 卸载请在 WebGUI 的插件管理页面删除 `msm-free` 插件。插件卸载会停止 WebUI 服务并移除插件文件，默认保留 `/mnt/user/appdata/msm-free` 数据目录；如需彻底清理，需要手动删除该目录。

Unraid 上不要使用 `msm update` 或 `msm uninstall`，更新和卸载应通过 Unraid 插件管理页面完成，避免绕过 `.plg` 包状态。

## 初始化配置说明

初始化向导会写入系统配置、生成 MosDNS/Mihomo 配置，并保存到数据库。几个关键点：

- 机场订阅：保存为 `名称|URL` 换行格式，最终进入 Mihomo `proxy-providers`。
- 手动节点：保存到 `mihomo_proxies`，生成 `configs/mihomo/proxy_providers/msm_manual.yaml`。
- `msm_manual`：在 Mihomo 中作为 `type: file` 的本地 proxy provider 注册。
- GitHub 下载代理：只影响组件下载过程，不会修改代理服务本身的运行配置。
- 完全自定义 Mihomo `config.yaml`、自定义代理分组、规则集和在线 ruleset 管理暂未进入 `v0.2.1`。

## 运行目录

普通 Linux 默认数据目录：

```text
/opt/msm-free
```

Unraid 默认数据目录：

```text
/mnt/user/appdata/msm-free
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
go run ./cmd/msm-free serve -c ./data -p 7777
```

构建 Linux x86_64 压缩包：

```bash
make package VERSION=0.2.1 GOOS=linux GOARCH=amd64
```

构建 Linux ARM64 压缩包：

```bash
make package VERSION=0.2.1 GOOS=linux GOARCH=arm64
```

构建 Unraid 插件产物：

```bash
make unraid VERSION=0.2.1 UNRAID_VERSION=0.2.1 GITHUB_REPO=scoltzero/msm-free RELEASE_TAG=v0.2.1
```

构建产物：

- `dist/msm-free-linux-amd64.tar.gz`
- `dist/msm-free-linux-arm64.tar.gz`
- `dist/unraid/msm-free-0.2.1-x86_64-1.txz`
- `dist/unraid/msm-free.plg`
- `msm-free.plg`

发布时，Linux `.tar.gz`、Unraid `.txz` 和 `.plg` 上传到 GitHub Release。根目录 `msm-free.plg` 可用于仓库分支安装入口。

## 说明

`msm-free` 不包含 MSM 的闭源后端代码。项目目标是做一个非商业用途的开放重构版：外观和使用体验参考 MSM，后端行为围绕 mssb 风格的 MosDNS + Mihomo 工作流重新实现。

## 鸣谢

感谢这些项目提供参考：

- `msm9527/msm-wiki`：作为 MSM 管理体验和功能组织的公开参考。
- `baozaodetudou/mssb`：作为 MosDNS + Mihomo 后端工作流的公开参考。

本项目与 MSM、mssb 上游项目没有隶属关系。
