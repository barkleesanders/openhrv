import { Hono } from "hono";
import { computeHrv, parseRrText } from "./hrv";
import {
  ICON_SVG,
  aboutPage,
  categoryPage,
  coachPage,
  journalPage,
  labPage,
  layout,
  manifestJson,
  measurePage,
  morePage,
  myDataPage,
  serviceWorkerJs,
  sleepPage,
  storiesPage,
  testsPage,
  themesPage,
  todayPage,
  welcomePage,
  type TodayData,
} from "./views";
import { WEBMCP_TOOLS, webmcpDiscovery } from "./webmcp";
import { APPLE_TOUCH_ICON, FAVICON_ICO } from "./assets";
import {
  batteryState,
  dailyAggregates,
  factorImpact,
  measurementGaugeDays,
  mergeGaugeDays,
  pressureState,
  scoreHealthDays,
  scoreSeries,
  stressState,
  type DayAggregate,
  type FactorImpact,
  type MeasurementLike,
} from "./insights";
import { healthDays, type HealthDay } from "./healthdays";
import { impactPage, scoreDetailPage } from "./views";
import {
  parseExportXml,
  parseHealthAutoExport,
  parseShortcutJson,
  type NormalizedSample,
} from "./import";
import {
  decryptToken,
  encryptToken,
  stravaActivitySample,
  stravaAuthorizeUrl,
  stravaConfigured,
} from "./strava";
import { summarizeSleep } from "./sleep";
import { bloodPressureReadings, categoryDefs, summarizeCategories } from "./categories";
import { buildLabDays, correlationPairs, generateInsights, labSeriesLabel } from "./lab";
import { COACH_SYSTEM_PROMPT, buildCoachContext, type CoachData } from "./coach";
import {
  DEFAULT_NOTIFICATION_CONFIG,
  NOTIFICATION_TYPES,
  dueNotifications,
  localParts,
  sendWebPush,
  type NotificationConfig,
  type NotificationType,
  type PushSub,
  type VapidKeys,
} from "./push";

/** Minimal structural types for the AI / R2 bindings (keeps tests able to
 *  inject stubs without the full workers-types surface). */
export interface AiBinding {
  run: (model: string, input: unknown) => Promise<unknown>;
}
export interface MediaBucket {
  get: (key: string) => Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
  put: (key: string, value: ArrayBuffer | ReadableStream, opts?: { httpMetadata?: { contentType?: string } }) => Promise<unknown>;
  delete: (key: string) => Promise<unknown>;
}

export interface Env {
  DB: D1Database;
  OWNER_EMAIL: string;
  GIT_SHA?: string;
  STRAVA_CLIENT_ID?: string;
  STRAVA_CLIENT_SECRET?: string;
  STRAVA_VERIFY_TOKEN?: string;
  TOKEN_ENC_KEY?: string;
  AI?: AiBinding;
  MEDIA?: MediaBucket;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  COACH_MODEL?: string;
}

const app = new Hono<{ Bindings: Env }>();

/** One wide-event JSON line per request (pathname only — no query, no PII). */
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const u = new URL(c.req.url);
  console.log(
    JSON.stringify({
      evt: "http_request",
      method: c.req.method,
      pathname: u.pathname,
      status: c.res.status,
      ms: Date.now() - start,
      ray: c.req.header("cf-ray") ?? null,
      sha: c.env.GIT_SHA || "unstamped",
    }),
  );
});

/** Owner lock: Cloudflare Access injects the authenticated email header.
 *  When present it must be the owner; Access itself blocks everyone else at
 *  the edge (unauthenticated requests never reach this Worker). */
const TOKEN_GATED_PREFIXES = ["/api/import/", "/api/export/health-writeback", "/api/webhooks/", "/api/watch/"];
app.use("/api/*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  // Import / write-back / webhook lanes authenticate with their own tokens
  // (phones and Strava's servers hold no Access session); a dedicated
  // Cloudflare Access bypass application covers exactly those paths, and
  // the handlers enforce the token. Everything else uses the Access identity.
  if (TOKEN_GATED_PREFIXES.some((p) => path.startsWith(p))) return next();
  const email = c.req.header("cf-access-authenticated-user-email");
  if (email && email.toLowerCase() !== (c.env.OWNER_EMAIL ?? "").toLowerCase()) {
    return c.json({ ok: false, error: "forbidden" }, 403);
  }
  await next();
});

// ---------------------------------------------------------------- D1 helpers
type Row = Record<string, unknown>;

async function all(db: D1Database, sql: string, ...bind: unknown[]): Promise<Row[]> {
  try {
    const r = await db.prepare(sql).bind(...bind).all<Row>();
    return r.results ?? [];
  } catch {
    return [];
  }
}
async function first(db: D1Database, sql: string, ...bind: unknown[]): Promise<Row | null> {
  const rows = await all(db, sql, ...bind);
  return rows[0] ?? null;
}

/** Per-day inputs from the imported health_samples store (Apple Health
 *  daily aggregates) — the gauge path for every day without a real RR
 *  measurement. SPEC.md "Aggregate score mappings". */
async function healthDayInputs(db: D1Database): Promise<HealthDay[]> {
  const samples = await all(
    db,
    "SELECT type, value, unit, start_at, end_at, source FROM health_samples ORDER BY start_at ASC LIMIT 10000",
  );
  const sleepRows = await all(db, "SELECT end_at, duration_s FROM sleep LIMIT 500");
  return healthDays(
    samples as unknown as Array<{ type: string; value: number | null; start_at: string; source?: string }>,
    sleepRows as unknown as Array<{ end_at: string; duration_s: number }>,
  );
}

async function todayData(db: D1Database): Promise<TodayData> {
  const history = (await all(
    db,
    "SELECT id, taken_at, source, mean_hr_bpm, rmssd_ms, sdnn_ms, pnn50_pct, baevsky_si, lf_hf_ratio FROM measurements ORDER BY taken_at DESC LIMIT 10",
  )) as Array<Record<string, number | string>>;
  const latest = history[0] ?? null;
  const asc = (await all(
    db,
    "SELECT taken_at, rmssd_ms, baevsky_si, lf_hf_ratio, source FROM measurements ORDER BY taken_at ASC LIMIT 1000",
  )) as unknown as MeasurementLike[];
  // Gauges: one merged per-day series — a real RR measurement wins its
  // day; imported Apple Health daily aggregates fill every other day.
  const hDays = await healthDayInputs(db);
  const gaugeDays = mergeGaugeDays(measurementGaugeDays(asc), scoreHealthDays(hDays));
  const latestGauge = gaugeDays[gaugeDays.length - 1] ?? null;
  const s = latestGauge
    ? { battery: latestGauge.battery, stress: latestGauge.stress, pressure: latestGauge.pressure }
    : { battery: null, stress: null, pressure: null };
  const healthLatest =
    latestGauge?.source === "health"
      ? {
          date: latestGauge.date,
          sdnnMs: latestGauge.hrvMs,
          restingHrBpm: latestGauge.restingHrBpm,
          sleepHours: latestGauge.sleepHours,
          source: hDays.find((d) => d.date === latestGauge.date)?.sdnnSource ?? "Apple Health",
        }
      : null;
  // Rule-based insights (D5) over the same stored data the Lab uses.
  const sleepRows = await all(db, "SELECT end_at, duration_s FROM sleep LIMIT 500");
  const stepRows = await all(db, "SELECT type, value, start_at FROM health_samples WHERE type = 'step_count' LIMIT 2000");
  const journalRows = await all(db, "SELECT created_at, mood, tags_json FROM journal LIMIT 500");
  const breathingRows = await all(db, "SELECT taken_at FROM breathing_sessions LIMIT 500");
  const days = buildLabDays(
    asc,
    sleepRows as unknown as Array<{ end_at: string; duration_s: number }>,
    stepRows as unknown as Array<{ type: string; value: number | null; start_at: string }>,
    journalRows as unknown as Array<{ created_at: string; mood: number; tags_json: string }>,
  );
  const insights = generateInsights(days, new Date().toISOString(), new Set(breathingRows.map((b) => String(b.taken_at).slice(0, 10))));
  const onboardedRow = await first(db, "SELECT value_json FROM settings WHERE key = ?", "onboarded");
  const showWelcome = !history.length && !hDays.length && !(onboardedRow && String(onboardedRow.value_json) === "1");
  return {
    battery: s.battery,
    stress: s.stress,
    pressure: s.pressure,
    latest,
    history,
    insights,
    showWelcome,
    scoreSource: latestGauge?.source ?? null,
    scoreAt: latestGauge?.date ?? null,
    healthLatest,
  };
}

