import SwiftUI
import TalkativeCore

@main
struct TalkativeApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

/// Placeholder root: the wordmark over the background with the CRT overlay, so a build proves the fonts, resources and look load.
struct RootView: View {
    @Environment(\.tokens) private var tokens

    var body: some View {
        ZStack {
            Color(tokens.palette.background).ignoresSafeArea()
            VStack(alignment: .leading, spacing: 16) {
                WordmarkHeader {
                    Text(verbatim: "v0.3.0")
                        .font(.mono(12))
                        .foregroundStyle(Color(tokens.palette.muted))
                }
                Spacer()
            }
            .padding(.horizontal, 16)
            CRTOverlay()
        }
    }
}
