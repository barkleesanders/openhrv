import WidgetKit
import SwiftUI

/// Complications for the Watch face: current Battery / Stress / Pressure,
/// fetched from the Worker's `/api/watch/today` lane.
///
/// Token note: the extension reads the same `openhrv.importToken`
/// UserDefaults key as the app (see APIClient.swift). Widget extensions run
/// in their own container, so on a real device the token must also be
/// visible there — the production hardening step is an app group
/// (`group.com.openhrv`) shared by both targets; without a token the
/// complication shows placeholders, never wrong numbers.
struct GaugesEntry: TimelineEntry {
    var date: Date
    var battery: Double?
    var stress: Double?
    var pressure: Double?
}

struct GaugesProvider: TimelineProvider {
    func placeholder(in context: Context) -> GaugesEntry {
        GaugesEntry(date: Date(), battery: 72, stress: 38, pressure: 41)
    }

    func getSnapshot(in context: Context, completion: @escaping (GaugesEntry) -> Void) {
        if context.isPreview {
            completion(placeholder(in: context))
            return
        }
        Task {
            let today = try? await APIClient.shared.fetchToday()
            completion(GaugesEntry(date: Date(), battery: today?.battery, stress: today?.stress, pressure: today?.pressure))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<GaugesEntry>) -> Void) {
        Task {
            let today = try? await APIClient.shared.fetchToday()
            let entry = GaugesEntry(date: Date(), battery: today?.battery, stress: today?.stress, pressure: today?.pressure)
            let next = Date().addingTimeInterval(30 * 60)
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }
}

private func pct(_ value: Double?) -> String {
    value.map { String(Int($0.rounded())) } ?? "—"
}

struct GaugesComplicationView: View {
    @Environment(\.widgetFamily) var family
    var entry: GaugesEntry

    var body: some View {
        switch family {
        case .accessoryCircular:
            Gauge(value: (entry.battery ?? 0) / 100) {
                Text("B")
            } currentValueLabel: {
                Text(pct(entry.battery))
            }
            .gaugeStyle(.accessoryCircular)
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text("Battery \(pct(entry.battery))")
                Text("Stress \(pct(entry.stress)) · Pressure \(pct(entry.pressure))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        case .accessoryInline:
            Text("Battery \(pct(entry.battery)) · Stress \(pct(entry.stress))")
        default:
            Text("OpenHRV \(pct(entry.battery))")
        }
    }
}

struct GaugesComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "GaugesComplication", provider: GaugesProvider()) { entry in
            GaugesComplicationView(entry: entry)
        }
        .configurationDisplayName("OpenHRV gauges")
        .description("Battery, stress and pressure at a glance.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline, .accessoryCorner])
    }
}

@main
struct OpenHRVComplications: WidgetBundle {
    var body: some Widget {
        GaugesComplication()
    }
}
