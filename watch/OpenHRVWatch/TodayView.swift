import SwiftUI

/// Today screen: the three gauges plus the latest measurement — the Watch
/// counterpart of the web app's Today page.
struct TodayView: View {
    @State private var today: TodayResponse?
    @State private var message: String?
    @State private var loading = false

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                if let today {
                    HStack(spacing: 6) {
                        GaugeView(title: "Battery", value: today.battery, tint: .green)
                        GaugeView(title: "Stress", value: today.stress, tint: .orange)
                    }
                    GaugeView(title: "Pressure", value: today.pressure, tint: .red)
                    if let latest = today.latest {
                        VStack(spacing: 2) {
                            Text("\(Int(latest.mean_hr_bpm.rounded())) bpm · RMSSD \(Int(latest.rmssd_ms.rounded())) ms")
                                .font(.caption2)
                            Text("SDNN \(Int(latest.sdnn_ms.rounded())) ms · \(latest.source)")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    } else {
                        Text("No measurements yet today.")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                } else if let message {
                    Text(message)
                        .font(.caption2)
                        .multilineTextAlignment(.center)
                }
                Button(loading ? "Loading…" : "Refresh") { Task { await load() } }
                    .disabled(loading)
            }
            .padding(.horizontal, 4)
        }
        .navigationTitle("Today")
        .task { await load() }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            today = try await APIClient.shared.fetchToday()
            message = nil
        } catch {
            message = error.localizedDescription
        }
    }
}
