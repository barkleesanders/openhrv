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

### Aggregate score mappings (imported daily Health aggregates — fix wave 2026-11-03)

Days whose only HRV input is an imported daily aggregate (Apple Health
SDNN, resting HR, sleep — no RR series, no Baevsky SI, no LF/HF) are scored
from the aggregate signals only, always relative to the owner's own
baselines (median of prior days in the same series; population norms are
never the score basis). The RR mappings above stay normative for
measurement days; a real measurement wins its calendar day and the
aggregate path fills every other day — one merged day series feeds
`todayData`, `/api/scores`, `/api/watch/today` and factor impact.

- **Battery** = clamp(62 + 38 · ln(SDNN / personal-baseline SDNN) + sleepAdj),
  sleepAdj = clamp((last night's sleep − personal median sleep) · 3, −12, +8)
  (8 h target stands in when fewer than 3 nights are recorded). Cold start:
  the first aggregate day is its own reference (neutral Battery).
- **Stress** = clamp(42 + sdnnTerm + rhrTerm + sleepTerm), where
  sdnnTerm = clamp((baseline SDNN − SDNN) / baseline SDNN · 150, −35, +45),
  rhrTerm = clamp((resting HR − baseline resting HR) · 2, −20, +25),
  sleepTerm = min(20, sleep debt vs the 8 h target · 5).
- **Pressure** = clamp(0.55 · Stress + min(25, sleep debt · 7) +
  clamp((resting HR − baseline resting HR) · 1.2, −12, +18)) — derived from
  SDNN + resting HR + sleep debt (no LF/HF exists for aggregate days); the
  detail pages label every such contributor "from daily Health aggregates".
- **Factor impact** runs on the merged day series; the HRV slot carries
  RMSSD on measurement days and daily SDNN on aggregate days, and
  `/api/impact` reports `hrvBasis` (`rmssd` | `sdnn` | `mixed`) so the
  Impact page labels the metric honestly.

## Claim table

Status: `pass` = live/test evidence exists · `in-progress` = built, evidence
pending or partial · `open` = not yet built. Waves map to goal deliverables
D1–D8.

| # | Feature (decompile §) | OpenHRV behavior | Wave | Status |
|---|---|---|---|---|
| 1 | HRV engine — RMSSD/SDNN/pNN50/LF-HF/Baevsky/HR stats (§b,g) | Pure-TS module per math spec above, shared by all sources | D3 | pass |
| 2 | Artifact filtering (§g) | Cleaning spec §1 above; removal count reported per measurement | D3 | pass |
| 3 | Camera PPG measurement (§b,g) | Measure page: getUserMedia fingertip PPG, peak detection → RR → engine; clear unsupported-browser fallback | D3 | pass |
| 4 | BLE chest-strap measurement (§b,g) | Web Bluetooth Heart Rate service, RR (1/1024 s units) streamed live → engine; fallback message where unsupported | D3 | pass |
| 5 | **Health Auto Export REST import** (§b,g — D4 primary pipe) | `POST /api/import/health-auto-export` accepts the Health Auto Export app's JSON (metrics array: HRV SDNN, resting HR, heart rate, sleep analysis, BP, SpO2, respiratory rate, steps, workouts…), gated by a per-owner bearer import token (shown in Settings with copy button + in-app setup instructions). Samples land in the normalized store. Production-truth fix 2026-11-04: the real Health Auto Export app's own metric names (heart_rate_variability, blood_oxygen_saturation, basal_energy_burned, walking_running_distance) are normalized onto the canonical sample types — before this they landed under raw names no gauge or chart reads; external_id keeps the raw name so existing dedup keys never change | D4 | pass |
| 6 | **iOS Shortcuts import** (§b,g) | `POST /api/import/shortcut` (same import token) accepts flexible JSON health samples; the Shortcut recipe (read HRV/health in Shortcuts → POST) is documented in-app on the Import/Settings screen | D4 | pass |
| 7 | **Apple Health export.xml upload** (§b,g) | Settings/Import page file upload; Record elements parsed into the normalized store (HR, HRV SDNN, BP, sleep, steps…) with source=apple_health | D4 | pass |
| 8 | **Normalized samples store** (§g) | One `health_samples` store keyed by type + source (apple_health / strava / manual / ble / ppg / shortcut), feeding Today, gauges, scores and factor impact; source attribution preserved on every sample (read path connected in the 2026-11-03 fix wave: healthDays → scoreHealthDays merge; before that the gauges read only the measurements table and the claim was write-side only) | D4 | pass |
| 9 | **Write-back feed toward Apple Health** (§b,g) | `GET /api/export/health-writeback` (import token) returns samples the phone should write into Health (breathing mindful minutes, measurement HRV/HR summaries, in-app sleep) + a documented iOS Shortcut recipe using "Log Health Sample" (+ downloadable recipe file). Platform truth: a Worker cannot write HealthKit directly — automatic native write-back is the D7 companion's path (HealthKit entitlement); the Worker-side feed + Shortcut is the build-now lane | D4 | pass |
| 10 | **Full data export** (§b) | Settings: download all owner data (measurements, samples, journal, sleep) as JSON and CSV | D4 | pass |
| 11 | **Strava connector — OAuth connect** (D9) | `/connect/strava` → Strava authorize → callback → tokens stored encrypted in D1 (AES-GCM, key from Worker secret). Requires the owner's Strava API app credentials as Worker secrets; without them the Connect UI shows a clear "needs your Strava API keys" state | D9 | pass |
| 12 | **Strava activity import** (D9) | Activities (run/ride/swim incl. average/max HR; HR streams where available) pulled into the normalized store with source=strava | D9 | pass |
| 13 | **Strava webhook receiver** (D9) | `GET/POST /api/webhooks/strava`: verify-token handshake; activity create/update events trigger a pull (or are queued in `events` when credentials are absent) | D9 | pass |
| 14 | **Withings connector** (phase 2 — noted, not this build) | Scale / blood-pressure via the same normalized-store pattern; listed so the connector layer's next step is on record | D9 | open |
| 15 | Today dashboard (§b,c) | `/` Today page: Battery + Pressure gauges, latest metrics, recent history. Cleanup wave 2026-11-04: the measurements-driven latest/recent cards were removed (production measurements = 0 rows — see the Cleanup wave section); Today now opens with the Quick glance block (gauges + key numbers from health_samples) | D2 | pass |
| 16 | **Battery (charge)** — headline gauge + Battery detail screen (§b, BatteryDetails module; Watch Battery gauge/detail) | Today shows Battery as a charge % ("how charged you are") with state label. Detail screen `/battery`: charge level + state, 14-reading charge trend chart, and a factors panel listing what is draining/recharging it (last sleep duration vs baseline, prior-day stress load, recent measurement load) each with direction + magnitude or an honest "no data logged" note.  Score: original heuristic from RMSSD vs personal baseline (SPEC math notes). Fix wave 2026-11-03: Battery also computes from imported daily SDNN aggregates (Aggregate score mappings above); the original pass evidenced the RR path only — production re-proof in the goal's dashboard-proof folder (fixed-*.png) | D5 | pass |
| 17 | **Stress** — headline gauge + Stress detail screen (§b, Pressure/stress details; Watch Pressure gauge/detail) | Today shows a Stress gauge (% + state label: Low/Moderate/High/Very high). Detail screen `/stress`: current stress from the measurement engine (Baevsky stress index primary, LF/HF secondary — published mapping in SPEC math notes), 14-reading trend chart, and a what-drives-it breakdown (SI, LF/HF, RMSSD vs baseline, latest measurement source/time). Fix wave 2026-11-03: Stress also computes from imported daily aggregates (SDNN + resting HR + sleep debt, Aggregate score mappings); the original pass evidenced the RR path only | D5 | pass |
| 18 | **Pressure** — headline gauge + Pressure detail screen (§b, BloodPressureDetails/PressureDetails modules; Watch Pressure gauge) | Today shows a Pressure gauge (% load). Detail screen `/pressure`: current load, 14-reading trend chart, contributors panel (Baevsky SI component, LF/HF component, recent measurement density) mirroring the decompiled Pressure gauge + detail structure. Fix wave 2026-11-03: Pressure also derives from the aggregate signals (SDNN + resting HR + sleep debt — no LF/HF on aggregate days) with contributors labeled "from daily Health aggregates"; the original pass evidenced the RR path only | D5 | pass |
| 19 | **Stress impact / factor impact** (§b, ScienceLab + Insights + Tag Bank) | Impact cards for every tracked factor — journal tags (incl. caffeine/alcohol-style logged tags), sleep duration/quality (from sleep records), activity days — each card: measured impact on Stress, HRV (RMSSD) and Battery vs the owner's personal baseline, computed as days-with-factor vs days-without means with delta %, effect direction, and sample counts (n with / n without). Below the minimum sample (3 with + 3 without) the card shows an honest "not enough data yet" state instead of a number. Impact list screen `/impact` + per-factor detail view. Fix wave 2026-11-03: factor days now intersect the merged measurement + imported-health day series (sleep factors compute over the full imported SDNN series, `hrvBasis` reported); the original pass evidenced measurement days only | D5 | pass |
| 20 | Health score / category details — Activity, Blood Pressure, Health (§b) | My Data categories with per-category views: `/mydata/:category` detail pages (Activity, Blood Pressure — systolic/diastolic pairing, Health, Body, Sleep & Mind) with latest + 7-day average + range + counts per sample type, served by `GET /api/mydata/categories`; wave-2 tests seed samples and assert the computed summaries | D5 | pass |
| 21 | Sleep flow + sleep details (§b,g) | Sleep detail screen `/sleep` + `GET /api/sleep`: per-night duration vs 8 h target, debt vs the owner's median baseline, 7-night debt total, median/average duration, and stage totals (deep/REM/core/awake) from Health Auto Export stage samples; wave-2 tests verify debt + stage math on seeded nights | D5 | pass |
| 22 | Journal + manual tracking + tags (§b) | Journal page: entries, mood, tags; API CRUD; wave 2 adds voice comments (row 23) attachable to entries | D5 | pass |
| 23 | Voice comments (§b,i) | Voice comments: MediaRecorder capture on the Journal page → `POST /api/voice` stores audio in R2 (`MEDIA` bucket), Workers AI Whisper transcription when the AI binding is present, playback via `GET /api/voice/:id/audio`, delete; attaches to a journal entry on save; wave-2 tests exercise upload/transcribe/attach/playback/delete with stubbed R2 + Whisper | D5 | pass |
| 24 | Breathing exercises (§b) | Guided box-breathing session UI + session logging API | D5 | pass |
| 25 | Self-tests / Self-Discovery (§b) | `/tests` page + `POST/GET /api/self-tests` over the `self_tests` store: reaction time (5 randomized-wait trials, mean/median/best), finger tapping (30 s count + taps/sec), breath hold (timed, with safety copy), orthostatic (lying vs standing measurement comparison), HRV episode (baseline → 2-min paced breathing → post, RMSSD delta). Real timing/scoring in the browser; results trended on the page; wave-2 tests cover storage + validation | D5 | pass |
| 26 | Science Lab — experiments & correlations (§b) | `/lab` + `GET /api/lab`: per-day series built from measurements (RMSSD/HR/Battery/Stress/pressure), sleep duration, steps and journal tags; Pearson correlations for every pair with ≥5 shared days, ranked by strength, plus an X/Y scatter explorer; wave-2 tests verify day-building and r values against hand-computed expectations (gate n≥5, zero-variance → none) | D5 | pass |
| 27 | Insights (§b) | Rule-based insights engine computed from the owner's stored data: data gaps, RMSSD vs baseline (≥10%), Battery 3-reading trend, high-stress streaks, sleep→next-day-RMSSD relation, sleep debt, logged deep-breathing effect; wave-2 tests cover the rules incl. the sleep→RMSSD direction. Cleanup wave 2026-11-04: the Today Insights CARD was removed — on production data it rendered only its empty state ("No measurements yet — take your first HRV reading…") because it read the measurements table (0 production rows), and its populated content duplicated the Coach panel. The engine (src/lab.ts generateInsights) and its unit tests stay; the card does not | D5 | pass |
| 28 | AI Coach chat (§b) | `/coach` + `POST /api/coach`: Workers AI binding (`env.AI`, model var `COACH_MODEL`), system prompt restricts answers to a context block computed from the owner's own data (gauges, trends, sleep, lab correlations, journal factors) with a clear not-medical-advice framing; feature-flag gated (403 when off), 503 when no AI binding; wave-2 tests verify flag/binding behavior and that the context block carries the owner's numbers. Live inference uses Cloudflare Workers AI on the owner's account. Production-truth fixes 2026-11-04: (1) the context now includes the latest Apple Health aggregate day (SDNN + baseline-median delta, RHR, sleep, steps) — before this, the coach told the owner “no HRV data stored” while his dashboard showed SDNN 165.7 ms, because the context only carried RR measurements (0 in production); (2) error surface hardened end-to-end after the owner hit the raw platform string “The string did not match the expected pattern.” on the coach page: AI failures map to a human message (detail logged server-side as a wide event), a global onError returns JSON for API routes (never an HTML error page), and the coach page parses responses defensively (an expired Access session answers with an HTML redirect — never print raw platform text). Regression tests: test/coachfix.test.ts | D5 | pass |
| 29 | News / stories content (§b) | `/stories`: five original explainer cards (what HRV measures, breathing and HRV, sleep and readiness, caffeine/alcohol evidence, spotting artifacts) — all copy written for OpenHRV, no third-party content service | D5 | pass |
| 30 | Onboarding (§b,c) | `/welcome` first-run flow (5 steps: what it measures, ways to measure, connect Apple Health pipes, notifications, privacy) shown on Today until dismissed (persisted `onboarded` setting); relaunchable from More | D5 | pass |
| 31 | Accounts / auth (§b,i) | Platform translation: Cloudflare Access single-owner lock; owner email is the identity; no passwords stored | D2 | pass |
| 32 | Live Activities (§e) | Translation: live state on the PWA Today dashboard + Web Push (see D8 register); push stack live — see rows 33–34 evidence | D6 | pass |
| 33 | Notification Service extension / rich push (§e) | Translation: Web Push to installed PWA via the Worker's push sender — VAPID (RFC 8292 ES256 JWT) + aes128gcm payload encryption (RFC 8291) implemented on WebCrypto in `src/push.ts`; wave-2 tests include an independent in-test decryptor round-trip; production dispatch evidence in the wave-5/6 ship notes below | D6 | pass |
| 34 | Notifications — morning readiness, reminders, low-Battery (§b) | Cron `scheduled()` handler on a `*/15 * * * *` trigger: morning readiness (after the day's first measurement), measurement reminder at the owner-set time, low-Battery alert (<25, 20 h cooldown), evening breathing nudge — per-type enable + time preferences in More, owner time zone, every attempt written to `notification_log` with the push-service status; duplicate suppression reads the log. Production evidence: at the 2026-11-04 06:00 UTC tick the live Worker dispatched the two due types to a controlled same-origin test subscription and logged `sent` with HTTP 201; later ticks re-sent nothing; the test subscription/log rows were then removed | D6 | pass |
| 35 | Watch app — Today/Battery/Pressure gauges (§d) | SwiftUI companion in `watch/` (Xcode project, watchOS 11+): Today screen with Battery/Stress/Pressure gauges + latest measurement, guided 60 s measurement (HealthKit heartbeat-series RR → `POST /api/watch/measurements`), settings with import-token paste + connection test. API lanes `/api/watch/*` enforce the import token and sit behind a dedicated Cloudflare Access bypass app (created 2026-11-03, id b1c3698b-ac6d-4458-8098-f33ac2de0bd4). Build evidence: `xcodebuild build` (watchOS Simulator destination, signing disabled) → **BUILD SUCCEEDED** incl. extension embed validation — see wave-2 ship notes; a simulator *device* could not be created on the build machine (CoreSimulator creation-state failure at ~8 GiB free disk), so it was not run interactively, and it is not installed on a physical Watch | D7 | pass |
| 36 | Watch workout views (§d) | Workout flow in the same project: type picker (Run/Ride/Swim/Walk/Other) → active session with elapsed time + live RR collection → summary with store-as-measurement (source `watch-workout`); compiles as part of the D7 build evidence | D7 | pass |
| 37 | Watch complications (§d,e) | WidgetKit extension `OpenHRVComplications` embedded in the app target: circular (Battery gauge), rectangular, inline and corner families fed by `/api/watch/today` with a 30 min timeline refresh; compiles as part of the D7 build evidence; token sharing with the extension container is the documented app-group hardening step (watch/README.md) | D7 | pass |
| 38 | Watch faces (§d) | Translation: theme gallery page `/themes` (Forest/Ocean/Ember/Mono accent themes, persisted via settings + applied app-wide) — no installable .watchface in a web build; registered deviation | D8 | pass |
| 39 | Watch ↔ iPhone WCSession sync (§d) | Translation implemented: the Watch companion syncs via the Worker API (`/api/watch/*`, import-token auth, Access bypass app) instead of WCSession — registered deviation | D7 | pass |
| 40 | iPhone widgets (§e) | Translation: PWA home-screen install (manifest + service worker, wave 1) + WebMCP glanceable tools (row 49) — no WidgetKit appex on web; WidgetKit itself exists in the D7 companion (row 37); registered deviation | D8 | pass |
| 41 | Paywall / subscriptions / Pro (§b) | Translation: owner-controlled feature flags in More → Settings (AI Coach, Science Lab, Stories — enforced server-side with 403/redirect when off); no payments (single-user) — registered deviation | D8 | pass |
| 42 | Analytics (§h) | Translation: first-party wide-event JSON logs only (Cloudflare Logs/Traces); no Amplitude/Facebook/AppsFlyer — registered deviation | D2 | pass |
| 43 | Support / Intercom (§b) | Translation: `/about` page — what OpenHRV is, how data is used, the translations register in-app, and a feedback form stored to the owner's `events` table (`POST /api/feedback`); registered deviation | D8 | pass |
| 44 | Sharing (§b) | Today's summary and each My Data category can be shared via the Web Share API (`navigator.share`) with a clipboard fallback — text is computed from the owner's actual current numbers | D5 | pass |
| 45 | Home-screen quick actions (§b) | Translation: PWA shortcuts in the web manifest — Measure, Journal, More, Self-tests (manifest test asserts all four); served by the Worker's manifest route | D2 | pass |
| 46 | Background work / daily sync (§b,i) | Translation: Worker Cron trigger `*/15 * * * *` (registered in the deploy output) runs the notification scheduler; replaces BGTask scheduling | D6 | pass |
| 47 | Profile, settings, data deletion (§b) | More → Settings & connections: profile/preferences, notification + feature-flag settings, and a delete-my-data action (`POST /api/account/delete`, requires typing DELETE) that wipes all 13 owner tables plus R2 voice objects and reports per-table counts; wave-2 test verifies the wipe end-to-end | D5 | pass |
| 48 | Permissions model (§i) | Browser permission prompts per feature (camera, bluetooth, notifications) with plain-language explanations | D3 | pass |
| 49 | WebMCP agent surface (fleet gate) | /.well-known/webmcp.json discovery, /api/webmcp tools, beacon, robots/llms advertisement, in-page tool registration | D2 | pass |
| 50 | Observability | Native CF logs+traces (persist) + one wide-event JSON line per request (pathname only) | D2 | pass |
| 51 | SPEC + HRV oracle (goal D1) | This document's claim table (every decompile feature row §b–§j) + `oracle/` — a pure-stdlib Python reference implementation and 3 frozen RR vectors with expected RMSSD/SDNN/pNN50/LF-HF/Baevsky values; the TS engine must reproduce them in vitest within the stated tolerances (time-domain rel 0.005, Baevsky 0.01, band power 0.08, LF/HF 0.10) | D1 | pass |
| 52 | Measurement API + manual entry + CSV import + history (§b) | `POST /api/measurements` (RR array → computed metrics stored with the RR series), Measure page manual RR paste/entry, CSV file import, My Data history list + RMSSD chart; WebMCP tool parity (`openhrv_create_measurement`, `openhrv_list_measurements`) | D3 | pass |

## Deviations register (D8 — summary; README carries the same list)

Paywall → feature flags · trackers → first-party wide events · Intercom →
About section · Live Activities → dashboard + push · WCSession → Worker API
sync · .watchface files → theme gallery · native APNs → Web Push to the
installed PWA (iOS 16.4+). No feature row is silently dropped: anything not
yet built stays `open` above.

## Data model (D1)

`users`, `settings`, `measurements`, `rr_series`, `sleep`, `journal`,
`breathing_sessions`, `self_tests`, `push_subscriptions`,
`notification_prefs`, `events` — see `migrations/0001_init.sql`;
`health_samples` + `strava_tokens` in `migrations/0002_samples.sql`;
`voice_notes` (R2 object keys + transcripts) + `notification_log`
(delivery attempts) in `migrations/0003_wave2.sql`. Voice audio lives in
the `openhrv-media` R2 bucket. All health
data stays in the owner's own Cloudflare account; the public repo contains
code and synthetic oracle vectors only.

## Ship evidence — 2026-11-03 (waves 1–4)

- Repo: https://github.com/barkleesanders/openhrv (public, MIT). Gates at ship:
  `npm run check` = tsc clean + vitest 25/25, including the three tests named
  `oracle vector <name>: engine reproduces Python reference`.
- Live: https://openhrv.barkleesanders.workers.dev — unauthenticated GET /
  returns HTTP 302 to the Cloudflare Access login (owner-only allow policy for
  barkleesanders@gmail.com). D1 migrations 0001 + 0002 applied remotely
  (14 tables incl. `health_samples`, `strava_tokens`).
- Connector lanes verified live against production with a seeded import
  token: Health Auto Export POST → samples in D1 with source attribution +
  derived sleep row; Shortcut POST → inserted; export.xml POST → parsed +
  inserted; write-back feed GET → 200 with the Shortcut recipe; bad token →
  401; Strava webhook verify without the secret → worker 403.
- Strava activation was the one flagged follow-up (set the four Worker
  secrets from the owner's own Strava API app, then More → Connect Strava)
  — COMPLETED 2026-11-03; see "Ship evidence — 2026-11-03 (Strava
  activation, D9)" at the end of this file.
- The seeded import token is the owner's live token (visible/regenerable in
  More → Settings & connections).

## Ship evidence — 2026-11-03 (wave 2: D5 remainder, D6, D7, D8)

- Gates at ship: `npm run check` = tsc clean + vitest 66/66 (25 wave-1 + 41
  new: lab/sleep/categories math, push crypto round-trip with an independent
  decryptor, scheduler dedup, and stub-D1 endpoint tests for every wave-2
  API and page).
- Infrastructure created: R2 bucket `openhrv-media`; migration
  `0003_wave2.sql` applied remotely (voice_notes, notification_log);
  VAPID keypair generated on-device and stored as Worker secrets
  (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT — never in the
  repo); Cloudflare Access bypass app for `/api/watch/*`
  (b1c3698b-ac6d-4458-8098-f33ac2de0bd4, bypass policy: the Worker enforces
  the import token). Deploy output confirms bindings DB + MEDIA + AI and
  the `*/15 * * * *` cron trigger.
- D6 production dispatch: with a controlled test subscription registered
  server-side (endpoint = the Worker's own same-origin webhook lane,
  standing in for a device push endpoint), the 2026-11-04 06:00 UTC cron
  tick dispatched measurement_reminder + breathing_nudge; both attempts
  are in `notification_log` as `sent` with HTTP 201 (the receiving endpoint
  recorded the encrypted deliveries), and later ticks dispatched nothing
  (log-based dedup). Test subscription, log rows and arrival events were
  removed afterwards (read back as 0/0/0). Delivery to a real Apple/Google
  push endpoint awaits the owner's on-phone step: open the site in Safari
  signed in via Access → Share → Add to Home Screen → open the installed
  app → More → Notifications → Enable notifications → Send test
  notification.
- D7 build evidence: the build machine initially had no simulator
  runtimes (deleted 2026-11-02); `xcodebuild -downloadPlatform watchOS`
  installed the watchOS 26.5 simulator runtime during this wave, after
  which `xcodebuild build -destination 'generic/platform=watchOS
  Simulator' CODE_SIGNING_ALLOWED=NO` completed with **BUILD SUCCEEDED**
  (both targets compiled + linked; the WidgetKit extension embedded and
  passed bundle validation; `swiftc -typecheck` against the SDK is also
  clean for both targets). Creating a simulator *device* failed
  repeatedly ("Device was allocated but was stuck in creation state",
  CoreSimulator.log) with ~8 GiB free disk, so the app was not run
  interactively in a simulator, and it has not been installed on a
  physical Watch.
- Final counts at wave 2: 48 pass / 3 in-progress (rows 11–13, Strava) /
  1 open (row 14, Withings). Updated after Strava activation (below):
  51 pass / 0 in-progress / 1 open.

## Ship evidence — 2026-11-03 (always-on Apple Health connector sync)

- Primary Apple Health lane is now the Muse Apple Health connector
  (HealthKit data synced from the owner's iPhone to Muse), ahead of the
  manual pipes: a scheduled job (Muse cron `openhrv-apple-health-sync`,
  every 3 hours) reads daily metrics, sleep sessions and workout sessions
  via `health-cli --provider healthkit`, maps them onto the Health Auto
  Export JSON contract, and POSTs them to `/api/import/health-auto-export`
  from the Mac mini — the import token is read from D1 inside the poster
  process and never printed or logged.
- Mapping: heart_rate_variability_ms→hrv_sdnn, resting_hr_average_bpm→
  resting_heart_rate, hr_average_bpm→heart_rate, oxygen_saturation_average→
  spo2 (fraction→%), respiratory_rate_average→respiratory_rate, step_count,
  active_energy_burned_kcal→active_energy, basal_energy_burned_kcal→
  basal_energy, distance_walking_running_meters→distance_walking_running,
  vo2_max; sleep sessions→sleep_analysis points (deriving sleep rows);
  workout sessions→workouts. Source attribution: `health_auto_export:Muse
  Apple Health` (workout rows ride the endpoint's plain
  `health_auto_export` source).
- First sync 2026-11-03: window 2026-09-01→2026-11-03, received 490 /
  inserted 490 + 3 derived sleep rows; an identical re-POST inserted 0
  (health_samples dedupes on (owner, source, external_id); already-present
  sleep sessions are filtered by the poster). A watermark plus a 2-day
  overlap window makes every later run incremental and duplicate-free.
- Known gaps of this lane: the connector exposes no raw samples
  (`query samples --list-fields` returns an empty sample-type list), so
  intraday heart-rate points and RR/heartbeat-series data do not flow
  through it — HRV arrives as the daily SDNN aggregate. Blood-pressure
  fields are known to the connector but nothing has synced yet
  (observed: false). Health Auto Export, Shortcuts and export.xml remain
  available as manual alternatives; the write-back feed + Shortcut lane
  is unchanged.

## Ship evidence — 2026-11-03 (Strava activation, D9)

- Credentials were NOT in Vaultwarden (exhaustive `bw` search: no item with
  "strava" in name or URI among 1,638 items). Per the owner's fallback
  directive, the existing Strava API app on his account — "Barklee Mini
  CLI" — was used; its Authorization Callback Domain was changed from
  localhost to openhrv.barkleesanders.workers.dev (verified by reading the
  saved Edit form back). App credentials plus the generated
  STRAVA_VERIFY_TOKEN / TOKEN_ENC_KEY were stored in Vaultwarden as item
  "Strava API (OpenHRV)" and set as Worker secrets (`wrangler secret list`:
  STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_VERIFY_TOKEN,
  TOKEN_ENC_KEY alongside the VAPID_* set). All value movement stayed
  inside Mini-local pipelines; no credential value was printed or logged.
- Strava's Google SSO sign-in was completed in the owner's real Chrome
  (password + Authenticator TOTP sourced from the vault's Google item
  inside Mini-local scripts, never surfaced). Note: a pre-existing
  half-finished Google sign-in tab (already past its password step,
  waiting at a TOTP challenge) disappeared from the browser during window
  management and could not be recovered; a fresh sign-in flow replaced it.
- OAuth: `/connect/strava` → Strava authorize (app "Barklee Mini CLI") →
  callback → `/more?strava=connected`; D1 `strava_tokens` count = 1
  (tokens AES-GCM-encrypted at rest); More page reads "Connected
  (athlete 121691632)".
- Backfill: "Sync activities" → fetched 50, inserted 50; D1 read-back:
  50 `health_samples` rows with source=strava (type=workout).
- Webhook: `push_subscriptions` GET showed no subscription for our
  callback; POST create succeeded — Strava's verification handshake
  against `/api/webhooks/strava` passed with the Worker verify token —
  and a verify GET returns subscription id 382875 with callback
  https://openhrv.barkleesanders.workers.dev/api/webhooks/strava.
- Rows 11–13 → pass. Updated final counts: 51 pass / 0 in-progress /
  1 open (row 14, Withings — phase 2 by the goal's own definition).

## Design — Phase 2 (2026-11-03, /design)

Direction (locked before code, per the design skill): **Apple Health
Summary/Browse** — the iOS Health app's visual language, applied as a
presentation-layer redesign only (routes, data wiring and the Phase-1
aggregate gauge path unchanged).

- Canvas: light systemGray6 (#f2f2f7); content on white cards, 18px
  radius, hairline separators + soft shadow. Follows the system
  appearance via `prefers-color-scheme` (dark: black canvas, #1c1c1e
  cards) — no in-app appearance toggle.
- Type: SF system stack (-apple-system), Large Title page headers,
  31–48px bold tabular numerals for values, 13px semibold category
  labels, 12px context lines.
- Semantic category colors (Health's): Battery #34c759 (activity
  green), Stress/HRV/Resting HR #ff2d55 / #ff3b30 (heart red), Pressure
  #ff9500 (orange), Sleep #5856d6 (indigo), Respiratory #32ade6.
- Today = Health Summary: "Favorites" grid — Battery / Stress /
  Pressure / HRV / Resting HR / Sleep cards with category icon + label
  + chevron, big value + unit, source/date context, and gradient-fill
  SVG sparklines from the real series (server-computed trends in
  `todayData`); Factor Impact demoted to a browse row.
- Score detail pages = Health chart pages: category-colored headline
  value, D/W/M/Y segmented range control over the real daily trend
  (canvas line + gradient fill), contributors as hairline rows.
- My Data = Health Browse: icon-chip category rows (chip color per
  category) with latest values + chevrons.
- Bottom nav = iOS tab bar: translucent blur (backdrop-filter), hairline
  top border, safe-area padding, original SF-style line icons (inline
  SVG, no external assets).
- HIG gate (apple-hig.md, baseline for web + Apple-targeted brief):
  ✅ system font/text styles · ✅ contrast (dim #6e6e73 ≈ 5:1 on white;
  category colors used at ≥14px semibold/large numerals) · ✅ 44pt
  targets (nav 49pt + safe area, buttons 44pt) · ✅ not color-alone
  (icons + labels + values) · ✅ no gesture-only actions · ✅ Reduce
  Motion (no decorative animation added) · ✅ system appearance, no
  toggle · ✅ safe areas (tab bar + header insets) · ✅ glass only in
  the tab bar (control layer) · ✅ ≤1 typeface family, no light weights
  · ✅ system-style components, branding defers · ✅ empty states give
  next steps · N-A live HIG page re-read (cached reference used; the
  values applied are the brief's own named targets).

## Granularity wave (2026-11-04) — evidence

Directive: hourly data in the charts, more granular and labeled better
(/design applied to data), tracked more closely. Commits e3a227e (wave)
+ 3b52d90 (axis-title fix); production GIT_SHA = 3b52d90.

- Hourly lane: the Apple Health connector sync now also pulls
  `query metrics --interval hourly` for a rolling 14-day window
  (build_payload.py; hourly watermark tracked separately in
  watermark.json). Points land in health_samples with
  meta.granularity="hourly" and ":hourly:" external ids; the daily id
  format is unchanged, so re-runs insert 0 (verified live).
  Production hourly counts by type (2026-11-04): basal_energy 290,
  distance_walking_running 188, step_count 187, active_energy 119,
  heart_rate 112, resting_heart_rate 107, hrv_sdnn 79, spo2 38,
  vo2_max 2 — total 1,122. respiratory_rate returns ZERO hourly
  buckets from the connector (named gap, never fabricated).
- Daily derivation is grain-safe: healthDays, category summaries and
  the Science Lab step sums all exclude hourly rows (an hourly SDNN is
  not the day rollup; hourly steps would double daily totals).
- Chart system (src/chart.ts + src/series.ts): ONE server-rendered SVG
  component for every detail chart — y-axis tick values + unit title,
  x time labels (hours for Day, dates for W/M/Y), min/max markers,
  zone bands, crosshair enhancer (value bubble with full timestamp),
  selected-point readout, data-table toggle, and a computed insight
  caption per chart (avg · range · peak · delta vs personal baseline).
  Today sparklines gained min/max end labels. Ranges switch via
  ?range=day|week|month|year segmented links. Gauge pages: Day view
  shows hourly heart-rate context and states why (gauges are daily).
- Strava HR streams: migration 0004 workout_streams; sync + webhook +
  tokened POST /api/import/strava-streams fetch time+heartrate
  streams, downsampled to <=1 pt/5 s. Live backfill 2026-11-04:
  50 checked, 47 stored, 3 activities have no HR stream. Workout
  detail pages (/workout/:id) chart the real curve with Z1-Z5 zone
  bands from the observed max HR + time-in-zone caption.
- Sleep stages verdict: the connector store holds stage DURATIONS
  only (3 sessions, unspecified+awake) — no stage intervals exist, so
  there is NO hypnogram. The sync now attaches per-night stage totals
  (meta.stages) and the Sleep page renders a composition bar when a
  night carries them, with durations-not-sequence labeling.
- Tests: 122/122 (chart label contract, series shaping, hourly
  mapping + stable-id dedup, healthDays grain exclusion, stream
  parse/downsample fixtures, scripts-parse gate).
- Screenshots (local wrangler dev on a production-seeded local D1,
  headless Chrome): files/dashboard-proof/granular-*.png — Today,
  Health Day hourly charts, workout HR chart, Sleep, Battery Day.
  Verdict: axes/captions legible, real density; one defect found and
  fixed in-wave (axis title clipped in the gutter -> 3b52d90).

## Phase 2 — reports, scores, journal (2026-11-04)

Feature patterns modeled on mainstream HRV apps (per-day report
structure, trio score presentation, day-grouped journal) — behavior
replicated, all code, formulas and wording original (clean-room).
Nothing in OpenHRV is ever locked, blurred or sampled: every section
renders in full for the owner.

- Reports hub (/reports) with Latest/Days/Weeks/Months ranges.
- Stress Impact (/reports/stress): per-day mini-gauge strip; stats
  Stress level / Morning level / Stress minutes. Stationary stress =
  an hour whose mean HR >= resting baseline x 1.2 with < 50 steps;
  each qualifying hour counts in full (hourly resolution, labeled).
  Morning level = mean positive HR elevation (%) over the first three
  hours with data from 04:00. Days without hourly buckets show the
  daily-aggregate stress level and mark minutes/morning unavailable —
  never estimated. Explainer text is original.
- Activity (/reports/activity): Active time, Active METs, Active cal,
  Sedentary, Steps, Total cal, Intense time, Intense METs, Stand hours.
  Stand hour = >= 100 steps in the hour. Sedentary = hours 06:00-22:00
  outside sleep with < 100 steps. Intense = HR >= resting + 0.75 x
  (observed max - resting). MET estimate: MET level = 1 + 9 x HR
  reserve fraction (resting -> observed max), MET-minutes summed over
  active hours; labeled an estimate wherever shown. No weight input is
  used or assumed.
- Heart report (/reports/heart?date=): the days hourly HR segmented
## Phase 2 — reports, scores, journal (2026-11-04)

Feature patterns modeled on mainstream HRV apps (per-day report
structure, trio score presentation, day-grouped journal) — behavior
replicated, all code, formulas and wording original (clean-room).
Nothing in OpenHRV is ever locked, blurred or sampled: every section
renders in full for the owner.

- Reports hub (/reports) with Latest/Days/Weeks/Months ranges.
- Stress Impact (/reports/stress): per-day mini-gauge strip; stats
  Stress level / Morning level / Stress minutes. Stationary stress =
  an hour whose mean HR >= resting baseline x 1.2 with < 50 steps;
  each qualifying hour counts in full (hourly resolution, labeled).
  Morning level = mean positive HR elevation (%) over the first three
  hours with data from 04:00. Days without hourly buckets show the
  daily-aggregate stress level and mark minutes/morning unavailable —
  never estimated. Explainer text is original.
- Activity (/reports/activity): Active time, Active METs, Active cal,
  Sedentary, Steps, Total cal, Intense time, Intense METs, Stand hours.
  Stand hour = >= 100 steps in the hour. Sedentary = hours 06:00-22:00
  outside sleep with < 100 steps. Intense = HR >= resting + 0.75 x
  (observed max - resting). MET estimate: MET level = 1 + 9 x HR
  reserve fraction (resting -> observed max), MET-minutes summed over
  active hours; labeled an estimate wherever shown. No weight input is
  used or assumed.
- Heart report (/reports/heart?date=): the day's hourly HR segmented
  Sleep / Exercise / Mindfulness / Move / Rest (priority exercise >
  mindfulness > sleep > move > rest), segment-colored runs with a
  legend, peak callout, generated one-line summary. Workout hours with
  a stored Strava stream use the stream's per-hour means and the
  stream's true max for the peak (disclosed in the summary).
- Health score: 50% SDNN vs personal baseline (log form), 25% resting
  HR vs baseline, 25% sleep duration vs own median; missing parts
  renormalize; nothing known -> no score. Focus: real LF/HF form
  (peak at ratio 1.6) on measurement days; SDNN/RHR proxy on aggregate
  days, labeled estimate in the UI wherever used.
- Trio presentation (Stress / Energy / Health: value + state label +
  state-colored underline) on measurement and day detail pages.
  Measurement accuracy = share of RR intervals kept after artifact
  filtering, recomputed from the stored RR series.
- Breakdown sections (Health / Focus / Energy / Stress / Nervous
  system balance / HRV Score): value, state, delta-vs-baseline chip
  (scores: vs mean of prior 14 days; HRV: vs personal baseline),
  generated text, trend chart. ANS balance: LF/HF share when a
  spectrum exists, SDNN proxy otherwise (labeled). Latest-results
  multiline chart: Stress/Energy/Health over the last 14 scored days.
- Key Insights: generated per day/measurement from the actual numbers
  (score pairing, SDNN delta vs baseline, sleep duration, stationary
  stress minutes, resting-HR elevation) — original wording, templates
  in reports.ts keyInsights(), capped at 4 statements, each backed by
  a stored value.
- Journal (/journal): calendar strip with per-day charge orbs, then a
  day-grouped reverse-chronological feed mixing measurement trio
  cards, SDNN sample cards, workout cards, sleep cards (sorted by
  wake time), breathing cards and the owner's notes — timestamped,
  source-tagged, each linking to its detail. The composer and voice
  notes remain above the feed.
- Tests: 148/148 (14 files) — stress-minutes/stationary fixtures,
  stand hours + sedentary + MET estimate, Health/Focus vs fixture
  days, ANS both bases, heart-day segmentation priority, journal
  ordering/mixing/orbs, chart label gates for the new multi-line /
  bar / segmented / mini-gauge components, scripts-parse gate.

## Tap-fix wave (Phase A, 2026-11-04)

- Home Favorites taps land hourly-first: gauge pages default (no explicit
  range) to the Day view whenever hourly driver data exists — Battery
  leads with hourly HRV (SDNN), Stress with hourly HR plus the hourly
  steps chart and its stationary-stress minutes for that day, Pressure
  with hourly HR — each with the honest basis note that the gauge itself
  is a daily construct. Category pages accept a ?metric= focus (home HRV
  and Resting HR cards use it) that moves the tapped metric's chart
  first, preserves the focus in the range links, and defaults to Day
  when hourly data exists for the focused or any metric. When no hourly
  data exists, the landing defaults to the daily (Month) view and states
  the reason at the top — never a blank or a spinner. Sleep leads with
  an hourly heart-rate context card before its duration trend.
- Tests: test/tapfix.test.ts enumerates the six Favorites hrefs from the
  rendered home page, follows each through the router, and asserts the
  Day-selected segmented control, hourly points with hour labels, the
  per-gauge drivers, metric-focus ordering, and the no-hourly fallback.

## Coach home wave (Phase B, 2026-11-04)

- Today is the home page, ordered: daily brief → Coach panel (What's
  impacting you / What's driving stress — or What's keeping stress low
  in protective mode / What to work on) → AI Coach card (top proactive
  suggestion, talk entry, data-generated quick-ask chips that prefill
  the coach chat) → hourly highlights → Reports preview → sleep +
  journal preview → Favorites + impact → an Explore card carrying every
  feature that used to live only under More (audit-tested: every
  internal More link is reachable from Today).
- The Coach panel is deterministic (src/coachpanel.ts): rule-based
  synthesis over gauge days, factor impacts, hourly stationary-stress,
  sleep debt vs the 8 h target, stand hours vs the owner's best days,
  and schedule load. Every sentence cites its number; actions are
  threshold-gated and stay silent when not met. The AI Coach chat
  context now includes the same driver/action lines.
- Calendar lane: the Apple Health sync also pulls today + tomorrow's
  events via the Mini's gog calendar route and POSTs title + start/end +
  calendar name only to /api/import/calendar (import-token auth, same
  as health data) into calendar_events (migration 0005); rows older
  than 14 days are pruned on every POST. The panel uses events only as
  schedule-load context; no Watch or export endpoint returns them. A
  failed or empty calendar pull changes nothing and is never mentioned.
- Tests: test/coachpanel.test.ts — fixture-day drivers/actions/
  protective mode, schedule-load math, endpoint token auth + prune +
  no-leakage, Today section order, and the More→Today link audit.
  Full suite 164/164 (16 files).

## Cleanup wave (2026-11-04) — panel discipline

Barklee's rule after using the live app: **a panel exists only if it
populates.** Five waves of accretion left legacy panels reading the
`measurements` table (0 rows in production — his real data lives in
`health_samples`) and insight surfaces duplicating the Coach panel.
Production evidence (2026-11-04, remote D1 counts): measurements 0,
health_samples 1,668, sleep 4, journal 0, breathing_sessions 0,
self_tests 0; blood_pressure_* / body_mass / mindful_session samples:
zero ever; respiratory_rate: 2 samples ever, none hourly.

Removed (markup + dead code + tests):

- Today **Insights** card — rendered only its "No measurements yet"
  empty state on a fully populated dashboard; its populated content
  duplicated the Coach panel. The generateInsights engine stays in
  src/lab.ts with its unit tests; no route calls it now.
- Today **Latest from Apple Health / Latest measurement** card —
  duplicated the glance + Favorites numbers at the bottom of the page.
- Today **Recent** card — measurements-only; rendered nothing.
- Today **Daily brief** as a standalone card — merged into the Quick
  glance block as its footer (the "Most important:" line + the
  schedule-derived brief lines), so brief and glance never stack
  duplicate numbers.
- My Data **Measurement history** card (+ its share buttons and fetch
  plumbing) — measurements-only; rendered "Nothing yet." plus a blank
  chart canvas.

Reorder — Today now opens with the **Quick glance** block: the three
gauge tiles (Battery / Stress / Pressure) + a key-numbers strip
(HRV, resting HR, last night's sleep, steps, stand hours — each row
only when its number exists) + the merged brief footer. Then: Coach
panel (impacting / drivers / actions) → AI Coach card → hourly
highlights → Reports preview → sleep & journal → Favorites → Factor
Impact → Explore. The empty-journal placeholder line inside Sleep &
journal now shows only when there is no sleep data either.

Category visibility rule (My Data surfaces): a metric is shown when it
has real data behind it — **at least 3 daily samples, or any hourly
samples** (visibleCategories in src/index.ts, applied to
/api/mydata/categories and to category-page chart blocks; the
summarizeCategories computation itself stays complete). Consequences
on production data: the Blood Pressure and Body categories leave the
category list and their pages redirect to /mydata (zero samples ever);
Respiratory rate (2 samples, no hourly) and Mindful sessions (0
samples) lose their chart blocks until data exists. No API data is
deleted — this is a display rule, and a metric reappears automatically
the day its data lands.

Kept deliberately: the gauge pages' "from daily aggregates" explainer
lines (they sit inside fully populated pages and carry the honesty
labeling), the My Data counts card (its zeros are honest row counts of
input features, next to 1,668 imported samples), the input-feature
pages (Journal, Self-tests, Breathing — empty states there are the
feature's starting state, not dead panels), and the Welcome card
(conditional on having no data at all).

Tests: test/cleanup.test.ts renders against a production-shaped
fixture (measurements empty) and asserts the glance is first and
populated, every content panel on Today carries a real value, the
removed panels' markup strings are absent, the categories API hides
empty categories / trace metrics, and data-less category pages
redirect. Section-order test updated to the new order. Full suite
170/170 (17 files).

## Ship evidence — 2026-11-04 (production-truth sweep)

- Trigger: the owner screenshotted the AI Coach page showing the raw error
  "The string did not match the expected pattern." on build 1773244 despite
  170/170 unit tests — the tests stub Workers AI, and no ship gate ever
  exercised the real binding or the error surface.
- Root cause: the ask path itself was healthy (reproduced 5/5 against
  production and 6/6 against `wrangler dev --remote` with the real AI
  binding + production D1, via a temporary Access service token). The raw
  string reached the screen because a NON-JSON response (an expired Access
  session answers POST /api/coach with a 302 HTML page — reproduced)
  hit the page's `r.json()` and the catch printed `e.message` verbatim
  (WebKit's message for that failure). Every server JSON error path carries
  a human sentence, so the bare string could only arrive client-side.
  Fixes in src/views.ts (defensive parse + human catch), src/index.ts
  (global onError → JSON for API routes; coach AI failures mapped to a
  human message with the detail in the wide-event log), src/coach.ts +
  src/index.ts (aggregate-HRV grounding), src/import.ts (HAE name
  normalization). Regression tests: test/coachfix.test.ts (6 tests).
- Full sweep against production (temporary Access service token, created
  → used → revoked in the same run; human owner policy untouched):
  25/25 pages, all read APIs, measurement lifecycle (POST→GET→page→
  DELETE), journal/breathing/self-tests/feedback writes (cleaned), voice
  note round-trip incl. real Whisper transcription, push subscribe→list
  →unsubscribe + test send delivered (web.push.apple.com, HTTP 201),
  WebMCP, Watch lanes (token + 401), imports (HAE dedup proven on a
  sync-faithful payload: inserted=0 twice; shortcut; export.xml; calendar
  idempotent), exports (JSON/CSV/write-back), Strava (status, sync,
  streams backfill 47, webhook verify 403 + bogus-activity POST graceful),
  account-delete guard (400 without the exact confirm — never executed),
  cron (production notification_log evidence). Failures found and fixed:
  the three above; two sweep-checker artifacts (export JSON has no `ok`
  field by design; invalid self-test type correctly 400s) were verified
  as correct app behavior.
- Mechanical gate added: `scripts/smoke.mjs` (post-deploy production
  checks; coach check requires an Access service token in env and SKIPS
  LOUDLY without one). scripts/deploy.sh prints the smoke command after
  every deploy and runs it when SMOKE_* env is present.

## Ship evidence — 2026-11-04 (12-hour display wave)

Barklee's rule: every human-visible clock time in the UI is 12-hour
("2:05 PM"); machine formats (ISO strings, API JSON, stored data,
`<time datetime>`) are unchanged. Implementation: one central
formatter, `src/timefmt.ts` (`fmtHour12` / `fmtHourMin12` /
`fmtTime12`), called from every display site — hourly chart labels +
readouts (`series.ts`), coach panel hour ranges / first-event /
medical-block / lights-out strings (`coachpanel.ts`), journal feed
times (`journalfeed.ts`), workout `whenLabel`, reports-preview peak
text, heart-report segment labels + peak callout (`index.ts`), and
the sleep page's client-side nights list (`views.ts` inline `t12`,
same conversion). Push scheduling math (`push.ts` `localParts`,
minutes-since-midnight) is not display and is untouched. Tests:
`test/timefmt.test.ts` pins the formatter (midnight/noon edges,
minute rollover) + the chart/coach label producers; the three suites
that asserted 24-hour strings (chart, coachpanel, tapfix) now assert
the 12-hour forms. 181/181 tests, `tsc` clean.

## Ship evidence — 2026-11-04 (coach 500 hardening)

Barklee hit the global onError 500 ("Something went wrong on the
server") twice on the production coach at 15:47-15:48 PST — inside
the 12-hour wave's deploy rollout window; identical asks minutes
later returned grounded 200s. The route's AI call was guarded (502),
but everything around it (flags, data assembly, context build) was
not: any platform-layer throw in that span became a bare 500. (The
D1 read helpers swallow query errors and row shapes are coerced, so
the exposure is the platform/binding layer and the long tail of pure
assembly code.) Fix: POST /api/coach now delegates to coachAsk()
inside one guard — any throw logs {evt:"coach_error",
stage:"assembly"} and returns the human 502. The coach page client
additionally retries a 5xx ask once, silently, after 1.2 s, so a
rollout blip never reaches the user. Regression tests in
test/coachfix.test.ts (binding-fault injection -> human 502 with no
raw leak; page script carries the retry). 183/183 tests.

## Ship evidence — 2026-11-04 (session-resilience wave)

Barklee: the app "can't show the data right now." Production data and
every read API were verified healthy at that moment; the failure was
client-side. The Access session lasted 24h; when it lapsed, data
fetches received the login page (non-JSON), pages called r.json(),
threw, and sat on "Loading…" forever (the first coach incident's
failure shape, still present on every other page). Fixes: (1) Access
app session_duration 24h -> 720h (30 days, single-user app). (2) All
data pages (Today helpers in layout, Sleep, My Data + category,
Impact, score detail) now load via apiJson(), which detects the
non-JSON/session case, and settle via apiFail() with the honest
message and a one-tap sign-in/retry link — never a dead loader.
(3) Service worker v2: purges the v1 cache on activate and caches
only successful, non-redirected GET responses (a cached login page
can no longer be served as app content). Tests:
test/sessionresilience.test.ts; 187/187.

## Longevity (PLSI) — 2026-11-08

Implemented after PLSI (github.com/Insilico-org/plsi, MIT) — Insilico's
Personal Longevity State Interface. Two of its maps are ported:

- **Blood PhenoAge** (PLSI map/derive.py): the Levine-2018 clinical
  aging clock (Levine et al., doi:10.18632/aging.101414), constants
  verified against the BioAge reference via PLSI. `src/phenoage.ts`
  computes PhenoAge + acceleration from the 9 markers of ONE blood
  draw (albumin, creatinine, glucose, CRP, lymphocyte %, MCV, RDW,
  ALP, WBC) plus chronological age; oracle vectors from PLSI's own
  Python are pinned in test/phenoage.test.ts (32.9721 @ 40y;
  75.9221 @ 60y). Labs are stored canonical-only in `lab_results`
  (migration 0006); US entry units convert at the API boundary
  (POST /api/labs). Date of birth lives only in the app's own
  settings store (POST /api/settings/dob) as the clock's
  calendar-age input — never logged, never exported.
- **Wearables monthly projection** (PLSI sleep_activity map):
  `src/longevity.ts` summarizes the last 3 calendar months (current
  month labeled partial) — mean sleep h/night, resting HR, HRV SDNN,
  steps/day, workout minutes, active days, latest VO2max — from the
  health_samples store with healthdays.ts granularity rules (hourly
  rows never enter daily derivation; longest sleep record wins the
  night; the `sleep` table is merged in as sleep_analysis rows, the
  same merge healthDayInputs performs).

Page: GET /longevity (linked from Reports, More, and Today's Explore
card per the More⊆Today rule). Boundaries, inherited from PLSI and
stated on the page: markers must come from the SAME draw — draws are
grouped by date and an incomplete draw shows its missing-markers
checklist instead of a blended score; the clock is research and
education, NOT a diagnosis; every value traces to a stored row.

Deliberately NOT ported from PLSI: the multi-agent team and token
economy (OpenHRV is a single-user personal app — no agents, no
tokens), methylation/DNA clocks (no methylation data source exists
in the app, and adding one means a new sensitive-data lane), and
mothership result-sharing (nothing leaves the owner's Worker; the
app's whole posture is locked-to-owner). A prediction ledger
(self-fulfilling-prophecy log) is a plausible future wave but is
out of scope here.
