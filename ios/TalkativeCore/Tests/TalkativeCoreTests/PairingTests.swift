import XCTest
@testable import TalkativeCore

final class FakeTransport: HTTPTransport, @unchecked Sendable {
    var status = 200
    var body = Data()
    var error: Error?
    var lastURL: URL?
    var lastBody: Data?
    var lastTimeout: TimeInterval?
    func post(_ url: URL, json: Data, timeout: TimeInterval) async throws -> (status: Int, body: Data) {
        lastURL = url; lastBody = json; lastTimeout = timeout
        if let error { throw error }
        return (status, body)
    }
}

struct Boom: Error, CustomStringConvertible { var description: String { "boom" } }

final class PairingTests: XCTestCase {
    private func jwt(_ payload: String) -> String {
        func b64(_ s: String) -> String {
            Data(s.utf8).base64EncodedString()
                .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
        }
        return "\(b64("{\"alg\":\"HS256\"}")).\(b64(payload)).sig"
    }

    func testParse() throws {
        XCTAssertEqual(try PairAddress.parse("100.101.102.103").absoluteString, "http://100.101.102.103:7890/pair")
        XCTAssertEqual(try PairAddress.parse(" laptop.tail1234.ts.net:7000 ").absoluteString, "http://laptop.tail1234.ts.net:7000/pair")
        XCTAssertEqual(try PairAddress.parse("http://1.2.3.4:7890").absoluteString, "http://1.2.3.4:7890/pair")
        for bad in ["", "  ", "https://x", "1.2.3.4:99999", "1.2.3.4:0", "1.2.3.4/x", "http://1.2.3.4/x"] {
            XCTAssertThrowsError(try PairAddress.parse(bad), bad) { XCTAssertEqual($0 as? PairingError, .invalidAddress) }
        }
    }

    func testRequestBody() async throws {
        let t = FakeTransport()
        t.body = Data(#"{"url":"wss://x","token":"t"}"#.utf8)
        _ = try await PairingClient(http: t).pair(address: "1.2.3.4", code: "  Amber  WIRE lantern ")
        XCTAssertEqual(String(data: t.lastBody!, encoding: .utf8), #"{"code":"amber wire lantern"}"#)
        XCTAssertEqual(t.lastTimeout, 10)
        XCTAssertEqual(t.lastURL?.absoluteString, "http://1.2.3.4:7890/pair")
    }

    func testStatusMapping() async throws {
        let t = FakeTransport()
        let c = PairingClient(http: t)
        t.body = Data(#"{"url":"wss://x","token":"tok"}"#.utf8)
        let cred = try await c.pair(address: "1.2.3.4", code: "a b c")
        XCTAssertEqual(cred.livekitURL, "wss://x")
        XCTAssertEqual(cred.token, "tok")
        XCTAssertEqual(cred.pairURL.absoluteString, "http://1.2.3.4:7890/pair")
        for (status, err) in [(403, PairingError.wrongCode), (429, .locked), (500, .badResponse), (413, .badResponse)] {
            t.status = status
            do { _ = try await c.pair(address: "1.2.3.4", code: "a"); XCTFail() }
            catch { XCTAssertEqual(error as? PairingError, err) }
        }
        t.status = 200
        for body in ["{}", #"{"url":"x"}"#, #"{"url":1,"token":"t"}"#, "nope"] {
            t.body = Data(body.utf8)
            do { _ = try await c.pair(address: "1.2.3.4", code: "a"); XCTFail() }
            catch { XCTAssertEqual(error as? PairingError, .badResponse) }
        }
        t.error = Boom()
        do { _ = try await c.pair(address: "1.2.3.4", code: "a"); XCTFail() }
        catch { XCTAssertEqual(error as? PairingError, .unreachable("boom")) }
        do { _ = try await c.pair(address: "", code: "a"); XCTFail() }
        catch { XCTAssertEqual(error as? PairingError, .invalidAddress) }
    }

    func testExpiry() {
        let url = URL(string: "http://1.2.3.4:7890/pair")!
        let c = Credentials(pairURL: url, livekitURL: "wss://x", token: jwt(#"{"exp":1800000000}"#))
        XCTAssertEqual(c.expiresAt, Date(timeIntervalSince1970: 1800000000))
        XCTAssertFalse(c.isExpired(now: Date(timeIntervalSince1970: 1800000000 - 7200)))
        XCTAssertTrue(c.isExpired(now: Date(timeIntervalSince1970: 1800000000 - 1800)))
        let bad = Credentials(pairURL: url, livekitURL: "wss://x", token: "not-a-jwt")
        XCTAssertNil(bad.expiresAt)
        XCTAssertFalse(bad.isExpired(now: Date()))
        XCTAssertNil(Credentials(pairURL: url, livekitURL: "x", token: jwt("{}")).expiresAt)
    }
}
