import SwiftUI
import TalkativeCore

/// The conversation, newest at the bottom. It follows new text while the owner is at the bottom;
/// once they scroll up it stays where they are until they scroll back down.
///
/// Equatable on `entries`, so the ~30 Hz level updates that re-render the main screen skip it.
struct TranscriptView: View, Equatable {
    let entries: [Entry]
    @Environment(\.tokens) private var tokens
    /// Whether the view follows new content; cleared when the owner scrolls up.
    @State private var pinned = true
    @State private var lastContentHeight: CGFloat = 0
    @State private var viewportHeight: CGFloat = 0

    private static let bottomID = "transcript-bottom"
    private static let space = "transcript"
    /// How close to the bottom still counts as at the bottom, in points.
    private static let slack: CGFloat = 24

    init(entries: [Entry]) {
        self.entries = entries
    }

    static func == (a: TranscriptView, b: TranscriptView) -> Bool { a.entries == b.entries }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(entries.indices, id: \.self) { i in
                        EntryRow(entry: entries[i]).equatable()
                    }
                    Color.clear
                        .frame(height: 1)
                        .id(TranscriptView.bottomID)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    GeometryReader { g in
                        let m = ContentMetrics(
                            height: g.size.height,
                            bottom: g.frame(in: .named(TranscriptView.space)).maxY)
                        Color.clear
                            .onAppear { follow(m, proxy) }
                            .onChange(of: m) { _, m in follow(m, proxy) }
                    })
            }
            .coordinateSpace(.named(TranscriptView.space))
            .background(
                GeometryReader { g in
                    Color.clear
                        .onAppear { viewportHeight = g.size.height }
                        .onChange(of: g.size.height) { _, h in viewportHeight = h }
                })
            .onChange(of: viewportHeight) { _, _ in
                // The keyboard, the type bar or an approval took room: stay at the bottom.
                if pinned { proxy.scrollTo(TranscriptView.bottomID, anchor: .bottom) }
            }
        }
    }

    /// A change in the content's height is new content, not the owner scrolling: follow it if
    /// pinned. Otherwise the owner scrolled: pinned again once they are back at the bottom.
    private func follow(_ m: ContentMetrics, _ proxy: ScrollViewProxy) {
        if m.height != lastContentHeight {
            lastContentHeight = m.height
            if pinned { proxy.scrollTo(TranscriptView.bottomID, anchor: .bottom) }
        } else {
            pinned = m.bottom - viewportHeight <= TranscriptView.slack
        }
    }
}

private struct ContentMetrics: Equatable {
    let height: CGFloat
    let bottom: CGFloat
}

/// The width of the `you ›` / `agent ›` column.
private let labelWidth: CGFloat = 72

/// One transcript entry. Equatable so unchanged rows are skipped while a reply streams.
private struct EntryRow: View, Equatable {
    let entry: Entry
    @Environment(\.tokens) private var tokens

    static func == (a: EntryRow, b: EntryRow) -> Bool { a.entry == b.entry }

    var body: some View {
        let p = tokens.palette
        switch entry {
        case .you(let text):
            Labelled("you ›", Color(p.muted)) {
                Text(verbatim: text)
                    .font(.mono(15))
                    .foregroundStyle(Color(p.text))
            }
        case .agent(let reply):
            AgentReply(segments: ReplyLayout.layout(reply))
        case .narration(let text):
            Indented {
                Text(verbatim: "· \(text)")
                    .font(.mono(12))
                    .foregroundStyle(Color(p.muted))
            }
        case .error(let text):
            Indented {
                Text(verbatim: text)
                    .font(.mono(13))
                    .foregroundStyle(Color(p.danger))
            }
        case .decision(let summary, let allow, let by):
            Indented {
                Text(verbatim: EntryRow.decision(summary: summary, allow: allow, by: by))
                    .font(.mono(13))
                    .foregroundStyle(Color(p.muted))
            }
        }
    }

    static func decision(summary: String, allow: Bool, by: DecidedBy) -> String {
        if by == .timeout { return "✕ Timed out: \(summary)" }
        return allow ? "✓ Approved: \(summary)" : "✕ Denied: \(summary)"
    }
}

/// A reply: prose in the content column, the first prose row labelled `agent ›`; code and tables
/// full width. An empty code panel (a fence that has only just opened) is not drawn.
private struct AgentReply: View {
    let segments: [LaidSegment]
    @Environment(\.tokens) private var tokens

    var body: some View {
        let p = tokens.palette
        let shown = segments.filter { s in
            switch s {
            case .prose: return true
            case .code(let t), .table(let t): return !t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            }
        }
        VStack(alignment: .leading, spacing: 8) {
            if !AgentReply.startsWithProse(shown) {
                Labelled("agent ›", Color(p.accent)) { EmptyView() }
            }
            ForEach(shown.indices, id: \.self) { i in
                switch shown[i] {
                case .prose(let runs):
                    if i == 0 {
                        Labelled("agent ›", Color(p.accent)) { ProseText(runs: runs) }
                    } else {
                        Indented { ProseText(runs: runs) }
                    }
                case .code(let text):
                    CodePanel(kind: .code, text: text)
                case .table(let text):
                    CodePanel(kind: .table, text: text)
                }
            }
        }
    }

    static func startsWithProse(_ segments: [LaidSegment]) -> Bool {
        if case .prose = segments.first { return true }
        return false
    }
}

/// A reply's prose, coloured by how far the voice has got: spoken in the text colour, the sentence
/// being spoken in accent with a glow, the rest muted.
private struct ProseText: View {
    let runs: [Run]
    @Environment(\.tokens) private var tokens

    var body: some View {
        let p = tokens.palette
        let hasCurrent = runs.contains { $0.kind == .current }
        Text(attributed(glowOnly: false))
            .font(.mono(15))
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .topLeading) {
                // The same text laid out identically, with only the current sentence visible,
                // so the glow falls on that sentence alone.
                if hasCurrent && tokens.glows {
                    Text(attributed(glowOnly: true))
                        .font(.mono(15))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .shadow(color: Color(p.accent), radius: 6, x: 0, y: 0)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
    }

    private func attributed(glowOnly: Bool) -> AttributedString {
        let p = tokens.palette
        var out = AttributedString()
        for run in runs {
            var part = AttributedString(run.text)
            let color: Color
            switch run.kind {
            case .plain, .spoken: color = Color(p.text)
            case .current: color = Color(p.accent)
            case .pending: color = Color(p.muted)
            }
            part.foregroundColor = glowOnly && run.kind != .current ? Color.clear : color
            out.append(part)
        }
        return out
    }
}

/// A row with `label` in the 72 pt column and `content` beside it.
private struct Labelled<Content: View>: View {
    let label: String
    let color: Color
    let content: Content

    init(_ label: String, _ color: Color, @ViewBuilder content: () -> Content) {
        self.label = label
        self.color = color
        self.content = content()
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            Text(verbatim: label)
                .font(.mono(15))
                .foregroundStyle(color)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .frame(width: labelWidth, alignment: .leading)
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// A row with an empty label column.
private struct Indented<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, labelWidth)
    }
}
