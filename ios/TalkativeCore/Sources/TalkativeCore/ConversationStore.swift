import Foundation

public enum Connection: Equatable { case idle, connecting, connected, reconnecting, left, expired }

public struct ReplyBlock: Equatable {
    public let block: Int
    public var text: String
    public init(block: Int, text: String) { self.block = block; self.text = text }
}

public struct Reply: Equatable {
    public let turnId: String
    public var blocks: [ReplyBlock]
    public var sentences: [Int: String]
    public var spokenIndex: Int?
    public init(turnId: String, blocks: [ReplyBlock] = [], sentences: [Int: String] = [:], spokenIndex: Int? = nil) {
        self.turnId = turnId; self.blocks = blocks; self.sentences = sentences; self.spokenIndex = spokenIndex
    }
}

public enum Entry: Equatable {
    case you(String)
    case agent(Reply)
    case narration(String)
    case error(String)
    case decision(summary: String, allow: Bool, by: DecidedBy)
}

public struct Approval: Equatable {
    public let id: String
    public let tool: String
    public let summary: String
    public let detail: String
    public let expiresAt: Date
    public var sending: Bool

    public init(id: String, tool: String, summary: String, detail: String, expiresAt: Date, sending: Bool = false) {
        self.id = id; self.tool = tool; self.summary = summary; self.detail = detail
        self.expiresAt = expiresAt; self.sending = sending
    }

    /// `mm:ss` left until expiry, floored, never below `00:00`.
    public func countdown(now: Date) -> String {
        let left = max(0, Int(expiresAt.timeIntervalSince(now).rounded(.down)))
        return String(format: "%02d:%02d", left / 60, left % 60)
    }
}

public struct ServerSettings: Equatable {
    public let verbosity: Verbosity
    public let model: String
    public let effort: Effort
    public init(verbosity: Verbosity, model: String, effort: Effort) {
        self.verbosity = verbosity; self.model = model; self.effort = effort
    }
}

public struct ConversationState: Equatable {
    public var connection: Connection
    public var agent: AgentHealth = .down
    public var thinking = false
    public var jobs = 0
    public var audio = true
    public var mic = true
    public var entries: [Entry] = []
    public var approvals: [Approval] = []
    public var settings: ServerSettings?
    /// Counts approvals that newly arrived; the view watches it for the haptic.
    public var newApprovals = 0

    public init(connection: Connection = .idle) { self.connection = connection }

    /// The transcript line for a decision that never left the phone.
    public static let decisionNotSent = "Not connected, so that decision wasn't sent. Try again once connected."
    /// The transcript line for any other tap that never left the phone.
    public static let notSent = "Not connected; that wasn't sent."
}

public enum StoreAction {
    case received(ToPhone)
    case connection(Connection)
    case sent(FromPhone)
    /// A message the phone could not send (not connected, or the send failed).
    case unsent(FromPhone)
    /// Ends every approval whose deadline has passed, as the voice side would have: a card whose
    /// `approvalDone` was lost while the phone was away must not wait forever.
    case expire(now: Date)
}

let maxEntries = 500

public func reduce(_ state: inout ConversationState, _ action: StoreAction) {
    switch action {
    case .connection(let c):
        state.connection = c
        // A decide in flight may be lost with the connection: let the owner answer again.
        if c == .reconnecting || c == .connecting {
            for i in state.approvals.indices { state.approvals[i].sending = false }
        }
    case .sent(let m):
        switch m {
        case .decide(let id, _):
            if let i = state.approvals.firstIndex(where: { $0.id == id }) { state.approvals[i].sending = true }
        case .mic(let on): state.mic = on
        case .audio(let on): state.audio = on
        default: break
        }
    case .unsent(let m):
        switch m {
        case .decide:
            state.entries.append(.error(ConversationState.decisionNotSent))
            for i in state.approvals.indices { state.approvals[i].sending = false }
        case .command, .settings, .said, .mic, .audio:
            state.entries.append(.error(ConversationState.notSent))
        case .hello, .log:
            break
        }
    case .expire(let now):
        for a in state.approvals where a.expiresAt <= now {
            state.entries.append(.decision(summary: a.summary, allow: false, by: .timeout))
        }
        state.approvals.removeAll { $0.expiresAt <= now }
    case .received(let m):
        receive(&state, m)
    }
    if state.entries.count > maxEntries { state.entries.removeFirst(state.entries.count - maxEntries) }
}

private func receive(_ state: inout ConversationState, _ m: ToPhone) {
    switch m {
    case .heard(let text):
        state.entries.append(.you(text))
    case .narration(let text):
        if case .narration = state.entries.last { state.entries[state.entries.count - 1] = .narration(text) }
        else { state.entries.append(.narration(text)) }
    case .error(let text):
        state.entries.append(.error(text))
        for i in state.approvals.indices { state.approvals[i].sending = false }
    case .blockStart(let turn, let block):
        withReply(&state, turn) { r in
            if !r.blocks.contains(where: { $0.block == block }) { r.blocks.append(ReplyBlock(block: block, text: "")) }
        }
    case .blockEnd:
        break
    case .delta(let turn, let block, let text):
        withReply(&state, turn) { r in
            if let i = r.blocks.firstIndex(where: { $0.block == block }) { r.blocks[i].text += text }
            else { r.blocks.append(ReplyBlock(block: block, text: text)) }
        }
    case .sentence(let turn, let index, let text):
        withReply(&state, turn) { $0.sentences[index] = text }
    case .speaking(let turn, let index):
        if turn == "voice" { return }
        withReply(&state, turn) { r in
            if r.spokenIndex == nil || index > r.spokenIndex! { r.spokenIndex = index }
        }
    case .status(let agent, let thinking, let jobs, let audio):
        state.agent = agent; state.thinking = thinking; state.jobs = jobs; state.audio = audio
    case .settings(let v, let model, let e):
        state.settings = ServerSettings(verbosity: v, model: model, effort: e)
    case .approval(let id, let tool, let summary, let detail, let expiresAt):
        let date = Date(timeIntervalSince1970: Double(expiresAt) / 1000)
        if let i = state.approvals.firstIndex(where: { $0.id == id }) {
            state.approvals[i] = Approval(id: id, tool: tool, summary: summary, detail: detail,
                                          expiresAt: date, sending: state.approvals[i].sending)
        } else {
            state.approvals.append(Approval(id: id, tool: tool, summary: summary, detail: detail, expiresAt: date))
            state.newApprovals += 1
        }
    case .approvalDone(let id, let allow, let by):
        var summary = "an approval"
        if let i = state.approvals.firstIndex(where: { $0.id == id }) {
            summary = state.approvals[i].summary
            state.approvals.remove(at: i)
        }
        state.entries.append(.decision(summary: summary, allow: allow, by: by))
    }
}

private func withReply(_ state: inout ConversationState, _ turn: String, _ body: (inout Reply) -> Void) {
    for i in state.entries.indices.reversed() {
        if case .agent(var r) = state.entries[i], r.turnId == turn {
            body(&r)
            state.entries[i] = .agent(r)
            return
        }
    }
    var r = Reply(turnId: turn)
    body(&r)
    state.entries.append(.agent(r))
}
