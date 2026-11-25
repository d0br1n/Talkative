import SwiftUI

/// A button written as `[ title ]`.
struct BracketButton: View {
    enum Style { case primary, outline, quiet, danger }

    let title: String
    let style: Style
    let action: () -> Void
    @Environment(\.tokens) private var tokens
    @Environment(\.isEnabled) private var isEnabled

    init(title: String, style: Style = .outline, action: @escaping () -> Void) {
        self.title = title
        self.style = style
        self.action = action
    }

    var body: some View {
        let p = tokens.palette
        let height: CGFloat = style == .primary ? 52 : 48
        Button(action: action) {
            Text(verbatim: title)
                .font(.mono(15, bold: style == .primary))
                .foregroundStyle(textColor)
                .frame(maxWidth: .infinity, minHeight: height)
                .background(style == .primary ? Color(p.accent) : Color.clear)
                .overlay(Rectangle().stroke(borderColor, lineWidth: 1))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .opacity(isEnabled ? 1 : 0.5)
        .accessibilityLabel(title)
    }

    private var textColor: Color {
        let p = tokens.palette
        switch style {
        case .primary: return Color(p.background)
        case .outline: return Color(p.accent)
        case .quiet: return Color(p.text)
        case .danger: return Color(p.danger)
        }
    }

    private var borderColor: Color {
        let p = tokens.palette
        switch style {
        case .primary: return Color(p.accent)
        case .outline: return Color(p.accent)
        case .quiet, .danger: return Color(p.border)
        }
    }
}