// ---------------------------------------------------------------- pages
app.get("/", async (c) => c.html(todayPage(await todayData(c.env.DB), c.env.GIT_SHA ?? "")));
app.get("/measure", (c) => c.html(measurePage(c.env.GIT_SHA ?? "")));
app.get("/journal", (c) => c.html(journalPage(c.env.GIT_SHA ?? "")));
app.get("/mydata", (c) => c.html(myDataPage(c.env.GIT_SHA ?? "")));
app.get("/more", (c) => c.html(morePage(c.env.GIT_SHA ?? "")));
app.get("/battery", (c) => c.html(scoreDetailPage("battery", c.env.GIT_SHA ?? "")));
app.get("/stress", (c) => c.html(scoreDetailPage("stress", c.env.GIT_SHA ?? "")));
app.get("/pressure", (c) => c.html(scoreDetailPage("pressure", c.env.GIT_SHA ?? "")));
app.get("/impact", (c) => c.html(impactPage(c.env.GIT_SHA ?? "")));
app.get("/sleep", (c) => c.html(sleepPage(c.env.GIT_SHA ?? "")));
app.get("/mydata/:category", (c) => {
  const def = categoryDefs().find((d) => d.key === c.req.param("category"));
  if (!def) return c.html(layout("", "Not found", `<div class="card"><h2>Unknown category</h2><p><a href="/mydata"><button>Back to My Data</button></a></p></div>`, c.env.GIT_SHA ?? ""), 404);
  return c.html(categoryPage(def.key, def.title, c.env.GIT_SHA ?? ""));
});
app.get("/lab", (c) => c.html(labPage(c.env.GIT_SHA ?? "")));
app.get("/coach", (c) => c.html(coachPage(c.env.GIT_SHA ?? "")));
app.get("/stories", (c) => c.html(storiesPage(c.env.GIT_SHA ?? "")));
app.get("/welcome", (c) => c.html(welcomePage(c.env.GIT_SHA ?? "")));
app.get("/tests", (c) => c.html(testsPage(c.env.GIT_SHA ?? "")));
app.get("/themes", (c) => c.html(themesPage(c.env.GIT_SHA ?? "")));
app.get("/about", (c) => c.html(aboutPage(c.env.GIT_SHA ?? "")));

// ---------------------------------------------------------------- PWA assets
app.get("/manifest.webmanifest", (c) =>
  c.body(manifestJson(), 200, { "content-type": "application/manifest+json" }),
);
app.get("/sw.js", (c) => c.body(serviceWorkerJs(), 200, { "content-type": "text/javascript" }));
app.get("/icon.svg", (c) => c.body(ICON_SVG, 200, { "content-type": "image/svg+xml" }));
app.get("/favicon.ico", (c) => c.body(new Blob([FAVICON_ICO], { type: "image/x-icon" }), 200, { "content-type": "image/x-icon" }));
app.get("/apple-touch-icon.png", (c) => c.body(new Blob([APPLE_TOUCH_ICON], { type: "image/png" }), 200, { "content-type": "image/png" }));
app.get("/apple-touch-icon-precomposed.png", (c) => c.body(new Blob([APPLE_TOUCH_ICON], { type: "image/png" }), 200, { "content-type": "image/png" }));

// ---------------------------------------------------------------- discovery
app.get("/api/health", (c) => c.json({ ok: true, app: "openhrv", sha: c.env.GIT_SHA || "unstamped" }));
app.get("/.well-known/webmcp.json", (c) => c.json(webmcpDiscovery(new URL(c.req.url).origin)));
app.get("/robots.txt", (c) => {
  const origin = new URL(c.req.url).origin;
  return c.body(
    [
      "User-agent: *",
      "Allow: /",
      "",
      "# WebMCP discovery",
      `WebMCP: ${origin}/.well-known/webmcp.json`,
      `LLMs: ${origin}/llms.txt`,
      "",
    ].join("\n"),
    200,
    { "content-type": "text/plain" },
  );
});
app.get("/llms.txt", (c) => {
  const origin = new URL(c.req.url).origin;
  return c.body(
    [
      "# OpenHRV",
      "",
      "> Open-source, clean-room HRV / readiness / stress tracker. Single-user instance locked to its owner via Cloudflare Access.",
      "",
      "## Machine interfaces",
      `- WebMCP discovery: ${origin}/.well-known/webmcp.json`,
      `- WebMCP tools endpoint: ${origin}/api/webmcp`,
      `- Health: ${origin}/api/health`,
      "",
      "## Pages",
      `- Today dashboard: ${origin}/`,
      `- Measure: ${origin}/measure`,
      `- Journal: ${origin}/journal`,
      `- My Data: ${origin}/mydata`,
      "",
    ].join("\n"),
    200,
    { "content-type": "text/plain" },
  );
});

// ---------------------------------------------------------------- WebMCP
app.post("/api/webmcp/beacon", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  console.log(JSON.stringify({ evt: "webmcp_beacon", event: body.event ?? null, count: body.count ?? null, pathname: "/api/webmcp/beacon" }));
  return c.body(null, 204);
});
app.get("/api/webmcp", (c) => c.json({ ok: true, tools: WEBMCP_TOOLS }));
app.post("/api/webmcp", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { tool?: string; arguments?: Record<string, unknown> };
  const tool = WEBMCP_TOOLS.find((t) => t.name === body.tool);
  if (!tool) return c.json({ ok: false, error: "unknown tool" }, 404);
  const args = body.arguments ?? {};
  if (tool.name === "openhrv_get_today") return c.json({ ok: true, result: await todayData(c.env.DB) });
  if (tool.name === "openhrv_list_measurements") {
    const limit = Math.min(100, Math.max(1, Number(args.limit ?? 20)));
    return c.json({ ok: true, result: await all(c.env.DB, "SELECT * FROM measurements ORDER BY taken_at DESC LIMIT ?", limit) });
  }
  if (tool.name === "openhrv_get_mydata") return handleMyData(c.env.DB);
  if (tool.name === "openhrv_create_measurement") {
    const rr = Array.isArray(args.rr_ms) ? (args.rr_ms as number[]) : [];
    return storeMeasurement(c, rr, String(args.source ?? "webmcp"));
  }
  return c.json({ ok: false, error: "unhandled tool" }, 400);
});

