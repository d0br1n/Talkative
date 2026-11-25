import SwiftUI

/// Type instead of speaking: a field and `[ send ]`. Sends the trimmed text, ignores empty text,
/// and closes after sending.
struct TypeBar: View {
    let send: (String) -> Void
    let close: () -> Void
    @Environment(\.tokens) private var tokens
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        let p = tokens.palette
        HStack(spacing: 8) {
            TextField(
                "",
                text: $text,
                prompt: Text(verbatim: "type instead").foregroundColor(Color(p.muted))
            )
            .font(.mono(15))
            .foregroundStyle(Color(p.text))
            .tint(Color(p.accent))
            .focused($focused)
            .submitLabel(.send)
            .onSubmit(submit)
            .padding(.horizontal, 12)
            .frame(height: 48)
            .overlay(Rectangle().stroke(Color(p.border), lineWidth: 1))
            .accessibilityLabel("Type instead")

            BracketButton(title: "[ send ]", style: .outline, action: submit)
                .frame(width: 104)
        }
        .onAppear { focused = true }
    }

    private func submit() {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        send(trimmed)
        text = ""
        close()
    }
}
