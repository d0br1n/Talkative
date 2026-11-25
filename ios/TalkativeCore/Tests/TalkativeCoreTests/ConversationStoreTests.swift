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
        // A decide may have been lost in the reconnect: the card can be answered again.
        XCTAssertFalse(s.approvals[0].sending)
        XCTAssertEqual(s.connection, .connected)
    }

    func testReconnectingAndConnectingClearEverySending() {
        for c in [Connection.reconnecting, .connecting] {
            let s = run([rx(approval("a")), rx(approval("b")), .sent(.decide(id: "a", allow: true)),
                         .sent(.decide(id: "b", allow: false)), .connection(c)])
            XCTAssertEqual(s.approvals.map(\.sending), [false, false], "\(c)")
        }
    }

    func testConnectedAndLeftKeepSending() {
        for c in [Connection.connected, .left, .idle, .expired] {
            let s = run([rx(approval()), .sent(.decide(id: "a1", allow: true)), .connection(c)])
            XCTAssertTrue(s.approvals[0].sending, "\(c)")
        }
    }

    func testExpireRemovesDueApprovalsAndRecordsTimeouts() {
        let late = ToPhone.approval(id: "a2", tool: "Bash", summary: "rm tmp", detail: "", expiresAt: 200_000)
        let due = ToPhone.approval(id: "a3", tool: "Bash", summary: "git push", detail: "", expiresAt: 60_000)
        let s = run([rx(approval()), rx(late), rx(due), .expire(now: Date(timeIntervalSince1970: 95))])
        XCTAssertEqual(s.approvals.map(\.id), ["a2"])
        XCTAssertEqual(s.entries, [.decision(summary: "run ls", allow: false, by: .timeout),
                                   .decision(summary: "git push", allow: false, by: .timeout)])
    }

    func testExpireWaitsForTheVoicesOwnTimeoutAndIgnoresItsLateEcho() {
        let early = run([rx(approval()), .expire(now: Date(timeIntervalSince1970: 92))])
        XCTAssertEqual(early.approvals.map(\.id), ["a1"], "within the grace the voice ends the card")
        XCTAssertEqual(early.entries, [])
        let s = run([.expire(now: Date(timeIntervalSince1970: 95)),
                     rx(.approvalDone(id: "a1", allow: false, by: .timeout))], from: early)
        XCTAssertEqual(s.entries, [.decision(summary: "run ls", allow: false, by: .timeout)])
        let other = run([rx(.approvalDone(id: "zz", allow: false, by: .timeout))], from: s)
        XCTAssertEqual(other.entries.count, 2, "an unrelated unknown timeout still shows")
    }

    func testExpiredIdsAreCapped() {
        var s = ConversationState(connection: .connected)
        for i in 0..<60 {
            reduce(&s, .received(.approval(id: "i\(i)", tool: "t", summary: "s", detail: "", expiresAt: 1_000)))
        }
        reduce(&s, .expire(now: Date(timeIntervalSince1970: 10)))
        XCTAssertEqual(s.expiredIds.count, 50)
        XCTAssertEqual(s.expiredIds.last, "i59")
    }

    func testExpireBeforeAnyDeadlineChangesNothing() {
        let before = run([rx(approval()), .sent(.decide(id: "a1", allow: true))])
        let after = run([.expire(now: Date(timeIntervalSince1970: 94.999))], from: before)
        XCTAssertEqual(after, before)
    }

    func testUnsentDecideSaysSoAndClearsSending() {
        let s = run([rx(approval()), .sent(.decide(id: "a1", allow: true)), .unsent(.decide(id: "a1", allow: true))])
        XCTAssertEqual(s.entries, [.error(ConversationState.decisionNotSent)])
        XCTAssertEqual(ConversationState.decisionNotSent,
                       "Not connected, so that decision wasn't sent. Try again once connected.")
        XCTAssertFalse(s.approvals[0].sending)
    }

    func testUnsentTapsSaySoOnce() {
        let taps: [FromPhone] = [.command(.stop), .settings(verbosity: .brief, model: nil, effort: nil),
                                 .said(text: "hi"), .mic(on: false), .audio(on: true)]
        for m in taps {
            XCTAssertEqual(run([.unsent(m)]).entries, [.error("Not connected; that wasn't sent.")], "\(m)")
        }
        XCTAssertEqual(ConversationState.notSent, "Not connected; that wasn't sent.")
    }

    func testUnsentHelloAndLogSayNothing() {
        let s = run([.unsent(.hello(protocol: 1)), .unsent(.log(level: .info, text: "x"))])
        XCTAssertEqual(s.entries, [])
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
