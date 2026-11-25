import SwiftUI
import TalkativeCore
import UIKit

/// The main screen: header, status line, the mark, the transcript, pending approvals, and
/// `[ stop ]` / `[ type ]`.
struct MainView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.tokens) private var tokens
    @State private var typing = false
    /// The main screen's height (less the keyboard), for bounding the approval panels.
    @State private var height: CGFloat = 0
    let openOptions: () -> Void

    init(openOptions: @escaping () -> Void) {
        self.openOptions = openOptions
    }

    var body: some View {
        let p = tokens.palette
        VStack(alignment: .leading, spacing: 12) {
            WordmarkHeader {
                Button(action: openOptions) {
                    Text(verbatim: "⚙")
                        .font(.mono(20))
                        .foregroundStyle(Color(p.text))
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Options")
            }

            StatusLineView(line: StatusLine.text(model.state))

            MarkView()

            Text(verbatim: "## transcript")
                .font(.mono(15, bold: true))
                .foregroundStyle(Color(p.accent))
                .phosphorGlow()

            TranscriptView(entries: model.state.entries)
                .equatable()
                .frame(maxHeight: .infinity)

            if !model.state.approvals.isEmpty {
                ApprovalStack(approvals: model.state.approvals, maxHeight: height * 0.45) { id, allow in
                    model.decide(id: id, allow: allow)
                }
            }

            if typing {
                TypeBar(send: { model.say($0) }, close: { typing = false })
            }

            HStack(spacing: 12) {
                BracketButton(title: "[ stop ]", style: .outline) { model.send(.command(.stop)) }
                BracketButton(title: "[ type ]", style: .quiet) { typing.toggle() }
            }
        }
        .foregroundStyle(Color(p.text))
        .background(
            GeometryReader { g in
                Color.clear
                    .onAppear { height = g.size.height }
                    .onChange(of: g.size.height) { _, h in height = h }
            })
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
        .onChange(of: model.state.newApprovals) { old, new in
            if new > old { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
        }
    }
}

/// The pending approvals, the newest at the bottom: as tall as they are, up to `maxHeight`, then
/// they scroll, so `[ stop ]` and `[ type ]` stay on screen.
private struct ApprovalStack: View {
    let approvals: [Approval]
    let maxHeight: CGFloat
    let decide: (String, Bool) -> Void
    @State private var contentHeight: CGFloat = 0

    /// Room for the panels' amber shadow, which the scroll view would otherwise clip.
    private static let shadowRoom: CGFloat = 12

    var body: some View {
        let cap = maxHeight > 0 ? maxHeight : .infinity
        ScrollViewReader { proxy in
            ScrollView(.vertical) {
                VStack(spacing: 12) {
                    ForEach(approvals, id: \.id) { a in
                        ApprovalPanel(approval: a) { allow in decide(a.id, allow) }
                            .equatable()
                            .id(a.id)
                    }
                }
                .padding(ApprovalStack.shadowRoom)
                .background(
                    GeometryReader { g in
                        Color.clear
                            .onAppear { contentHeight = g.size.height }
                            .onChange(of: g.size.height) { _, h in contentHeight = h }
                    })
            }
            .frame(height: min(contentHeight, cap))
            .defaultScrollAnchor(.bottom)
            .padding(.horizontal, -ApprovalStack.shadowRoom)
            .padding(.vertical, -ApprovalStack.shadowRoom / 2)
            .onChange(of: approvals.last?.id) { _, id in
                if let id { proxy.scrollTo(id, anchor: .bottom) }
            }
        }
    }
}

/// `StatusLine.text`, 13 pt, its leading glyph in accent, or danger for `✕`.
private struct StatusLineView: View {
    let line: String
    @Environment(\.tokens) private var tokens

    var body: some View {
        let p = tokens.palette
        let glyph = line.first.map(String.init) ?? ""
        let rest = String(line.dropFirst())
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            Text(verbatim: glyph)
                .foregroundStyle(glyph == "✕" ? Color(p.danger) : Color(p.accent))
            Text(verbatim: rest)
                .foregroundStyle(Color(p.text))
        }
        .font(.mono(13))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(line)
    }
}
