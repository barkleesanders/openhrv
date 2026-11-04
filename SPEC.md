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
| 5 | **Health Auto Export REST import** (§b,g — D4 primary pipe) | `POST /api/import/health-auto-export` accepts the Health Auto Export app's JSON (metrics array: HRV SDNN, resting HR, heart rate, sleep analysis, BP, SpO2, respiratory rate, steps, workouts…), gated by a per-owner bearer import token (shown in Settings with copy button + in-app setup instructions). Samples land in the normalized store | D4 | pass |
| 6 | **iOS Shortcuts import** (§b,g) | `POST /api/import/shortcut` (same import token) accepts flexible JSON health samples; the Shortcut recipe (read HRV/health in Shortcuts → POST) is documented in-app on the Import/Settings screen | D4 | pass |
| 7 | **Apple Health export.xml upload** (§b,g) | Settings/Import page file upload; Record elements parsed into the normalized store (HR, HRV SDNN, BP, sleep, steps…) with source=apple_health | D4 | pass |
| 8 | **Normalized samples store** (§g) | One `health_samples` store keyed by type + source (apple_health / strava / manual / ble / ppg / shortcut), feeding Today, gauges, scores and factor impact; source attribution preserved on every sample (read path connected in the 2026-11-03 fix wave: healthDays → scoreHealthDays merge; before that the gauges read only the measurements table and the claim was write-side only) | D4 | pass |
| 9 | **Write-back feed toward Apple Health** (§b,g) | `GET /api/export/health-writeback` (import token) returns samples the phone should write into Health (breathing mindful minutes, measurement HRV/HR summaries, in-app sleep) + a documented iOS Shortcut recipe using "Log Health Sample" (+ downloadable recipe file). Platform truth: a Worker cannot write HealthKit directly — automatic native write-back is the D7 companion's path (HealthKit entitlement); the Worker-side feed + Shortcut is the build-now lane | D4 | pass |
| 10 | **Full data export** (§b) | Settings: download all owner data (measurements, samples, journal, sleep) as JSON and CSV | D4 | pass |
| 11 | **Strava connector — OAuth connect** (D9) | `/connect/strava` → Strava authorize → callback → tokens stored encrypted in D1 (AES-GCM, key from Worker secret). Requires the owner's Strava API app credentials as Worker secrets; without them the Connect UI shows a clear "needs your Strava API keys" state | D9 | pass |
| 12 | **Strava activity import** (D9) | Activities (run/ride/swim incl. average/max HR; HR streams where available) pulled into the normalized store with source=strava | D9 | pass |
| 13 | **Strava webhook receiver** (D9) | `GET/POST /api/webhooks/strava`: verify-token handshake; activity create/update events trigger a pull (or are queued in `events` when credentials are absent) | D9 | pass |
| 14 | **Withings connector** (phase 2 — noted, not this build) | Scale / blood-pressure via the same normalized-store pattern; listed so the connector layer's next step is on record | D9 | open |
| 15 | Today dashboard (§b,c) | `/` Today page: Battery + Pressure gauges, latest metrics, recent history | D2 | pass |
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
| 27 | Insights (§b) | Rule-based insights computed from the owner's stored data and shown on Today: data gaps, RMSSD vs baseline (≥10%), Battery 3-reading trend, high-stress streaks, sleep→next-day-RMSSD relation, sleep debt, logged deep-breathing effect; wave-2 tests cover the rules incl. the sleep→RMSSD direction | D5 | pass |
| 28 | AI Coach chat (§b) | `/coach` + `POST /api/coach`: Workers AI binding (`env.AI`, model var `COACH_MODEL`), system prompt restricts answers to a context block computed from the owner's own data (gauges, trends, sleep, lab correlations, journal factors) with a clear not-medical-advice framing; feature-flag gated (403 when off), 503 when no AI binding; wave-2 tests verify flag/binding behavior and that the context block carries the owner's numbers. Live inference uses Cloudflare Workers AI on the owner's account | D5 | pass |
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
