import Foundation

enum PayloadParser {
  static func runtimeSnapshot(from payload: [String: Any]) -> RuntimeSnapshot? {
    let root = dictionary(payload["data"]) ?? payload
    guard
      let rawState = string(root["effective_state"])
        ?? string(root["state"])
        ?? string(root["status"])
    else {
      return nil
    }

    let services = dictionary(root["services"])
    let mosdns = serviceRunning(named: "mosdns", root: root, services: services)
    let mihomo = serviceRunning(named: "mihomo", root: root, services: services)
    let traffic = dictionary(root["traffic"]) ?? dictionary(root["network"]) ?? root

    return RuntimeSnapshot(
      phase: RuntimePhase(serverValue: rawState),
      reachable: true,
      mosdnsRunning: mosdns,
      mihomoRunning: mihomo,
      downloadBytesPerSecond: number(traffic["down_bps"])
        ?? number(traffic["download_speed"])
        ?? number(traffic["down"])
        ?? number(traffic["download"])
        ?? 0,
      uploadBytesPerSecond: number(traffic["up_bps"])
        ?? number(traffic["upload_speed"])
        ?? number(traffic["up"])
        ?? number(traffic["upload"])
        ?? 0,
      supportsSafeDisable: true,
      detail: string(root["message"]) ?? string(root["last_error"])
    )
  }

  static func legacySnapshot(
    servicesPayload: [String: Any],
    trafficPayload: [String: Any]
  ) -> RuntimeSnapshot {
    let serviceRows =
      array(servicesPayload["data"])
      ?? array(servicesPayload["services"])
      ?? []
    var mosdns = false
    var mihomo = false
    for item in serviceRows {
      guard let row = dictionary(item), let name = string(row["name"])?.lowercased() else {
        continue
      }
      let running =
        bool(row["running"])
        ?? (string(row["status"])?.lowercased() == "running")
      if name == "mosdns" {
        mosdns = running
      } else if name == "mihomo" || name == "proxy" || name == "clash" {
        mihomo = running
      }
    }

    let phase: RuntimePhase
    if mosdns && mihomo {
      phase = .enabled
    } else if !mosdns && !mihomo {
      phase = .stopped
    } else {
      phase = .degraded
    }

    let traffic = dictionary(trafficPayload["data"]) ?? trafficPayload
    return RuntimeSnapshot(
      phase: phase,
      reachable: true,
      mosdnsRunning: mosdns,
      mihomoRunning: mihomo,
      downloadBytesPerSecond: number(traffic["down"])
        ?? number(traffic["download"])
        ?? number(traffic["download_speed"])
        ?? 0,
      uploadBytesPerSecond: number(traffic["up"])
        ?? number(traffic["upload"])
        ?? number(traffic["upload_speed"])
        ?? 0,
      supportsSafeDisable: false,
      detail: "兼容旧版后台"
    )
  }

  private static func serviceRunning(
    named name: String,
    root: [String: Any],
    services: [String: Any]?
  ) -> Bool {
    if let directValue = bool(root[name + "_running"]) {
      return directValue
    }
    if let service = dictionary(services?[name]) {
      return bool(service["running"])
        ?? (string(service["status"])?.lowercased() == "running")
    }
    return false
  }

  private static func dictionary(_ value: Any?) -> [String: Any]? {
    value as? [String: Any]
  }

  private static func array(_ value: Any?) -> [Any]? {
    value as? [Any]
  }

  private static func string(_ value: Any?) -> String? {
    if let value = value as? String, !value.isEmpty {
      return value
    }
    return nil
  }

  private static func bool(_ value: Any?) -> Bool? {
    if let value = value as? Bool {
      return value
    }
    if let value = value as? NSNumber {
      return value.boolValue
    }
    if let value = value as? String {
      switch value.lowercased() {
      case "true", "1", "yes", "running", "active":
        return true
      case "false", "0", "no", "stopped", "inactive":
        return false
      default:
        return nil
      }
    }
    return nil
  }

  private static func number(_ value: Any?) -> Double? {
    if let value = value as? Double {
      return value
    }
    if let value = value as? NSNumber {
      return value.doubleValue
    }
    if let value = value as? String {
      return Double(value)
    }
    return nil
  }
}
