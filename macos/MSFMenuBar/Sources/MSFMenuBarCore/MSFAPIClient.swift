import Foundation

public protocol MSFAPIClientProtocol: Sendable {
  func snapshot(configuration: APIConfiguration) async throws -> RuntimeSnapshot
  func perform(_ action: RuntimeAction, configuration: APIConfiguration) async throws
  func pair(baseURL: URL, username: String, password: String) async throws -> String
}

public actor MSFAPIClient: MSFAPIClientProtocol {
  private let session: URLSession

  public init(session: URLSession = .shared) {
    self.session = session
  }

  public func snapshot(configuration: APIConfiguration) async throws -> RuntimeSnapshot {
    do {
      let payload = try await requestJSON(
        baseURL: configuration.baseURL,
        path: "/api/v1/network/runtime",
        token: configuration.token
      )
      guard let snapshot = PayloadParser.runtimeSnapshot(from: payload) else {
        throw MSFAPIError.invalidResponse
      }
      return snapshot
    } catch MSFAPIError.notFound {
      let services = try await requestJSON(
        baseURL: configuration.baseURL,
        path: "/api/v1/services",
        token: configuration.token
      )
      let traffic = try await requestJSON(
        baseURL: configuration.baseURL,
        path: "/api/v1/mihomo/traffic?fresh=1",
        token: configuration.token
      )
      return PayloadParser.legacySnapshot(
        servicesPayload: services,
        trafficPayload: traffic
      )
    }
  }

  public func perform(_ action: RuntimeAction, configuration: APIConfiguration) async throws {
    let endpoint: String
    switch action {
    case .enable:
      endpoint = "/api/v1/network/runtime/enable"
    case .disable:
      endpoint = "/api/v1/network/runtime/disable"
    case .restart:
      endpoint = "/api/v1/network/runtime/restart"
    case .fullStop:
      endpoint = "/api/v1/network/runtime/stop"
    }

    do {
      _ = try await requestJSON(
        baseURL: configuration.baseURL,
        path: endpoint,
        method: "POST",
        token: configuration.token
      )
      return
    } catch MSFAPIError.notFound {
      switch action {
      case .enable:
        try await performLegacy(
          path: "/api/v1/services/start-all?wait=1&timeout_ms=10000",
          configuration: configuration
        )
      case .restart:
        try await performLegacy(
          path: "/api/v1/services/restart-all?wait=1&timeout_ms=10000",
          configuration: configuration
        )
      case .fullStop:
        try await performLegacy(
          path: "/api/v1/services/stop-all?wait=1&timeout_ms=10000",
          configuration: configuration
        )
      case .disable:
        throw MSFAPIError.safeDisableUnsupported
      }
    }
  }

  public func pair(baseURL: URL, username: String, password: String) async throws -> String {
    let loginPayload = try await requestJSON(
      baseURL: baseURL,
      path: "/api/v1/auth/login",
      method: "POST",
      body: [
        "username": username,
        "password": password,
      ]
    )
    guard let loginToken = loginPayload["token"] as? String, !loginToken.isEmpty else {
      throw MSFAPIError.invalidResponse
    }

    let hostName = Host.current().localizedName ?? "macOS"
    let tokenPayload = try await requestJSON(
      baseURL: baseURL,
      path: "/api/v1/api-tokens",
      method: "POST",
      token: loginToken,
      body: [
        "name": "MSF Menu Bar - \(hostName)",
        "scope": "operate",
      ]
    )
    guard let apiToken = tokenPayload["token"] as? String, !apiToken.isEmpty else {
      throw MSFAPIError.invalidResponse
    }
    return apiToken
  }

  private func performLegacy(path: String, configuration: APIConfiguration) async throws {
    let payload = try await requestJSON(
      baseURL: configuration.baseURL,
      path: path,
      method: "POST",
      token: configuration.token
    )
    if let success = payload["success"] as? Bool, !success {
      throw MSFAPIError.server(errorMessage(from: payload))
    }
  }

  private func requestJSON(
    baseURL: URL,
    path: String,
    method: String = "GET",
    token: String? = nil,
    body: [String: Any]? = nil
  ) async throws -> [String: Any] {
    let url = try MSFEndpoint.apiURL(baseURL: baseURL, path: path)
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.timeoutInterval = 15
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let token, !token.isEmpty {
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }
    if let body {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      do {
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
      } catch {
        throw MSFAPIError.invalidResponse
      }
    }

    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await session.data(for: request)
    } catch {
      throw MSFAPIError.transport(error.localizedDescription)
    }

    guard let httpResponse = response as? HTTPURLResponse else {
      throw MSFAPIError.invalidResponse
    }
    if httpResponse.statusCode == 401 || httpResponse.statusCode == 403 {
      throw MSFAPIError.unauthorized
    }
    if httpResponse.statusCode == 404 {
      throw MSFAPIError.notFound
    }

    let payload: [String: Any]
    if data.isEmpty {
      payload = [:]
    } else {
      do {
        payload = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
      } catch {
        throw MSFAPIError.invalidResponse
      }
    }
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw MSFAPIError.server(errorMessage(from: payload))
    }
    if let success = payload["success"] as? Bool, !success {
      throw MSFAPIError.server(errorMessage(from: payload))
    }
    return payload
  }

  private func errorMessage(from payload: [String: Any]) -> String {
    if let message = payload["message"] as? String, !message.isEmpty {
      return message
    }
    if let error = payload["error"] as? String, !error.isEmpty {
      return error
    }
    return "后台操作失败"
  }
}
