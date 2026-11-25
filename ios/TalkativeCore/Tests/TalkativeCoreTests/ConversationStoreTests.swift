import XCTest
@testable import TalkativeCore

final class ConversationStoreTests: XCTestCase {
    private func run(_ actions: [StoreAction], from s: ConversationState = ConversationState()) -> ConversationState {
        var st = s
        for a in actions { reduce(&st, a) }
        return st
    }
    private func rx(_ m: ToPhone) -> StoreAction { .received(m) }
    private func reply(_ s: ConversationState, _ i: Int = 0) -> Reply {
        guard case .agent(let r) = s.entries[i] else { XCTFail("not agent"); return Reply(turnId: "") }
        return r
    }
    private func approval(_ id: String = "a1") -> ToPhone {
        .approval(id: id, tool: "Bash", summary: "run ls", detail: "ls -la", expiresAt: 90_000)
    }

    func testDefaults() {
        let s = ConversationState()
        XCTAssertEqual(s.connection, .idle); XCTAssertEqual(s.agent, .down)
        XCTAssertTrue(s.audio); XCTAssertTrue(s.mic); XCTAssertEqual(s.newApprovals, 0)
    }

    func testHeardAppendsYou() {
        XCTAssertEqual(run([rx(.heard(text: "hi"))]).entries, [.you("hi")])
    }

    func testNarrationAppendsThenReplacesLast() {
        let s = run([rx(.heard(text: "hi")), rx(.narration(text: "a")), rx(.narration(text: "b"))])
        XCTAssertEqual(s.entries, [.you("hi"), .narration("b")])
    }

    func testErrorAppendsAndClearsSending() {
        let s = run([rx(approval()), .sent(.decide(id: "a1", allow: true)), rx(.error(text: "boom"))])
        XCTAssertEqual(s.entries, [.error("boom")])
        XCTAssertFalse(s.approvals[0].sending)
    }

    func testDeltaWithoutBlockStartCreatesReply() {
        let s = run([rx(.delta(turnId: "t", block: 0, text: "Hel")), rx(.delta(turnId: "t", block: 0, text: "lo"))])
        XCTAssertEqual(s.entries.count, 1)
        XCTAssertEqual(reply(s).blocks, [ReplyBlock(block: 0, text: "Hello")])
    }

    func testBlockStartAndTwoBlocks() {
        let s = run([rx(.blockStart(turnId: "t", block: 0)), rx(.blockStart(turnId: "t", block: 1)),
                     rx(.delta(turnId: "t", block: 1, text: "x"))])
        XCTAssertEqual(reply(s).blocks, [ReplyBlock(block: 0, text: ""), ReplyBlock(block: 1, text: "x")])
    }

    func testSentenceAndSpeakingGrowOnly() {
        let s = run([rx(.sentence(turnId: "t", index: 0, text: "A.")), rx(.speaking(turnId: "t", index: 2)),
                     rx(.speaking(turnId: "t", index: 1))])
        XCTAssertEqual(reply(s).sentences, [0: "A."])
        XCTAssertEqual(reply(s).spokenIndex, 2)
    }

    func testSpeakingUnknownTurnCreatesEmptyReply() {
        let s = run([rx(.speaking(turnId: "zz", index: 0))])
        XCTAssertEqual(reply(s), Reply(turnId: "zz", blocks: [], sentences: [:], spokenIndex: 0))
    }

    func testSpeakingVoiceChangesNothing() {
        let s = run([rx(.speaking(turnId: "voice", index: 0))])
        XCTAssertEqual(s.entries, [])
    }

    func testLastAgentEntryWithTurnIdIsUsed() {
        let s = run([rx(.delta(turnId: "t", block: 0, text: "a")), rx(.heard(text: "x")),
                     rx(.delta(turnId: "t", block: 0, text: "b"))])
        XCTAssertEqual(s.entries.count, 2)
        XCTAssertEqual(reply(s).blocks[0].text, "ab")
    }

    func testStatusAndSettings() {
        let s = run([rx(.status(agent: .ready, thinking: true, jobs: 2, audio: false)),
                     rx(.settings(verbosity: .brief, model: "opus", effort: .high))])
        XCTAssertEqual(s.agent, .ready); XCTAssertTrue(s.thinking); XCTAssertEqual(s.jobs, 2); XCTAssertFalse(s.audio)
        XCTAssertEqual(s.settings, ServerSettings(verbosity: .brief, model: "opus", effort: .high))
    }

    func testApprovalAppendsAndCounts() {
        let s = run([rx(approval())])
        XCTAssertEqual(s.approvals.count, 1); XCTAssertEqual(s.newApprovals, 1)
        XCTAssertEqual(s.approvals[0].expiresAt, Date(timeIntervalSince1970: 90))
    }

    func testApprovalResentAfterReconnectKeepsOneCardNoHaptic() {
        let s = run([rx(approval()), .sent(.decide(id: "a1", allow: true)), .connection(.reconnecting),
                     .connection(.connected), rx(approval())])
        XCTAssertEqual(s.approvals.count, 1); XCTAssertEqual(s.newApprovals, 1)
        XCTAssertTrue(s.approvals[0].sending)
        XCTAssertEqual(s.connection, .connected)
    }

    func testApprovalDoneRemovesAndRecordsDecision() {
        let s = run([rx(approval()), rx(.approvalDone(id: "a1", allow: false, by: .timeout))])
        XCTAssertTrue(s.approvals.isEmpty)
        XCTAssertEqual(s.entries, [.decision(summary: "run ls", allow: false, by: .timeout)])
    }

    func testApprovalDoneUnknownId() {
        let s = run([rx(.approvalDone(id: "?", allow: true, by: .owner))])
        XCTAssertEqual(s.entries, [.decision(summary: "an approval", allow: true, by: .owner)])
    }

    func testSentDecideSetsSending() {
        let s = run([rx(approval("a")), rx(approval("b")), .sent(.decide(id: "b", allow: true))])
        XCTAssertFalse(s.approvals[0].sending); XCTAssertTrue(s.approvals[1].sending)
    }

    func testSentMicAndAudio() {
        let s = run([.sent(.mic(on: false)), .sent(.audio(on: false))])
        XCTAssertFalse(s.mic); XCTAssertFalse(s.audio)
    }

    func testKeepsNewest500() {
        let s = run((0..<600).map { rx(.heard(text: "\($0)")) })
        XCTAssertEqual(s.entries.count, 500)
        XCTAssertEqual(s.entries.first, .you("100")); XCTAssertEqual(s.entries.last, .you("599"))
    }

    func testCountdown() {
        let a = Approval(id: "a", tool: "t", summary: "s", detail: "d", expiresAt: Date(timeIntervalSince1970: 200))
        XCTAssertEqual(a.countdown(now: Date(timeIntervalSince1970: 100.4)), "01:39")
        XCTAssertEqual(a.countdown(now: Date(timeIntervalSince1970: 200)), "00:00")
        XCTAssertEqual(a.countdown(now: Date(timeIntervalSince1970: 500)), "00:00")
    }
}
