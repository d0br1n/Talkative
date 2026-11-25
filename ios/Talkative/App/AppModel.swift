import Combine
import Foundation
import TalkativeCore

private let barCount = 14

/// Everything the screens read and every action they take.
@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var state = ConversationState()
    @Published private(set) var credentials: Credentials? = nil
    @Published private(set) var outputBars: [Double] = Array(repeating: 0, count: barCount)
    @Published private(set) var micBars: [Double] = Array(repeating: 0, count: barCount)
    @Published private(set) var outputRMS: Double = 0
    @Published private(set) var micRMS: Double = 0
    /// The voice side's address from the last pairing (`host` or `host:port`), for the pair
    /// screen to fill in after the pairing expired.
    @Published private(set) var lastAddress = ""
    let log: RemoteLog

    private let tokens: TokenStore
    private let pairing: PairingClient
    private let audio: AudioSessionController
    private let room: RoomController
    /// The owner's mic choice when an interruption began; nil when none is in progress.
    private var micBeforeInterruption: Bool?

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
    }

    func send(_ m: FromPhone) {
        dispatch(.sent(m))
        room.send(m)
    }

    func decide(id: String, allow: Bool) {
        send(.decide(id: id, allow: allow))
    }

    func say(_ text: String) {
        send(.said(text: text))
    }

    // MARK: - Wiring

    private func wire() {
        room.onConnection = { [weak self] c in self?.connectionChanged(c) }
        room.onMessage = { [weak self] m in self?.dispatch(.received(m)) }
        room.onUnsent = { [weak self] m in self?.unsent(m) }
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
        audio.onQuiet = { [weak self] in self?.send(.command(.quiet)) }
    }

    private func dispatch(_ action: StoreAction) {
        TalkativeCore.reduce(&state, action)
    }

    private func connectionChanged(_ c: Connection) {
        dispatch(.connection(c))
        // An expired pairing goes back to the pair screen; the Keychain item stays until a new
        // pairing replaces it, so the address is still there after a relaunch.
        if c == .expired { credentials = nil }
    }

    /// A decision that never left the phone must not leave its card stuck on `sending`.
    private func unsent(_ m: FromPhone) {
        if case .decide = m {
            dispatch(.received(.error(text: "Not connected, so that decision wasn't sent. Try again once connected.")))
        }
    }

    private func interruptionBegan() {
        if micBeforeInterruption == nil { micBeforeInterruption = state.mic }
        if state.mic { send(.mic(on: false)) }
    }

    private func interruptionEnded() {
        let wasOn = micBeforeInterruption ?? state.mic
        micBeforeInterruption = nil
        if wasOn { send(.mic(on: true)) }
    }

    private static func address(of url: URL) -> String {
        guard let host = url.host else { return "" }
        if let port = url.port, port != PairAddress.defaultPort { return "\(host):\(port)" }
        return host
    }
}