// ---------------------------------------------------------------- API
async function storeMeasurement(c: { env: Env; json: (o: unknown, s?: number) => Response }, rr: number[], source: string, note = "") {
  let metrics;
  try {
    metrics = computeHrv(rr);
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : "invalid RR data" }, 400);
  }
  const takenAt = new Date().toISOString();
  const info = await c.env.DB.prepare(
    `INSERT INTO measurements (owner, taken_at, source, duration_s, mean_hr_bpm, mean_rr_ms, sdnn_ms, rmssd_ms, pnn50_pct, lf_ms2, hf_ms2, lf_hf_ratio, baevsky_si, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      c.env.OWNER_EMAIL, takenAt, source, Math.round(rr.reduce((a, b) => a + b, 0) / 1000),
      metrics.meanHrBpm, metrics.meanRrMs, metrics.sdnnMs, metrics.rmssdMs, metrics.pnn50Pct,
      metrics.lfMs2, metrics.hfMs2, metrics.lfHfRatio, metrics.baevskySi, note,
    )
    .run();
  const id = info.meta.last_row_id;
  await c.env.DB.prepare("INSERT INTO rr_series (measurement_id, rr_ms_json) VALUES (?, ?)")
    .bind(id, JSON.stringify(rr))
    .run();
  return c.json({ ok: true, id, metrics });
}

app.post("/api/measurements", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { rr_ms?: number[]; rr_text?: string; source?: string; note?: string };
  const rr = Array.isArray(body.rr_ms) ? body.rr_ms : body.rr_text ? parseRrText(body.rr_text) : [];
  if (!rr.length) return c.json({ ok: false, error: "rr_ms array or rr_text required" }, 400);
  return storeMeasurement(c, rr, body.source ?? "manual", body.note ?? "");
});
app.get("/api/measurements", async (c) => {
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 20)));
  return c.json({ ok: true, measurements: await all(c.env.DB, "SELECT * FROM measurements ORDER BY taken_at DESC LIMIT ?", limit) });
});
app.get("/api/measurements/:id", async (c) => {
  const m = await first(c.env.DB, "SELECT * FROM measurements WHERE id = ?", Number(c.req.param("id")));
  if (!m) return c.json({ ok: false, error: "not found" }, 404);
  const rr = await first(c.env.DB, "SELECT rr_ms_json FROM rr_series WHERE measurement_id = ?", Number(c.req.param("id")));
  return c.json({ ok: true, measurement: m, rr_ms: rr ? JSON.parse(String(rr.rr_ms_json)) : [] });
});
app.delete("/api/measurements/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM rr_series WHERE measurement_id = ?").bind(Number(c.req.param("id"))).run();
  await c.env.DB.prepare("DELETE FROM measurements WHERE id = ?").bind(Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

app.get("/api/today", async (c) => c.json({ ok: true, ...(await todayData(c.env.DB)) }));

app.get("/api/journal", async (c) => {
  const rows = await all(c.env.DB, "SELECT * FROM journal ORDER BY created_at DESC LIMIT 50");
  return c.json({
    ok: true,
    entries: rows.map((r) => ({ ...r, tags: JSON.parse(String(r.tags_json ?? "[]")) as string[] })),
  });
});
app.post("/api/journal", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { body?: string; mood?: number; tags?: string[]; voice_note_id?: number | string | null };
  if (!body.body?.trim() && !body.voice_note_id) return c.json({ ok: false, error: "body required" }, 400);
  const info = await c.env.DB.prepare(
    "INSERT INTO journal (owner, created_at, body, mood, tags_json, voice_note_id) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      c.env.OWNER_EMAIL,
      new Date().toISOString(),
      body.body ?? "",
      Math.min(10, Math.max(1, body.mood ?? 5)),
      JSON.stringify(body.tags ?? []),
      body.voice_note_id !== undefined && body.voice_note_id !== null ? String(body.voice_note_id) : null,
    )
    .run();
  return c.json({ ok: true, id: info.meta.last_row_id });
});

app.post("/api/breathing", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { pattern?: string; duration_s?: number };
  const info = await c.env.DB.prepare(
    "INSERT INTO breathing_sessions (owner, taken_at, pattern, duration_s) VALUES (?, ?, ?, ?)",
  )
    .bind(c.env.OWNER_EMAIL, new Date().toISOString(), body.pattern ?? "box-4-4-4-4", body.duration_s ?? 0)
    .run();
  return c.json({ ok: true, id: info.meta.last_row_id });
});

async function handleMyData(db: D1Database) {
  const counts = {
    measurements: Number((await first(db, "SELECT COUNT(*) AS n FROM measurements"))?.n ?? 0),
    sleep: Number((await first(db, "SELECT COUNT(*) AS n FROM sleep"))?.n ?? 0),
    journal: Number((await first(db, "SELECT COUNT(*) AS n FROM journal"))?.n ?? 0),
    breathing: Number((await first(db, "SELECT COUNT(*) AS n FROM breathing_sessions"))?.n ?? 0),
    tests: Number((await first(db, "SELECT COUNT(*) AS n FROM self_tests"))?.n ?? 0),
  };
  const measurements = await all(db, "SELECT id, taken_at, source, mean_hr_bpm, rmssd_ms, sdnn_ms, baevsky_si FROM measurements ORDER BY taken_at DESC LIMIT 50");
  return new Response(JSON.stringify({ ok: true, counts, measurements }), {
    headers: { "content-type": "application/json" },
  });
}
app.get("/api/mydata", async (c) => handleMyData(c.env.DB));

// ---------------------------------------------------------------- scores + impact (D5)
app.get("/api/scores", async (c) => {
  const rows = (await all(
    c.env.DB,
    "SELECT taken_at, rmssd_ms, baevsky_si, lf_hf_ratio, source FROM measurements ORDER BY taken_at ASC LIMIT 1000",
  )) as unknown as MeasurementLike[];
  const hDays = await healthDayInputs(c.env.DB);
  const gaugeDays = mergeGaugeDays(measurementGaugeDays(rows), scoreHealthDays(hDays));
  if (!gaugeDays.length) {
    const empty = { value: null, state: null, at: null, trend: [], contributors: [{ label: "No data", detail: "Take a measurement first" }] };
    return c.json({ ok: true, battery: empty, stress: empty, pressure: empty });
  }
  const latest = gaugeDays[gaugeDays.length - 1];
  const trend = (pick: "battery" | "stress" | "pressure") =>
    gaugeDays.slice(-14).map((p) => ({ at: p.date, value: Math.round(p[pick] * 10) / 10 }));
  const mk = (
    pick: "battery" | "stress" | "pressure",
    stateFn: (v: number) => string,
    contributors: Array<{ label: string; detail: string }>,
    at: string,
  ) => ({
    value: Math.round(latest[pick] * 10) / 10,
    state: stateFn(latest[pick]),
    at,
    trend: trend(pick),
    contributors,
    source: latest.source,
  });
  if (latest.source === "health") {
    // Aggregate-driven day: contributors name the aggregate signals and
    // say so — no SI / LF-HF exists for these days (SPEC aggregate mappings).
    const p = latest.parts!;
    const pts = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(0)} pts`;
    return c.json({
      ok: true,
      battery: mk(
        "battery",
        batteryState,
        [
          {
            label: "HRV (SDNN) vs baseline",
            detail: `${latest.hrvMs.toFixed(0)} ms vs your ${latest.baselineHrvMs !== null ? `${latest.baselineHrvMs.toFixed(0)} ms median` : "—"} (from daily Health aggregates)`,
          },
          {
            label: "Last night's sleep",
            detail:
              latest.sleepHours !== null
                ? `${latest.sleepHours.toFixed(1)} h (${pts(p.sleepAdj)} on Battery)`
                : "No sleep recorded for that morning",
          },
          {
            label: "Resting heart rate",
            detail: latest.restingHrBpm !== null ? `${latest.restingHrBpm.toFixed(0)} bpm (from daily Health aggregates)` : "No resting HR that day",
          },
        ],
        latest.date,
      ),
      stress: mk(
        "stress",
        stressState,
        [
          { label: "HRV (SDNN) component", detail: `${pts(p.stressSdnnTerm)} (from daily Health aggregates)` },
          { label: "Resting HR component", detail: pts(p.stressRhrTerm) },
          { label: "Sleep debt component", detail: `${p.stressSleepTerm.toFixed(0)} pts` },
        ],
        latest.date,
      ),
      pressure: mk(
        "pressure",
        pressureState,
        [
          { label: "Stress-load component", detail: `${(0.55 * latest.stress).toFixed(0)} pts (from daily Health aggregates)` },
          { label: "Sleep-debt component", detail: `${p.pressureSleepTerm.toFixed(0)} pts` },
          { label: "Resting HR component", detail: pts(p.pressureRhrTerm) },
        ],
        latest.date,
      ),
    });
  }
  const scored = scoreSeries(rows);
  const mLatest = scored[scored.length - 1];
  const sleepRows = await all(c.env.DB, "SELECT start_at, end_at, duration_s FROM sleep ORDER BY end_at DESC LIMIT 30");
  const lastSleep = sleepRows[0];
  const sleepHrs = lastSleep ? Number(lastSleep.duration_s) / 3600 : null;
  const medianSleep = sleepRows.length
    ? sleepRows.map((r) => Number(r.duration_s) / 3600).sort((a, b) => a - b)[Math.floor(sleepRows.length / 2)]
    : null;
  const priorStress = scored.length > 1 ? scored.slice(0, -1).reduce((a, p) => a + p.stress, 0) / (scored.length - 1) : null;
  return c.json({
    ok: true,
    battery: mk("battery", batteryState, [
      { label: "Last sleep", detail: sleepHrs !== null ? `${sleepHrs.toFixed(1)} h (your median ${medianSleep?.toFixed(1)} h)` : "No sleep logged yet — import from Apple Health" },
      { label: "Prior stress load", detail: priorStress !== null ? `avg stress ${priorStress.toFixed(0)} before this reading` : "Not enough history yet" },
      { label: "RMSSD vs baseline", detail: `${mLatest.rmssd.toFixed(0)} ms in the latest measurement` },
    ], mLatest.at),
    stress: mk("stress", stressState, [
      { label: "Baevsky stress index", detail: `${mLatest.si.toFixed(0)} (primary driver)` },
      { label: "LF / HF balance", detail: mLatest.lfhf.toFixed(2) },
      { label: "RMSSD", detail: `${mLatest.rmssd.toFixed(1)} ms in the latest measurement` },
    ], mLatest.at),
    pressure: mk("pressure", pressureState, [
      { label: "Stress-index component", detail: `${(mLatest.si / 3.2).toFixed(0)} pts` },
      { label: "LF/HF component", detail: `${Math.max(0, (mLatest.lfhf - 1) * 6).toFixed(0)} pts` },
      { label: "Readings in history", detail: `${scored.length}` },
    ], mLatest.at),
  });
});

/** Day aggregates for factor impact: measurement days merged with
 *  imported-health days (measurement wins its day), so sleep factors
 *  intersect the full imported series — not just measurement days. The
 *  HRV slot carries RMSSD on measurement days and daily SDNN on health
 *  days; `hrvBasis` says which, and the Impact page labels it honestly. */
