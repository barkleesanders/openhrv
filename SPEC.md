# OpenHRV — Clean-Room Specification

OpenHRV is a clean-room reimplementation of the **feature set** of the Welltory
4.63.0 iOS app, as documented by a verified static decompile of that app
(feature inventory, UI inventory, HealthKit import map, entitlements and
permissions — report sections (b)–(j)). It is built from this specification
plus public documentation only (Task Force 1996 HRV standards, Apple HealthKit
public docs, MDN Web Bluetooth / getUserMedia / Web Push, Cloudflare
Workers/Hono/D1/Access docs). No decompiled code, strings, copy, branding, or
assets are used; all code, text, and artwork here are original.

**Platform translation.** The original is a native iOS + watchOS app. OpenHRV
is a Hono app on a Cloudflare Worker with a D1 store, delivered as an
installable PWA, **locked to a single owner via Cloudflare Access**
(allow policy: the owner's email only; unauthenticated requests 302 to the
Access login at the edge and never reach the Worker). The app additionally
checks the Access identity header on API routes when present.

## HRV mathematics (normative)

Input: RR intervals in milliseconds.

1. **Artifact cleaning** — (a) drop RR < 300 ms or > 2000 ms; (b) sequential
   pass: drop a value deviating more than 20% from the median of the up-to-5
   previously accepted values (a value is only judged once ≥3 values have
   been accepted). Metrics are computed on the cleaned series; ≥10 clean
   intervals are required.
2. **Time domain** — mean RR, mean HR (60000/meanRR), min/max RR & HR,
   SDNN (sample standard deviation, ddof=1), RMSSD (root mean square of
   successive differences), pNN50 (% of successive differences > 50 ms).
3. **Baevsky Stress Index** — 50 ms histogram bins anchored at
   floor(minRR/50)·50; Mo = modal bin midpoint (s), AMo = modal bin share (%),
   MxDMn = (max−min) RR (s); SI = AMo / (2 · Mo · MxDMn).
4. **Frequency domain** — tachogram resampled at 4 Hz by linear interpolation
   over cumulative beat times, mean-detrended, Hann window, zero-padded to
   the next power of two ≥ sample count; PSD = |FFT(w·x)|² / (fs · Σw²);
   LF = ∫0.04–0.15 Hz, HF = ∫0.15–0.40 Hz, ratio LF/HF, total power 0–0.40 Hz.

**Oracle.** `oracle/vectors.json` holds 3 frozen RR vectors with expected
values from `oracle/compute_oracle.py`, an independent pure-Python reference
(direct O(N²) DFT — a different code path from the TypeScript radix-2 FFT).
Tolerances: time-domain ≤ 0.5% relative, Baevsky ≤ 1%, band powers ≤ 8%,
LF/HF ≤ 10%. The Vitest suite must reproduce every vector within tolerance.

### Score mappings (original heuristics, normative for this build)

- **Battery (charge %)** = clamp(62 + 38 · ln(RMSSD / personal-baseline RMSSD), 0, 100);
  baseline = median RMSSD of prior measurements (45 ms cold-start reference).
  State: ≥75 Charged, 50–74 Moderate, 25–49 Low, <25 Depleted.
- **Stress %** = clamp(100 · (ln SI − ln 20) / (ln 800 − ln 20), 0, 100) from the
  Baevsky index, blended 80/20 with an LF/HF term clamp((LF/HF − 0.5) · 25, 0, 100).
  State: <25 Low, <50 Moderate, <75 High, ≥75 Very high.
- **Pressure %** = clamp(SI / 3.2 + max(0, LF/HF − 1) · 6, 0, 100) (load estimate).
- **Factor impact**: per factor, group daily aggregates (mean RMSSD, Battery,
  Stress per calendar day) by factor presence; report with/without means,
  delta %, and counts; minimum sample 3 days with + 3 days without, else the
  card reports insufficient data.

## Claim table

Status: `pass` = live/test evidence exists · `in-progress` = built, evidence
pending or partial · `open` = not yet built. Waves map to goal deliverables
D1–D8.

