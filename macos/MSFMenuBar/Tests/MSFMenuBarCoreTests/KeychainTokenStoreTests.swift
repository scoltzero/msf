import Foundation
import XCTest

@testable import MSFMenuBarCore

final class KeychainTokenStoreTests: XCTestCase {
  func testRoundTripWorksWithoutDataProtectionEntitlement() throws {
    let store = KeychainTokenStore(
      service: "io.github.scoltzero.msf.menubar.tests.\(UUID().uuidString)",
      account: "api-token"
    )
    defer { try? store.delete() }

    XCTAssertNil(try store.load())
    try store.save("msf_test_token")
    XCTAssertEqual(try store.load(), "msf_test_token")

    try store.save("msf_replaced_token")
    XCTAssertEqual(try store.load(), "msf_replaced_token")

    try store.delete()
    XCTAssertNil(try store.load())
  }
}
