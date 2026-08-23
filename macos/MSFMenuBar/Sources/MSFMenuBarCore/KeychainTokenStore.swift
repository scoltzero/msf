import Foundation
import Security

public struct KeychainTokenStore: Sendable {
  public let service: String
  public let account: String

  public init(
    service: String = "io.github.scoltzero.msf.menubar",
    account: String = "api-token"
  ) {
    self.service = service
    self.account = account
  }

  public func load() throws -> String? {
    for useDataProtection in [true, false] {
      var query = baseQuery(useDataProtection: useDataProtection)
      query[kSecReturnData as String] = true
      query[kSecMatchLimit as String] = kSecMatchLimitOne

      var result: CFTypeRef?
      let status = SecItemCopyMatching(query as CFDictionary, &result)
      if status == errSecItemNotFound || (useDataProtection && status == errSecMissingEntitlement) {
        continue
      }
      guard status == errSecSuccess,
        let data = result as? Data,
        let token = String(data: data, encoding: .utf8)
      else {
        throw KeychainError(status: status)
      }
      return token
    }
    return nil
  }

  public func save(_ token: String) throws {
    let data = Data(token.utf8)
    for useDataProtection in [true, false] {
      let status = save(data, useDataProtection: useDataProtection)
      if status == errSecSuccess {
        return
      }
      if useDataProtection && status == errSecMissingEntitlement {
        continue
      }
      throw KeychainError(status: status)
    }
    throw KeychainError(status: errSecMissingEntitlement)
  }

  public func delete() throws {
    var firstError: OSStatus?
    for useDataProtection in [true, false] {
      let status = SecItemDelete(baseQuery(useDataProtection: useDataProtection) as CFDictionary)
      if status == errSecSuccess || status == errSecItemNotFound
        || (useDataProtection && status == errSecMissingEntitlement)
      {
        continue
      }
      if firstError == nil {
        firstError = status
      }
    }
    if let firstError {
      throw KeychainError(status: firstError)
    }
  }

  private func save(_ data: Data, useDataProtection: Bool) -> OSStatus {
    let query = baseQuery(useDataProtection: useDataProtection)
    let updateStatus = SecItemUpdate(
      query as CFDictionary,
      [kSecValueData as String: data] as CFDictionary
    )
    if updateStatus == errSecSuccess || updateStatus != errSecItemNotFound {
      return updateStatus
    }

    var attributes = query
    attributes[kSecValueData as String] = data
    return SecItemAdd(attributes as CFDictionary, nil)
  }

  private func baseQuery(useDataProtection: Bool) -> [String: Any] {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    if useDataProtection {
      query[kSecUseDataProtectionKeychain as String] = true
    }
    return query
  }
}

public struct KeychainError: LocalizedError, Equatable, Sendable {
  public let status: OSStatus

  public init(status: OSStatus) {
    self.status = status
  }

  public var errorDescription: String? {
    if let message = SecCopyErrorMessageString(status, nil) as String? {
      return "Keychain：\(message)"
    }
    return "Keychain 错误（\(status)）"
  }
}
