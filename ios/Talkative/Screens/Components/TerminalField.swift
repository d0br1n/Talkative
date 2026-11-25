import SwiftUI

/// A labelled, bordered single-line text field.
struct TerminalField: View {
    let label: String
    @Binding var text: String
    let placeholder: String
    var keyboard: UIKeyboardType = .default
    @Environment(\.tokens) private var tokens

    var body: some View {
        let p = tokens.palette
        VStack(alignment: .leading, spacing: 6) {
            Text(verbatim: label)
                .font(.mono(12))
                .foregroundStyle(Color(p.accent))
            TextField(
                "",
                text: $text,
                prompt: Text(verbatim: placeholder).foregroundStyle(Color(p.muted))
            )
            .font(.mono(15))
            .foregroundStyle(Color(p.text))
            .tint(Color(p.accent))
            .keyboardType(keyboard)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .padding(.horizontal, 12)
            .frame(height: 48)
            .overlay(Rectangle().stroke(Color(p.border), lineWidth: 1))
            .accessibilityLabel(label)
        }
    }
}
