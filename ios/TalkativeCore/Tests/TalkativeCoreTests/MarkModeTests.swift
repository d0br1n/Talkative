import XCTest
@testable import TalkativeCore

final class MarkModeTests: XCTestCase {
    private func sel(connected: Bool = true, agent: AgentHealth = .ready, thinking: Bool = false,
                     out: Double = 0, mic: Double = 0, micOn: Bool = true) -> MarkMode {
        MarkMode.select(connected: connected, agent: agent, thinking: thinking,
                        outputRMS: out, micRMS: mic, micOn: micOn)
    }

    func testAgentHealthRawValues() {
        XCTAssertEqual(AgentHealth.ready.rawValue, "ready")
        XCTAssertEqual(AgentHealth.restarting.rawValue, "restarting")
        XCTAssertEqual(AgentHealth.down.rawValue, "down")
    }

    func testDownWhenNotConnectedEvenIfSpeaking() {
        XCTAssertEqual(sel(connected: false, out: 0.5), .down)
    }

    func testDownWhenAgentDown() {
        XCTAssertEqual(sel(agent: .down, out: 0.5, mic: 0.5), .down)
    }

    func testRestartingAgentIsNotDown() {
        XCTAssertEqual(sel(agent: .restarting), .listening)
    }

    func testSpeakingWhenOutputLoud() {
        XCTAssertEqual(sel(thinking: true, out: 0.02, mic: 0.5), .speaking)
    }

    func testSpeakingThresholdIsExclusive() {
        XCTAssertEqual(sel(out: 0.01), .listening)
    }

    func testListeningWhenMicOnAndLoudBeatsThinking() {
        XCTAssertEqual(sel(thinking: true, mic: 0.05), .listening)
    }

    func testThinkingWhenMicQuiet() {
        XCTAssertEqual(sel(thinking: true, mic: 0.005), .thinking)
    }

    func testThinkingWhenMicOffEvenIfMicLoud() {
        XCTAssertEqual(sel(thinking: true, mic: 0.5, micOn: false), .thinking)
    }

    func testDefaultsToListening() {
        XCTAssertEqual(sel(), .listening)
        XCTAssertEqual(sel(mic: 0.5, micOn: false), .listening)
    }

    func testBars() {
        let out = (0..<14).map { Double($0) / 14 }
        let mic = (0..<14).map { 1 - Double($0) / 14 }
        let t = 3.7
        XCTAssertEqual(MarkMode.bars(mode: .speaking, t: t, output: out, mic: mic, micOn: true), out)
        XCTAssertEqual(MarkMode.bars(mode: .listening, t: t, output: out, mic: mic, micOn: true), mic)
        XCTAssertEqual(MarkMode.bars(mode: .thinking, t: t, output: out, mic: mic, micOn: true),
                       MarkRenderer.idleBars(t: t * 0.35, level: 0.22))
        XCTAssertEqual(MarkMode.bars(mode: .down, t: t, output: out, mic: mic, micOn: true),
                       MarkRenderer.idleBars(t: 0, level: 0.1))
    }

    func testListeningWithTheMicOffIsFlat() {
        let mic = (0..<14).map { 1 - Double($0) / 14 }
        XCTAssertEqual(MarkMode.bars(mode: .listening, t: 1, output: [], mic: mic, micOn: false),
                       Array(repeating: 0, count: MarkRenderer.bars))
        // the voice still speaks with the mic off
        let out = (0..<14).map { Double($0) / 14 }
        XCTAssertEqual(MarkMode.bars(mode: .speaking, t: 1, output: out, mic: mic, micOn: false), out)
    }
}
