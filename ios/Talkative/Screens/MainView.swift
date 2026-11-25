import SwiftUI
import TalkativeCore
import UIKit

/// The main screen: header, status line, the mark, the transcript, pending approvals, and
/// `[ stop ]` / `[ type ]`.
struct MainView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.tokens) private var tokens
    @State private var typing = false
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

            TranscriptView(entries: model.state.entries)
                .equatable()
                .frame(maxHeight: .infinity)

            ForEach(model.state.approvals, id: \.id) { a in
                ApprovalPanel(approval: a) { allow in model.decide(id: a.id, allow: allow) }
                    .equatable()
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
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
        .onChange(of: model.state.newApprovals) { old, new in
            if new > old { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
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
