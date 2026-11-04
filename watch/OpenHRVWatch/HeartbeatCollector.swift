import Foundation
import HealthKit

/// Collects RR intervals from HealthKit heartbeat-series samples recorded
/// during this session (the same series the iPhone imports). On a real
/// Watch, heartbeat series are produced during workouts and by the system's
/// own periodic sampling; the simulator produces none, so the collector
/// simply reports that no beats have arrived yet.
@MainActor
final class HeartbeatCollector: ObservableObject {
    @Published private(set) var rrMs: [Double] = []
    @Published private(set) var status = "Idle"
    @Published private(set) var isRunning = false

    private let store = HKHealthStore()
    private var sessionStart = Date()
    private var lastBeatTime: TimeInterval?
    private var seenSeries = Set<String>()
    private var timer: Timer?

    func start() {
        guard HKHealthStore.isHealthDataAvailable() else {
            status = "Health data is unavailable on this device."
            return
        }
        sessionStart = Date()
        rrMs = []
        lastBeatTime = nil
        seenSeries = []
        isRunning = true
        status = "Requesting Health access…"

        var readTypes: Set<HKObjectType> = []
        if let series = HKObjectType.seriesType(forIdentifier: HKDataTypeIdentifierHeartbeatSeries) { readTypes.insert(series) }
        if let hr = HKObjectType.quantityType(forIdentifier: .heartRate) { readTypes.insert(hr) }
        store.requestAuthorization(toShare: [], read: readTypes) { [weak self] granted, _ in
            Task { @MainActor in
                guard let self else { return }
                self.status = granted ? "Collecting — stay still and breathe normally." : "Health access was not granted."
                if granted { self.poll() }
            }
        }
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.poll() }
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        isRunning = false
        status = "Stopped with \(rrMs.count) beats."
    }

    private func poll() {
        guard let seriesType = HKObjectType.seriesType(forIdentifier: HKDataTypeIdentifierHeartbeatSeries) else { return }
        let predicate = HKQuery.predicateForSamples(withStart: sessionStart, end: nil, options: [])
        let query = HKSampleQuery(sampleType: seriesType, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { [weak self] _, samples, _ in
            guard let series = samples as? [HKHeartbeatSeriesSample], !series.isEmpty else { return }
            Task { @MainActor in
                guard let self else { return }
                for sample in series where !self.seenSeries.contains(sample.uuid.uuidString) {
                    self.seenSeries.insert(sample.uuid.uuidString)
                    self.enumerate(sample)
                }
            }
        }
        store.execute(query)
    }

    private func enumerate(_ sample: HKHeartbeatSeriesSample) {
        let query = HKHeartbeatSeriesQuery(heartbeatSeries: sample) { [weak self] _, timeSinceStart, precededByGap, _, _ in
            Task { @MainActor in
                guard let self else { return }
                if precededByGap { self.lastBeatTime = nil }
                if let last = self.lastBeatTime {
                    let rr = (timeSinceStart - last) * 1000
                    if rr > 250, rr < 2500 { self.rrMs.append(rr) }
                }
                self.lastBeatTime = timeSinceStart
                if self.isRunning { self.status = "Collecting — \(self.rrMs.count) beats so far." }
            }
        }
        store.execute(query)
    }
}
