# OpenHRV Watch companion

A SwiftUI watchOS companion for the OpenHRV Worker, mirroring the reference
app's Watch flows:

- **Today** — Battery / Stress / Pressure gauges + latest measurement
  (`GET /api/watch/today`).
- **Measure** — a guided 60-second measurement: RR intervals are read from
  HealthKit heartbeat-series samples, then computed and stored server-side
  (`POST /api/watch/measurements`).
- **Workout** — pick a type → active session with live RR collection →
  summary, optionally stored as a measurement (source `watch-workout`).
- **Complications** — a WidgetKit extension (`OpenHRVComplications`) with
  circular / rectangular / inline / corner families showing the gauges.
- **Settings** — paste the owner's import token (the same token the iOS
  Shortcuts use; shown in the web app under More → Settings & connections).
  The token gates the `/api/watch/*` lanes on the Worker, which sit behind a
  Cloudflare Access *bypass* app because the Watch holds no Access session —
  the Worker enforces the token on every request.

## Build

```bash
xcodebuild build -project OpenHRVWatch.xcodeproj -scheme OpenHRVWatch \
  -destination 'generic/platform=watchOS Simulator' CODE_SIGNING_ALLOWED=NO
```

Targets: `OpenHRVWatch` (watchOS 11+, SwiftUI) and `OpenHRVComplications`
(WidgetKit extension, embedded in the app). `APIClient.swift` and
`Models.swift` are compiled into both targets.

## Build status & known limits (2026-11-03)

- The project compiles and links against the watchOS 26.5 SDK:
  `xcodebuild build` (watchOS Simulator destination) finished with
  **BUILD SUCCEEDED**, including extension embed + bundle validation;
  `swiftc -typecheck` is clean for both targets.
- The watchOS 26.5 simulator runtime was installed during the wave-2
  build (`xcodebuild -downloadPlatform watchOS`), but creating a
  simulator *device* failed repeatedly ("stuck in creation state",
  CoreSimulator) with only ~8 GiB of free disk on the build machine —
  so the app has not been run interactively in a simulator here.
- The app is **not** installed on a physical Apple Watch. Installing needs
  Barklee's signed build (development team + provisioning) from Xcode.
- The complications extension reads the import token from its own
  UserDefaults container; the production hardening step is an app group
  (`group.com.openhrv`) shared by both targets so the token pasted in the
  app is visible to the complication. Without a token the complication
  renders placeholders, never stale numbers presented as fresh.
- HealthKit: heartbeat-series data exists only on a real Watch (the
  simulator produces none); the collector reports that state instead of
  inventing beats.
