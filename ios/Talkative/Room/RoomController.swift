import Foundation
import LiveKit
import TalkativeCore

/// The phone's end of the LiveKit room: joins with the paired token, publishes the microphone,
/// plays the voice's audio, carries the phone protocol on the reliable data channel, and
/// rejoins with backoff after an unexpected disconnect.
@MainActor
final class RoomController {
    var onConnection: @MainActor (Connection) -> Void = { _ in }
    var onMessage: @MainActor (ToPhone) -> Void = { _ in }
    /// A message that could not be sent because the room is not connected.
    var onUnsent: @MainActor (FromPhone) -> Void = { _ in }
    /// The `mic` and `audio` messages that follow `hello` on every connect.
    var greeting: @MainActor () -> [FromPhone] = { [] }
    var onMicLevels: @MainActor ([Double], Double) -> Void = { _, _ in }
    var onOutputLevels: @MainActor ([Double], Double) -> Void = { _, _ in }

    private(set) var connection: Connection = .idle

    private let log: RemoteLog
    private let audio: AudioSessionController
    /// LiveKit holds delegates weakly; this keeps the adapter alive.
    private let events = RoomEvents()
    private lazy var micTap = LevelTap(label: "mic") { [weak self] bars, rms in
        self?.onMicLevels(bars, rms)
    }
    private lazy var outputTap = LevelTap(label: "output") { [weak self] bars, rms in
        self?.onOutputLevels(bars, rms)
    }

    private var room: Room?
    private var credentials: Credentials?
    private var micOn = true
    /// True while the owner wants to be in the room (joined and has not chosen leave).
    private var wanted = false
    private var attempt = 0
    /// Bumped on every connect, leave and expiry, so a late result from an old attempt is ignored.
    private var generation = 0
    private var retryTask: Task<Void, Never>?
    private var sendChain: Task<Void, Never>?
    private var tappedOutput: RemoteAudioTrack?
    private var tappedOutputSid: String?

    init(log: RemoteLog, audio: AudioSessionController) {
        self.log = log
        self.audio = audio
        events.owner = self
    }

    // MARK: - Owner actions

    func join(_ credentials: Credentials, mic: Bool) {
        self.credentials = credentials
        micOn = mic
        wanted = true
        attempt = 0
        retryTask?.cancel()
        retryTask = nil
        connect()
    }

    func leave() {
        wanted = false
        retryTask?.cancel()
        retryTask = nil
        generation += 1
        let old = room
        room = nil
        detachTaps()
        set(.left)
        Task { [weak self] in
            await old?.disconnect()
            guard let self, !self.wanted else { return }
            self.audio.deactivate()
        }
    }

    /// Sends on the reliable channel, in order. `mic` also turns the local microphone on or off.
    func send(_ m: FromPhone) {
        if case .mic(let on) = m { setMicrophone(on) }
        if !transmit(m) {
            log.add(.info, "not sent while \(connection): \(RoomController.kind(m))")
            onUnsent(m)
        }
    }

    // MARK: - Joining

    private func connect() {
        guard wanted, let c = credentials else { return }
        if c.isExpired(now: Date()) {
            expire("the pairing token has expired")
            return
        }
        generation += 1
        let gen = generation
        let old = room
        detachTaps()
        let r = Room(delegate: events)
        room = r
        set(attempt == 0 ? .connecting : .reconnecting)
        do {
            try audio.activate()
        } catch {
            log.add(.error, "audio session: activate failed: \(error.localizedDescription)")
        }
        let mic = micOn
        Task { [weak self] in
            await old?.disconnect()
            do {
                try await r.connect(url: c.livekitURL, token: c.token)
                guard let self, gen == self.generation else {
                    await r.disconnect()
                    return
                }
                if mic {
                    do {
                        try await r.localParticipant.setMicrophone(enabled: true)
                    } catch {
                        self.log.add(.error, "microphone: \(RoomController.describe(error))")
                    }
                }
                guard gen == self.generation else { return }
                self.joined()
            } catch {
                guard let self, gen == self.generation else { return }
                self.joinFailed(error)
            }
        }
    }

