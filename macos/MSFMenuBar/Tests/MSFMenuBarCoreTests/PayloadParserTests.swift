import XCTest

@testable import MSFMenuBarCore

final class PayloadParserTests: XCTestCase {
  func testParsesUnifiedRuntimePayload() throws {
    let payload: [String: Any] = [
      "data": [
        "effective_state": "enabled",
        "services": [
          "mosdns": ["running": true],
          "mihomo": ["running": true],
        ],
        "traffic": [
          "down_bps": 2_048,
          "up_bps": 1_024,
        ],
      ]
    ]

    let snapshot = try XCTUnwrap(PayloadParser.runtimeSnapshot(from: payload))
    XCTAssertEqual(snapshot.phase, .enabled)
    XCTAssertTrue(snapshot.reachable)
    XCTAssertTrue(snapshot.mosdnsRunning)
    XCTAssertTrue(snapshot.mihomoRunning)
    XCTAssertEqual(snapshot.downloadBytesPerSecond, 2_048)
    XCTAssertEqual(snapshot.uploadBytesPerSecond, 1_024)
    XCTAssertTrue(snapshot.supportsSafeDisable)
  }

  func testParsesLegacyServicesAndTraffic() {
    let services: [String: Any] = [
      "data": [
        ["name": "mosdns", "running": true],
        ["name": "mihomo", "status": "running"],
      ]
    ]
    let traffic: [String: Any] = [
      "data": ["down": 4_096, "up": 512]
    ]

    let snapshot = PayloadParser.legacySnapshot(
      servicesPayload: services,
      trafficPayload: traffic
    )
    XCTAssertEqual(snapshot.phase, .enabled)
    XCTAssertEqual(snapshot.downloadBytesPerSecond, 4_096)
    XCTAssertEqual(snapshot.uploadBytesPerSecond, 512)
    XCTAssertFalse(snapshot.supportsSafeDisable)
  }

  func testLegacyPartialServiceStateIsDegraded() {
    let snapshot = PayloadParser.legacySnapshot(
      servicesPayload: [
        "services": [
          ["name": "mosdns", "running": true],
          ["name": "mihomo", "running": false],
        ]
      ],
      trafficPayload: [:]
    )
    XCTAssertEqual(snapshot.phase, .degraded)
  }
}
