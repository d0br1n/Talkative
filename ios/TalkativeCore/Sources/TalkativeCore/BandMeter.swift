import Foundation

/// Turns mono audio buffers into per-bar band levels (0...1): Goertzel power at log-spaced
/// centres (150 Hz...4 kHz) over a Hann-windowed buffer, tilt-compensated, normalised against a
/// shared slowly-falling peak.
public final class BandMeter {
    public let sampleRate: Double
    public let bands: Int
    public private(set) var rms: Double = 0

    private let centres: [Double]
    private var peakDB: Double = -50
    private var levels: [Double]
    private var window: [Float] = []

    private static let floorDB = -120.0
    private static let fallTau = 0.120
    private static let peakFallDBPerSec = 3.0
    private static let peakMinDB = -50.0
    private static let rangeDB = 30.0

    public init(sampleRate: Double, bands: Int = 14) {
        self.sampleRate = sampleRate
        self.bands = bands
        let lo = 150.0, hi = 4000.0
        centres = (0..<bands).map { b in
            bands == 1 ? lo : lo * pow(hi / lo, Double(b) / Double(bands - 1))
        }
        levels = Array(repeating: 0, count: bands)
    }

    private func hann(_ n: Int) -> [Float] {
        (0..<n).map { Float(0.5 - 0.5 * cos(2 * Double.pi * Double($0) / Double(n))) }
    }

    public func process(_ samples: [Float]) -> [Double] {
        let n = samples.count
        guard n > 0 else { return levels }
        if window.count != n { window = hann(n) }
        let dt = Double(n) / sampleRate

        var sumSq = 0.0
        for s in samples { sumSq += Double(s) * Double(s) }
        rms = (sumSq / Double(n)).squareRoot()

        var windowed = [Double](repeating: 0, count: n)
        var windowSum = 0.0
        for i in 0..<n {
            windowed[i] = Double(samples[i] * window[i])
            windowSum += Double(window[i])
        }

        var db = [Double](repeating: Self.floorDB, count: bands)
        var maxDB = Self.floorDB
        for b in 0..<bands {
            let w = 2 * Double.pi * centres[b] / sampleRate
            let coeff = 2 * cos(w)
            var s1 = 0.0, s2 = 0.0
            for x in windowed {
                let s0 = x + coeff * s1 - s2
                s2 = s1; s1 = s0
            }
            let power = max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2)
            let amp = 2 * power.squareRoot() / max(windowSum, 1e-9)   // full-scale sine = 1.0
            var level = amp > 1e-9 ? 20 * log10(amp) : Self.floorDB
            level = max(level, Self.floorDB)
            if level > Self.floorDB { level += 3 * log2(centres[b] / 500) }
            db[b] = level
            maxDB = max(maxDB, level)
        }

        peakDB = max(maxDB, peakDB - Self.peakFallDBPerSec * dt, Self.peakMinDB)

        let decay = exp(-dt / Self.fallTau)
        var out = [Double](repeating: 0, count: bands)
        for b in 0..<bands {
            let raw = min(1, max(0, (db[b] - (peakDB - Self.rangeDB)) / Self.rangeDB))
            let v = raw >= levels[b] ? raw : raw + (levels[b] - raw) * decay
            levels[b] = v
            out[b] = v
        }
        return out
    }
}