    private func joined() {
        attempt = 0
        set(.connected)
        AudioManager.shared.add(localAudioRenderer: micTap)
        greet()
    }

    private func joinFailed(_ error: Error) {
        guard wanted else { return }
        if RoomController.isRefusal(error) {
            expire(RoomController.describe(error))
            return
        }
        log.add(.error, "join failed: \(RoomController.describe(error))")
        scheduleRetry()
    }

    private func scheduleRetry() {
        guard wanted else { return }
        if let c = credentials, c.isExpired(now: Date()) {
            expire("the pairing token has expired")
            return
        }
        let wait = Backoff.delay(attempt: attempt)
        attempt += 1
        set(.reconnecting)
        log.add(.info, "rejoining in \(Int(wait)) s")
        retryTask?.cancel()
        retryTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
            guard let self, !Task.isCancelled, self.wanted else { return }
            self.retryTask = nil
            self.connect()
        }
    }

    /// The pairing no longer works: stop, and stop retrying.
    private func expire(_ why: String) {
        log.add(.error, "pairing refused: \(why)")
        wanted = false
        retryTask?.cancel()
        retryTask = nil
        generation += 1
        let old = room
        room = nil
        detachTaps()
        set(.expired)
        Task { await old?.disconnect() }
    }

    // MARK: - Sending

    private func greet() {
        var out: [FromPhone] = [.hello(protocol: phoneProtocolVersion)]
        out += greeting()
        out += log.drain()
        for m in out { _ = transmit(m) }
    }

    /// Queues `m` behind earlier sends so the voice side sees them in order.
    private func transmit(_ m: FromPhone) -> Bool {
        guard let r = room, r.connectionState == .connected else { return false }
        let data: Data
        do {
            data = try PhoneCodec.encode(m)
        } catch {
            log.add(.error, "not sent: \(RoomController.describe(error))")
            return false
        }
        let previous = sendChain
        let options = DataPublishOptions(reliable: true)
        sendChain = Task { [weak self] in
            _ = await previous?.value
            do {
                try await r.localParticipant.publish(data: data, options: options)
            } catch {
                self?.log.add(.error, "send failed: \(RoomController.describe(error))")
            }
        }
        return true
    }

    private func setMicrophone(_ on: Bool) {
        micOn = on
        guard let r = room, r.connectionState == .connected else { return }
        Task { [weak self] in
            do {
                try await r.localParticipant.setMicrophone(enabled: on)
            } catch {
                self?.log.add(.error, "microphone \(on ? "on" : "off") failed: \(RoomController.describe(error))")
            }
        }
    }

    // MARK: - Room events (on the main actor, in the order LiveKit sent them)

    fileprivate func stateChanged(_ r: Room, _ state: ConnectionState) {
        guard r === room else { return }
        switch state {
        case .connecting: set(attempt == 0 ? .connecting : .reconnecting)
        case .reconnecting: set(.reconnecting)
        case .connected: set(.connected)
        default: break // disconnects arrive through `disconnected` or the join's error
        }
    }

    /// Quick reconnects skip `stateChanged`; these cover both kinds.
    fileprivate func reconnectStarted(_ r: Room) {
        guard r === room else { return }
        set(.reconnecting)
    }

    fileprivate func reconnectCompleted(_ r: Room) {
        guard r === room, r.connectionState == .connected else { return }
        set(.connected)
        greet()
    }

    /// LiveKit gave up on a connection that had been up.
    fileprivate func disconnected(_ r: Room, error: LiveKitError?) {
        guard r === room, wanted else { return }
        detachTaps()
        if let error, RoomController.isRefusal(error) {
            expire(RoomController.describe(error))
            return
        }
        log.add(.error, "disconnected: \(error.map { RoomController.describe($0) } ?? "no reason given")")
        scheduleRetry()
    }

    fileprivate func received(_ r: Room, from identity: String?, data: Data) {
        guard r === room, let identity, identity.hasPrefix("voice-") else { return }
        do {
            onMessage(try PhoneCodec.decodeToPhone(data))
        } catch {
            log.add(.error, "dropped a message from \(identity): \(RoomController.describe(error))")
        }
    }

    fileprivate func subscribed(_ r: Room, identity: String?, sid: String, track: Track?) {
        guard r === room, let identity, identity.hasPrefix("voice-"),
              let audioTrack = track as? RemoteAudioTrack else { return }
        tappedOutput?.remove(audioRenderer: outputTap)
        outputTap.reset()
        audioTrack.add(audioRenderer: outputTap)
        tappedOutput = audioTrack
        tappedOutputSid = sid
        log.add(.info, "voice audio from \(identity)")
    }

    fileprivate func unsubscribed(_ r: Room, sid: String) {
        guard r === room, sid == tappedOutputSid else { return }
        tappedOutput?.remove(audioRenderer: outputTap)
        tappedOutput = nil
        tappedOutputSid = nil
        outputTap.reset()
    }

    // MARK: - Helpers

    private func detachTaps() {
        AudioManager.shared.remove(localAudioRenderer: micTap)
        tappedOutput?.remove(audioRenderer: outputTap)
        tappedOutput = nil
        tappedOutputSid = nil
        micTap.reset()
        outputTap.reset()
    }

    private func set(_ c: Connection) {
        guard c != connection else { return }
        connection = c
        log.add(c == .expired ? .error : .info, "connection: \(c)")
        onConnection(c)
    }

    /// LiveKit checks a refused join against its validate endpoint and reports any 4xx but
    /// 404 and 429 (a bad, expired or revoked token) as `.validation`.
    private static func isRefusal(_ error: Error) -> Bool {
        guard let e = error as? LiveKitError else { return false }
        return e.type == .validation
    }

    private static func describe(_ error: Error) -> String {
        if let e = error as? PhoneProtocolError { return e.message }
        if let e = error as? LiveKitError { return e.localizedDescription }
        return String(describing: error)
    }

    private static func kind(_ m: FromPhone) -> String {
        switch m {
        case .hello: return "hello"
        case .mic: return "mic"
        case .audio: return "audio"
        case .said: return "said"
        case .decide: return "decide"
        case .settings: return "settings"
        case .command: return "command"
        case .log: return "log"
        }
    }
}

