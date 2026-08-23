import Foundation

public enum MSFEndpoint {
  public static let defaultURLString = "http://127.0.0.1:7777"

  public static func normalize(_ rawValue: String) throws -> URL {
    var value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
    if value.isEmpty {
      value = defaultURLString
    }
    if !value.contains("://") {
      value = "http://" + value
    }

    guard var components = URLComponents(string: value),
      let scheme = components.scheme?.lowercased(),
      scheme == "http" || scheme == "https",
      components.host?.isEmpty == false
    else {
      throw MSFAPIError.invalidBaseURL
    }

    components.scheme = scheme
    components.query = nil
    components.fragment = nil
    if components.path == "/" {
      components.path = ""
    } else {
      while components.path.hasSuffix("/") {
        components.path.removeLast()
      }
    }

    guard let url = components.url else {
      throw MSFAPIError.invalidBaseURL
    }
    return url
  }

  public static func apiURL(baseURL: URL, path: String) throws -> URL {
    let cleanPath = path.hasPrefix("/") ? path : "/" + path
    guard let url = URL(string: baseURL.absoluteString + cleanPath) else {
      throw MSFAPIError.invalidBaseURL
    }
    return url
  }
}
