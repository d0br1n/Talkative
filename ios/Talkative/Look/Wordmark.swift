import SwiftUI

/// A monospaced ASCII picture from a text file in the bundle, drawn in JetBrains Mono, each row exactly one em tall.
struct AsciiArt: View {
    let resource: String
    let pointSize: CGFloat
    let color: Color

    var body: some View {
        let rows = Self.load(resource).split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(rows.indices, id: \.self) { i in
                Text(verbatim: rows[i])
                    .font(.monoFixed(pointSize))
                    .foregroundStyle(color)
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
                    .frame(height: pointSize, alignment: .leading)
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// Each resource is read from the bundle once.
    @MainActor private static var cache: [String: String] = [:]

    @MainActor static func load(_ resource: String) -> String {
        if let text = cache[resource] { return text }
        var text = ""
        if let url = Bundle.main.url(forResource: resource, withExtension: "txt"),
           let contents = try? String(contentsOf: url, encoding: .utf8) {
            text = contents.trimmingCharacters(in: .newlines)
        }
        cache[resource] = text
        return text
    }
}

/// The wordmark at the left, `trailing` at the right. Every screen starts with this.
struct WordmarkHeader<Trailing: View>: View {
    @Environment(\.tokens) private var tokens
    private let trailing: Trailing

    init(@ViewBuilder trailing: () -> Trailing) {
        self.trailing = trailing()
    }

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            AsciiArt(resource: "wordmark", pointSize: 3.3, color: Color(tokens.palette.text))
                .phosphorGlow()
                .flicker()
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Talkative")
                .accessibilityAddTraits(.isImage)
            Spacer(minLength: 0)
            trailing
        }
        .frame(minHeight: 44)
    }
}

extension WordmarkHeader where Trailing == EmptyView {
    init() { self.init(trailing: { EmptyView() }) }
}
