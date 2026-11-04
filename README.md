# OpenHRV

Open-source, clean-room reimplementation of the Welltory feature set as a
Hono app on Cloudflare Workers — HRV measurement (camera, Bluetooth chest
strap, manual/CSV RR import), readiness ("Battery") and stress ("Pressure")
scores, sleep, journal, breathing, and self-tests, delivered as an
installable PWA with Web Push notifications.

**Clean-room statement.** OpenHRV was built from a feature-level specification
([SPEC.md](SPEC.md)) derived from static analysis of the reference app, plus
public documentation and published HRV mathematics (Task Force 1996; Baevsky
stress index). No code, copy, branding, or assets from the reference app are
used. OpenHRV is unaffiliated with Welltory.

**Privacy by design.** The reference app ships Amplitude, Facebook, and
AppsFlyer trackers. OpenHRV deliberately does not: the only telemetry is
first-party structured request logs in the owner's own Cloudflare account,
and all health data lives in the owner's own D1 database.

## Single-user lock

This instance is locked to its owner with Cloudflare Access (single allow
policy for the owner's email; unauthenticated requests are redirected to the
Access login at the edge). To self-host your own instance, deploy the Worker,
create your own D1 database, and put your own Access application + policy (or
your own auth) in front of it — see `wrangler.toml` and SPEC.md.

## Apple Health sync (always-on)

On the owner's instance, Apple Health data flows in automatically through
the Muse Apple Health connector: the iPhone syncs HealthKit data to Muse,
and a scheduled job (every 3 hours) reads daily metrics, sleep sessions and
workouts, maps them onto the Health Auto Export import contract, and posts
them to this Worker — no manual exports. The import is idempotent
(server-side dedupe on (owner, source, external_id)), so the sync safely
overlaps its window. Health Auto Export, iOS Shortcuts and the export.xml
upload remain available as manual alternatives, and the write-back feed +
Shortcut lane (More → Settings & connections) is unchanged.

## Develop

```bash
npm install
npm run check          # typecheck + vitest (incl. HRV oracle vectors)
npm run dev            # wrangler dev
npm run db:migrate     # apply D1 migrations (remote)
npm run deploy         # wrangler deploy, stamps GIT_SHA from HEAD
```

The HRV engine (`src/hrv.ts`) is verified against an independent Python
reference implementation in `oracle/` — regenerate the frozen vectors with
`python3 oracle/compute_oracle.py`.

## Platform translations (deviations register)

| Reference feature | OpenHRV translation |
|---|---|
| Subscriptions / paywall | Owner-controlled feature flags (single-user; no payments) |
| Amplitude / Facebook / AppsFlyer analytics | First-party wide-event logs only |
| Intercom support chat | In-app About / feedback section |
| Live Activities | Live PWA dashboard + Web Push |
| WatchConnectivity (WCSession) | Watch companion syncs over the Worker API |
| Bundled .watchface files | Theme gallery (no installable watchfaces on web) |
| Native push (APNs) | Web Push to the installed PWA (iOS 16.4+) |
| Native widgets / complications | PWA install + WebMCP glanceable tools; WidgetKit skeleton in the Watch companion (D7) |

Full claim table with per-feature status: [SPEC.md](SPEC.md).

## License

MIT