/// LiveKit calls its delegates on its own queue, in order. This hops each event to the main
/// queue (still in order) and hands it to the controller.
final class RoomEvents: NSObject, RoomDelegate, @unchecked Sendable {
    weak var owner: RoomController?

    private func onMain(_ body: @escaping @MainActor (RoomController) -> Void) {
        DispatchQueue.main.async { [weak self] in
            MainActor.assumeIsolated {
                guard let owner = self?.owner else { return }
                body(owner)
            }
        }
    }

    func room(_ room: Room, didUpdateConnectionState connectionState: ConnectionState,
              from oldConnectionState: ConnectionState) {
        onMain { $0.stateChanged(room, connectionState) }
    }

    func room(_ room: Room, didStartReconnectWithMode reconnectMode: ReconnectMode) {
        onMain { $0.reconnectStarted(room) }
    }

    func room(_ room: Room, didCompleteReconnectWithMode reconnectMode: ReconnectMode) {
        onMain { $0.reconnectCompleted(room) }
    }

    func room(_ room: Room, didDisconnectWithError error: LiveKitError?) {
        onMain { $0.disconnected(room, error: error) }
    }

    func room(_ room: Room, participant: RemoteParticipant?, didReceiveData data: Data,
              forTopic topic: String, encryptionType: EncryptionType) {
        let identity = participant?.identity?.stringValue
        onMain { $0.received(room, from: identity, data: data) }
    }

    func room(_ room: Room, participant: RemoteParticipant, didSubscribeTrack publication: RemoteTrackPublication) {
        let identity = participant.identity?.stringValue
        let sid = publication.sid.stringValue
        let track = publication.track
        onMain { $0.subscribed(room, identity: identity, sid: sid, track: track) }
    }

    func room(_ room: Room, participant: RemoteParticipant, didUnsubscribeTrack publication: RemoteTrackPublication) {
        let sid = publication.sid.stringValue
        onMain { $0.unsubscribed(room, sid: sid) }
    }
}
