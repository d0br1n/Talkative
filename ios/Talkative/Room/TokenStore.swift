import Foundation
import Security
import TalkativeCore

/// The pairing, kept as one generic-password Keychain item. Readable after the first unlock,
/// so the app can rejoin while the phone is locked.
struct TokenStore {
    static let service = "io.github.d0br1n.talkative"
    static let account = "pairing"

    struct KeychainError: Error, CustomStringConvertible {
        let status: OSStatus
        var description: String { "keychain status \(status)" }
    }

    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: TokenStore.service,
            kSecAttrAccount as String: TokenStore.account,
        ]
    }

    func load() -> Credentials? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(Credentials.self, from: data)
    }

    func save(_ credentials: Credentials) throws {
        let data = try JSONEncoder().encode(credentials)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var add = query
            for (key, value) in attributes { add[key] = value }
            status = SecItemAdd(add as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw KeychainError(status: status) }
    }

    func delete() {
        _ = SecItemDelete(query as CFDictionary)
    }
}