| # | Feature (decompile §) | OpenHRV behavior | Wave | Status |
|---|---|---|---|---|
| 1 | HRV engine — RMSSD/SDNN/pNN50/LF-HF/Baevsky/HR stats (§b,g) | Pure-TS module per math spec above, shared by all sources | D3 | in-progress |
| 2 | Artifact filtering (§g) | Cleaning spec §1 above; removal count reported per measurement | D3 | in-progress |
| 3 | Camera PPG measurement (§b,g) | Measure page: getUserMedia fingertip PPG, peak detection → RR → engine; clear unsupported-browser fallback | D3 | in-progress |
| 4 | BLE chest-strap measurement (§b,g) | Web Bluetooth Heart Rate service, RR (1/1024 s units) streamed live → engine; fallback message where unsupported | D3 | in-progress |
| 5 | **Health Auto Export REST import** (§b,g — D4 primary pipe) | `POST /api/import/health-auto-export` accepts the Health Auto Export app's JSON (metrics array: HRV SDNN, resting HR, heart rate, sleep analysis, BP, SpO2, respiratory rate, steps, workouts…), gated by a per-owner bearer import token (shown in Settings with copy button + in-app setup instructions). Samples land in the normalized store | D4 | in-progress |
| 6 | **iOS Shortcuts import** (§b,g) | `POST /api/import/shortcut` (same import token) accepts flexible JSON health samples; the Shortcut recipe (read HRV/health in Shortcuts → POST) is documented in-app on the Import/Settings screen | D4 | in-progress |
| 7 | **Apple Health export.xml upload** (§b,g) | Settings/Import page file upload; Record elements parsed into the normalized store (HR, HRV SDNN, BP, sleep, steps…) with source=apple_health | D4 | in-progress |
| 8 | **Normalized samples store** (§g) | One `health_samples` store keyed by type + source (apple_health / strava / manual / ble / ppg / shortcut), feeding Today, gauges, scores and factor impact; source attribution preserved on every sample | D4 | in-progress |
| 9 | **Write-back feed toward Apple Health** (§b,g) | `GET /api/export/health-writeback` (import token) returns samples the phone should write into Health (breathing mindful minutes, measurement HRV/HR summaries, in-app sleep) + a documented iOS Shortcut recipe using "Log Health Sample" (+ downloadable recipe file). Platform truth: a Worker cannot write HealthKit directly — automatic native write-back is the D7 companion's path (HealthKit entitlement); the Worker-side feed + Shortcut is the build-now lane | D4 | in-progress |
| 10 | **Full data export** (§b) | Settings: download all owner data (measurements, samples, journal, sleep) as JSON and CSV | D4 | in-progress |
| 11 | **Strava connector — OAuth connect** (D9) | `/connect/strava` → Strava authorize → callback → tokens stored encrypted in D1 (AES-GCM, key from Worker secret). Requires the owner's Strava API app credentials as Worker secrets; without them the Connect UI shows a clear "needs your Strava API keys" state | D9 | in-progress |
| 12 | **Strava activity import** (D9) | Activities (run/ride/swim incl. average/max HR; HR streams where available) pulled into the normalized store with source=strava | D9 | in-progress |
| 13 | **Strava webhook receiver** (D9) | `GET/POST /api/webhooks/strava`: verify-token handshake; activity create/update events trigger a pull (or are queued in `events` when credentials are absent) | D9 | in-progress |
| 14 | **Withings connector** (phase 2 — noted, not this build) | Scale / blood-pressure via the same normalized-store pattern; listed so the connector layer's next step is on record | D9 | open |
| 15 | Today dashboard (§b,c) | `/` Today page: Battery + Pressure gauges, latest metrics, recent history | D2 | in-progress |
| 16 | **Battery (charge)** — headline gauge + Battery detail screen (§b, BatteryDetails module; Watch Battery gauge/detail) | Today shows Battery as a charge % ("how charged you are") with state label. Detail screen `/battery`: charge level + state, 14-reading charge trend chart, and a factors panel listing what is draining/recharging it (last sleep duration vs baseline, prior-day stress load, recent measurement load) each with direction + magnitude or an honest "no data logged" note. Score: original heuristic from RMSSD vs personal baseline (SPEC math notes) | D5 | in-progress |
| 17 | **Stress** — headline gauge + Stress detail screen (§b, Pressure/stress details; Watch Pressure gauge/detail) | Today shows a Stress gauge (% + state label: Low/Moderate/High/Very high). Detail screen `/stress`: current stress from the measurement engine (Baevsky stress index primary, LF/HF secondary — published mapping in SPEC math notes), 14-reading trend chart, and a what-drives-it breakdown (SI, LF/HF, RMSSD vs baseline, latest measurement source/time) | D5 | in-progress |
| 18 | **Pressure** — headline gauge + Pressure detail screen (§b, BloodPressureDetails/PressureDetails modules; Watch Pressure gauge) | Today shows a Pressure gauge (% load). Detail screen `/pressure`: current load, 14-reading trend chart, contributors panel (Baevsky SI component, LF/HF component, recent measurement density) mirroring the decompiled Pressure gauge + detail structure | D5 | in-progress |
| 19 | **Stress impact / factor impact** (§b, ScienceLab + Insights + Tag Bank) | Impact cards for every tracked factor — journal tags (incl. caffeine/alcohol-style logged tags), sleep duration/quality (from sleep records), activity days — each card: measured impact on Stress, HRV (RMSSD) and Battery vs the owner's personal baseline, computed as days-with-factor vs days-without means with delta %, effect direction, and sample counts (n with / n without). Below the minimum sample (3 with + 3 without) the card shows an honest "not enough data yet" state instead of a number. Impact list screen `/impact` + per-factor detail view | D5 | in-progress |
| 20 | Health score / category details — Activity, Blood Pressure, Health (§b) | My Data categories with per-category views | D5 | open |
| 21 | Sleep flow + sleep details (§b,g) | Sleep table + import via D4; sleep page/detail | D5 | open |
| 22 | Journal + manual tracking + tags (§b) | Journal page: entries, mood, tags; API CRUD | D5 | in-progress |
| 23 | Voice comments (§b,i) | Voice note capture (Web Audio) attached to journal entries | D5 | open |
| 24 | Breathing exercises (§b) | Guided box-breathing session UI + session logging API | D5 | in-progress |
| 25 | Self-tests / Self-Discovery (§b) | Orthostatic test flow + self_tests store; further tests per inventory | D5 | open |
| 26 | Science Lab — experiments & correlations (§b) | Correlations over the owner's own data (tags vs HRV) | D5 | open |
| 27 | Insights (§b) | Rule-based insights from stored data on Today | D5 | open |
| 28 | AI Coach chat (§b) | Workers AI chat grounded in the owner's stored measurements (no external API) | D5 | open |
| 29 | News / stories content (§b) | Static original content cards in-app (no third-party content service) | D5 | open |
| 30 | Onboarding (§b,c) | First-run intro flow explaining sources + permissions in the PWA | D5 | open |
| 31 | Accounts / auth (§b,i) | Platform translation: Cloudflare Access single-owner lock; owner email is the identity; no passwords stored | D2 | in-progress |
| 32 | Live Activities (§e) | Translation: live state on the PWA Today dashboard + Web Push (see D8 register) | D6 | open |
| 33 | Notification Service extension / rich push (§e) | Translation: Web Push to installed PWA via the Worker's push sender | D6 | open |
| 34 | Notifications — morning readiness, reminders, low-Battery (§b) | Cron scheduler + VAPID Web Push, per-type preferences | D6 | open |
| 35 | Watch app — Today/Battery/Pressure gauges (§d) | SwiftUI companion skeleton in-repo mirroring the flows, Worker API client | D7 | open |
| 36 | Watch workout views (§d) | SwiftUI workout flow skeleton (start/types/process/final) in-repo | D7 | open |
| 37 | Watch complications (§d,e) | WidgetKit complication skeleton in the D7 project | D7 | open |
| 38 | Watch faces (§d) | Translation: PWA/watch theme gallery page (no installable .watchface in a web build) — registered deviation | D8 | open |
| 39 | Watch ↔ iPhone WCSession sync (§d) | Translation: Watch companion syncs via the Worker API (HTTPS), not WCSession — registered deviation | D7 | open |
| 40 | iPhone widgets (§e) | Translation: PWA home-screen install + WebMCP glanceable tools; no WidgetKit appex on web — registered deviation | D8 | open |
| 41 | Paywall / subscriptions / Pro (§b) | Translation: owner-controlled feature flags in settings; no payments (single-user) — registered deviation | D8 | open |
| 42 | Analytics (§h) | Translation: first-party wide-event JSON logs only (Cloudflare Logs/Traces); no Amplitude/Facebook/AppsFlyer — registered deviation | D2 | in-progress |
| 43 | Support / Intercom (§b) | Translation: in-app About/feedback section — registered deviation | D8 | open |
| 44 | Sharing (§b) | Share a measurement summary via the Web Share API | D5 | open |
| 45 | Home-screen quick actions (§b) | Translation: PWA shortcuts in the web manifest (Measure, Journal) | D2 | open |
| 46 | Background work / daily sync (§b,i) | Translation: Worker Cron triggers (with D6) replace BGTask scheduling | D6 | open |
| 47 | Profile, settings, data deletion (§b) | More page: preferences + delete-my-data action over D1 | D5 | open |
| 48 | Permissions model (§i) | Browser permission prompts per feature (camera, bluetooth, notifications) with plain-language explanations | D3 | in-progress |
| 49 | WebMCP agent surface (fleet gate) | /.well-known/webmcp.json discovery, /api/webmcp tools, beacon, robots/llms advertisement, in-page tool registration | D2 | in-progress |
| 50 | Observability | Native CF logs+traces (persist) + one wide-event JSON line per request (pathname only) | D2 | in-progress |

## Deviations register (D8 — summary; README carries the same list)

Paywall → feature flags · trackers → first-party wide events · Intercom →
About section · Live Activities → dashboard + push · WCSession → Worker API
sync · .watchface files → theme gallery · native APNs → Web Push to the
installed PWA (iOS 16.4+). No feature row is silently dropped: anything not
yet built stays `open` above.

## Data model (D1)

`users`, `settings`, `measurements`, `rr_series`, `sleep`, `journal`,
`breathing_sessions`, `self_tests`, `push_subscriptions`,
`notification_prefs`, `events` — see `migrations/0001_init.sql`. All health
data stays in the owner's own Cloudflare account; the public repo contains
code and synthetic oracle vectors only.