async function impactDayAggregates(
  db: D1Database,
): Promise<{ days: DayAggregate[]; hrvBasis: "rmssd" | "sdnn" | "mixed" }> {
  const rows = (await all(
    db,
    "SELECT taken_at, rmssd_ms, baevsky_si, lf_hf_ratio FROM measurements ORDER BY taken_at ASC LIMIT 1000",
  )) as unknown as MeasurementLike[];
  const mDays = dailyAggregates(rows);
  const hGauge = scoreHealthDays(await healthDayInputs(db));
  const byDate = new Map<string, DayAggregate>();
  for (const g of hGauge) {
    byDate.set(g.date, { date: g.date, rmssd: g.hrvMs, battery: g.battery, stress: g.stress, pressure: g.pressure, count: 1 });
  }
  for (const d of mDays) byDate.set(d.date, d);
  const days = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  return { days, hrvBasis: mDays.length && hGauge.length ? "mixed" : hGauge.length ? "sdnn" : "rmssd" };
}

async function impactFactors(db: D1Database): Promise<Array<{ name: string; dates: Set<string> }>> {
  const factors: Array<{ name: string; dates: Set<string> }> = [];
  const journal = await all(db, "SELECT created_at, tags_json FROM journal LIMIT 500");
  const tagDates = new Map<string, Set<string>>();
  for (const j of journal) {
    const date = String(j.created_at).slice(0, 10);
    for (const t of JSON.parse(String(j.tags_json ?? "[]")) as string[]) {
      if (!tagDates.has(t)) tagDates.set(t, new Set());
      tagDates.get(t)!.add(date);
    }
  }
  for (const [name, dates] of tagDates) factors.push({ name: `tag: ${name}`, dates });
  const sleepRows = await all(db, "SELECT end_at, duration_s FROM sleep LIMIT 500");
  const goodSleep = new Set<string>();
  const shortSleep = new Set<string>();
  for (const s of sleepRows) {
    const d = String(s.end_at).slice(0, 10);
    const hrs = Number(s.duration_s) / 3600;
    if (hrs >= 7) goodSleep.add(d);
    if (hrs > 0 && hrs < 6) shortSleep.add(d);
  }
  if (goodSleep.size) factors.push({ name: "Sleep 7h+", dates: goodSleep });
  if (shortSleep.size) factors.push({ name: "Short sleep (<6h)", dates: shortSleep });
  return factors;
}

async function computeImpacts(db: D1Database): Promise<FactorImpact[]> {
  const { days } = await impactDayAggregates(db);
  return factorImpact(days, await impactFactors(db));
}

app.get("/api/impact", async (c) => {
  const { days, hrvBasis } = await impactDayAggregates(c.env.DB);
  return c.json({ ok: true, days: days.length, hrvBasis, impacts: factorImpact(days, await impactFactors(c.env.DB)) });
});

// ---------------------------------------------------------------- wave 2: sleep, categories, lab, coach, voice, tests, settings
app.get("/api/sleep", async (c) => {
  const rows = await all(c.env.DB, "SELECT id, start_at, end_at, duration_s, source, stages_json FROM sleep ORDER BY end_at DESC LIMIT 120");
  const stageSamples = await all(
    c.env.DB,
    "SELECT start_at, value, unit, meta_json FROM health_samples WHERE type = ? ORDER BY start_at DESC LIMIT 2000",
    "sleep_analysis",
  );
  const summary = summarizeSleep(
    rows as unknown as Array<{ start_at: string; end_at: string; duration_s: number; source: string; stages_json?: string }>,
    8,
    stageSamples as unknown as Array<{ start_at: string; value: number | null; unit: string; meta_json?: string }>,
  );
  return c.json({ ok: true, summary });
});

app.get("/api/mydata/categories", async (c) => {
  const samples = await all(c.env.DB, "SELECT type, value, unit, start_at, source FROM health_samples ORDER BY start_at DESC LIMIT 10000");
  const typed = samples as unknown as Array<{ type: string; value: number | null; unit: string; start_at: string; source: string }>;
  return c.json({
    ok: true,
    categories: summarizeCategories(typed, new Date().toISOString()),
    bpReadings: bloodPressureReadings(typed),
    recentSamples: typed.slice(0, 200),
  });
});

async function labDays(db: D1Database) {
  const asc = (await all(
    db,
    "SELECT taken_at, rmssd_ms, baevsky_si, lf_hf_ratio, source FROM measurements ORDER BY taken_at ASC LIMIT 1000",
  )) as unknown as MeasurementLike[];
  const sleepRows = await all(db, "SELECT end_at, duration_s FROM sleep LIMIT 500");
  const stepRows = await all(db, "SELECT type, value, start_at FROM health_samples WHERE type = 'step_count' LIMIT 2000");
  const journalRows = await all(db, "SELECT created_at, mood, tags_json FROM journal LIMIT 500");
  return buildLabDays(
    asc,
    sleepRows as unknown as Array<{ end_at: string; duration_s: number }>,
    stepRows as unknown as Array<{ type: string; value: number | null; start_at: string }>,
    journalRows as unknown as Array<{ created_at: string; mood: number; tags_json: string }>,
  );
}

app.get("/api/lab", async (c) => {
  const days = await labDays(c.env.DB);
  const labels: Record<string, string> = {};
  for (const k of ["rmssd", "battery", "stress", "pressure", "sleepHours", "steps", "mood"]) labels[k] = labSeriesLabel(k);
  const tags = new Set<string>();
  for (const d of days) for (const t of d.tags) tags.add(t);
  const enriched = days.map((d) => {
    const rec: Record<string, unknown> = { ...d };
    for (const t of tags) {
      labels[`tag:${t}`] = `tag: ${t}`;
      rec[`tag:${t}`] = d.tags.includes(t) ? 1 : 0;
    }
    return rec;
  });
  return c.json({ ok: true, days: enriched, correlations: correlationPairs(days), labels });
});

async function getFlags(db: D1Database, owner: string): Promise<Record<string, boolean>> {
  const defaults: Record<string, boolean> = { ai_coach: true, science_lab: true, stories: true };
  const raw = await getSetting(db, owner, "feature_flags");
  if (raw) {
    try {
      return { ...defaults, ...(JSON.parse(raw) as Record<string, boolean>) };
    } catch {
      return defaults;
    }
  }
  return defaults;
}

app.post("/api/coach", async (c) => {
  const flags = await getFlags(c.env.DB, c.env.OWNER_EMAIL);
  if (!flags.ai_coach) return c.json({ ok: false, error: "AI Coach is turned off in More → Feature flags." }, 403);
  if (!c.env.AI) return c.json({ ok: false, error: "AI Coach unavailable — the Workers AI binding is not configured on this instance." }, 503);
  const body = (await c.req.json().catch(() => ({}))) as { message?: string; history?: Array<{ role: string; content: string }> };
  if (!body.message?.trim()) return c.json({ ok: false, error: "message required" }, 400);
  const td = await todayData(c.env.DB);
  const days = await labDays(c.env.DB);
  const sleepRows = await all(c.env.DB, "SELECT start_at, end_at, duration_s, source FROM sleep ORDER BY end_at DESC LIMIT 60");
  const sleepSummary = summarizeSleep(
    sleepRows as unknown as Array<{ start_at: string; end_at: string; duration_s: number; source: string }>,
    8,
  );
  const count = async (t: string): Promise<number> => Number((await first(c.env.DB, `SELECT COUNT(*) AS n FROM ${t}`))?.n ?? 0);
  const journalRows = await all(c.env.DB, "SELECT created_at, mood FROM journal ORDER BY created_at DESC LIMIT 14");
  const data: CoachData = {
    battery: td.battery,
    stress: td.stress,
    pressure: td.pressure,
    latestMeasurement: td.latest
      ? {
          taken_at: String(td.latest.taken_at),
          mean_hr_bpm: Number(td.latest.mean_hr_bpm),
          rmssd_ms: Number(td.latest.rmssd_ms),
          sdnn_ms: Number(td.latest.sdnn_ms),
          source: String(td.latest.source),
        }
      : null,
    days: days.slice(-21),
    sleepMedianH: sleepSummary.medianHours,
    sleepLastH: sleepSummary.lastNight?.hours ?? null,
    impacts: await computeImpacts(c.env.DB),
    recentMoods: journalRows.map((j) => ({ date: String(j.created_at).slice(0, 10), mood: Number(j.mood) })),
    counts: {
      measurements: await count("measurements"),
      sleep: await count("sleep"),
      journal: await count("journal"),
      breathing: await count("breathing_sessions"),
      tests: await count("self_tests"),
    },
  };
  const context = buildCoachContext(data);
  const history = (body.history ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-6);
  try {
    const out = (await c.env.AI.run(c.env.COACH_MODEL ?? "@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [
        { role: "system", content: `${COACH_SYSTEM_PROMPT}\n\n${context}` },
        ...history,
        { role: "user", content: body.message },
      ],
    })) as { response?: string };
    const reply = typeof out?.response === "string" ? out.response.trim() : "";
    if (!reply) return c.json({ ok: false, error: "The coach returned an empty answer — try again." }, 502);
    return c.json({ ok: true, reply });
  } catch (e) {
    return c.json({ ok: false, error: `Workers AI call failed: ${e instanceof Error ? e.message : "unknown error"}` }, 502);
  }
});

