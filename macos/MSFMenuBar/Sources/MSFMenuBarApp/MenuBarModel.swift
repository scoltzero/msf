import Foundation
import MSFMenuBarCore
import SwiftUI

@MainActor
final class MenuBarModel: ObservableObject {
  private enum DefaultsKey {
    static let baseURL = "msf.baseURL"
    static let showSpeed = "msf.showSpeedInMenuBar"
  }

  @Published private(set) var snapshot: RuntimeSnapshot = .offline
  @Published private(set) var isPerformingAction = false
  @Published private(set) var isPairing = false
  @Published private(set) var hasToken = false
  @Published private(set) var lastError: String?
  @Published private(set) var baseURLString: String
  @Published private(set) var showSpeedInMenuBar: Bool

  private let apiClient: any MSFAPIClientProtocol
  private let tokenStore: KeychainTokenStore
  private let defaults: UserDefaults
  private var pollingTask: Task<Void, Never>?

  init(
    apiClient: any MSFAPIClientProtocol = MSFAPIClient(),
    tokenStore: KeychainTokenStore = KeychainTokenStore(),
    defaults: UserDefaults = .standard
  ) {
    self.apiClient = apiClient
    self.tokenStore = tokenStore
    self.defaults = defaults
    baseURLString =
      defaults.string(forKey: DefaultsKey.baseURL)
      ?? MSFEndpoint.defaultURLString
    if defaults.object(forKey: DefaultsKey.showSpeed) == nil {
      showSpeedInMenuBar = true
    } else {
      showSpeedInMenuBar = defaults.bool(forKey: DefaultsKey.showSpeed)
    }
    hasToken = (try? tokenStore.load())?.isEmpty == false
    if !hasToken {
      snapshot = RuntimeSnapshot(
        phase: .offline,
        reachable: false,
        mosdnsRunning: false,
        mihomoRunning: false,
        detail: "请在连接设置中绑定后台"
      )
    }
    startPolling()
  }

  var statusTitle: String {
    switch snapshot.phase {
    case .offline:
      hasToken ? "后台离线" : "尚未连接"
    case .starting:
      "正在启动"
    case .enabled:
      "运行中"
    case .direct:
      "已停止（LAN 直连）"
    case .restarting:
      "正在重启"
    case .degraded:
      "运行异常"
    case .stopped:
      "服务已完全停止"
    }
  }

  var statusSymbolName: String {
    switch snapshot.phase {
    case .offline:
      "network.slash"
    case .starting, .restarting:
      "arrow.triangle.2.circlepath"
    case .enabled:
      "network"
    case .direct:
      "arrow.triangle.branch"
    case .degraded:
      "exclamationmark.triangle"
    case .stopped:
      "pause.circle"
    }
  }

  var compactSpeedText: String {
    let down = SpeedFormatter.string(
      bytesPerSecond: snapshot.downloadBytesPerSecond,
      compact: true
    )
    let up = SpeedFormatter.string(
      bytesPerSecond: snapshot.uploadBytesPerSecond,
      compact: true
    )
    return "↓\(down) ↑\(up)"
  }

  var fullSpeedText: String {
    let down = SpeedFormatter.string(bytesPerSecond: snapshot.downloadBytesPerSecond)
    let up = SpeedFormatter.string(bytesPerSecond: snapshot.uploadBytesPerSecond)
    return "↓ \(down)    ↑ \(up)"
  }

  var canEnable: Bool {
    hasToken
      && !isPerformingAction
      && snapshot.phase != .enabled
      && snapshot.phase != .starting
  }

  var canSafeDisable: Bool {
    hasToken
      && !isPerformingAction
      && snapshot.supportsSafeDisable
      && snapshot.phase == .enabled
  }

  var canRestart: Bool {
    hasToken
      && !isPerformingAction
      && snapshot.reachable
      && snapshot.phase.hasActiveDataPlane
  }

  var canFullStop: Bool {
    hasToken
      && !isPerformingAction
      && snapshot.reachable
      && snapshot.phase != .stopped
  }

  var webURL: URL? {
    try? MSFEndpoint.normalize(baseURLString)
  }

