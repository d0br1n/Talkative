import XCTest
@testable import TalkativeCore

final class BackoffTests: XCTestCase {
    func testScheduleDoublesFromOneSecondAndStopsAtThirty() {
        let delays = (0..<7).map { Backoff.delay(attempt: $0) }
        XCTAssertEqual(delays, [1, 2, 4, 8, 16, 30, 30])
    }

    func testLateAttemptsStayAtThirty() {
        XCTAssertEqual(Backoff.delay(attempt: 50), 30)
        XCTAssertEqual(Backoff.delay(attempt: Int.max), 30)
    }

    func testNegativeAttemptIsTheFirstDelay() {
        XCTAssertEqual(Backoff.delay(attempt: -1), 1)
    }
}
