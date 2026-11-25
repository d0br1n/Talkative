import AVFoundation
import Foundation
import LiveKit
import TalkativeCore

/// Owns the `AVAudioSession` (recon b): LiveKit's automatic configuration is off, and the app
/// sets `.playAndRecord` / `.voiceChat` itself before the microphone is published. Reports
/// interruptions, route changes and the AirPods press-to-mute gesture.
@MainActor
final class AudioSessionController {
    var onInterruptionBegan: @MainActor () -> Void = {}
    var onInterruptionEnded: @MainActor () -> Void = {}
    /// The owner pressed the AirPods stem (iOS 17 press-to-mute): a barge-in, not a mute.
    var onQuiet: @MainActor () -> Void = {}
    /// The owner's mic choice (`state.mic`). A muted input while this is false is the owner's
    /// own mic-off, not a press, and must stay muted.
    var micIsOn: @MainActor () -> Bool = { false }

    /// When the app itself last turned the microphone on or off. LiveKit's default mute mode
    /// mutes through the voice-processing input, which may post the same notification.
    private var lastAppMicChange: Date?
    private static let ownChangeWindow: TimeInterval = 1.0

    private let log: RemoteLog
    private var observers: [NSObjectProtocol] = []

    init(log: RemoteLog) {
        self.log = log
        // Must happen before any Room exists or the audio engine starts.
        AudioManager.shared.audioSession.isAutomaticConfigurationEnabled = false
        observe()
    }

    /// Sets the category and activates the session. Call before publishing the microphone.
    func activate() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat,
                                options: [.allowBluetoothHFP, .allowBluetoothA2DP])
        try session.setActive(true)
    }

    /// Call whenever the app turns the microphone on or off, so the mute notification that
    /// follows is not taken for an AirPods press.
    func noteAppMicChange() {
        lastAppMicChange = Date()
    }

    /// Lets other apps' audio resume after leaving.
    func deactivate() {
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            log.add(.error, "audio session: deactivate failed: \(error.localizedDescription)")
        }
    }

    private func observe() {
        let center = NotificationCenter.default
        let session = AVAudioSession.sharedInstance()
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification,
                                            object: session, queue: .main) { [weak self] note in
            MainActor.assumeIsolated { self?.interruption(note) }
        })
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification,
                                            object: session, queue: .main) { [weak self] note in
            MainActor.assumeIsolated { self?.routeChange(note) }
        })
        if #available(iOS 17.0, *) {
            observers.append(center.addObserver(forName: AVAudioApplication.inputMuteStateChangeNotification,
                                                object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.inputMuteChanged() }
            })
        }
    }

    private func interruption(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        switch type {
        case .began:
            log.add(.info, "interruption began")
            onInterruptionBegan()
        case .ended:
            var options: AVAudioSession.InterruptionOptions = []
            if let rawOptions = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt {
                options = AVAudioSession.InterruptionOptions(rawValue: rawOptions)
            }
            log.add(.info, options.contains(.shouldResume) ? "interruption ended (should resume)" : "interruption ended")
            // Resume either way: the owner is in a conversation and expects the mic back.
            do {
                try activate()
            } catch {
                log.add(.error, "audio session: reactivate failed: \(error.localizedDescription)")
            }
            onInterruptionEnded()
        @unknown default:
            break
        }
    }

    private func routeChange(_ note: Notification) {
        var old = "unknown"
        if let previous = note.userInfo?[AVAudioSessionRouteChangePreviousRouteKey] as? AVAudioSessionRouteDescription {
            old = AudioSessionController.describe(previous)
        }
        let new = AudioSessionController.describe(AVAudioSession.sharedInstance().currentRoute)
        log.add(.info, "route: \(old) -> \(new)")
    }

    private static func describe(_ route: AVAudioSessionRouteDescription) -> String {
        let outputs = route.outputs.map { $0.portName }
        return outputs.isEmpty ? "none" : outputs.joined(separator: " + ")
    }

    /// iOS 17 press-to-mute: the system muted the input at the owner's press. Turn that into
    /// `quiet` and unmute again, so the microphone stays live. Only while the owner's mic is on
    /// and the app did not just change it itself; never unmutes a mic the owner turned off.
    @available(iOS 17.0, *)
    private func inputMuteChanged() {
        let app = AVAudioApplication.shared
        guard app.isInputMuted else { return }
        guard micIsOn() else { return }
        if let last = lastAppMicChange, Date().timeIntervalSince(last) < AudioSessionController.ownChangeWindow {
            return
        }
        log.add(.info, "press-to-mute: quiet")
        onQuiet()
        do {
            try app.setInputMuted(false)
        } catch {
            log.add(.error, "press-to-mute: unmute failed: \(error.localizedDescription)")
        }
    }
}
