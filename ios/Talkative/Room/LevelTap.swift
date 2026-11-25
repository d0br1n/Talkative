import AVFoundation
import Foundation
import LiveKit
import TalkativeCore

/// Watches one audio track: each buffer goes through this tap's own `BandMeter` on a serial
/// queue (the meter is not thread-safe and allocates, so it stays off the audio thread), and
/// the bars and RMS reach the main actor at most every 33 ms.
final class LevelTap: NSObject, AudioRenderer, @unchecked Sendable {
    typealias Sink = @MainActor (_ bars: [Double], _ rms: Double) -> Void

    static let interval: TimeInterval = 0.033

    private let bands: Int
    private let sink: Sink
    private let queue: DispatchQueue
    // Touched only on `queue`.
    private var meter: BandMeter?
    private var lastPublish: TimeInterval = 0

    init(label: String, bands: Int = 14, sink: @escaping Sink) {
        self.bands = bands
        self.sink = sink
        queue = DispatchQueue(label: "io.github.d0br1n.talkative.level.\(label)", qos: .userInitiated)
        super.init()
    }

    /// Called by LiveKit on an audio thread: copy channel 0 and leave at once.
    func render(pcmBuffer: AVAudioPCMBuffer) {
        let rate = pcmBuffer.format.sampleRate
        guard rate > 0, let samples = LevelTap.channelZero(pcmBuffer) else { return }
        queue.async { [weak self] in self?.process(samples, rate: rate) }
    }

    /// Forgets the meter's history and publishes silence, after any buffers already queued.
    func reset() {
        queue.async { [weak self] in
            guard let self else { return }
            self.meter = nil
            self.lastPublish = 0
            self.post(Array(repeating: 0, count: self.bands), 0)
        }
    }

    private func process(_ samples: [Float], rate: Double) {
        if meter == nil || meter?.sampleRate != rate {
            meter = BandMeter(sampleRate: rate, bands: bands)
        }
        guard let meter else { return }
        let bars = meter.process(samples)
        let rms = meter.rms
        let now = ProcessInfo.processInfo.systemUptime
        guard now - lastPublish >= LevelTap.interval else { return }
        lastPublish = now
        post(bars, rms)
    }

    private func post(_ bars: [Double], _ rms: Double) {
        let sink = self.sink
        DispatchQueue.main.async {
            MainActor.assumeIsolated { sink(bars, rms) }
        }
    }

    private static func channelZero(_ buffer: AVAudioPCMBuffer) -> [Float]? {
        let n = Int(buffer.frameLength)
        guard n > 0 else { return nil }
        let stride = max(1, buffer.stride)
        var out = [Float](repeating: 0, count: n)
        if let channels = buffer.floatChannelData {
            let p = channels[0]
            for i in 0..<n { out[i] = p[i * stride] }
            return out
        }
        if let channels = buffer.int16ChannelData {
            let p = channels[0]
            for i in 0..<n { out[i] = Float(p[i * stride]) / 32768 }
            return out
        }
        if let channels = buffer.int32ChannelData {
            let p = channels[0]
            for i in 0..<n { out[i] = Float(p[i * stride]) / 2_147_483_648 }
            return out
        }
        return nil
    }
}
