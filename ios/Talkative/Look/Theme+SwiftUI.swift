import SwiftUI
import TalkativeCore

extension Color {
    init(_ rgb: RGB) {
        self.init(.sRGB, red: Double(rgb.r) / 255, green: Double(rgb.g) / 255, blue: Double(rgb.b) / 255, opacity: 1)
    }
}

/// The look for the current appearance: the palette, and whether the dark-only effects (glow, scanlines, vignette) apply.
struct Tokens {
    let palette: Palette
    let glows: Bool

    init(scheme: ColorScheme) {
        palette = scheme == .dark ? .dark : .light
        glows = scheme == .dark
    }
}

extension EnvironmentValues {
    /// Read with `@Environment(\.tokens)`; follows `colorScheme`.
    var tokens: Tokens { Tokens(scheme: colorScheme) }
}

extension Font {
    /// JetBrains Mono, the only face in the app. `Font.custom` with a size scales with Dynamic Type.
    static func mono(_ size: CGFloat, bold: Bool = false) -> Font {
        .custom(bold ? "JetBrainsMono-Bold" : "JetBrainsMono-Regular", size: size)
    }

    /// Fixed-size variant for ASCII art, which must not reflow.
    static func monoFixed(_ size: CGFloat, bold: Bool = false) -> Font {
        .custom(bold ? "JetBrainsMono-Bold" : "JetBrainsMono-Regular", fixedSize: size)
    }
}
