import Combine
import Foundation
import TalkativeCore

private let barCount = 14

/// Everything the screens read and every action they take.
@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var state = ConversationState()
    @Published private(set) var credentials: Credentials? = nil
    // The levels change ~30 times a second each. They are not published, so they never redraw
    // the screens: only the live mark reads them, on its own timeline.
    private(set) var outputBars: [Double] = Array(repeating: 0, count: barCount)
    private(set) var micBars: [Double] = Array(repeating: 0, count: barCount)
    private(set) var outputRMS: Double = 0
    private(set) var micRMS: Double = 0
    /// The voice side's address from the last pairing (`host` or `host:port`), for the pair
    /// screen to fill in after the pairing expired.
    @Published private(set) var lastAddress = ""
    let log: RemoteLog

    private let tokens: TokenStore
    private let pairing: PairingClient
    private let audio: AudioSessionController
    private let room: RoomController
    /// The owner's mic choice when an interruption began (or their latest during it); nil when
    /// none is in progress.
    private var micBeforeInterruption: Bool?
    /// The scene is in the foreground and active.
    private var active = true
    /// Ends overdue approvals once a second while any is shown and the scene is active.
    private var expiryTask: Task<Void, Never>?

    init() {
        let log = RemoteLog()
        let tokens = TokenStore()
        let audio = AudioSessionController(log: log)
        self.log = log
        self.tokens = tokens
        self.audio = audio
        pairing = PairingClient(http: URLSessionTransport())
        room = RoomController(log: log, audio: audio)
        let saved = tokens.load()

        wire()
        if let saved {
            credentials = saved
            lastAddress = AppModel.address(of: saved.pairURL)
            join()
        }
    }

    // MARK: - Actions

    /// Pairs with the voice side, keeps the credentials in the Keychain, and joins.
    func pair(address: String, code: String) async throws {
        let c = try await pairing.pair(address: address, code: code)
        do {
            try tokens.save(c)
        } catch {
            log.add(.error, "keychain: could not save the pairing: \(error)")
        }
        state = ConversationState()
        watchApprovals()
        lastAddress = AppModel.address(of: c.pairURL)
        credentials = c
        join()
    }

    func join() {
        guard let c = credentials else { return }
        room.join(c, mic: state.mic)
    }

    func leave() {
        room.leave()
    }

    /// Leaves, forgets the pairing, and goes back to the pair screen.
    func unpair() {
        room.leave()
        tokens.delete()
        credentials = nil
        lastAddress = ""
        state = ConversationState()
        watchApprovals()
    }

    /// The owner's own action.
    func send(_ m: FromPhone) {
        // Their mic choice during an interruption is the one its end restores.
        if case .mic(let on) = m, micBeforeInterruption != nil { micBeforeInterruption = on }
        deliver(m)
    }

    func decide(id: String, allow: Bool) {
        send(.decide(id: id, allow: allow))
    }

    func say(_ text: String) {
        send(.said(text: text))
    }

    /// The scene's phase, from the root view. In the background the level taps stop posting;
    /// back in the foreground, overdue approvals end and an interruption whose end never came
    /// is treated as ended.
    func setActive(_ on: Bool) {
        guard on != active else { return }
        active = on
        room.setLevelsPosting(on)
        watchApprovals()
        guard on else { return }
        expireApprovals()
        if micBeforeInterruption != nil {
            log.add(.info, "interruption: no end arrived; ending it on return to the foreground")
            do {
                try audio.activate()
            } catch {
                log.add(.error, "audio session: reactivate failed: \(error.localizedDescription)")
            }
            interruptionEnded()
        }
    }

    // MARK: - Wiring

    private func wire() {
        room.onConnection = { [weak self] c in self?.connectionChanged(c) }
        room.onMessage = { [weak self] m in self?.dispatch(.received(m)) }
        room.onUnsent = { [weak self] m in self?.dispatch(.unsent(m)) }
        room.onMicFailed = { [weak self] in self?.dispatch(.sent(.mic(on: false))) }
        room.greeting = { [weak self] in
            guard let self else { return [] }
            return [.mic(on: self.state.mic), .audio(on: self.state.audio)]
        }
        room.onMicLevels = { [weak self] bars, rms in
            self?.micBars = bars
            self?.micRMS = rms
        }
        room.onOutputLevels = { [weak self] bars, rms in
            self?.outputBars = bars
            self?.outputRMS = rms
        }
        audio.onInterruptionBegan = { [weak self] in self?.interruptionBegan() }
        audio.onInterruptionEnded = { [weak self] in self?.interruptionEnded() }
        audio.onQuiet = { [weak self] in self?.deliver(.command(.quiet)) }
        audio.micIsOn = { [weak self] in self?.state.mic ?? false }
    }

    private func deliver(_ m: FromPhone) {
        dispatch(.sent(m))
        room.send(m)
    }

    private func dispatch(_ action: StoreAction) {
        TalkativeCore.reduce(&state, action)
        watchApprovals()
    }

    /// Runs the once-a-second expiry while an approval is shown and the scene is active.
    private func watchApprovals() {
        guard active, !state.approvals.isEmpty else {
            expiryTask?.cancel()
            expiryTask = nil
            return
        }
        guard expiryTask == nil else { return }
        expiryTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                guard !Task.isCancelled, let self else { return }
                self.expireApprovals()
            }
        }
    }

    /// Ends the approvals whose deadline passed; touches the state only when one did.
    private func expireApprovals() {
        let now = Date()
        guard state.approvals.contains(where: { $0.expiresAt <= now }) else { return }
        dispatch(.expire(now: now))
    }

    private func connectionChanged(_ c: Connection) {
        dispatch(.connection(c))
        // An expired pairing goes back to the pair screen; the Keychain item stays until a new
        // pairing replaces it, so the address is still there after a relaunch.
        if c == .expired { credentials = nil }
    }

    private func interruptionBegan() {
        if micBeforeInterruption == nil { micBeforeInterruption = state.mic }
        if state.mic { deliver(.mic(on: false)) }
    }

    private func interruptionEnded() {
        let wasOn = micBeforeInterruption ?? state.mic
        micBeforeInterruption = nil
        if wasOn { deliver(.mic(on: true)) }
    }

    private static func address(of url: URL) -> String {
        guard let host = url.host else { return "" }
        if let port = url.port, port != PairAddress.defaultPort { return "\(host):\(port)" }
        return host
    }
}