  func setShowSpeedInMenuBar(_ enabled: Bool) {
    showSpeedInMenuBar = enabled
    defaults.set(enabled, forKey: DefaultsKey.showSpeed)
  }

  func saveBaseURL(_ value: String) -> Bool {
    do {
      let url = try MSFEndpoint.normalize(value)
      baseURLString = url.absoluteString
      defaults.set(baseURLString, forKey: DefaultsKey.baseURL)
      lastError = nil
      restartPolling()
      return true
    } catch {
      lastError = error.localizedDescription
      return false
    }
  }

  func pair(baseURL value: String, username: String, password: String) async -> Bool {
    guard !username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      !password.isEmpty
    else {
      lastError = "请输入管理员用户名和密码"
      return false
    }

    isPairing = true
    defer { isPairing = false }
    do {
      let url = try MSFEndpoint.normalize(value)
      let token = try await apiClient.pair(
        baseURL: url,
        username: username.trimmingCharacters(in: .whitespacesAndNewlines),
        password: password
      )
      try tokenStore.save(token)
      baseURLString = url.absoluteString
      defaults.set(baseURLString, forKey: DefaultsKey.baseURL)
      hasToken = true
      lastError = nil
      await refresh()
      return true
    } catch {
      lastError = error.localizedDescription
      return false
    }
  }

  func saveManualToken(baseURL value: String, token rawToken: String) async -> Bool {
    let token = rawToken.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !token.isEmpty else {
      lastError = "API Token 不能为空"
      return false
    }
    do {
      let url = try MSFEndpoint.normalize(value)
      try tokenStore.save(token)
      baseURLString = url.absoluteString
      defaults.set(baseURLString, forKey: DefaultsKey.baseURL)
      hasToken = true
      lastError = nil
      await refresh()
      return snapshot.reachable
    } catch {
      lastError = error.localizedDescription
      return false
    }
  }

  func disconnect() {
    do {
      try tokenStore.delete()
      hasToken = false
      lastError = nil
      snapshot = RuntimeSnapshot(
        phase: .offline,
        reachable: false,
        mosdnsRunning: false,
        mihomoRunning: false,
        detail: "请在连接设置中绑定后台"
      )
    } catch {
      lastError = error.localizedDescription
    }
  }

  func perform(_ action: RuntimeAction) {
    guard !isPerformingAction else { return }
    Task { @MainActor [weak self] in
      await self?.performNow(action)
    }
  }

  func refresh() async {
    guard hasToken else { return }
    do {
      let configuration = try currentConfiguration()
      snapshot = try await apiClient.snapshot(configuration: configuration)
      lastError = nil
    } catch {
      snapshot = RuntimeSnapshot(
        phase: .offline,
        reachable: false,
        mosdnsRunning: false,
        mihomoRunning: false,
        detail: error.localizedDescription
      )
      lastError = error.localizedDescription
    }
  }

  private func performNow(_ action: RuntimeAction) async {
    isPerformingAction = true
    lastError = nil
    let previousPhase = snapshot.phase
    switch action {
    case .enable:
      snapshot.phase = .starting
    case .restart:
      snapshot.phase = .restarting
    case .disable, .fullStop:
      break
    }

    do {
      let configuration = try currentConfiguration()
      try await apiClient.perform(action, configuration: configuration)
      try? await Task.sleep(for: .milliseconds(400))
      await refresh()
    } catch {
      snapshot.phase = previousPhase
      lastError = error.localizedDescription
    }
    isPerformingAction = false
  }

  private func currentConfiguration() throws -> APIConfiguration {
    let baseURL = try MSFEndpoint.normalize(baseURLString)
    guard let token = try tokenStore.load(), !token.isEmpty else {
      throw MSFAPIError.missingToken
    }
    return APIConfiguration(baseURL: baseURL, token: token)
  }

  private func startPolling() {
    pollingTask = Task { @MainActor [weak self] in
      while !Task.isCancelled {
        guard let self else { return }
        await refresh()
        let interval: Duration = showSpeedInMenuBar ? .seconds(1) : .seconds(5)
        do {
          try await Task.sleep(for: interval)
        } catch {
          return
        }
      }
    }
  }

  private func restartPolling() {
    pollingTask?.cancel()
    startPolling()
  }
}
