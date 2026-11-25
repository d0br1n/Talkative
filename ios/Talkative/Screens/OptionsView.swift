import SwiftUI
import TalkativeCore

/// The options sheet: the agent's settings, audio and mic, new conversation, leave and unpair.
struct OptionsView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.tokens) private var tokens
    @Environment(\.dismiss) private var dismiss
    @State private var confirmingUnpair = false

    var body: some View {
        let p = tokens.palette
        ZStack {
            Color(p.background).ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    WordmarkHeader {
                        Button { dismiss() } label: {
                            Text(verbatim: "✕")
                                .font(.mono(20))
                                .foregroundStyle(Color(p.text))
                                .frame(width: 44, height: 44)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Close")
                    }
                    Text(verbatim: "## options")
                        .font(.mono(15, bold: true))
                        .foregroundStyle(Color(p.accent))

                    Group {
                        Choice(label: "verbosity", options: Verbosity.allCases, selection: verbosity)
                        VStack(alignment: .leading, spacing: 6) {
                            Choice(label: "model", options: PhoneModel.allCases, selection: modelChoice)
                            Text(verbatim: "Changing the model restarts the agent.")
                                .font(.mono(12))
                                .foregroundStyle(Color(p.muted))
                        }
                        Choice(label: "effort", options: Effort.allCases, selection: effort)
                    }
                    .disabled(model.state.settings == nil)

                    toggle("voice audio", on: model.state.audio) { model.send(.audio(on: $0)) }
                    toggle("microphone", on: model.state.mic) { model.send(.mic(on: $0)) }

                    VStack(spacing: 12) {
                        BracketButton(title: "[ new conversation ]", style: .outline) {
                            model.send(.command(.newConversation))
                            dismiss()
                        }
                        if model.state.connection == .left {
                            BracketButton(title: "[ rejoin ]", style: .quiet) { model.join() }
                        } else {
                            BracketButton(title: "[ leave ]", style: .quiet) { model.leave() }
                        }
                        BracketButton(title: "[ unpair this phone ]", style: .danger) {
                            confirmingUnpair = true
                        }
                    }
                    .padding(.top, 8)

                    Text(verbatim: footer)
                        .font(.mono(12))
                        .foregroundStyle(Color(p.muted))
                        .padding(.top, 8)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
            CRTOverlay()
        }
        .foregroundStyle(Color(p.text))
        .confirmationDialog(
            "Unpair this phone? You'll need a new code from the voice side.",
            isPresented: $confirmingUnpair,
            titleVisibility: .visible
        ) {
            Button("Unpair this phone", role: .destructive) { model.unpair() }
            Button("Cancel", role: .cancel) {}
        }
    }

    // MARK: - Settings bindings

    private var verbosity: Binding<Verbosity?> {
        Binding(
            get: { model.state.settings?.verbosity },
            set: { if let v = $0 { model.send(.settings(verbosity: v, model: nil, effort: nil)) } }
        )
    }

    private var modelChoice: Binding<PhoneModel?> {
        Binding(
            get: { model.state.settings.flatMap { PhoneModel(rawValue: $0.model) } },
            set: { if let m = $0 { model.send(.settings(verbosity: nil, model: m, effort: nil)) } }
        )
    }

    private var effort: Binding<Effort?> {
        Binding(
            get: { model.state.settings?.effort },
            set: { if let e = $0 { model.send(.settings(verbosity: nil, model: nil, effort: e)) } }
        )
    }

    // MARK: - Pieces

    private func toggle(_ label: String, on: Bool, set: @escaping (Bool) -> Void) -> some View {
        let p = tokens.palette
        return Button { set(!on) } label: {
            HStack {
                Text(verbatim: label)
                    .font(.mono(15))
                    .foregroundStyle(Color(p.text))
                Spacer()
                Text(verbatim: on ? "[on]" : "[off]")
                    .font(.mono(15, bold: true))
                    .foregroundStyle(on ? Color(p.accent) : Color(p.muted))
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 48)
            .overlay(Rectangle().stroke(Color(p.border), lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityValue(on ? "on" : "off")
        .accessibilityAddTraits(.isToggle)
    }

    private var footer: String {
        let host = model.credentials?.pairURL.host ?? "-"
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        return "voice side \(host) · protocol 1 · app \(version)"
    }
}
