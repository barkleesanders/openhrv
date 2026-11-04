import SwiftUI

/// A guided 60-second measurement: collect heartbeat-series RR intervals,
/// then compute and store the measurement on the server.
struct MeasureView: View {
    @StateObject private var collector = HeartbeatCollector()
    @State private var secondsLeft = 60
    @State private var countdown: Timer?
    @State private var result: MeasurementResponse?
    @State private var message: String?
    @State private var saving = false

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                if let result {
                    Text("Saved ✓")
                        .font(.headline)
                        .foregroundStyle(.green)
                    Text("\(Int(result.metrics.meanHrBpm.rounded())) bpm")
                        .font(.title3.bold())
                    Text("RMSSD \(Int(result.metrics.rmssdMs.rounded())) ms · SDNN \(Int(result.metrics.sdnnMs.rounded())) ms")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Button("Measure again") { reset() }
                } else if collector.isRunning {
                    Text("\(secondsLeft)s")
                        .font(.largeTitle.bold())
                    Text(collector.status)
                        .font(.caption2)
                        .multilineTextAlignment(.center)
                    Button("Stop", role: .destructive) { stopCollecting() }
                } else {
                    Text("Sit still for 60 seconds while your Watch records heartbeat intervals.")
                        .font(.caption2)
                        .multilineTextAlignment(.center)
                    Text(collector.status)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Button("Start measurement") { start() }
                    if collector.rrMs.count >= 10 {
                        Button(saving ? "Saving…" : "Save \(collector.rrMs.count) beats") {
                            Task { await save() }
                        }
                        .disabled(saving)
                    }
                }
                if let message {
                    Text(message)
                        .font(.caption2)
                        .foregroundStyle(.orange)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, 4)
        }
        .navigationTitle("Measure")
    }

    private func start() {
        result = nil
        message = nil
        secondsLeft = 60
        collector.start()
        countdown?.invalidate()
        countdown = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
            Task { @MainActor in
                if secondsLeft > 0 { secondsLeft -= 1 }
                if secondsLeft == 0 { stopCollecting() }
            }
        }
    }

    private func stopCollecting() {
        countdown?.invalidate()
        countdown = nil
        collector.stop()
    }

    private func reset() {
        result = nil
        message = nil
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            result = try await APIClient.shared.postMeasurement(rrMs: collector.rrMs, source: "watch")
            message = nil
        } catch {
            message = error.localizedDescription
        }
    }
}
