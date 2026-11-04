import Foundation

/// Decodable mirrors of the Worker's JSON (see src/index.ts `/api/watch/*`).
struct TodayResponse: Decodable {
    let ok: Bool
    /// Battery charge, stress, pressure: 0–100 gauges (null until enough data).
    let battery: Double?
    let stress: Double?
    let pressure: Double?
    let latest: LatestMeasurement?

    struct LatestMeasurement: Decodable {
        let taken_at: String
        let source: String
        let mean_hr_bpm: Double
        let rmssd_ms: Double
        let sdnn_ms: Double
        let pnn50_pct: Double
        let baevsky_si: Double
        let lf_hf_ratio: Double
    }
}

struct MeasurementResponse: Decodable {
    let ok: Bool
    let id: Int
    let metrics: Metrics

    struct Metrics: Decodable {
        let count: Int
        let meanHrBpm: Double
        let rmssdMs: Double
        let sdnnMs: Double
        let pnn50Pct: Double
        let baevskySi: Double
        let lfHfRatio: Double
    }
}
