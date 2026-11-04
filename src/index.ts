import { Hono } from "hono";
import { computeHrv, parseRrText } from "./hrv";
import {
  ICON_SVG,
  journalPage,
  layout,
  manifestJson,
  measurePage,
  morePage,
  myDataPage,
  serviceWorkerJs,
  todayPage,
  type TodayData,
} from "./views";
import { WEBMCP_TOOLS, webmcpDiscovery } from "./webmcp";
import { APPLE_TOUCH_ICON, FAVICON_ICO } from "./assets";
import {
  batteryCharge,
  batteryState,
  dailyAggregates,
  factorImpact,
  pressurePct,
  pressureState,
  scoreSeries,
  stressPct,
  stressState,
  type MeasurementLike,
} from "./insights";
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

export interface Env {
  DB: D1Database;
  OWNER_EMAIL: string;
  GIT_SHA?: string;
  STRAVA_CLIENT_ID?: string;
  STRAVA_CLIENT_SECRET?: string;
  STRAVA_VERIFY_TOKEN?: string;
  TOKEN_ENC_KEY?: string;
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
      sha: c.env.GIT_SHA ?? "dev",
    }),
  );
});

/** Owner lock: Cloudflare Access injects the authenticated email header.
 *  When present it must be the owner; Access itself blocks everyone else at
 *  the edge (unauthenticated requests never reach this Worker). */
const TOKEN_GATED_PREFIXES = ["/api/import/", "/api/export/health-writeback", "/api/webhooks/"];
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

function scores(
  latest: Row | null,
  baselineRmssd: number | null,
): { battery: number | null; stress: number | null; pressure: number | null } {
  if (!latest) return { battery: null, stress: null, pressure: null };
  const si = Number(latest.baevsky_si);
  const lfhf = Number(latest.lf_hf_ratio);
  // Normative mappings: SPEC.md "Score mappings" (src/insights.ts).
  return {
    battery: batteryCharge(Number(latest.rmssd_ms), baselineRmssd),
    stress: stressPct(si, lfhf),
    pressure: pressurePct(si, lfhf),
  };
}

