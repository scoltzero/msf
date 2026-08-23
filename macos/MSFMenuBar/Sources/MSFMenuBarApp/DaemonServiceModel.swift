import Foundation

#if MSF_SIGNED_RELEASE
@preconcurrency import ServiceManagement
#endif

@MainActor
final class DaemonServiceModel: ObservableObject {
  enum State: Equatable {
    case checking
    case notInstalled
    case approvalRequired
    case installed
    case running
    case failed(String)
  }

  @Published private(set) var state: State = .checking
  @Published private(set) var isBusy = false
  @Published private(set) var detail = "正在检查 MSF 后台…"

  private static let label = "io.github.scoltzero.msf.daemon"
  private static let plistName = label + ".plist"
  private static let helperPath = "/Library/PrivilegedHelperTools/" + label

  #if MSF_SIGNED_RELEASE
  private let service = SMAppService.daemon(plistName: plistName)
  #endif

  var title: String {
    switch state {
    case .checking:
      "正在检查"
    case .notInstalled:
      "后台未安装"
    case .approvalRequired:
      "等待系统批准"
    case .installed:
      "后台已安装"
    case .running:
      "后台运行中"
    case .failed:
      "后台操作失败"
    }
  }

  var symbolName: String {
    switch state {
    case .running:
      "checkmark.circle.fill"
    case .installed, .approvalRequired:
      "clock.badge.checkmark"
    case .failed:
      "exclamationmark.triangle.fill"
    case .checking:
      "arrow.triangle.2.circlepath"
    case .notInstalled:
      "externaldrive.badge.xmark"
    }
  }

  var canInstall: Bool {
    !isBusy
  }

  var canUninstall: Bool {
    if isBusy { return false }
    switch state {
    case .installed, .running, .approvalRequired:
      return true
    default:
      return FileManager.default.fileExists(atPath: Self.helperPath)
    }
  }

  func refresh() async {
    let reachable = await backendReachable()
    if reachable {
      state = .running
      detail = "LaunchDaemon 正在 127.0.0.1:7777 提供服务"
      return
    }
    if FileManager.default.fileExists(atPath: Self.helperPath) {
      state = .installed
      detail = "后台文件已安装，但端口 7777 尚未就绪"
      return
    }
    #if MSF_SIGNED_RELEASE
      switch service.status {
      case .enabled:
        state = .installed
        detail = "系统服务已启用，正在等待后台启动"
      case .requiresApproval:
        state = .approvalRequired
        detail = "请在“系统设置 → 通用 → 登录项与扩展”中允许 MSF"
      case .notRegistered, .notFound:
        state = .notInstalled
        detail = "安装后由 root LaunchDaemon 管理 TUN、DNS 和路由"
      @unknown default:
        state = .notInstalled
        detail = "尚未安装 MSF 系统后台"
      }
    #else
      state = .notInstalled
      detail = "安装后由 root LaunchDaemon 管理 TUN、DNS 和路由"
    #endif
  }

  func install() {
    guard !isBusy else { return }
    isBusy = true
    detail = "正在请求管理员权限…"
    Task {
      defer { isBusy = false }
      do {
        #if MSF_SIGNED_RELEASE
          if service.status == .enabled {
            try await service.unregister()
          }
          try service.register()
          if service.status == .requiresApproval {
            SMAppService.openSystemSettingsLoginItems()
          }
        #else
          let output = try await Self.runLegacyInstaller(action: "install")
          detail = output.isEmpty ? "后台安装完成，正在等待启动" : output
        #endif
        await waitForBackend()
        await refresh()
      } catch {
        state = .failed(error.localizedDescription)
        detail = error.localizedDescription
      }
    }
  }

  func uninstall() {
    guard !isBusy else { return }
    isBusy = true
    detail = "正在停止并移除系统后台…"
    Task {
      defer { isBusy = false }
      do {
        #if MSF_SIGNED_RELEASE
          if service.status != .notRegistered && service.status != .notFound {
            try await service.unregister()
          }
          detail = "后台已取消注册，配置数据已保留"
        #else
          let output = try await Self.runLegacyInstaller(action: "uninstall")
          detail = output.isEmpty ? "后台已卸载，配置数据已保留" : output
        #endif
        try? await Task.sleep(for: .milliseconds(500))
        await refresh()
      } catch {
        state = .failed(error.localizedDescription)
        detail = error.localizedDescription
      }
    }
  }

  func openApprovalSettings() {
    #if MSF_SIGNED_RELEASE
      SMAppService.openSystemSettingsLoginItems()
    #endif
  }

  private func waitForBackend() async {
    for _ in 0..<30 {
      if await backendReachable() { return }
      try? await Task.sleep(for: .milliseconds(300))
    }
  }

  private func backendReachable() async -> Bool {
    guard let url = URL(string: "http://127.0.0.1:7777/api/v1/version") else {
      return false
    }
    var request = URLRequest(url: url)
    request.timeoutInterval = 1
    do {
      let (_, response) = try await URLSession.shared.data(for: request)
      guard let http = response as? HTTPURLResponse else { return false }
      return (200..<300).contains(http.statusCode)
    } catch {
      return false
    }
  }

  private nonisolated static func runLegacyInstaller(action: String) async throws -> String {
    guard
      let script = Bundle.main.path(forResource: "msf-daemon-installer", ofType: "sh")
    else {
      throw DaemonServiceError("App 中缺少后台安装器")
    }
    let bundlePath = Bundle.main.bundlePath
    let command = shellQuote(script) + " " + shellQuote(action) + " " + shellQuote(bundlePath)
    let source = "do shell script " + appleScriptLiteral(command) + " with administrator privileges"
    return try await Task.detached(priority: .userInitiated) {
      let process = Process()
      let output = Pipe()
      let errorOutput = Pipe()
      process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
      process.arguments = ["-e", source]
      process.standardOutput = output
      process.standardError = errorOutput
      try process.run()
      process.waitUntilExit()
      let stdout =
        String(
          data: output.fileHandleForReading.readDataToEndOfFile(),
          encoding: .utf8
        )?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      let stderr =
        String(
          data: errorOutput.fileHandleForReading.readDataToEndOfFile(),
          encoding: .utf8
        )?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      guard process.terminationStatus == 0 else {
        throw DaemonServiceError(stderr.isEmpty ? "管理员授权被取消或安装失败" : stderr)
      }
      return stdout
    }.value
  }

  private nonisolated static func shellQuote(_ value: String) -> String {
    "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
  }

  private nonisolated static func appleScriptLiteral(_ value: String) -> String {
    let escaped =
      value
      .replacingOccurrences(of: "\\", with: "\\\\")
      .replacingOccurrences(of: "\"", with: "\\\"")
      .replacingOccurrences(of: "\n", with: "\\n")
    return "\"" + escaped + "\""
  }
}

private struct DaemonServiceError: LocalizedError, Sendable {
  let message: String

  init(_ message: String) {
    self.message = message
  }

  var errorDescription: String? { message }
}