// --- voice comments (audio in R2, metadata in D1) ---
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

app.post("/api/voice", async (c) => {
  if (!c.env.MEDIA) return c.json({ ok: false, error: "Voice storage is not configured on this instance (R2 bucket missing)." }, 501);
  const form = await c.req.formData().catch(() => null);
  const f = form?.get("file");
  if (!f || typeof f === "string") return c.json({ ok: false, error: "audio file required" }, 400);
  const buf = await f.arrayBuffer();
  if (buf.byteLength > 10 * 1024 * 1024) return c.json({ ok: false, error: "voice note too large (10 MB max)" }, 413);
  const mime = f.type || "audio/webm";
  const key = `voice/${Date.now()}-${crypto.randomUUID()}`;
  await c.env.MEDIA.put(key, buf, { httpMetadata: { contentType: mime } });
  const info = await c.env.DB.prepare("INSERT INTO voice_notes (owner, r2_key, mime, duration_s) VALUES (?, ?, ?, ?)")
    .bind(c.env.OWNER_EMAIL, key, mime, Number(form?.get("duration_s") ?? 0) || 0)
    .run();
  const id = info.meta.last_row_id;
  let transcript: string | null = null;
  if (c.env.AI) {
    try {
      const out = (await c.env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio: arrayBufferToBase64(buf) })) as { text?: string };
      if (out?.text) {
        transcript = out.text;
        await c.env.DB.prepare("UPDATE voice_notes SET transcript = ? WHERE id = ?").bind(transcript, id).run();
      }
    } catch {
      transcript = null; // transcription is best-effort; the audio is the record
    }
  }
  return c.json({ ok: true, id, transcript });
});
app.get("/api/voice", async (c) => {
  const rows = await all(c.env.DB, "SELECT id, mime, duration_s, transcript, created_at FROM voice_notes ORDER BY created_at DESC LIMIT 50");
  return c.json({ ok: true, notes: rows });
});
app.get("/api/voice/:id/audio", async (c) => {
  if (!c.env.MEDIA) return c.json({ ok: false, error: "media not configured" }, 501);
  const row = await first(c.env.DB, "SELECT r2_key, mime FROM voice_notes WHERE id = ?", Number(c.req.param("id")));
  if (!row) return c.json({ ok: false, error: "not found" }, 404);
  const obj = await c.env.MEDIA.get(String(row.r2_key));
  if (!obj) return c.json({ ok: false, error: "audio missing" }, 404);
  return new Response(obj.body, { headers: { "content-type": String(row.mime) || "audio/webm" } });
});
app.delete("/api/voice/:id", async (c) => {
  const row = await first(c.env.DB, "SELECT r2_key FROM voice_notes WHERE id = ?", Number(c.req.param("id")));
  if (row && c.env.MEDIA) await c.env.MEDIA.delete(String(row.r2_key)).catch(() => {});
  await c.env.DB.prepare("DELETE FROM voice_notes WHERE id = ?").bind(Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

// --- self-tests (Self-Discovery set) ---
const SELF_TEST_TYPES = ["reaction_time", "finger_tapping", "breath_hold", "orthostatic", "hrv_episode"];
app.post("/api/self-tests", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { test_type?: string; result?: Record<string, unknown> };
  if (!body.test_type || !SELF_TEST_TYPES.includes(body.test_type)) {
    return c.json({ ok: false, error: `test_type must be one of ${SELF_TEST_TYPES.join(", ")}` }, 400);
  }
  if (!body.result || typeof body.result !== "object") return c.json({ ok: false, error: "result object required" }, 400);
  const info = await c.env.DB.prepare("INSERT INTO self_tests (owner, taken_at, test_type, result_json) VALUES (?, ?, ?, ?)")
    .bind(c.env.OWNER_EMAIL, new Date().toISOString(), body.test_type, JSON.stringify(body.result))
    .run();
  return c.json({ ok: true, id: info.meta.last_row_id });
});
app.get("/api/self-tests", async (c) => {
  const type = c.req.query("type");
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 30)));
  const rows = type
    ? await all(c.env.DB, "SELECT * FROM self_tests WHERE test_type = ? ORDER BY taken_at DESC LIMIT ?", type, limit)
    : await all(c.env.DB, "SELECT * FROM self_tests ORDER BY taken_at DESC LIMIT ?", limit);
  return c.json({
    ok: true,
    tests: rows.map((r) => ({ ...r, result: JSON.parse(String(r.result_json ?? "{}")) as Record<string, unknown> })),
  });
});

// --- settings: flags, theme, onboarding, feedback ---
app.get("/api/settings/flags", async (c) => c.json({ ok: true, flags: await getFlags(c.env.DB, c.env.OWNER_EMAIL) }));
app.post("/api/settings/flags", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const flags = await getFlags(c.env.DB, c.env.OWNER_EMAIL);
  for (const k of ["ai_coach", "science_lab", "stories"]) if (typeof body[k] === "boolean") flags[k] = body[k] as boolean;
  await setSetting(c.env.DB, c.env.OWNER_EMAIL, "feature_flags", JSON.stringify(flags));
  return c.json({ ok: true, flags });
});
app.post("/api/settings/theme", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { theme?: string };
  if (body.theme) await setSetting(c.env.DB, c.env.OWNER_EMAIL, "theme", String(body.theme));
  return c.json({ ok: true });
});
app.get("/api/settings/onboarded", async (c) => {
  const v = await getSetting(c.env.DB, c.env.OWNER_EMAIL, "onboarded");
  return c.json({ ok: true, onboarded: v === "1" });
});
app.post("/api/settings/onboarded", async (c) => {
  await setSetting(c.env.DB, c.env.OWNER_EMAIL, "onboarded", "1");
  return c.json({ ok: true });
});
app.post("/api/feedback", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { text?: string };
  if (!body.text?.trim()) return c.json({ ok: false, error: "text required" }, 400);
  await c.env.DB.prepare("INSERT INTO events (owner, kind, detail_json) VALUES (?, 'feedback', ?)")
    .bind(c.env.OWNER_EMAIL, JSON.stringify({ text: body.text.slice(0, 4000) }))
    .run();
  return c.json({ ok: true });
});

// --- delete my data (profile/settings row 47) ---
app.post("/api/account/delete", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { confirm?: string };
  if (body.confirm !== "DELETE") return c.json({ ok: false, error: "confirm must be the exact string DELETE" }, 400);
  const owner = c.env.OWNER_EMAIL;
  const deleted: Record<string, number> = {};
  const voices = await all(c.env.DB, "SELECT r2_key FROM voice_notes WHERE owner = ?", owner);
  if (c.env.MEDIA) {
    for (const v of voices) await c.env.MEDIA.delete(String(v.r2_key)).catch(() => {});
  }
  const measurementIds = await all(c.env.DB, "SELECT id FROM measurements WHERE owner = ?", owner);
  for (const m of measurementIds) {
    await c.env.DB.prepare("DELETE FROM rr_series WHERE measurement_id = ?").bind(Number(m.id)).run();
  }
  for (const t of [
    "measurements",
    "sleep",
    "journal",
    "breathing_sessions",
    "self_tests",
    "health_samples",
    "push_subscriptions",
    "notification_prefs",
    "notification_log",
    "voice_notes",
    "strava_tokens",
    "settings",
    "events",
  ]) {
    const r = await c.env.DB.prepare(`DELETE FROM ${t} WHERE owner = ?`).bind(owner).run();
    deleted[t] = r.meta.changes ?? 0;
  }
  return c.json({ ok: true, deleted });
});

// ---------------------------------------------------------------- push + notifications (D6)
function vapidKeys(env: Env): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return null;
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
}

async function loadNotificationConfig(db: D1Database, owner: string): Promise<NotificationConfig> {
  const cfg: NotificationConfig = JSON.parse(JSON.stringify(DEFAULT_NOTIFICATION_CONFIG)) as NotificationConfig;
  const rows = await all(db, "SELECT type, enabled FROM notification_prefs WHERE owner = ?", owner);
  for (const r of rows) {
    const t = String(r.type) as NotificationType;
    if (t in cfg.enabled) cfg.enabled[t] = Number(r.enabled) === 1;
  }
  const raw = await getSetting(db, owner, "notification_config");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { times?: Record<string, string>; timeZone?: string };
      if (parsed.times) cfg.times = { ...cfg.times, ...parsed.times };
      if (parsed.timeZone) cfg.timeZone = parsed.timeZone;
    } catch {
      /* keep defaults */
    }
  }
  return cfg;
}