async function todayData(db: D1Database): Promise<TodayData> {
  const history = (await all(
    db,
    "SELECT id, taken_at, source, mean_hr_bpm, rmssd_ms, sdnn_ms, pnn50_pct, baevsky_si, lf_hf_ratio FROM measurements ORDER BY taken_at DESC LIMIT 10",
  )) as Array<Record<string, number | string>>;
  const latest = history[0] ?? null;
  let baseline: number | null = null;
  if (history.length > 1) {
    const rest = history.slice(1).map((m) => Number(m.rmssd_ms)).sort((a, b) => a - b);
    baseline = rest[Math.floor(rest.length / 2)];
  }
  const s = scores(latest as Row | null, baseline);
  return { battery: s.battery, stress: s.stress, pressure: s.pressure, latest, history };
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
app.get("/api/health", (c) => c.json({ ok: true, app: "openhrv", sha: c.env.GIT_SHA ?? "dev" }));
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
  const body = (await c.req.json().catch(() => ({}))) as { body?: string; mood?: number; tags?: string[] };
  if (!body.body?.trim()) return c.json({ ok: false, error: "body required" }, 400);
  const info = await c.env.DB.prepare(
    "INSERT INTO journal (owner, created_at, body, mood, tags_json) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(c.env.OWNER_EMAIL, new Date().toISOString(), body.body, Math.min(10, Math.max(1, body.mood ?? 5)), JSON.stringify(body.tags ?? []))
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
    "SELECT taken_at, rmssd_ms, baevsky_si, lf_hf_ratio, source FROM measurements ORDER BY taken_at ASC LIMIT 200",
  )) as unknown as MeasurementLike[];
  if (!rows.length) {
    const empty = { value: null, state: null, at: null, trend: [], contributors: [{ label: "No data", detail: "Take a measurement first" }] };
    return c.json({ ok: true, battery: empty, stress: empty, pressure: empty });
  }
  const scored = scoreSeries(rows);
  const latest = scored[scored.length - 1];
  const trend = (pick: "battery" | "stress" | "pressure") =>
    scored.slice(-14).map((p) => ({ at: p.at, value: Math.round(p[pick] * 10) / 10 }));
  const sleepRows = await all(c.env.DB, "SELECT start_at, end_at, duration_s FROM sleep ORDER BY end_at DESC LIMIT 30");
  const lastSleep = sleepRows[0];
  const sleepHrs = lastSleep ? Number(lastSleep.duration_s) / 3600 : null;
  const medianSleep = sleepRows.length
    ? sleepRows.map((r) => Number(r.duration_s) / 3600).sort((a, b) => a - b)[Math.floor(sleepRows.length / 2)]
    : null;
  const priorStress = scored.length > 1 ? scored.slice(0, -1).reduce((a, p) => a + p.stress, 0) / (scored.length - 1) : null;
  const mk = (
    pick: "battery" | "stress" | "pressure",
    stateFn: (v: number) => string,
    contributors: Array<{ label: string; detail: string }>,
  ) => ({ value: Math.round(latest[pick] * 10) / 10, state: stateFn(latest[pick]), at: latest.at, trend: trend(pick), contributors });
  return c.json({
    ok: true,
    battery: mk("battery", batteryState, [
      { label: "Last sleep", detail: sleepHrs !== null ? `${sleepHrs.toFixed(1)} h (your median ${medianSleep?.toFixed(1)} h)` : "No sleep logged yet — import from Apple Health" },
      { label: "Prior stress load", detail: priorStress !== null ? `avg stress ${priorStress.toFixed(0)} before this reading` : "Not enough history yet" },
      { label: "RMSSD vs baseline", detail: `${latest.rmssd.toFixed(0)} ms in the latest measurement` },
    ]),
    stress: mk("stress", stressState, [
      { label: "Baevsky stress index", detail: `${latest.si.toFixed(0)} (primary driver)` },
      { label: "LF / HF balance", detail: latest.lfhf.toFixed(2) },
      { label: "RMSSD", detail: `${latest.rmssd.toFixed(1)} ms in the latest measurement` },
    ]),
    pressure: mk("pressure", pressureState, [
      { label: "Stress-index component", detail: `${(latest.si / 3.2).toFixed(0)} pts` },
      { label: "LF/HF component", detail: `${Math.max(0, (latest.lfhf - 1) * 6).toFixed(0)} pts` },
      { label: "Readings in history", detail: `${scored.length}` },
    ]),
  });
});

app.get("/api/impact", async (c) => {
  const rows = (await all(
    c.env.DB,
    "SELECT taken_at, rmssd_ms, baevsky_si, lf_hf_ratio FROM measurements ORDER BY taken_at ASC LIMIT 1000",
  )) as unknown as MeasurementLike[];
  const days = dailyAggregates(rows);
  const factors: Array<{ name: string; dates: Set<string> }> = [];
  const journal = await all(c.env.DB, "SELECT created_at, tags_json FROM journal LIMIT 500");
  const tagDates = new Map<string, Set<string>>();
  for (const j of journal) {
    const date = String(j.created_at).slice(0, 10);
    for (const t of JSON.parse(String(j.tags_json ?? "[]")) as string[]) {
      if (!tagDates.has(t)) tagDates.set(t, new Set());
      tagDates.get(t)!.add(date);
    }
  }
  for (const [name, dates] of tagDates) factors.push({ name: `tag: ${name}`, dates });
  const sleepRows = await all(c.env.DB, "SELECT end_at, duration_s FROM sleep LIMIT 500");
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
  return c.json({ ok: true, days: days.length, impacts: factorImpact(days, factors) });
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

export default app;
