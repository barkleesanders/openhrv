import SwiftUI

/// Circular 0–100 gauge used for the Battery / Stress / Pressure values,
/// mirroring the web app's gauge cards.
struct GaugeView: View {
    let title: String
    let value: Double?
    let tint: Color

    var body: some View {
        VStack(spacing: 2) {
            ZStack {
                Circle()
                    .stroke(tint.opacity(0.25), lineWidth: 6)
                Circle()
                    .trim(from: 0, to: CGFloat(max(0, min(100, value ?? 0))) / 100)
                    .stroke(tint, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Text(value.map { String(Int($0.rounded())) } ?? "—")
                    .font(.title3.bold())
            }
            .frame(width: 64, height: 64)
            Text(title)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}
