import SwiftUI

/// Workout flow mirroring the companion app's structure: pick a type →
/// active session (elapsed time + live RR collection) → summary with the
/// option to store the session's RR data as a measurement.
struct WorkoutView: View {
    private let types = ["Run", "Ride", "Swim", "Walk", "Other"]
    @StateObject private var collector = HeartbeatCollector()
    @State private var selectedType: String?
    @State private var startedAt: Date?
    @State private var ended = false
    @State private var saved = false
    @State private var message: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                if let selectedType, let startedAt, !ended {
                    Text(selectedType)
                        .font(.headline)
                    TimelineView(.periodic(from: startedAt, by: 1)) { context in
                        Text(elapsed(since: startedAt, now: context.date))
                            .font(.largeTitle.bold())
                    }
                    Text(collector.status)
                        .font(.caption2)
                        .multilineTextAlignment(.center)
                    Button("End workout", role: .destructive) {
                        collector.stop()
                        ended = true
                    }
                } else if ended {
                    Text("Summary")
                        .font(.headline)
                    Text("\(selectedType ?? "Workout") · \(collector.rrMs.count) beats collected")
                        .font(.caption2)
                        .multilineTextAlignment(.center)
                    if saved {
                        Text("Stored ✓")
                            .foregroundStyle(.green)
                            .font(.caption2)
                    } else if collector.rrMs.count >= 10 {
                        Button("Store as measurement") {
                            Task {
                                do {
                                    _ = try await APIClient.shared.postMeasurement(rrMs: collector.rrMs, source: "watch-workout")
                                    saved = true
                                } catch {
                                    message = error.localizedDescription
                                }
                            }
                        }
                    }
                    Button("Done") {
                        ended = false
                        selectedType = nil
                        startedAt = nil
                        saved = false
                    }
                } else {
                    Text("Pick a workout")
                        .font(.headline)
                    ForEach(types, id: \.self) { type in
                        Button(type) {
                            selectedType = type
                            startedAt = Date()
                            ended = false
                            saved = false
                            collector.start()
                        }
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
        .navigationTitle("Workout")
    }

    private func elapsed(since start: Date, now: Date) -> String {
        let s = max(0, Int(now.timeIntervalSince(start)))
        return String(format: "%02d:%02d", s / 60, s % 60)
    }
}
