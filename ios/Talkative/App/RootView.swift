import SwiftUI
import TalkativeCore

/// No pairing: the pair screen. Otherwise the main screen, with options as a sheet.
struct RootView: View {
    @StateObject private var model = AppModel()
    @State private var showingOptions = false
    @Environment(\.tokens) private var tokens

    var body: some View {
        ZStack {
            Color(tokens.palette.background).ignoresSafeArea()
            if model.credentials == nil {
                PairView()
            } else {
                MainView(openOptions: { showingOptions = true })
            }
            CRTOverlay()
        }
        .environmentObject(model)
        .sheet(isPresented: $showingOptions) {
            OptionsView()
                .environmentObject(model)
        }
        .onChange(of: model.credentials == nil) { _, unpaired in
            if unpaired { showingOptions = false }
        }
        // Outermost, so the options sheet inherits it too: selection, carets and default-tinted
        // controls use the accent, never system blue.
        .tint(Color(tokens.palette.accent))
    }
}
