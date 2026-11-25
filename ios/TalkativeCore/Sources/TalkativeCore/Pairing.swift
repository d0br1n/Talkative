import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum PairingError: Error, Equatable {
    case invalidAddress, wrongCode, locked, unreachable(String), badResponse
}

public protocol HTTPTransport {
    func post(_ url: URL, json: Data, timeout: TimeInterval) async throws -> (status: Int, body: Data)
}

public struct URLSessionTransport: HTTPTransport {
    public init() {}

    public func post(_ url: URL, json: Data, timeout: TimeInterval) async throws -> (status: Int, body: Data) {
        var req = URLRequest(url: url, timeoutInterval: timeout)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = json
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw PairingError.badResponse }
        return (http.statusCode, data)
    }
}

public enum PairAddress {
    public static let defaultPort = 7890

    /// "100.64.0.1", "host.ts.net:7000" or "http://1.2.3.4" → `http://host:port/pair`.
    public static func parse(_ text: String) throws -> URL {
        var s = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.lowercased().hasPrefix("http://") { s = String(s.dropFirst(7)) }
        guard !s.isEmpty, !s.contains("/"), !s.contains("://") else { throw PairingError.invalidAddress }
        var host = s
        var port = defaultPort
        if let colon = s.lastIndex(of: ":") {
            host = String(s[..<colon])
            let p = String(s[s.index(after: colon)...])
            guard !p.isEmpty, p.allSatisfy({ $0.isASCII && $0.isNumber }), let n = Int(p), (1...65535).contains(n)
            else { throw PairingError.invalidAddress }
            port = n
        }
        let ok = Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_")
        guard !host.isEmpty, host.allSatisfy({ ok.contains($0) }) else { throw PairingError.invalidAddress }
        var c = URLComponents()
        c.scheme = "http"; c.host = host; c.port = port; c.path = "/pair"
        guard let url = c.url else { throw PairingError.invalidAddress }
        return url
    }
}

public struct Credentials: Codable, Equatable {
    public let pairURL: URL
    public let livekitURL: String
    public let token: String
    public let expiresAt: Date?

    public init(pairURL: URL, livekitURL: String, token: String) {
        self.pairURL = pairURL
        self.livekitURL = livekitURL
        self.token = token
        self.expiresAt = Credentials.expiry(ofJWT: token)
    }

    /// True from one hour before the token expires. Unknown expiry is never expired.
    public func isExpired(now: Date) -> Bool {
        guard let expiresAt else { return false }
        return now >= expiresAt.addingTimeInterval(-3600)
    }

    /// Reads `exp` from the payload without verifying anything.
    static func expiry(ofJWT jwt: String) -> Date? {
        let parts = jwt.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3 else { return nil }
        var b64 = parts[1].replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        guard let data = Data(base64Encoded: b64),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let exp = obj["exp"] as? NSNumber else { return nil }
        return Date(timeIntervalSince1970: exp.doubleValue)
    }
}

public struct PairingClient {
    public let http: HTTPTransport

    public init(http: HTTPTransport) { self.http = http }

    public func pair(address: String, code: String) async throws -> Credentials {
        let url = try PairAddress.parse(address)
        let words = code.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ").lowercased()
        guard let body = try? JSONSerialization.data(withJSONObject: ["code": words]) else { throw PairingError.badResponse }
        let result: (status: Int, body: Data)
        do { result = try await http.post(url, json: body, timeout: 10) }
        catch { throw PairingError.unreachable(String(describing: error)) }
        switch result.status {
        case 200:
            guard let obj = try? JSONSerialization.jsonObject(with: result.body) as? [String: Any],
                  let lk = obj["url"] as? String, let token = obj["token"] as? String
            else { throw PairingError.badResponse }
            return Credentials(pairURL: url, livekitURL: lk, token: token)
        case 403: throw PairingError.wrongCode
        case 429: throw PairingError.locked
        default: throw PairingError.badResponse
        }
    }
}
