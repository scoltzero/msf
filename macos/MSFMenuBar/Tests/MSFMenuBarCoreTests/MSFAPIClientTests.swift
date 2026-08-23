import Foundation
import XCTest

@testable import MSFMenuBarCore

final class MSFAPIClientTests: XCTestCase {
  override func tearDown() {
    StubURLProtocol.handler = nil
    StubURLProtocol.resetRequests()
    super.tearDown()
  }

  func testSnapshotFallsBackToLegacyEndpoints() async throws {
    StubURLProtocol.handler = { request in
      switch request.url?.path {
      case "/api/v1/network/runtime":
        return (404, [:])
      case "/api/v1/services":
        return (
          200,
          [
            "success": true,
            "data": [
              ["name": "mosdns", "running": true],
              ["name": "mihomo", "running": true],
            ],
          ]
        )
      case "/api/v1/mihomo/traffic":
        return (200, ["success": true, "data": ["down": 4096, "up": 1024]])
      default:
        return (500, ["error": "unexpected endpoint"])
      }
    }

    let snapshot = try await makeClient().snapshot(configuration: configuration)
    XCTAssertEqual(snapshot.phase, .enabled)
    XCTAssertEqual(snapshot.downloadBytesPerSecond, 4096)
    XCTAssertEqual(snapshot.uploadBytesPerSecond, 1024)
    XCTAssertFalse(snapshot.supportsSafeDisable)
  }

  func testSafeDisableNeverFallsBackToStopAll() async {
    StubURLProtocol.handler = { request in
      if request.url?.path == "/api/v1/network/runtime/disable" {
        return (404, [:])
      }
      return (500, ["error": "unexpected endpoint"])
    }

    do {
      try await makeClient().perform(.disable, configuration: configuration)
      XCTFail("safe disable should fail when the unified runtime endpoint is unavailable")
    } catch {
      XCTAssertEqual(error as? MSFAPIError, .safeDisableUnsupported)
    }

    XCTAssertFalse(
      StubURLProtocol.requests().contains { $0.contains("/api/v1/services/stop-all") }
    )
  }

  func testEnableFallsBackToLegacyStartAll() async throws {
    StubURLProtocol.handler = { request in
      switch request.url?.path {
      case "/api/v1/network/runtime/enable":
        return (404, [:])
      case "/api/v1/services/start-all":
        return (200, ["success": true])
      default:
        return (500, ["error": "unexpected endpoint"])
      }
    }

    try await makeClient().perform(.enable, configuration: configuration)
    XCTAssertTrue(
      StubURLProtocol.requests().contains { $0.contains("/api/v1/services/start-all") }
    )
  }

  private var configuration: APIConfiguration {
    APIConfiguration(baseURL: URL(string: "http://127.0.0.1:7777")!, token: "msf_test")
  }

  private func makeClient() -> MSFAPIClient {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [StubURLProtocol.self]
    return MSFAPIClient(session: URLSession(configuration: configuration))
  }
}

private final class StubURLProtocol: URLProtocol, @unchecked Sendable {
  nonisolated(unsafe) static var handler: ((URLRequest) -> (Int, [String: Any]))?
  private static let lock = NSLock()
  nonisolated(unsafe) private static var recordedRequests: [String] = []

  override class func canInit(with request: URLRequest) -> Bool {
    true
  }

  override class func canonicalRequest(for request: URLRequest) -> URLRequest {
    request
  }

  override func startLoading() {
    let requestURL = request.url?.absoluteString ?? ""
    Self.lock.lock()
    Self.recordedRequests.append(requestURL)
    let handler = Self.handler
    Self.lock.unlock()

    guard let handler, let url = request.url else {
      client?.urlProtocol(self, didFailWithError: MSFAPIError.invalidResponse)
      return
    }

    let (statusCode, payload) = handler(request)
    let response = HTTPURLResponse(
      url: url,
      statusCode: statusCode,
      httpVersion: "HTTP/1.1",
      headerFields: ["Content-Type": "application/json"]
    )!
    let data = try! JSONSerialization.data(withJSONObject: payload)
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: data)
    client?.urlProtocolDidFinishLoading(self)
  }

  override func stopLoading() {}

  static func requests() -> [String] {
    lock.lock()
    defer { lock.unlock() }
    return recordedRequests
  }

  static func resetRequests() {
    lock.lock()
    recordedRequests.removeAll()
    lock.unlock()
  }
}
