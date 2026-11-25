import Foundation

public struct RGB: Equatable, Sendable {
    public let r: UInt8
    public let g: UInt8
    public let b: UInt8

    public init(hex: UInt32) {
        r = UInt8((hex >> 16) & 0xFF)
        g = UInt8((hex >> 8) & 0xFF)
        b = UInt8(hex & 0xFF)
    }
}

public struct Palette: Equatable, Sendable {
    public let background: RGB
    public let text: RGB
    public let accent: RGB
    public let muted: RGB
    public let border: RGB
    public let danger: RGB

    public static let dark = Palette(
        background: RGB(hex: 0x0C0A07), text: RGB(hex: 0xFFE2A8), accent: RGB(hex: 0xFFC453),
        muted: RGB(hex: 0xD4B888), border: RGB(hex: 0xA88E60), danger: RGB(hex: 0xFF8A5C))

    public static let light = Palette(
        background: RGB(hex: 0xF5EEE0), text: RGB(hex: 0x1B1409), accent: RGB(hex: 0xA85200),
        muted: RGB(hex: 0x6E5B3E), border: RGB(hex: 0x8F7A5C), danger: RGB(hex: 0xB3261E))
}

public struct GlowLayer: Sendable {
    public let radius: Double
    public let r: UInt8
    public let g: UInt8
    public let b: UInt8
    public let alpha: Double
}

/// Text-shadow layers for the dark theme only.
public enum Glow {
    public static let layers: [GlowLayer] = [
        GlowLayer(radius: 2, r: 255, g: 214, b: 130, alpha: 0.95),
        GlowLayer(radius: 7, r: 255, g: 170, b: 40, alpha: 0.80),
        GlowLayer(radius: 18, r: 255, g: 130, b: 10, alpha: 0.55),
        GlowLayer(radius: 42, r: 255, g: 110, b: 0, alpha: 0.35),
    ]
}

public enum CRT {
    public static let scanlineAlpha = 0.18
    public static let scanlinePeriod = 3.0
    public static let vignetteAlpha = 0.20
    public static let vignetteStart = 0.55
}

private func luminance(_ c: RGB) -> Double {
    func lin(_ v: UInt8) -> Double {
        let s = Double(v) / 255
        return s <= 0.03928 ? s / 12.92 : pow((s + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}

/// WCAG 2.x contrast ratio, between 1 and 21.
public func contrastRatio(_ a: RGB, _ b: RGB) -> Double {
    let la = luminance(a), lb = luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
}
