import XCTest
@testable import TalkativeCore

final class ReplyLayoutTests: XCTestCase {
    private func reply(_ blocks: [String], sentences: [String] = [], spoken: Int? = nil) -> Reply {
        var s: [Int: String] = [:]
        for (i, t) in sentences.enumerated() { s[i] = t }
        return Reply(turnId: "t", blocks: blocks.enumerated().map { ReplyBlock(block: $0.offset, text: $0.element) },
                     sentences: s, spokenIndex: spoken)
    }
    private func plain(_ t: String) -> LaidSegment { .prose([Run(text: t, kind: .plain)]) }

    func testProseFenceProse() {
        let l = ReplyLayout.layout(reply(["Before\n```swift\nlet x = 1\nlet y = 2\n```\nAfter"]))
        XCTAssertEqual(l, [plain("Before"), .code("let x = 1\nlet y = 2"), plain("After")])
    }

    func testTildeFence() {
        XCTAssertEqual(ReplyLayout.layout(reply(["~~~\na\n~~~"])), [.code("a")])
    }

    func testUnclosedFenceRunsToEnd() {
        XCTAssertEqual(ReplyLayout.layout(reply(["Hi\n```\nabc\ndef"])), [plain("Hi"), .code("abc\ndef")])
    }

    func testTableBetweenProse() {
        let l = ReplyLayout.layout(reply(["Intro\n| a | b |\n|---|---|\n| 1 | 2 |\nOutro"]))
        XCTAssertEqual(l, [plain("Intro"), .table("| a | b |\n|---|---|\n| 1 | 2 |"), plain("Outro")])
    }

    func testPipelessHeaderAndContinuation() {
        let l = ReplyLayout.layout(reply(["a | b\n--- | ---\n1 | 2\n3 | 4\n\nEnd"]))
        XCTAssertEqual(l, [.table("a | b\n--- | ---\n1 | 2\n3 | 4"), plain("End")])
    }

    func testBlocksJoinedByBlankLine() {
        XCTAssertEqual(ReplyLayout.layout(reply(["One", "Two"])), [plain("One\n\nTwo")])
    }

    func testSpokenCurrentPending() {
        let l = ReplyLayout.layout(reply(["Two of three  modules are done. The ear is rewritten. Next the mouth."],
                                         sentences: ["Two of three modules are done.", "The ear is rewritten."], spoken: 1))
        XCTAssertEqual(l, [.prose([Run(text: "Two of three  modules are done. ", kind: .spoken),
                                   Run(text: "The ear is rewritten.", kind: .current),
                                   Run(text: " Next the mouth.", kind: .pending)])])
    }

    func testEarlierSentenceCurrentIsSpoken() {
        let l = ReplyLayout.layout(reply(["A one. B two. C three."], sentences: ["A one.", "B two.", "C three."], spoken: 5))
        XCTAssertEqual(l, [.prose([Run(text: "A one. B two. C three.", kind: .spoken)])])
    }

    func testNoSpokenIndexIsPlain() {
        XCTAssertEqual(ReplyLayout.layout(reply(["A one."], sentences: ["A one."])), [plain("A one.")])
    }

    func testUnfoundSentenceIsPlain() {
        XCTAssertEqual(ReplyLayout.layout(reply(["Hello there."], sentences: ["Nope."], spoken: 0)), [plain("Hello there.")])
    }

    func testNoSentenceAtOrBeforeSpokenIsPlain() {
        let l = ReplyLayout.layout(reply(["A one. B two."], sentences: ["A one.", "B two."], spoken: -1))
        XCTAssertEqual(l, [plain("A one. B two.")])
    }

    func testNoteSentenceSkippedAndClippedAcrossSegments() {
        let r = reply(["Done here.\n```\ncode\n```\nMore later."],
                      sentences: ["Done here.", "It's on your screen.", "More later."], spoken: 2)
        XCTAssertEqual(ReplyLayout.layout(r), [
            .prose([Run(text: "Done here.", kind: .spoken)]), .code("code"),
            .prose([Run(text: "More later.", kind: .current)])])
    }
}
