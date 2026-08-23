import Foundation

public enum RuntimePhase: String, Codable, CaseIterable, Sendable {
  case offline
  case starting
  case enabled
  case direct
  case restarting
  case degraded
  case stopped

  public init(serverValue: String) {
    switch serverValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
    case "starting":
      self = .starting
    case "enabled", "running", "active", "rule":
      self = .enabled
    case "direct", "disabled", "bypass":
      self = .direct
    case "restarting":
      self = .restarting
    case "degraded", "error", "failed":
      self = .degraded
    case "stopped", "inactive":
      self = .stopped
    default:
      self = .offline
    }
  }

  public var isBusy: Bool {
    self == .starting || self == .restarting
  }

  public var hasActiveDataPlane: Bool {
    switch self {
    case .enabled, .direct, .starting, .restarting, .degraded:
      true
    case .offline, .stopped:
      false
    }
  }
}

public enum RuntimeAction: String, Sendable {
  case enable
  case disable
  case restart
  case fullStop
}

public struct RuntimeSnapshot: Equatable, Sendable {
  public var phase: RuntimePhase
  public var reachable: Bool
  public var mosdnsRunning: Bool
  public var mihomoRunning: Bool
  public var downloadBytesPerSecond: Double
  public var uploadBytesPerSecond: Double
  public var supportsSafeDisable: Bool
  public var detail: String?

  public init(
    phase: RuntimePhase,
    reachable: Bool,
    mosdnsRunning: Bool,
    mihomoRunning: Bool,
    downloadBytesPerSecond: Double = 0,
    uploadBytesPerSecond: Double = 0,
    supportsSafeDisable: Bool = false,
    detail: String? = nil
  ) {
    self.phase = phase
    self.reachable = reachable
    self.mosdnsRunning = mosdnsRunning
    self.mihomoRunning = mihomoRunning
    self.downloadBytesPerSecond = max(0, downloadBytesPerSecond)
    self.uploadBytesPerSecond = max(0, uploadBytesPerSecond)
    self.supportsSafeDisable = supportsSafeDisable
    self.detail = detail
  }

  public static let offline = RuntimeSnapshot(
    phase: .offline,
    reachable: false,
    mosdnsRunning: false,
    mihomoRunning: false,
    detail: "无法连接后台"
  )
}

public struct APIConfiguration: Equatable, Sendable {
  public let baseURL: URL
  public let token: String

  public init(baseURL: URL, token: String) {
    self.baseURL = baseURL
    self.token = token
  }
}

public enum MSFAPIError: Error, Equatable, Sendable {
  case invalidBaseURL
  case missingToken
  case unauthorized
  case notFound
  case safeDisableUnsupported
  case invalidResponse
  case server(String)
  case transport(String)
}

extension MSFAPIError: LocalizedError {
  public var errorDescription: String? {
    switch self {
    case .invalidBaseURL:
      "后台地址无效"
    case .missingToken:
      "尚未配置 API Token"
    case .unauthorized:
      "认证失败，请重新连接后台"
    case .notFound:
      "后台不支持该接口"
    case .safeDisableUnsupported:
      "当前后台版本尚不支持 LAN 直连保活，请升级后台或使用“完全停止服务”"
    case .invalidResponse:
      "后台返回了无法识别的数据"
    case .server(let message):
      message
    case .transport(let message):
      message
    }
  }
}
