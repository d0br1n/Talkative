import SwiftUI
import TalkativeCore

/// Placeholder until Task 11: the header, a way into options, and the status line.
struct MainView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.tokens) private var tokens
    let openOptions: () -> Void

    init(openOptions: @escaping () -> Void) {
        self.openOptions = openOptions
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            WordmarkHeader {
                Button(action: openOptions) {
                    Text(verbatim: "⚙")
                        .font(.mono(20))
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Options")
            }
            Text(verbatim: StatusLine.text(model.state))
                .font(.mono(13))
            Spacer()
        }
        .foregroundStyle(Color(tokens.palette.text))
        .padding(.horizontal, 16)
    }
}
