import XCTest

@testable import MSFMenuBarCore

final class EndpointTests: XCTestCase {
  func testNormalizeAddsHTTPAndRemovesTrailingSlash() throws {
    let url = try MSFEndpoint.normalize("127.0.0.1:7777/")
    XCTAssertEqual(url.absoluteString, "http://127.0.0.1:7777")
  }

  func testNormalizePreservesBasePath() throws {
    let url = try MSFEndpoint.normalize("https://example.test/msf/")
    XCTAssertEqual(url.absoluteString, "https://example.test/msf")
    XCTAssertEqual(
      try MSFEndpoint.apiURL(baseURL: url, path: "/api/v1/services").absoluteString,
      "https://example.test/msf/api/v1/services"
    )
  }

  func testNormalizeRejectsUnsupportedScheme() {
    XCTAssertThrowsError(try MSFEndpoint.normalize("file:///tmp/msf"))
  }
}
