import XCTest
@testable import TalkativeCore

final class RemoteLogTests: XCTestCase {
    func testDropsOldestAndReportsCount() {
        let log = RemoteLog(capacity: 3)
        for i in 1...5 { log.add(.info, "line \(i)") }
        let out = log.drain()
        XCTAssertEqual(out.count, 4)
        XCTAssertEqual(out[0], .log(level: .info, text: "… 2 earlier lines dropped"))
        XCTAssertEqual(out[1], .log(level: .info, text: "line 3"))
        XCTAssertEqual(out[3], .log(level: .info, text: "line 5"))
    }

    func testLongLineIsCutOnCharacterBoundary() {
        let log = RemoteLog()
        log.add(.error, String(repeating: "x", count: 5000))
        log.add(.error, String(repeating: "é", count: 5000))
        for case .log(_, let t) in log.drain() {
            XCTAssertLessThanOrEqual(t.utf8.count, 2048)
            XCTAssertFalse(t.isEmpty)
        }
    }

    func testDrainEmpties() {
        let log = RemoteLog()
        log.add(.info, "a")
        XCTAssertEqual(log.drain().count, 1)
        XCTAssertTrue(log.drain().isEmpty)
    }
}
