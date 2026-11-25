import SwiftUI

/// A code block or table from a reply: shown, never spoken. Scrolls sideways, never wraps.
struct CodePanel: View {
    enum Kind: Equatable { case code, table }

    let kind: Kind
    let text: String
    @Environment(\.tokens) private var tokens

    init(kind: Kind, text: String) {
        self.kind = kind
        self.text = text
    }

    var body: some View {
        let p = tokens.palette
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text(verbatim: kind == .code ? "┌─ code" : "┌─ table")
                Spacer(minLength: 0)
                Text(verbatim: "on screen only")
            }
            .font(.mono(12))
            .foregroundStyle(Color(p.muted))
            .padding(.horizontal, 10)
            .padding(.top, 8)
            .accessibilityElement(children: .combine)

            ScrollView(.horizontal, showsIndicators: true) {
                Text(verbatim: CodePanel.trimmed(text))
                    .font(.mono(12))
                    .foregroundStyle(Color(p.text))
                    .lineLimit(nil)
                    .fixedSize(horizontal: true, vertical: true)
                    .textSelection(.enabled)
                    .padding(10)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(Rectangle().stroke(Color(p.border), lineWidth: 1))
    }

    /// Drops the newline the closing fence leaves behind, keeping the code's own indentation.
    static func trimmed(_ s: String) -> String {
        var out = Substring(s)
        while let last = out.last, last.isNewline { out = out.dropLast() }
        return String(out)
    }
}
