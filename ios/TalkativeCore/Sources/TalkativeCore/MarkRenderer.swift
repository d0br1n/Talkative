import Foundation

/// Port of `frame(t)` in site/mark.js, with the bar amplitudes supplied by the caller.
public enum MarkRenderer {
    public static let rows = 15
    public static let bars = 14
    public static let columns = 56
    public static let envelope: [Double] = [0.25, 0.45, 0.7, 0.9, 0.6, 1.0, 0.75, 0.5, 0.85, 0.55, 0.4, 0.7, 0.35, 0.18]

    private static let heavy: [Character] = ["@", "@", "@", "%", "#", "8", "&"]
    private static let midHi: [Character] = ["#", "%", "*", "8", "&"]
    private static let mid: [Character] = ["*", "+", "=", "#"]
    private static let midLo: [Character] = ["+", "=", "-", "*"]
    private static let low: [Character] = ["-", ":", "=", "~"]
    private static let dust: [Character] = [".", ":", "'", "`", ","]

    private static func pick(_ l: [Character], _ r: Double) -> Character {
        l[Int(floor(r * Double(l.count))) % l.count]
    }

    // Bit for bit the same as Math.imul and >>> in the JS original.
    private static func hash(_ a: Int, _ b: Int, _ c: Int) -> Double {
        func u(_ v: Int) -> UInt32 { UInt32(truncatingIfNeeded: v) }
        var h = (u(a + 1) &* 374761393) ^ (u(b + 1) &* 668265263) ^ (u(c + 1) &* 2147483629)
        h = (h ^ (h >> 13)) &* 1274126177
        h = h ^ (h >> 16)
        return Double(h) / 4294967296
    }

    private static func charFor(_ d: Double, _ r: Double) -> Character {
        if d > 0.86 { return pick(heavy, r) }
        if d > 0.66 { return pick(midHi, r) }
        if d > 0.46 { return pick(mid, r) }
        if d > 0.30 { return pick(midLo, r) }
        if d > 0.17 { return pick(low, r) }
        if d > 0.07 { return pick(dust, r) }
        return " "
    }

    public static func idleBars(t: Double, level: Double) -> [Double] {
        (0..<bars).map { b in
            let bf = Double(b)
            return (envelope[b] * (0.55 + 0.45 * sin(t * 0.33 + bf * 0.9)) + 0.12 * sin(t * 0.9 + bf * 2.1)) * level
        }
    }

    public static func frame(t: Double, bars amps: [Double]) -> String {
        let cy = 7
        var grid = Array(repeating: Array(repeating: Character(" "), count: columns), count: rows)
        let tick = Int(floor(t / 2))
        for b in 0..<bars {
            let raw = b < amps.count ? amps[b] : 0
            let amp = max(0.08, min(1, raw))
            let half = max(1, Int((amp * Double(cy)).rounded()))
            for bx in 0..<4 {
                let x = b * 4 + bx
                for y in 0..<rows {
                    let dist = abs(y - cy)
                    if bx < 3 {
                        if dist <= half {
                            let tt = Double(dist) / (Double(half) + 0.8)
                            var d = 1 - pow(tt, 2.4)
                            if bx != 1 { d -= 0.16 }
                            d += (hash(x, y, 0) - 0.5) * 0.28
                            var ch = charFor(d, hash(x, y, 1))
                            if ch != " " && hash(x, y, 5 + tick) < 0.015 { ch = pick(dust, hash(x, y, 9 + tick)) }
                            grid[y][x] = ch
                        } else if dist == half + 1 && hash(x, y, 2) < 0.5 {
                            grid[y][x] = pick(dust, hash(x, y, 3))
                        }
                    } else if dist <= 1 && hash(x, y, 11 + tick) < 0.18 {
                        grid[y][x] = pick(dust, hash(x, y, 4 + tick))
                    }
                }
            }
        }
        return grid.map { String($0) }.joined(separator: "\n")
    }
}
