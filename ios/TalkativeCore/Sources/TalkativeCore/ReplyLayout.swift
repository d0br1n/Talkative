import Foundation

public enum RunKind { case plain, spoken, current, pending }

public struct Run: Equatable {
    public let text: String
    public let kind: RunKind
    public init(text: String, kind: RunKind) { self.text = text; self.kind = kind }
}

public enum LaidSegment: Equatable {
    case prose([Run])
    case code(String)
    case table(String)
}

public enum ReplyLayout {
    static let note = "It's on your screen."

    public static func layout(_ reply: Reply) -> [LaidSegment] {
        let text = reply.blocks.map(\.text).joined(separator: "\n\n")
        let chars = Array(text)
        let highlight = highlightRanges(reply, chars)
        var out: [LaidSegment] = []
        for seg in split(chars) {
            switch seg.kind {
            case .code: out.append(.code(String(chars[seg.start..<seg.end])))
            case .table: out.append(.table(String(chars[seg.start..<seg.end])))
            case .prose:
                let runs = proseRuns(chars, seg.start, seg.end, highlight)
                if !runs.isEmpty { out.append(.prose(runs)) }
            }
        }
        return out
    }

    // MARK: segmentation (same rules as src/voice/speakable.ts)

    private enum SegKind { case prose, code, table }
    private struct Seg { var kind: SegKind; var start: Int; var end: Int }  // char offsets, end exclusive

    private static let separator = try! NSRegularExpression(pattern: #"^\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$"#)
    private static let fence = try! NSRegularExpression(pattern: #"^\s*(```|~~~)"#)

    private static func matches(_ re: NSRegularExpression, _ s: String) -> Bool {
        re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
    }
    private static func isSeparator(_ s: String) -> Bool { matches(separator, s) }
    private static func isTableRow(_ s: String) -> Bool {
        s.drop(while: { $0.isWhitespace && !$0.isNewline }).first == "|" || isSeparator(s)
    }

    private static func split(_ chars: [Character]) -> [Seg] {
        // lines with their char offsets
        var lines: [(text: String, start: Int, end: Int)] = []
        var s = 0
        for i in 0...chars.count where i == chars.count || chars[i] == "\n" {
            lines.append((String(chars[s..<i]), s, i))
            s = i + 1
        }
        var segs: [Seg] = []
        func add(_ kind: SegKind, _ line: Int, replacing: Bool) {
            if let last = segs.last, last.kind == kind, replacing { segs[segs.count - 1].end = lines[line].end }
            else { segs.append(Seg(kind: kind, start: lines[line].start, end: lines[line].end)) }
        }
        var inFence = false
        var inTable = false
        var prev: SegKind?   // kind of the previous line's segment; nil after a fence line or blank gap
        for i in lines.indices {
            let line = lines[i].text
            let header = line.contains("|") && i + 1 < lines.count && isSeparator(lines[i + 1].text)
            if matches(fence, line) {
                if inFence {
                    inFence = false
                    prev = nil
                } else {
                    inFence = true
                    segs.append(Seg(kind: .code, start: min(lines[i].end + 1, chars.count), end: min(lines[i].end + 1, chars.count)))
                    prev = .code
                }
                inTable = false
                continue
            }
            if inFence {
                // extend the open code segment through this line
                segs[segs.count - 1].end = lines[i].end
                continue
            }
            inTable = header || isTableRow(line) || (inTable && line.contains("|"))
            if inTable {
                add(.table, i, replacing: prev == .table)
                prev = .table
            } else {
                add(.prose, i, replacing: prev == .prose)
                prev = .prose
            }
        }
        // drop empty code segments? keep: an empty fence is an empty code panel
        return segs
    }

    // MARK: highlighting

    /// (start of c, end of c, whether c is the sentence being spoken), or nil for all plain.
    private static func highlightRanges(_ reply: Reply, _ chars: [Character]) -> (Int, Int, Bool)? {
        guard let spoken = reply.spokenIndex else { return nil }
        var from = 0
        var chosen: (Int, Int, Bool)?
        for index in reply.sentences.keys.sorted() {
            let sentence = reply.sentences[index]!
            if sentence == note { continue }
            guard let r = find(sentence, in: chars, from: from) else { continue }
            from = r.1
            if index <= spoken { chosen = (r.0, r.1, index == spoken) }
        }
        return chosen
    }

    /// First match at or after `from`, treating any whitespace run as equal to any other.
    private static func find(_ sentence: String, in chars: [Character], from: Int) -> (Int, Int)? {
        let pat = Array(sentence.trimmingCharacters(in: .whitespacesAndNewlines))
        if pat.isEmpty { return nil }
        var s = from
        while s < chars.count {
            if chars[s] == pat[0], let e = matchEnd(pat, chars, s) { return (s, e) }
            s += 1
        }
        return nil
    }

    private static func matchEnd(_ pat: [Character], _ chars: [Character], _ start: Int) -> Int? {
        var p = 0, t = start
        while p < pat.count {
            if pat[p].isWhitespace {
                guard t < chars.count, chars[t].isWhitespace else { return nil }
                while p < pat.count, pat[p].isWhitespace { p += 1 }
                while t < chars.count, chars[t].isWhitespace { t += 1 }
            } else {
                guard t < chars.count, chars[t] == pat[p] else { return nil }
                p += 1; t += 1
            }
        }
        return t
    }

    private static func proseRuns(_ chars: [Character], _ start: Int, _ end: Int, _ h: (Int, Int, Bool)?) -> [Run] {
        var a = start, b = end
        while a < b, chars[a].isWhitespace { a += 1 }
        while b > a, chars[b - 1].isWhitespace { b -= 1 }
        if a >= b { return [] }
        guard let (cs, ce, isCurrent) = h else { return [Run(text: String(chars[a..<b]), kind: .plain)] }
        var runs: [Run] = []
        func push(_ lo: Int, _ hi: Int, _ kind: RunKind) {
            let l = max(lo, a), r = min(hi, b)
            guard l < r else { return }
            let t = String(chars[l..<r])
            if let last = runs.last, last.kind == kind { runs[runs.count - 1] = Run(text: last.text + t, kind: kind) }
            else { runs.append(Run(text: t, kind: kind)) }
        }
        push(a, cs, .spoken)
        push(cs, ce, isCurrent ? .current : .spoken)
        push(ce, b, .pending)
        return runs
    }
}
