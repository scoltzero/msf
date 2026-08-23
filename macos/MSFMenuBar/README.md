# MSF Menu Bar for macOS

原生 SwiftUI 菜单栏客户端，最低支持 macOS 15。App 本身不持有 root 权限，也不直接修改 DNS、路由或 TUN；所有系统操作都通过本机 MSF root LaunchDaemon 完成。

v0.4.0 是 macOS App 的首个 Beta 版本。完整安装、LAN 路由要求、验证和回退步骤见 [macOS 安装与使用](../../docs/install/macos.md)。

## 功能

- 启动 MSF 数据面。
- 安全停止并保持 LAN 直连。
- 重启 MosDNS、Mihomo 和 TUN 数据面。
- 带风险确认的完全停止。
- 打开 MSF 网页管理页。
- 在菜单栏和菜单内显示 Mihomo/TUN 实时上下行速度。
- 使用管理员账户创建 `operate` API Token，或直接录入现有 Token。
- Token 仅保存在 macOS Keychain，管理员密码不会保存。

## 架构边界

- `MSFMenuBarCore`：API、运行状态解析、Keychain 和速度格式化。
- `MSFMenuBarApp`：`MenuBarExtra`、连接设置和原生菜单交互。
- macOS 后台使用统一 `/api/v1/network/runtime/*` 状态机。
- 客户端保留 `/api/v1/services/*` 与 `/api/v1/mihomo/traffic` 兼容逻辑，便于识别旧后台。
- 旧后台无法安全实现“停止并让 LAN 直连保活”，因此该操作会保持禁用，不会静默退化为完全停机。
- Debug、普通 Release 与当前 GitHub Release 均使用管理员授权的 legacy LaunchDaemon 安装器。`SMAppService` 实现保留在 `MSF_SIGNED_RELEASE` 编译条件后，默认不参与构建。

## 本地开发

要求：完整 Xcode 16 或更高版本、XcodeGen 2.45 或更高版本。

```bash
make macos-app-project
make macos-app-test
make macos-app-build-debug macos-app-build-release
make macos-app-verify MACOS_CONFIGURATION=Debug
make macos-app-verify MACOS_CONFIGURATION=Release
make macos-app-open
```

如果系统 `xcode-select` 没有指向完整 Xcode，可只为命令指定路径：

```bash
make macos-app-build XCODE_DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
```

生成后的工程位于 `macos/MSFMenuBar/MSFMenuBar.xcodeproj`。工程文件和构建产物由 XcodeGen 重建，不提交到 Git。

默认后台地址为 `http://127.0.0.1:7777`。首次启动后进入“连接设置”，使用管理员账户配对或粘贴 `operate` Token。

## GitHub Release

当前 v0.6.0 macOS Beta 以未签名方式发布，需要干净且已打 tag 的源码，不需要 Apple Developer 凭据：

```bash
make macos-release-assets \
  VERSION=0.6.0 \
  RELEASE_TAG=v0.6.0 \
  MACOS_BUILD_NUMBER=1
```

该目标会构建 legacy Installer 版 Universal 2 App，随后在 `dist/macos/` 生成名称包含 `-unsigned` 的 DMG、ZIP 和 SHA-256。用户首次启动需要在 Finder 中右键“打开”或到“隐私与安全”中手动允许。

原 Developer ID/公证路径仍保留为非默认的 `macos-release-assets-signed` 目标，只有显式提供签名和公证参数时才会启用 `MSF_SIGNED_RELEASE` 与 `SMAppService`。
