import AppKit
import MSFMenuBarCore
import SwiftUI

struct ConnectionSettingsView: View {
  @ObservedObject var model: MenuBarModel
  @StateObject private var daemon = DaemonServiceModel()

  @State private var serverURL = ""
  @State private var username = ""
  @State private var password = ""
  @State private var manualToken = ""

  var body: some View {
    Form {
      Section("系统后台") {
        HStack {
          Label(daemon.title, systemImage: daemon.symbolName)
          Spacer()
          if daemon.isBusy {
            ProgressView()
              .controlSize(.small)
          }
        }

        Text(daemon.detail)
          .font(.caption)
          .foregroundStyle(.secondary)
          .textSelection(.enabled)

        HStack {
          Button(daemon.canUninstall ? "修复后台" : "安装后台") {
            daemon.install()
          }
          .disabled(!daemon.canInstall)

          if daemon.canUninstall {
            Button("卸载后台", role: .destructive) {
              daemon.uninstall()
            }
            .disabled(daemon.isBusy)
          }

          if daemon.state == .approvalRequired {
            Button("打开系统设置") {
              daemon.openApprovalSettings()
            }
          }

          Button("刷新") {
            Task { await daemon.refresh() }
          }
          .disabled(daemon.isBusy)
        }
      }

      Section("后台连接") {
        TextField("后台地址", text: $serverURL)
          .textFieldStyle(.roundedBorder)

        HStack {
          Label(
            model.hasToken ? "已保存 API Token" : "尚未连接",
            systemImage: model.hasToken ? "checkmark.shield" : "exclamationmark.triangle"
          )
          Spacer()
          Button("保存地址") {
            _ = model.saveBaseURL(serverURL)
          }
        }
      }

      Section("使用管理员账户绑定") {
        TextField("用户名", text: $username)
          .textFieldStyle(.roundedBorder)
        SecureField("密码", text: $password)
          .textFieldStyle(.roundedBorder)

        Button(model.isPairing ? "正在连接…" : "连接并创建 operate Token") {
          Task {
            if await model.pair(
              baseURL: serverURL,
              username: username,
              password: password
            ) {
              password = ""
            }
          }
        }
        .disabled(model.isPairing || username.isEmpty || password.isEmpty)

        Text("密码只用于本次登录，不会保存；长期凭据保存在 macOS Keychain。")
          .font(.caption)
          .foregroundStyle(.secondary)
      }

      Section("已有 API Token") {
        SecureField("msf_…", text: $manualToken)
          .textFieldStyle(.roundedBorder)

        HStack {
          Button("保存 Token") {
            Task {
              if await model.saveManualToken(
                baseURL: serverURL,
                token: manualToken
              ) {
                manualToken = ""
              }
            }
          }
          .disabled(manualToken.isEmpty)

          Button("打开网页管理页") {
            if let url = try? MSFEndpoint.normalize(serverURL) {
              NSWorkspace.shared.open(url)
            }
          }
        }
      }

      if let error = model.lastError, !error.isEmpty {
        Section("连接信息") {
          Text(error)
            .foregroundStyle(.red)
            .textSelection(.enabled)
        }
      }

      Section {
        Button("断开连接", role: .destructive) {
          model.disconnect()
        }
        .disabled(!model.hasToken)
      }
    }
    .formStyle(.grouped)
    .padding()
    .frame(width: 520, height: 680)
    .onAppear {
      serverURL = model.baseURLString
      Task { await daemon.refresh() }
    }
  }
}
