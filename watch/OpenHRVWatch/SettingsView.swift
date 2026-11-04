import SwiftUI

/// Token setup for the companion. The token is the same import token shown
/// in the web app under More → "Settings & connections" — it gates only this
/// owner's token lanes on the Worker.
struct SettingsView: View {
    @State private var token = APIConfig.importToken
    @State private var testResult: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Text("Import token")
                    .font(.headline)
                TextField("Paste token", text: $token)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Button("Save token") {
                    APIConfig.importToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
                    testResult = "Saved."
                }
                Button("Test connection") {
                    Task {
                        do {
                            let today = try await APIClient.shared.fetchToday()
                            testResult = today.ok ? "Connected ✓" : "Unexpected response."
                        } catch {
                            testResult = error.localizedDescription
                        }
                    }
                }
                if let testResult {
                    Text(testResult)
                        .font(.caption2)
                        .multilineTextAlignment(.center)
                }
                Text("Find the token in the OpenHRV web app: More → Settings & connections.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 4)
        }
        .navigationTitle("Settings")
    }
}
