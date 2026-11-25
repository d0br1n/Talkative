import XCTest
import Foundation
@testable import TalkativeCore

final class BandMeterTests: XCTestCase {
    let sr = 48_000.0
    let n = 480

    struct XorShift { var s: UInt64 = 0x9E3779B97F4A7C15
        mutating func next() -> Float {
            s ^= s << 13; s ^= s >> 7; s ^= s << 17
            return Float(Double(s % 2_000_001) / 1_000_000 - 1)   // uniform -1...1
        }
    }

    private func check(_ levels: [Double], file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(levels.count, 14, file: file, line: line)
        for l in levels { XCTAssertTrue((0...1).contains(l), "\(l)", file: file, line: line) }
    }

    private func run(_ m: BandMeter, buffers: Int, _ gen: (Int) -> Float) -> [Double] {
        var last: [Double] = []
        var idx = 0
        for _ in 0..<buffers {
            let buf = (0..<n).map { _ in defer { idx += 1 }; return gen(idx) }
            last = m.process(buf)
            check(last)
        }
        return last
    }

    func testSilence() {
        let m = BandMeter(sampleRate: sr)
        let l = run(m, buffers: 100) { _ in 0 }
        XCTAssertTrue(l.allSatisfy { $0 <= 0.01 })
        XCTAssertEqual(m.rms, 0)
    }

    func testToneThenSilence() {
        let m = BandMeter(sampleRate: sr)
        let amp = Float(pow(10.0, -12.0 / 20))
        let l = run(m, buffers: 50) { i in amp * Float(sin(2 * Double.pi * 1000 * Double(i) / 48_000)) }
        print("tone levels:", l.map { String(format: "%.3f", $0) }, "rms", m.rms)
        let top = l.indices.max { l[$0] < l[$1] }!
        // centres are 150 * (4000/150)^(k/13)
        let centres = (0..<14).map { 150 * pow(4000.0 / 150, Double($0) / 13) }
        // ruling: the largest band is one of the two whose centres bracket 1 kHz
        let below = centres.lastIndex { $0 <= 1000 }!
        let above = centres.firstIndex { $0 >= 1000 }!
        XCTAssertTrue(top == below || top == above, "top=\(top) bracket=\(below),\(above)")
        XCTAssertGreaterThanOrEqual(l[top], 0.9)
        XCTAssertEqual(m.rms, 0.177, accuracy: 0.005)
        let s = run(m, buffers: 100) { _ in 0 }
        XCTAssertTrue(s.allSatisfy { $0 <= 0.05 }, "\(s)")
    }

    func testWhiteNoise() {
        let m = BandMeter(sampleRate: sr)
        var g = XorShift()
        // uniform -1...1 has rms 1/sqrt(3); scale to -20 dBFS rms (0.1)
        let k = Float(0.1 * 3.0.squareRoot())
        let l = run(m, buffers: 50) { _ in g.next() * k }
        print("noise levels:", l.map { String(format: "%.3f", $0) }, "rms", m.rms)
        XCTAssertGreaterThanOrEqual(l.filter { $0 >= 0.3 }.count, 10, "\(l)")
    }
}
