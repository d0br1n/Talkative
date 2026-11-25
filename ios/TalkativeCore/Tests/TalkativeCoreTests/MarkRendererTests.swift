import XCTest
import Foundation
@testable import TalkativeCore

final class MarkRendererTests: XCTestCase {
    struct Fixture: Decodable { let t: Double; let frame: String }

    func loadFixtures() throws -> [Fixture] {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "mark-frames", withExtension: "json", subdirectory: "Fixtures"))
        return try JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))
    }

    func testMatchesSiteFrames() throws {
        let fixtures = try loadFixtures()
        XCTAssertEqual(fixtures.count, 7)
        for f in fixtures {
            let got = MarkRenderer.frame(t: f.t, bars: MarkRenderer.idleBars(t: f.t, level: 1))
            XCTAssertEqual(got, f.frame, "t=\(f.t)")
        }
    }

    func testShape() {
        for t in [0.0, 3.3, 99.0] {
            let lines = MarkRenderer.frame(t: t, bars: MarkRenderer.idleBars(t: t, level: 1)).split(separator: "\n", omittingEmptySubsequences: false)
            XCTAssertEqual(lines.count, 15)
            for l in lines { XCTAssertEqual(l.count, 56) }
        }
    }

    func testZeroBarsStayInMiddleRows() {
        let lines = MarkRenderer.frame(t: 0, bars: Array(repeating: 0, count: 14)).split(separator: "\n", omittingEmptySubsequences: false)
        for (y, l) in lines.enumerated() where !(5...9).contains(y) {
            XCTAssertTrue(l.allSatisfy { $0 == " " }, "row \(y)")
        }
    }

    func testFullBarsFillMiddleColumns() {
        let lines = MarkRenderer.frame(t: 0, bars: Array(repeating: 1, count: 14)).split(separator: "\n", omittingEmptySubsequences: false).map { Array($0) }
        for b in 0..<14 {
            for y in 0..<15 {
                XCTAssertNotEqual(lines[y][4 * b + 1], " ", "bar \(b) row \(y)")
            }
        }
    }
}
