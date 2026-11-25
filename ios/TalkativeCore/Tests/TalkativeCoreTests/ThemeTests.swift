import XCTest
@testable import TalkativeCore

final class ThemeTests: XCTestCase {
    func testDarkPalette() {
        let p = Palette.dark
        XCTAssertEqual(p.background, RGB(hex: 0x0C0A07))
        XCTAssertEqual(p.text, RGB(hex: 0xFFE2A8))
        XCTAssertEqual(p.accent, RGB(hex: 0xFFC453))
        XCTAssertEqual(p.muted, RGB(hex: 0xD4B888))
        XCTAssertEqual(p.border, RGB(hex: 0xA88E60))
        XCTAssertEqual(p.danger, RGB(hex: 0xFF8A5C))
    }

    func testLightPalette() {
        let p = Palette.light
        XCTAssertEqual(p.background, RGB(hex: 0xF5EEE0))
        XCTAssertEqual(p.text, RGB(hex: 0x1B1409))
        XCTAssertEqual(p.accent, RGB(hex: 0xA85200))
        XCTAssertEqual(p.muted, RGB(hex: 0x6E5B3E))
        XCTAssertEqual(p.border, RGB(hex: 0x8F7A5C))
        XCTAssertEqual(p.danger, RGB(hex: 0xB3261E))
    }

    func testBlackOnWhiteIs21() {
        XCTAssertEqual(contrastRatio(RGB(hex: 0x000000), RGB(hex: 0xFFFFFF)), 21, accuracy: 0.01)
    }

    func testTextColoursPassAA() {
        for p in [Palette.dark, Palette.light] {
            for c in [p.text, p.accent, p.muted, p.danger] {
                XCTAssertGreaterThanOrEqual(contrastRatio(c, p.background), 4.5)
            }
        }
    }

    func testGlowAndCRT() {
        XCTAssertEqual(Glow.layers.map(\.radius), [2, 7, 18, 42])
        XCTAssertEqual(Glow.layers.map(\.alpha), [0.95, 0.80, 0.55, 0.35])
        XCTAssertEqual(CRT.scanlineAlpha, 0.18)
        XCTAssertEqual(CRT.scanlinePeriod, 3.0)
        XCTAssertEqual(CRT.vignetteAlpha, 0.20)
        XCTAssertEqual(CRT.vignetteStart, 0.55)
    }
}
