import SwiftUI
import TalkativeCore

/// Pair this phone with the voice side.
struct PairView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.tokens) private var tokens
    @State private var address = ""
    @State private var code = ""
    @State private var pairing = false
    @State private var failure: String?

    var body: some View {
        let p = tokens.palette
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                logo
                    .frame(maxWidth: .infinity)
                    .padding(.top, 22)
                    .padding(.bottom, 6)
                if model.state.connection == .expired {
                    Text(verbatim: "Your pairing expired after 30 days. Pair again.")
                        .font(.mono(13))
                        .foregroundStyle(Color(p.danger))
                }
                Text(verbatim: "Pair this phone with your voice side. Start it with bun src/main.ts voice and read the code it prints.")
                    .font(.mono(13))
                    .foregroundStyle(Color(p.muted))
                TerminalField(label: "pair › voice side", text: $address, placeholder: "100.101.102.103", keyboard: .URL)
                VStack(alignment: .leading, spacing: 6) {
                    TerminalField(label: "pair › code", text: $code, placeholder: "amber wire lantern")
                    Text(verbatim: "Three words. A new code is made after each pairing.")
                        .font(.mono(12))
                        .foregroundStyle(Color(p.muted))
                }
                BracketButton(title: pairing ? "[ connecting… ]" : "[ connect ]", style: .primary) {
                    Task { await connect() }
                }
                .disabled(pairing)
                if let failure {
                    Text(verbatim: failure)
                        .font(.mono(13))
                        .foregroundStyle(Color(p.danger))
                        .accessibilityAddTraits(.isStaticText)
                }
                Text(verbatim: "Only over your Tailscale network. Your audio never leaves your machines.")
                    .font(.mono(12))
                    .foregroundStyle(Color(p.muted))
                    .padding(.top, 24)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .scrollDismissesKeyboard(.interactively)
        .foregroundStyle(Color(p.text))
        .onAppear { if address.isEmpty { address = model.lastAddress } }
    }

    private var logo: some View {
        VStack(spacing: 22) {
            AsciiArt(resource: "lockup-mark", pointSize: 7.5, color: Color(tokens.palette.accent))
            AsciiArt(resource: "wordmark", pointSize: 4.1, color: Color(tokens.palette.text))
        }
        .phosphorGlow()
        .flicker()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Talkative")
        .accessibilityAddTraits(.isImage)
    }

    private func connect() async {
        pairing = true
        failure = nil
        defer { pairing = false }
        do {
            try await model.pair(address: address, code: code)
        } catch let e as PairingError {
            failure = PairView.message(for: e)
        } catch {
            failure = PairView.message(for: .unreachable(String(describing: error)))
        }
    }

    static func message(for e: PairingError) -> String {
        switch e {
        case .wrongCode: return "That code didn't match. Check the code the voice side prints."
        case .locked: return "Too many tries. Wait a minute, then try again."
        case .invalidAddress: return "That address doesn't look right. Use the Tailscale IP, like 100.101.102.103."
        case .unreachable: return "Can't reach the voice side at that address."
        case .badResponse: return "The voice side answered oddly. Is it the Talkative voice side?"
        }
    }
}