async function dispatchNotification(
  env: Env,
  type: string,
  title: string,
  body: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Array<{ endpoint_host: string; status: string; http_status: number | null }>> {
  const keys = vapidKeys(env);
  const results: Array<{ endpoint_host: string; status: string; http_status: number | null }> = [];
  if (!keys) return results;
  const subs = await all(env.DB, "SELECT endpoint, keys_json FROM push_subscriptions WHERE owner = ?", env.OWNER_EMAIL);
  const payload = JSON.stringify({ title, body, url: "/", type });
  for (const s of subs) {
    const endpoint = String(s.endpoint);
    let host = "";
    try {
      host = new URL(endpoint).host;
    } catch {
      host = "";
    }
    let status = "failed";
    let httpStatus: number | null = null;
    let detail = "";
    try {
      const kj = JSON.parse(String(s.keys_json)) as { p256dh: string; auth: string };
      const res = await sendWebPush(keys, { endpoint, p256dh: kj.p256dh, auth: kj.auth }, payload, fetchImpl);
      httpStatus = res.status;
      detail = `push service HTTP ${res.status}`;
      if (res.ok) status = "sent";
      else if (res.status === 404 || res.status === 410) {
        status = "gone";
        await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(endpoint).run();
      }
    } catch (e) {
      detail = e instanceof Error ? e.message : "send error";
    }
    try {
      await env.DB
        .prepare("INSERT INTO notification_log (owner, at, type, title, body, endpoint_host, status, http_status, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(env.OWNER_EMAIL, new Date().toISOString(), type, title, body, host, status, httpStatus, detail)
        .run();
    } catch {
      /* log table missing in unit envs — dispatch result still returned */
    }
    results.push({ endpoint_host: host, status, http_status: httpStatus });
  }
  return results;
}

/** The cron entry: evaluate the notification rules and dispatch what's due. */
export async function runScheduled(env: Env, fetchImpl: typeof fetch = fetch): Promise<{ due: string[]; sent: number }> {
  const owner = env.OWNER_EMAIL;
  const keys = vapidKeys(env);
  const cfg = await loadNotificationConfig(env.DB, owner);
  const subs = await all(env.DB, "SELECT endpoint FROM push_subscriptions WHERE owner = ?", owner);
  if (!keys || !subs.length) {
    console.log(JSON.stringify({ evt: "scheduled_skip", reason: !keys ? "vapid_not_configured" : "no_subscriptions" }));
    return { due: [], sent: 0 };
  }
  const now = new Date();
  const { date: localDate, minutes } = localParts(now, cfg.timeZone);
  const localDateOf = (iso: string): string => localParts(new Date(iso), cfg.timeZone).date;
  const measurements = (await all(
    env.DB,
    "SELECT taken_at, rmssd_ms, baevsky_si, lf_hf_ratio FROM measurements ORDER BY taken_at ASC LIMIT 1000",
  )) as unknown as MeasurementLike[];
  const scored = scoreSeries(measurements);
  const todays = scored.filter((p) => localDateOf(p.at) === localDate);
  const latestToday = todays[todays.length - 1] ?? null;
  const breathing = await all(env.DB, "SELECT taken_at FROM breathing_sessions ORDER BY taken_at DESC LIMIT 100");
  const hasBreathingToday = breathing.some((b) => localDateOf(String(b.taken_at)) === localDate);
  const logRows = await all(env.DB, "SELECT type, at, status FROM notification_log WHERE owner = ? ORDER BY at DESC LIMIT 100", owner);
  const sentToday = new Set(
    logRows.filter((r) => String(r.status) === "sent" && localDateOf(String(r.at)) === localDate).map((r) => String(r.type)),
  ) as Set<NotificationType>;
  const lastLow = logRows.find((r) => String(r.type) === "low_battery" && String(r.status) === "sent");
  const due = dueNotifications(cfg, {
    localDate,
    localMinutes: minutes,
    hasMeasurementToday: todays.length > 0,
    hasBreathingToday,
    battery: latestToday?.battery ?? null,
    batteryAt: latestToday?.at ?? null,
    stress: latestToday?.stress ?? null,
    sentToday,
    lastLowBatteryAt: lastLow ? String(lastLow.at) : null,
    nowIso: now.toISOString(),
  });
  let sent = 0;
  for (const n of due) {
    const res = await dispatchNotification(env, n.type, n.title, n.body, fetchImpl);
    sent += res.filter((r) => r.status === "sent").length;
  }
  console.log(JSON.stringify({ evt: "scheduled_notifications", due: due.map((d) => d.type), sent }));
  return { due: due.map((d) => d.type), sent };
}

app.get("/api/push/vapid-public-key", (c) => {
  const keys = vapidKeys(c.env);
  return c.json(keys ? { ok: true, configured: true, publicKey: keys.publicKey } : { ok: true, configured: false });
});
app.post("/api/push/subscribe", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
    p256dh?: string;
    auth?: string;
  };
  const sub = body.subscription ?? body;
  const endpoint = sub.endpoint ?? "";
  const p256dh = sub.keys?.p256dh ?? body.p256dh ?? "";
  const auth = sub.keys?.auth ?? body.auth ?? "";
  if (!endpoint.startsWith("https://") || !p256dh || !auth) {
    return c.json({ ok: false, error: "subscription endpoint + keys.p256dh + keys.auth required" }, 400);
  }
  await c.env.DB.prepare(
    "INSERT INTO push_subscriptions (owner, endpoint, keys_json) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET owner = excluded.owner, keys_json = excluded.keys_json",
  )
    .bind(c.env.OWNER_EMAIL, endpoint, JSON.stringify({ p256dh, auth }))
    .run();
  return c.json({ ok: true });
});
app.delete("/api/push/subscribe", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { endpoint?: string };
  if (!body.endpoint) return c.json({ ok: false, error: "endpoint required" }, 400);
  await c.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(body.endpoint).run();
  return c.json({ ok: true });
});
app.get("/api/push/subscriptions", async (c) => {
  const rows = await all(c.env.DB, "SELECT endpoint, created_at FROM push_subscriptions WHERE owner = ?", c.env.OWNER_EMAIL);
  return c.json({
    ok: true,
    count: rows.length,
    subscriptions: rows.map((r) => {
      let host = "";
      try {
        host = new URL(String(r.endpoint)).host;
      } catch {
        host = "";
      }
      return { host, created_at: r.created_at };
    }),
  });
});

app.get("/api/notifications/config", async (c) => {
  const cfg = await loadNotificationConfig(c.env.DB, c.env.OWNER_EMAIL);
  return c.json({
    ok: true,
    timeZone: cfg.timeZone,
    types: NOTIFICATION_TYPES.map((t) => ({ type: t.type, label: t.label, enabled: cfg.enabled[t.type], time: cfg.times[t.type] ?? "" })),
  });
});
app.post("/api/notifications/config", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { type?: string; enabled?: boolean; time?: string; timeZone?: string };
  const cfg = await loadNotificationConfig(c.env.DB, c.env.OWNER_EMAIL);
  if (body.type && NOTIFICATION_TYPES.some((t) => t.type === body.type)) {
    const type = body.type as NotificationType;
    if (typeof body.enabled === "boolean") {
      await c.env.DB
        .prepare("INSERT INTO notification_prefs (owner, type, enabled) VALUES (?, ?, ?) ON CONFLICT(owner, type) DO UPDATE SET enabled = excluded.enabled")
        .bind(c.env.OWNER_EMAIL, type, body.enabled ? 1 : 0)
        .run();
      cfg.enabled[type] = body.enabled;
    }
    if (typeof body.time === "string" && /^\d{1,2}:\d{2}$/.test(body.time)) cfg.times[type] = body.time;
  }
  if (typeof body.timeZone === "string" && body.timeZone) cfg.timeZone = body.timeZone;
  await setSetting(c.env.DB, c.env.OWNER_EMAIL, "notification_config", JSON.stringify({ times: cfg.times, timeZone: cfg.timeZone }));
  return c.json({ ok: true, timeZone: cfg.timeZone, types: NOTIFICATION_TYPES.map((t) => ({ type: t.type, label: t.label, enabled: cfg.enabled[t.type], time: cfg.times[t.type] ?? "" })) });
});
app.post("/api/notifications/test", async (c) => {
  if (!vapidKeys(c.env)) return c.json({ ok: false, error: "Push is not configured on this instance (VAPID secrets missing)." }, 400);
  const subs = await all(c.env.DB, "SELECT endpoint FROM push_subscriptions WHERE owner = ?", c.env.OWNER_EMAIL);
  if (!subs.length) return c.json({ ok: false, error: "No push subscription yet — enable notifications on a device first (More → Notifications)." }, 400);
  const results = await dispatchNotification(c.env, "test", "OpenHRV test notification", "Push is working — this is your test notification from OpenHRV.");
  return c.json({ ok: true, results });
});
app.get("/api/notifications/log", async (c) => {
  const rows = await all(c.env.DB, "SELECT at, type, title, endpoint_host, status, http_status, detail FROM notification_log WHERE owner = ? ORDER BY at DESC LIMIT 30", c.env.OWNER_EMAIL);
  return c.json({ ok: true, log: rows });
});

