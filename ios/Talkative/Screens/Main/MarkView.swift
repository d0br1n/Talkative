import SwiftUI
import TalkativeCore

/// The voice-bar mark. It animates only while the scene is active, Reduce Motion is off and the
/// mark is on screen; otherwise it is one still frame, so the ~30 Hz level updates that keep
/// arriving in the background never redraw it.
struct MarkView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var onScreen = false

    var body: some View {
        let s = model.state
        let down = s.connection != .connected || s.agent == .down
        // A ZStack, not a Group: a Group would hand onAppear/onDisappear to each branch, so every
        // live/still switch would flip `onScreen`. The ZStack appears and disappears only with the mark.
        ZStack {
            if scenePhase == .active && !reduceMotion && onScreen {
                LiveMark(model: model)
            } else {
                MarkFrame(text: down ? MarkView.stillDown : MarkView.stillUp, down: down)
            }
        }
        .frame(maxWidth: .infinity)
        .onAppear { onScreen = true }
        .onDisappear { onScreen = false }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Voice activity")
        .accessibilityAddTraits(.isImage)
    }

    private static let stillUp = MarkRenderer.frame(t: 0, bars: MarkRenderer.envelope)
    private static let stillDown = MarkRenderer.frame(
        t: 0, bars: MarkMode.bars(mode: .down, t: 0, output: [], mic: []))
}

/// Ticks every 0.09 s. It holds the model without observing it, so only the timeline redraws it,
/// reading the latest levels on each tick.
private struct LiveMark: View {
    let model: AppModel
    @State private var start = Date()

    var body: some View {
        TimelineView(.periodic(from: start, by: 0.09)) { context in
            // The tick count since the mark started: t goes up by one each tick.
            let t = (context.date.timeIntervalSince(start) / 0.09).rounded()
            let s = model.state
            let mode = MarkMode.select(
                connected: s.connection == .connected, agent: s.agent, thinking: s.thinking,
                outputRMS: model.outputRMS, micRMS: model.micRMS, micOn: s.mic)
            let bars = MarkMode.bars(mode: mode, t: t, output: model.outputBars, mic: model.micBars)
            MarkFrame(text: MarkRenderer.frame(t: t, bars: bars), down: mode == .down)
        }
    }
}

/// 15 rows of JetBrains Mono 9.6 pt, 9.8 pt apart, so the mark is 147 pt tall.
private struct MarkFrame: View {
    let text: String
    let down: Bool
    @Environment(\.tokens) private var tokens

    private static let pointSize: CGFloat = 9.6
    private static let rowHeight: CGFloat = 147.0 / CGFloat(MarkRenderer.rows)

    var body: some View {
        let rows = text.split(separator: "\n", omittingEmptySubsequences: false)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(0..<MarkRenderer.rows, id: \.self) { i in
                Text(verbatim: i < rows.count ? String(rows[i]) : "")
                    .font(.monoFixed(MarkFrame.pointSize))
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
                    .frame(height: MarkFrame.rowHeight, alignment: .leading)
            }
        }
        .foregroundStyle(Color(tokens.palette.accent))
        .phosphorGlow()
        .opacity(down ? 0.35 : 1)
    }
}
