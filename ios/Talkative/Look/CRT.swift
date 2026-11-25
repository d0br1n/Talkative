import SwiftUI
import TalkativeCore

/// Scanlines and a vignette over the whole screen. Dark mode only; never takes a touch.
struct CRTOverlay: View {
    @Environment(\.tokens) private var tokens

    var body: some View {
        if tokens.glows {
            ZStack {
                Canvas { context, size in
                    let period = CRT.scanlinePeriod
                    var y = 0.0
                    while y < size.height {
                        context.fill(
                            Path(CGRect(x: 0, y: y, width: size.width, height: 1)),
                            with: .color(.black.opacity(CRT.scanlineAlpha)))
                        y += period
                    }
                }
                GeometryReader { geo in
                    let radius = (geo.size.width * geo.size.width + geo.size.height * geo.size.height).squareRoot() / 2
                    RadialGradient(
                        stops: [
                            .init(color: .black.opacity(0), location: CRT.vignetteStart),
                            .init(color: .black.opacity(CRT.vignetteAlpha), location: 1),
                        ],
                        center: .center, startRadius: 0, endRadius: radius)
                }
            }
            .ignoresSafeArea()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }
}

private struct PhosphorGlow: ViewModifier {
    @Environment(\.tokens) private var tokens

    func body(content: Content) -> some View {
        if tokens.glows {
            // Flatten first so the four blurs are not recomputed on every flicker frame.
            content
                .compositingGroup()
                .shadow(color: color(Glow.layers[0]), radius: Glow.layers[0].radius, x: 0, y: 0)
                .shadow(color: color(Glow.layers[1]), radius: Glow.layers[1].radius, x: 0, y: 0)
                .shadow(color: color(Glow.layers[2]), radius: Glow.layers[2].radius, x: 0, y: 0)
                .shadow(color: color(Glow.layers[3]), radius: Glow.layers[3].radius, x: 0, y: 0)
        } else {
            content
        }
    }

    private func color(_ l: GlowLayer) -> Color {
        Color(.sRGB, red: Double(l.r) / 255, green: Double(l.g) / 255, blue: Double(l.b) / 255, opacity: l.alpha)
    }
}

private struct Flicker: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        if reduceMotion {
            content
        } else {
            // Opacity 1, .94, .99, .91, 1 over 5.5 s, repeating.
            content.keyframeAnimator(initialValue: 1.0, repeating: true) { view, opacity in
                view.opacity(opacity)
            } keyframes: { _ in
                KeyframeTrack {
                    LinearKeyframe(0.94, duration: 1.375)
                    LinearKeyframe(0.99, duration: 1.375)
                    LinearKeyframe(0.91, duration: 1.375)
                    LinearKeyframe(1.0, duration: 1.375)
                }
            }
        }
    }
}

extension View {
    /// The four-layer amber glow; dark mode only.
    func phosphorGlow() -> some View { modifier(PhosphorGlow()) }

    /// The slow phosphor flicker; stopped by Reduce Motion.
    func flicker() -> some View { modifier(Flicker()) }
}
