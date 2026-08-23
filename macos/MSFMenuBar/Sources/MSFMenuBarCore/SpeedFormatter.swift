import Foundation

public enum SpeedFormatter {
  private static let units = ["B/s", "KB/s", "MB/s", "GB/s", "TB/s"]
  private static let compactUnits = ["B", "K", "M", "G", "T"]

  public static func string(bytesPerSecond rawValue: Double, compact: Bool = false) -> String {
    var value = rawValue.isFinite ? max(0, rawValue) : 0
    var unitIndex = 0
    while value >= 1024, unitIndex < units.count - 1 {
      value /= 1024
      unitIndex += 1
    }

    let number: String
    if unitIndex == 0 || value >= 100 {
      number = String(format: "%.0f", value)
    } else if value >= 10 {
      number = String(format: "%.1f", value)
    } else {
      number = String(format: "%.2f", value)
    }

    return number + " " + (compact ? compactUnits[unitIndex] : units[unitIndex])
  }
}
