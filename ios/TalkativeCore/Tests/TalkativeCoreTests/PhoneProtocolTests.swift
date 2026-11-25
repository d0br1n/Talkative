import XCTest
@testable import TalkativeCore

final class PhoneProtocolTests: XCTestCase {
    private struct Fixture {
        let toPhone: [String], fromPhone: [String], bad: [(dir: String, json: String)]
    }

    private func load() throws -> Fixture {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "phone-messages", withExtension: "json", subdirectory: "Fixtures"))
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let bad = (root["bad"] as! [[String: String]]).map { (dir: $0["dir"]!, json: $0["json"]!) }
        return Fixture(toPhone: root["toPhone"] as! [String], fromPhone: root["fromPhone"] as! [String], bad: bad)
    }

    /// Canonical text, so true and 1 never compare equal the way NSNumber would.
    private func canon(_ data: Data) throws -> String {
        let o = try JSONSerialization.jsonObject(with: data)
        return String(decoding: try JSONSerialization.data(withJSONObject: o, options: [.sortedKeys]), as: UTF8.self)
    }

    func testToPhoneFixturesRoundTrip() throws {
        let f = try load()
        XCTAssertFalse(f.toPhone.isEmpty)
        for s in f.toPhone {
            let m = try PhoneCodec.decodeToPhone(Data(s.utf8))
            XCTAssertEqual(try canon(PhoneCodec.encode(m)), try canon(Data(s.utf8)), s)
        }
    }

    func testFromPhoneFixturesRoundTrip() throws {
        let f = try load()
        XCTAssertFalse(f.fromPhone.isEmpty)
        for s in f.fromPhone {
            let m = try PhoneCodec.decodeFromPhone(Data(s.utf8))
            XCTAssertEqual(try canon(PhoneCodec.encode(m)), try canon(Data(s.utf8)), s)
        }
    }

    func testBadFixturesThrow() throws {
        let f = try load()
        XCTAssertFalse(f.bad.isEmpty)
        for b in f.bad {
            XCTAssertThrowsError(try b.dir == "toPhone"
                ? { _ = try PhoneCodec.decodeToPhone(Data(b.json.utf8)) }()
                : { _ = try PhoneCodec.decodeFromPhone(Data(b.json.utf8)) }(), b.json) {
                XCTAssertTrue($0 is PhoneProtocolError, b.json)
            }
        }
    }

    func testBooleanIsNotANumberAndViceVersa() {
        XCTAssertThrowsError(try PhoneCodec.decodeFromPhone(Data(#"{"t":"mic","on":1}"#.utf8)))
        XCTAssertThrowsError(try PhoneCodec.decodeFromPhone(Data(#"{"t":"hello","protocol":true}"#.utf8)))
        XCTAssertThrowsError(try PhoneCodec.decodeToPhone(Data(#"{"t":"status","agent":"ready","thinking":false,"jobs":false,"audio":true}"#.utf8)))
        XCTAssertEqual(try PhoneCodec.decodeFromPhone(Data(#"{"t":"hello","protocol":1}"#.utf8)), .hello(protocol: 1))
        XCTAssertEqual(try PhoneCodec.decodeFromPhone(Data(#"{"t":"mic","on":true}"#.utf8)), .mic(on: true))
    }

    func testFractionalNumberForIntegerFieldThrows() {
        XCTAssertThrowsError(try PhoneCodec.decodeToPhone(Data(#"{"t":"speaking","turnId":"a","index":1.5}"#.utf8)))
    }

    func testExtraFieldsIgnoredAndNonObjectThrows() throws {
        XCTAssertEqual(try PhoneCodec.decodeToPhone(Data(#"{"t":"heard","text":"hi","extra":[1]}"#.utf8)), .heard(text: "hi"))
        XCTAssertThrowsError(try PhoneCodec.decodeToPhone(Data("[1]".utf8)))
        XCTAssertThrowsError(try PhoneCodec.decodeToPhone(Data("5".utf8)))
    }

    func testOversizeEncodeThrows() {
        XCTAssertThrowsError(try PhoneCodec.encode(FromPhone.said(text: String(repeating: "x", count: 70_000)))) {
            XCTAssertTrue($0 is PhoneProtocolError)
        }
    }
}
