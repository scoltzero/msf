# macOS 菜单栏版安装与使用

MSF v0.4.0 首次提供 macOS Beta 版菜单栏 App，最低支持 macOS 15，并按 macOS 15–26 的系统 API 兼容范围构建。App 与内嵌后台均为 Universal 2，覆盖 Apple Silicon (`arm64`) 和 Intel (`x86_64`)。

该版本只提供 TUN，不提供“系统代理”模式。MosDNS 负责 DNS 分流，Mihomo 的 `utun` 接管 Fake-IP 路由；root LaunchDaemon 负责保存/恢复本机 DNS、IPv4 转发状态和后台进程，菜单栏 App 本身不持有 root 权限。

## 下载与安装

从 [GitHub Latest Release](https://github.com/scoltzero/msf/releases/latest) 下载：

- `MSF-*-macos-universal-unsigned.dmg`：推荐安装包。
- `MSF-*-macos-universal-unsigned.zip`：直接解压版本。
- 对应的 `.sha256`：用于校验下载文件。

首个 macOS Beta 未使用 Apple Developer ID 签名，也未提交 Apple 公证。使用 DMG 时，将 `MSF.app` 拖入 `/Applications`，然后在 Finder 中按住 Control 点击或右键 `MSF.app`，选择“打开”并再次确认。若系统仍阻止启动，请到“系统设置 → 隐私与安全”找到 MSF 的拦截提示并选择“仍要打开”。该确认只应对从本项目 GitHub Release 下载且 SHA-256 校验正确的文件执行。

首次打开后进入“连接设置”，点击“安装后台”并输入管理员密码。App 使用 legacy 管理员安装器，把 daemon 与 plist 安装到 `/Library/PrivilegedHelperTools` 和 `/Library/LaunchDaemons`，再由系统级 `launchd` 启动；不使用 `SMAppService`，也不需要在“登录项与扩展”中批准后台项目。

## 使用边界

- 本机接管：启用后将当前出站网络服务的 DNS 临时切换到 `127.0.0.1`，确认 Fake-IP 路由已进入 `utun`，并保持 Mihomo/MosDNS 运行。
- DNS 接管在 macOS 上是 TUN 运行条件，初始化页和系统设置不会允许关闭；完整停止时按启动前快照恢复，而不是写死一个公共 DNS。
- Mihomo 配置不固定 `utun` 编号或设备名，由系统分配当前可用的 `utunN`，运行状态只校验 Fake-IP 路由是否确实进入某个 `utun`。
- 局域网接管：App 无法修改你的路由器。要让 LAN 客户端进入 MSF，仍需把 DHCP DNS 指向这台 Mac 的固定 LAN IP，并把 Fake-IP 网段（默认 `28.0.0.0/8`）静态路由到该 Mac。
- “停止”是安全直连：TUN 与 DNS 保活，只把 Mihomo 切到 `direct`，避免路由器仍指向这台 Mac 时导致全网断流。
- “完全停止”会恢复本机 DNS/IPv4 转发快照并停止 Mihomo、MosDNS；如果路由器仍保留上述 DHCP DNS 或静态路由，LAN 客户端可能断流。
- 启动 MSF 前应退出 Surge、Clash Verge、其他 TUN/VPN，以及占用本机 `53`、`7777`、`9090` 端口的程序。

## 首次使用

1. 将 `MSF.app` 放入 `/Applications` 并打开。
2. 进入“连接设置”，点击“安装后台”，在系统授权窗口中输入管理员密码。
3. 后台状态显示“运行中”后，点击“打开网页管理页”，完成六步初始化；macOS 页面只允许选择 TUN。
4. 在初始化页下载 Mihomo、带有当前配置所需扩展插件的 MosDNS 和 Zashboard，填写订阅或手动节点。
5. 回到“连接设置”，使用管理员账户绑定。密码仅用于这一次登录；App 创建的 `operate` Token 保存在 macOS Keychain。
6. 先确认本机工作正常，再启动数据面并配置路由器的 DHCP DNS 和 Fake-IP 静态路由。

建议给 Mac 配置 DHCP 静态租约。路由器侧示例（假设 Mac 为 `192.168.1.10`）：

```text
DHCP DNS: 192.168.1.10
Static route: 28.0.0.0/8 via 192.168.1.10
```

如果修改了初始化页的 Fake-IP 网段，路由器静态路由必须使用同一网段。应用 DHCP 修改后，让客户端重新获取租约并清理 DNS 缓存。

## 菜单含义

- `启动`：启动/恢复 MosDNS、Mihomo、TUN、本机 DNS 与 LAN IPv4 转发，Mihomo 使用 `rule` 模式。
- `停止（LAN 直连保活）`：保留数据面和路由，把 Mihomo 切到 `direct`。
- `重启`：按当前目标状态重启 MosDNS/Mihomo，并重新检查系统网络接管。
- `完全停止服务…`：恢复系统网络快照并停止全部数据面。
- `打开网页管理页`：打开本机 `http://127.0.0.1:7777`。
- `菜单栏显示速度`：显示 Mihomo 实时上下行速率。

## 验证与排错

```bash
curl http://127.0.0.1:7777/api/v1/version
sudo launchctl print system/io.github.scoltzero.msf.daemon
route -n get 28.0.0.1
networksetup -getdnsservers "Wi-Fi"
sysctl net.inet.ip.forwarding
```

启用后，`route -n get 28.0.0.1` 的 `interface` 应为某个 `utunN`。LaunchDaemon 输出可在 macOS“控制台”中按进程 `io.github.scoltzero.msf.daemon` 或 `msf` 检索。

系统数据位于 `/Library/Application Support/MSF`，网络恢复快照位于 `configs/network/darwin-state.json`。快照会记录原始 DNS 和 `net.inet.ip.forwarding`，恢复时不会假定其初始值一定为 `0`。

## 更新、修复与卸载

更新 App 时，先退出 MSF，将新版 `MSF.app` 替换到 `/Applications`，重新打开后在“连接设置”中执行后台修复，使 LaunchDaemon 使用新版内嵌后台。

卸载前优先执行“完全停止服务…”，然后到“连接设置”点击“卸载后台”。后台可执行文件和 LaunchDaemon plist 会从 `/Library` 移除，`/Library/Application Support/MSF` 用户数据默认保留；确认不再需要时再手工清理该目录。

## 源码构建

要求：

- 完整 Xcode 16 或更高版本；已验证 Xcode 26.3。
- Go、Node.js/npm。
- XcodeGen 2.45 或更高版本：`brew install xcodegen`。

如果 `xcode-select` 当前指向 Command Line Tools，可只为命令指定完整 Xcode：

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
```

在仓库根目录执行：

```bash
make macos-app-test
make macos-app-build-debug macos-app-build-release
make macos-app-verify MACOS_CONFIGURATION=Debug
make macos-app-verify MACOS_CONFIGURATION=Release
```

Debug 构建产物为 `macos/MSFMenuBar/DerivedData/Build/Products/Debug/MSF.app`。执行 `make macos-app-open` 可重新构建并打开 Debug App。当前 Debug、普通 Release 与 GitHub Release 均默认使用管理员授权的 legacy LaunchDaemon 安装器；保留的 `SMAppService` 实现只有在显式启用 `MSF_SIGNED_RELEASE` 编译条件时才会参与构建。
