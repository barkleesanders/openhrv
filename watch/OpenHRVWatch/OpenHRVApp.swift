import SwiftUI

/// OpenHRV Watch companion — Today gauges, a guided measurement, a workout
/// flow, and token setup. A native counterpart of the web app at
/// https://openhrv.barkleesanders.workers.dev
@main
struct OpenHRVApp: App {
    var body: some Scene {
        WindowGroup {
            TabView {
                NavigationStack { TodayView() }
                    .tabItem { Label("Today", systemImage: "gauge.with.dots.needle.33percent") }
                NavigationStack { MeasureView() }
                    .tabItem { Label("Measure", systemImage: "waveform.path.ecg") }
                NavigationStack { WorkoutView() }
                    .tabItem { Label("Workout", systemImage: "figure.run") }
                NavigationStack { SettingsView() }
                    .tabItem { Label("Settings", systemImage: "gearshape") }
            }
        }
    }
}
