import AppKit
import MSFMenuBarCore
import SwiftUI

struct MenuBarLabel: View {
  @ObservedObject var model: MenuBarModel

  var body: some View {
    HStack(spacing: 4) {
      Image(systemName: model.statusSymbolName)
      if model.showSpeedInMenuBar {
        Text(model.compactSpeedText)
          .monospacedDigit()
      }
    }
    .accessibilityLabel("MSF，\(model.statusTitle)，\(model.fullSpeedText)")
  }
}

struct MenuContentView: View {
  @ObservedObject var model: MenuBarModel

  var body: some View {
    Text(model.statusTitle)

    Text(model.fullSpeedText)
      .monospacedDigit()

    if let detail = model.snapshot.detail, !detail.isEmpty {
      Text(detail)
    }
    if let error = model.lastError, error != model.snapshot.detail {
      Text(error)
    }

    Divider()

    Button("启动", systemImage: "play.fill") {
      model.perform(.enable)
    }
    .disabled(!model.canEnable)

    Button("停止（LAN 直连保活）", systemImage: "stop.fill") {
      model.perform(.disable)
    }
    .disabled(!model.canSafeDisable)

    if model.snapshot.reachable, !model.snapshot.supportsSafeDisable {
      Text("安全停止需要新版 TUN Runtime API")
    }

    Button("重启", systemImage: "arrow.clockwise") {
      model.perform(.restart)
    }
    .disabled(!model.canRestart)

    Button("完全停止服务…", systemImage: "power", role: .destructive) {
      confirmFullStop()
    }
    .disabled(!model.canFullStop)

    Divider()

    Button("打开网页管理页", systemImage: "safari") {
      openWebManagement()
    }

    SettingsLink {
      Label("连接设置…", systemImage: "gearshape")
    }

    Toggle(
      "菜单栏显示速度",
      isOn: Binding(
        get: { model.showSpeedInMenuBar },
        set: { model.setShowSpeedInMenuBar($0) }
      )
    )

    Divider()

    Button("退出 MSF 菜单栏", systemImage: "xmark") {
      NSApplication.shared.terminate(nil)
    }
    .keyboardShortcut("q")
  }

  private func openWebManagement() {
    guard let url = model.webURL else { return }
    NSWorkspace.shared.open(url)
  }

  private func confirmFullStop() {
    let alert = NSAlert()
    alert.alertStyle = .warning
    alert.messageText = "完全停止 MSF 服务？"
    alert.informativeText =
      "这会停止 MosDNS、Mihomo 并拆除 TUN。若主路由仍把 DNS 和 Fake-IP 路由指向这台 Mac，局域网设备可能立即断流。"
    alert.addButton(withTitle: "完全停止")
    alert.addButton(withTitle: "取消")
    if alert.runModal() == .alertFirstButtonReturn {
      model.perform(.fullStop)
    }
  }
}
