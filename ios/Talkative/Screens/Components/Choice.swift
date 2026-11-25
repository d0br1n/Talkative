import SwiftUI

/// A row of equal-width buttons; the selected one is filled and written `[value]`.
struct Choice<T: Hashable & RawRepresentable>: View where T.RawValue == String {
    let label: String
    let options: [T]
    @Binding var selection: T?
    @Environment(\.tokens) private var tokens
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        let p = tokens.palette
        VStack(alignment: .leading, spacing: 6) {
            Text(verbatim: label)
                .font(.mono(12))
                .foregroundStyle(Color(p.accent))
            HStack(spacing: 6) {
                ForEach(options, id: \.self) { option in
                    let selected = option == selection
                    Button {
                        selection = option
                    } label: {
                        Text(verbatim: selected ? "[\(option.rawValue)]" : option.rawValue)
                            .font(.mono(13, bold: selected))
                            .foregroundStyle(selected ? Color(p.background) : Color(p.text))
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .background(selected ? Color(p.accent) : Color.clear)
                            .overlay(Rectangle().stroke(selected ? Color(p.accent) : Color(p.border), lineWidth: 1))
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(label) \(option.rawValue)")
                    .accessibilityAddTraits(selected ? [.isSelected] : [])
                }
            }
            .opacity(isEnabled ? 1 : 0.5)
        }
    }
}