// --- Watch companion lanes (D7): the watch app holds no Access session, so
// it authenticates with the same per-owner import token as the phone lanes. ---
app.get("/api/watch/today", async (c) => {
  if (!(await verifyImportToken(c))) return c.json({ ok: false, error: "bad import token" }, 401);
  const td = await todayData(c.env.DB);
  return c.json({ ok: true, battery: td.battery, stress: td.stress, pressure: td.pressure, latest: td.latest });
});
app.post("/api/watch/measurements", async (c) => {
  if (!(await verifyImportToken(c))) return c.json({ ok: false, error: "bad import token" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as { rr_ms?: number[]; rr_text?: string; source?: string };
  const rr = Array.isArray(body.rr_ms) ? body.rr_ms : body.rr_text ? parseRrText(body.rr_text) : [];
  if (!rr.length) return c.json({ ok: false, error: "rr_ms array or rr_text required" }, 400);
  return storeMeasurement(c, rr, body.source ?? "watch");
});

// ---------------------------------------------------------------- connectors (D4/D9)
async function getSetting(db: D1Database, owner: string, key: string): Promise<string | null> {
  const r = await first(db, "SELECT value_json FROM settings WHERE owner = ? AND key = ?", owner, key);
  return r ? String(r.value_json) : null;
}
async function setSetting(db: D1Database, owner: string, key: string, value: string): Promise<void> {
  await db
    .prepare("INSERT INTO settings (owner, key, value_json) VALUES (?, ?, ?) ON CONFLICT(owner, key) DO UPDATE SET value_json = excluded.value_json")
    .bind(owner, key, value)
    .run();
}
async function getImportToken(db: D1Database, owner: string, create = false): Promise<string | null> {
  const existing = await getSetting(db, owner, "import_token");
  if (existing) return existing;
  if (!create) return null;
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  await setSetting(db, owner, "import_token", token);
  return token;
}
async function verifyImportToken(c: { env: Env; req: { header: (n: string) => string | undefined; query: (n: string) => string | undefined } }): Promise<boolean> {
  const presented =
    c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? c.req.header("x-import-token") ?? c.req.query("token") ?? "";
  const expected = await getImportToken(c.env.DB, c.env.OWNER_EMAIL);
  return Boolean(expected) && presented.length > 0 && presented === expected;
}
async function insertSamples(db: D1Database, owner: string, samples: NormalizedSample[]): Promise<number> {
  if (!samples.length) return 0;
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO health_samples (owner, type, value, unit, start_at, end_at, source, external_id, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const batch = samples.slice(0, 2000).map((s) =>
    stmt.bind(owner, s.type, s.value, s.unit, s.start_at, s.end_at, s.source, s.external_id, JSON.stringify(s.meta)),
  );
  const results = await db.batch(batch);
  return results.reduce((a, r) => a + (r.meta.changes ?? 0), 0);
}

app.get("/api/settings/import-token", async (c) => {
  const token = await getImportToken(c.env.DB, c.env.OWNER_EMAIL, true);
  const origin = new URL(c.req.url).origin;
  return c.json({
    ok: true,
    token,
    health_auto_export_url: `${origin}/api/import/health-auto-export`,
    shortcut_url: `${origin}/api/import/shortcut`,
    writeback_url: `${origin}/api/export/health-writeback`,
    instructions:
      "Health Auto Export app: REST API export → URL above, header 'Authorization: Bearer <token>', JSON format, choose the metrics you want automated. iOS Shortcut: POST JSON samples to the Shortcut URL with the same header.",
  });
});
app.post("/api/settings/import-token/regenerate", async (c) => {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  await setSetting(c.env.DB, c.env.OWNER_EMAIL, "import_token", token);
  return c.json({ ok: true, token });
});

app.post("/api/import/health-auto-export", async (c) => {
  if (!(await verifyImportToken(c))) return c.json({ ok: false, error: "bad import token" }, 401);
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ ok: false, error: "JSON body required" }, 400);
  const samples = parseHealthAutoExport(body);
  const inserted = await insertSamples(c.env.DB, c.env.OWNER_EMAIL, samples);
  let sleepInserted = 0;
  for (const s of samples) {
    if (s.type === "sleep_analysis" && s.meta.sleepStart && s.meta.sleepEnd) {
      const start = String(s.meta.sleepStart);
      const end = String(s.meta.sleepEnd);
      const dur = Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 1000);
      if (dur > 0) {
        await c.env.DB.prepare("INSERT INTO sleep (owner, start_at, end_at, duration_s, source) VALUES (?, ?, ?, ?, ?)")
          .bind(c.env.OWNER_EMAIL, start, end, Math.round(dur), "health_auto_export")
          .run();
        sleepInserted++;
      }
    }
  }
  return c.json({ ok: true, received: samples.length, inserted, sleep_records: sleepInserted });
});
app.post("/api/import/shortcut", async (c) => {
  if (!(await verifyImportToken(c))) return c.json({ ok: false, error: "bad import token" }, 401);
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ ok: false, error: "JSON body required" }, 400);
  const samples = parseShortcutJson(body);
  const inserted = await insertSamples(c.env.DB, c.env.OWNER_EMAIL, samples);
  return c.json({ ok: true, received: samples.length, inserted });
});
app.post("/api/import/export-xml", async (c) => {
  const fromSession = Boolean(c.req.header("cf-access-authenticated-user-email"));
  if (!fromSession && !(await verifyImportToken(c))) return c.json({ ok: false, error: "auth required" }, 401);
  let xml = "";
  const ct = c.req.header("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const form = await c.req.formData().catch(() => null);
    const f = form?.get("file");
    if (f && typeof f !== "string") xml = await f.text();
  } else {
    xml = await c.req.text();
  }
  if (!xml.includes("<Record")) return c.json({ ok: false, error: "no <Record> elements found — is this an Apple Health export.xml?" }, 400);
  const samples = parseExportXml(xml);
  const inserted = await insertSamples(c.env.DB, c.env.OWNER_EMAIL, samples);
  return c.json({ ok: true, parsed: samples.length, inserted, note: "parser cap 5000 records per upload" });
});
app.get("/api/samples", async (c) => {
  const type = c.req.query("type");
  const limit = Math.min(500, Math.max(1, Number(c.req.query("limit") ?? 100)));
  const rows = type
    ? await all(c.env.DB, "SELECT * FROM health_samples WHERE type = ? ORDER BY start_at DESC LIMIT ?", type, limit)
    : await all(c.env.DB, "SELECT * FROM health_samples ORDER BY start_at DESC LIMIT ?", limit);
  return c.json({ ok: true, samples: rows });
});

