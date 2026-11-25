import SwiftUI
import TalkativeCore

/// Placeholder until Task 10: enough to pair through `AppModel.pair(address:code:)`.
struct PairView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.tokens) private var tokens
    @State private var address = ""
    @State private var code = ""
    @State private var pairing = false
    @State private var failure: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            WordmarkHeader()
            if model.state.connection == .expired {
                Text(verbatim: "Your pairing expired after 30 days. Pair again.")
                    .font(.mono(13))
                    .foregroundStyle(Color(tokens.palette.muted))
            }
            TextField("voice side", text: $address)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(.mono(15))
            TextField("code", text: $code)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(.mono(15))
            Button {
                Task { await connect() }
            } label: {
                Text(verbatim: pairing ? "[ connecting… ]" : "[ connect ]")
                    .font(.mono(15, bold: true))
                    .frame(maxWidth: .infinity, minHeight: 52)
            }
            .disabled(pairing)
            if let failure {
                Text(verbatim: failure)
                    .font(.mono(13))
                    .foregroundStyle(Color(tokens.palette.danger))
            }
            Spacer()
        }
        .foregroundStyle(Color(tokens.palette.text))
        .padding(.horizontal, 16)
        .onAppear { if address.isEmpty { address = model.lastAddress } }
    }

    private func connect() async {
        pairing = true
        defer { pairing = false }
        do {
            try await model.pair(address: address, code: code)
            failure = nil
        } catch {
            failure = String(describing: error)
        }
    }
}
