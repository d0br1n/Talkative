import SwiftUI
import TalkativeCore

/// Placeholder until Task 10: close, leave or rejoin, and unpair.
struct OptionsView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.tokens) private var tokens
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Color(tokens.palette.background).ignoresSafeArea()
            VStack(alignment: .leading, spacing: 16) {
                WordmarkHeader {
                    Button { dismiss() } label: {
                        Text(verbatim: "✕")
                            .font(.mono(20))
                            .frame(width: 44, height: 44)
                    }
                    .accessibilityLabel("Close")
                }
                Text(verbatim: "## options")
                    .font(.mono(15, bold: true))
                if model.state.connection == .left {
                    Button { model.join() } label: { Text(verbatim: "[ rejoin ]").font(.mono(15)) }
                } else {
                    Button { model.leave() } label: { Text(verbatim: "[ leave ]").font(.mono(15)) }
                }
                Button { model.unpair() } label: {
                    Text(verbatim: "[ unpair this phone ]")
                        .font(.mono(15))
                        .foregroundStyle(Color(tokens.palette.danger))
                }
                Spacer()
            }
            .foregroundStyle(Color(tokens.palette.text))
            .padding(.horizontal, 16)
            CRTOverlay()
        }
    }
}
