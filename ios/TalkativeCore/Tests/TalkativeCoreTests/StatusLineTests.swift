import XCTest
@testable import TalkativeCore

final class StatusLineTests: XCTestCase {
    private func state(_ c: Connection, agent: AgentHealth = .ready, thinking: Bool = false, jobs: Int = 0,
                       audio: Bool = true, mic: Bool = true, approval: Bool = false) -> ConversationState {
        var s = ConversationState(connection: c)
        s.agent = agent; s.thinking = thinking; s.jobs = jobs; s.audio = audio; s.mic = mic
        if approval { s.approvals = [Approval(id: "a", tool: "t", summary: "s", detail: "d", expiresAt: Date())] }
        return s
    }

    func testConnectionRows() {
        XCTAssertEqual(StatusLine.text(state(.connecting)), "… connecting")
        XCTAssertEqual(StatusLine.text(state(.reconnecting)), "… reconnecting")
        XCTAssertEqual(StatusLine.text(state(.idle)), "✕ not connected")
        XCTAssertEqual(StatusLine.text(state(.left)), "✕ not connected")
        XCTAssertEqual(StatusLine.text(state(.expired)), "✕ pairing expired")
    }

    func testAgentRows() {
        XCTAssertEqual(StatusLine.text(state(.connected, agent: .down, approval: true)), "✕ agent down")
        XCTAssertEqual(StatusLine.text(state(.connected, agent: .restarting)), "◌ restarting")
    }

    func testApprovalThinkingListening() {
        XCTAssertEqual(StatusLine.text(state(.connected, thinking: true, approval: true)), "▲ waiting for you")
        XCTAssertEqual(StatusLine.text(state(.connected, thinking: true)), "▲ thinking")
        XCTAssertEqual(StatusLine.text(state(.connected)), "● listening")
    }

    func testJobsSingularPluralOnlyWhenConnected() {
        XCTAssertEqual(StatusLine.text(state(.connected, jobs: 1)), "● listening · 1 job running")
        XCTAssertEqual(StatusLine.text(state(.connected, jobs: 3)), "● listening · 3 jobs running")
        XCTAssertEqual(StatusLine.text(state(.reconnecting, jobs: 3)), "… reconnecting")
    }

    func testAudioOff() {
        XCTAssertEqual(StatusLine.text(state(.connected, jobs: 2, audio: false)), "● listening · 2 jobs running · ♪ off")
        XCTAssertEqual(StatusLine.text(state(.connected, audio: false)), "● listening · ♪ off")
    }

    func testMicOffInEveryConnectionState() {
        XCTAssertEqual(StatusLine.text(state(.connected, mic: false)), "● listening · mic off")
        XCTAssertEqual(StatusLine.text(state(.reconnecting, mic: false)), "… reconnecting · mic off")
        XCTAssertEqual(StatusLine.text(state(.connecting, mic: false)), "… connecting · mic off")
        XCTAssertEqual(StatusLine.text(state(.idle, mic: false)), "✕ not connected · mic off")
        XCTAssertEqual(StatusLine.text(state(.expired, mic: false)), "✕ pairing expired · mic off")
    }

    func testMicOffAfterJobsBeforeAudioOff() {
        XCTAssertEqual(StatusLine.text(state(.connected, jobs: 2, audio: false, mic: false)),
                       "● listening · 2 jobs running · mic off · ♪ off")
        XCTAssertEqual(StatusLine.text(state(.reconnecting, jobs: 2, audio: false, mic: false)),
                       "… reconnecting · mic off · ♪ off")
    }
}
