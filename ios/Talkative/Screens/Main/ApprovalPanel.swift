import SwiftUI
import TalkativeCore

/// One pending approval: the summary, the detail on request, a live countdown, approve and deny.
///
/// Equatable on `approval` (`decide` always answers the same id), so the ~30 Hz level updates
/// that re-render the main screen skip it.
struct ApprovalPanel: View, Equatable {
    let approval: Approval
    let decide: (Bool) -> Void
    @Environment(\.tokens) private var tokens
    @State private var showingDetail = false
    @State private var tickStart = Date()

    static func == (a: ApprovalPanel, b: ApprovalPanel) -> Bool { a.approval == b.approval }

    var body: some View {
        let p = tokens.palette
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text(verbatim: "┌─ approval needed")
                    .font(.mono(13, bold: true))
                Spacer(minLength: 0)
                TimelineView(.periodic(from: tickStart, by: 1)) { context in
                    let left = approval.countdown(now: context.date)
                    Text(verbatim: left)
                        .font(.mono(13, bold: true))
                        .accessibilityLabel("\(left) left")
                }
            }
            .foregroundStyle(Color(p.accent))

            Text(verbatim: approval.summary)
                .font(.mono(15))
                .foregroundStyle(Color(p.text))
                .fixedSize(horizontal: false, vertical: true)

            if !approval.detail.isEmpty {
                Button {
                    showingDetail.toggle()
                } label: {
                    Text(verbatim: showingDetail ? "▾ hide details" : "▸ details")
                        .font(.mono(13))
                        .foregroundStyle(Color(p.muted))
                        .frame(minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                if showingDetail {
                    ScrollView([.horizontal, .vertical], showsIndicators: true) {
                        Text(verbatim: approval.detail)
                            .font(.mono(12))
                            .foregroundStyle(Color(p.text))
                            .fixedSize(horizontal: true, vertical: true)
                            .textSelection(.enabled)
                            .padding(8)
                    }
                    // As tall as the detail, up to 220 pt; longer details scroll.
                    .frame(maxHeight: 220)
                    .fixedSize(horizontal: false, vertical: true)
                    .overlay(Rectangle().stroke(Color(p.border), lineWidth: 1))
                }
            }

            HStack(spacing: 12) {
                BracketButton(title: "[ approve ]", style: .primary) { decide(true) }
                BracketButton(title: "[ deny ]", style: .quiet) { decide(false) }
            }
            .disabled(approval.sending)

            Text(verbatim: "No answer in 30 minutes counts as deny.")
                .font(.mono(12))
                .foregroundStyle(Color(p.muted))
        }
        .padding(12)
        .background {
            Color(p.background)
                .shadow(color: Color(p.accent).opacity(0.35), radius: 12, x: 0, y: 0)
        }
        .overlay(Rectangle().stroke(Color(p.accent), lineWidth: 1))
    }
}
