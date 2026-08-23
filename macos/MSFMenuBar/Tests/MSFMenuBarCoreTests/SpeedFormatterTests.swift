import XCTest

@testable import MSFMenuBarCore

final class SpeedFormatterTests: XCTestCase {
  func testFormatsIdleSpeed() {
    XCTAssertEqual(SpeedFormatter.string(bytesPerSecond: 0), "0 B/s")
  }

  func testFormatsBinaryUnits() {
    XCTAssertEqual(SpeedFormatter.string(bytesPerSecond: 1_024), "1.00 KB/s")
    XCTAssertEqual(SpeedFormatter.string(bytesPerSecond: 1_572_864), "1.50 MB/s")
    XCTAssertEqual(
      SpeedFormatter.string(bytesPerSecond: 1_572_864, compact: true),
      "1.50 M"
    )
  }

  func testClampsInvalidValues() {
    XCTAssertEqual(SpeedFormatter.string(bytesPerSecond: -.infinity), "0 B/s")
    XCTAssertEqual(SpeedFormatter.string(bytesPerSecond: -100), "0 B/s")
  }
}