app.get("/api/export/health-writeback", async (c) => {
  if (!(await verifyImportToken(c))) return c.json({ ok: false, error: "bad import token" }, 401);
  const feed: Array<Record<string, unknown>> = [];
  const breathing = await all(c.env.DB, "SELECT taken_at, duration_s FROM breathing_sessions ORDER BY taken_at DESC LIMIT 100");
  for (const b of breathing) {
    feed.push({ action: "log_health_sample", category: "MindfulSession", type: "mindful_minutes", value: Math.round(Number(b.duration_s) / 60), unit: "min", start: b.taken_at, end: b.taken_at, source: "openhrv:breathing" });
  }
  const measurements = await all(c.env.DB, "SELECT taken_at, sdnn_ms, mean_hr_bpm FROM measurements ORDER BY taken_at DESC LIMIT 100");
  for (const m of measurements) {
    feed.push({ action: "log_health_sample", quantity: "HeartRateVariabilitySDNN", type: "hrv_sdnn", value: Math.round(Number(m.sdnn_ms) * 10) / 10, unit: "ms", start: m.taken_at, end: m.taken_at, source: "openhrv:measurement" });
    feed.push({ action: "log_health_sample", quantity: "HeartRate", type: "heart_rate", value: Math.round(Number(m.mean_hr_bpm)), unit: "count/min", start: m.taken_at, end: m.taken_at, source: "openhrv:measurement" });
  }
  const sleeps = await all(c.env.DB, "SELECT start_at, end_at FROM sleep WHERE source = 'manual' ORDER BY end_at DESC LIMIT 30");
  for (const s of sleeps) {
    feed.push({ action: "log_health_sample", category: "SleepAnalysis", type: "sleep_analysis", value: "Asleep", start: s.start_at, end: s.end_at, source: "openhrv:sleep" });
  }
  return c.json({
    ok: true,
    generated_at: new Date().toISOString(),
    note: "A Worker cannot write HealthKit directly. Feed this list to the OpenHRV Write-Back Shortcut (recipe below), which uses Shortcuts' Log Health Sample action; automatic native write-back arrives with the D7 companion app.",
    shortcut_recipe: [
      "Create a Shortcut named 'OpenHRV Write-Back'.",
      "Add 'Get Contents of URL': the writeback URL shown in Settings, header Authorization: Bearer <your import token>.",
      "Add 'Get Dictionary from Input', then 'Repeat with Each' over the 'feed' list.",
      "Inside the repeat: 'Log Health Sample' with Type/value/start from the dictionary item (MindfulSession for mindful_minutes, Heart Rate Variability for hrv_sdnn, Heart Rate for heart_rate, Sleep for sleep_analysis).",
      "Run it manually or on a daily automation.",
    ],
    feed,
  });
});
app.get("/api/export/data.json", async (c) => {
  const data = {
    exported_at: new Date().toISOString(),
    measurements: await all(c.env.DB, "SELECT * FROM measurements ORDER BY taken_at"),
    samples: await all(c.env.DB, "SELECT * FROM health_samples ORDER BY start_at LIMIT 10000"),
    journal: await all(c.env.DB, "SELECT * FROM journal ORDER BY created_at"),
    sleep: await all(c.env.DB, "SELECT * FROM sleep ORDER BY start_at"),
    breathing_sessions: await all(c.env.DB, "SELECT * FROM breathing_sessions ORDER BY taken_at"),
  };
  return new Response(JSON.stringify(data, null, 1), {
    headers: { "content-type": "application/json", "content-disposition": "attachment; filename=openhrv-export.json" },
  });
});
app.get("/api/export/data.csv", async (c) => {
  const ms = await all(c.env.DB, "SELECT * FROM measurements ORDER BY taken_at");
  const head = "id,taken_at,source,mean_hr_bpm,mean_rr_ms,sdnn_ms,rmssd_ms,pnn50_pct,lf_ms2,hf_ms2,lf_hf_ratio,baevsky_si,note";
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = ms.map((m) => [m.id, m.taken_at, m.source, m.mean_hr_bpm, m.mean_rr_ms, m.sdnn_ms, m.rmssd_ms, m.pnn50_pct, m.lf_ms2, m.hf_ms2, m.lf_hf_ratio, m.baevsky_si, m.note].map(esc).join(","));
  return new Response([head, ...lines].join("\n"), {
    headers: { "content-type": "text/csv", "content-disposition": "attachment; filename=openhrv-measurements.csv" },
  });
});

// --- Strava (D9) ---
app.get("/connect/strava/status", async (c) => {
  const configured = stravaConfigured(c.env);
  const row = configured ? await first(c.env.DB, "SELECT athlete_id, updated_at FROM strava_tokens WHERE owner = ?", c.env.OWNER_EMAIL) : null;
  return c.json({
    ok: true,
    configured,
    connected: Boolean(row),
    athlete_id: row?.athlete_id ?? null,
    state: !configured
      ? "needs_keys: set STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_VERIFY_TOKEN and TOKEN_ENC_KEY as Worker secrets (wrangler secret put) using your own Strava API app, then reconnect."
      : row
        ? "connected"
        : "ready_to_connect",
  });
});
app.get("/connect/strava", (c) => {
  if (!stravaConfigured(c.env)) {
    return c.html(
      layout("", "Strava", `<div class="card"><h2>Strava needs your API keys</h2><p class="sub">Create a Strava API application (strava.com/settings/api), then set these Worker secrets: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_VERIFY_TOKEN, TOKEN_ENC_KEY. OpenHRV never ships shared credentials — your instance uses your own Strava app.</p><p><a href="/more"><button class="ghost">Back to settings</button></a></p></div>`, c.env.GIT_SHA ?? ""),
    );
  }
  const redirect = `${new URL(c.req.url).origin}/connect/strava/callback`;
  return c.redirect(stravaAuthorizeUrl(c.env, redirect));
});
app.get("/connect/strava/callback", async (c) => {
  const code = c.req.query("code");
  if (!code || !stravaConfigured(c.env)) return c.json({ ok: false, error: "missing code or Strava not configured" }, 400);
  if (!c.env.TOKEN_ENC_KEY) return c.json({ ok: false, error: "TOKEN_ENC_KEY secret required to store tokens encrypted" }, 500);
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: c.env.STRAVA_CLIENT_ID, client_secret: c.env.STRAVA_CLIENT_SECRET, code, grant_type: "authorization_code" }),
  });
  const tok = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_at?: number; athlete?: { id?: number } };
  if (!res.ok || !tok.access_token || !tok.refresh_token) return c.json({ ok: false, error: "strava token exchange failed" }, 502);
  await c.env.DB.prepare(
    "INSERT INTO strava_tokens (owner, athlete_id, access_token_enc, refresh_token_enc, expires_at, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(owner) DO UPDATE SET athlete_id = excluded.athlete_id, access_token_enc = excluded.access_token_enc, refresh_token_enc = excluded.refresh_token_enc, expires_at = excluded.expires_at, updated_at = datetime('now')",
  )
    .bind(c.env.OWNER_EMAIL, String(tok.athlete?.id ?? ""), await encryptToken(c.env, tok.access_token), await encryptToken(c.env, tok.refresh_token), tok.expires_at ?? 0)
    .run();
  return c.redirect("/more?strava=connected");
});
app.post("/connect/strava/sync", async (c) => {
  if (!stravaConfigured(c.env) || !c.env.TOKEN_ENC_KEY) return c.json({ ok: false, error: "strava not configured" }, 400);
  const row = await first(c.env.DB, "SELECT * FROM strava_tokens WHERE owner = ?", c.env.OWNER_EMAIL);
  if (!row) return c.json({ ok: false, error: "not connected" }, 400);
  let access = await decryptToken(c.env, String(row.access_token_enc));
  if (Number(row.expires_at) * 1000 < Date.now() + 60000) {
    const refresh = await decryptToken(c.env, String(row.refresh_token_enc));
    const res = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: c.env.STRAVA_CLIENT_ID, client_secret: c.env.STRAVA_CLIENT_SECRET, refresh_token: refresh, grant_type: "refresh_token" }),
    });
    const tok = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_at?: number };
    if (!res.ok || !tok.access_token || !tok.refresh_token) return c.json({ ok: false, error: "strava refresh failed" }, 502);
    access = tok.access_token;
    await c.env.DB.prepare("UPDATE strava_tokens SET access_token_enc = ?, refresh_token_enc = ?, expires_at = ?, updated_at = datetime('now') WHERE owner = ?")
      .bind(await encryptToken(c.env, tok.access_token), await encryptToken(c.env, tok.refresh_token), tok.expires_at ?? 0, c.env.OWNER_EMAIL)
      .run();
  }
  const res = await fetch("https://www.strava.com/api/v3/athlete/activities?per_page=50", { headers: { authorization: `Bearer ${access}` } });
  if (!res.ok) return c.json({ ok: false, error: `strava activities fetch failed: ${res.status}` }, 502);
  const acts = (await res.json()) as Array<Record<string, unknown>>;
  const samples = acts.map(stravaActivitySample) as unknown as NormalizedSample[];
  const inserted = await insertSamples(c.env.DB, c.env.OWNER_EMAIL, samples);
  return c.json({ ok: true, fetched: acts.length, inserted });
});
app.get("/api/webhooks/strava", (c) => {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");
  if (mode === "subscribe" && c.env.STRAVA_VERIFY_TOKEN && token === c.env.STRAVA_VERIFY_TOKEN && challenge) {
    return c.json({ "hub.challenge": challenge });
  }
  return c.json({ ok: false, error: "verification failed" }, 403);
});
app.post("/api/webhooks/strava", async (c) => {
  const evt = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  await c.env.DB.prepare("INSERT INTO events (owner, kind, detail_json) VALUES (?, 'strava_webhook', ?)")
    .bind(c.env.OWNER_EMAIL, JSON.stringify(evt))
    .run();
  // Pull happens on the next owner-initiated sync (or immediately when the
  // connector is fully configured — the event is durably queued either way).
  return c.json({ ok: true, queued: true });
});

// Fallback shell for unknown paths (keeps PWA nav coherent).
app.notFound((c) => {
  if (new URL(c.req.url).pathname.startsWith("/api/")) return c.json({ ok: false, error: "not found" }, 404);
  return c.html(layout("", "OpenHRV", `<div class="card"><h2>Not found</h2><p class="sub">That page does not exist.</p><p><a href="/"><button>Go to Today</button></a></p></div>`, c.env.GIT_SHA ?? ""), 404);
});

export { app };

/** Worker entry: Hono fetch handler + the D6 cron scheduler. */
export default {
  fetch: app.fetch,
  scheduled: (_event: unknown, env: Env, ctx: { waitUntil: (p: Promise<unknown>) => void }): void => {
    ctx.waitUntil(runScheduled(env));
  },
};
