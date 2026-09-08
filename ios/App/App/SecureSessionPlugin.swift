import Capacitor
import Foundation
import Security

@objc(SecureSessionPlugin)
public final class SecureSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SecureSessionPlugin"
    public let jsName = "SecureSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
    ]

    private let service = "com.phim4k.cinema.secure-session"
    private let account = "viewer-session-v1"

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    @objc public func get(_ call: CAPPluginCall) {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            call.resolve(["value": ""])
            return
        }
        guard status == errSecSuccess,
              let data = result as? Data,
              let value = String(data: data, encoding: .utf8) else {
            call.reject("Secure session could not be read.")
            return
        }
        call.resolve(["value": value])
    }

    @objc public func set(_ call: CAPPluginCall) {
        let value = call.getString("value") ?? ""
        guard value.utf8.count <= 16 * 1024, let data = value.data(using: .utf8) else {
            call.reject("Secure session is too large.")
            return
        }
        let attributes: [String: Any] = [kSecValueData as String: data]
        let updated = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
        if updated == errSecSuccess {
            call.resolve()
            return
        }
        guard updated == errSecItemNotFound else {
            call.reject("Secure session could not be updated.")
            return
        }
        var item = baseQuery
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else {
            call.reject("Secure session could not be stored.")
            return
        }
        call.resolve()
    }

    @objc public func clear(_ call: CAPPluginCall) {
        let status = SecItemDelete(baseQuery as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            call.resolve()
        } else {
            call.reject("Secure session could not be removed.")
        }
    }
}
