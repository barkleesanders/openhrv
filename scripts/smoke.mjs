#!/usr/bin/env node
/**
 * OpenHRV production smoke — run AFTER scripts/deploy.sh.
 *
 * Lane honesty: every check runs over HTTPS against the DEPLOYED Worker
 * (default https://openhrv.barkleesanders.workers.dev), so binding-backed
 * features (Workers AI coach, D1, R2-adjacent APIs) are exercised for
 * real — this is the gate whose absence let a broken coach error surface
 * ship on 2026-11-04 under 170/170 stubbed unit tests.
 *
 * Credentials (env only, never committed):
 *   SMOKE_ACCESS_CLIENT_ID / SMOKE_ACCESS_CLIENT_SECRET — a Cloudflare
 *     Access SERVICE TOKEN scoped to this application. Create it for the
 *     run and revoke it after (Zero Trust → Access → Service credentials).
 *     Without it, only the unauthenticated checks run and every
 *     authenticated check SKIPS LOUDLY (a skip is never a pass).
 *   SMOKE_BASE — override the base URL (default production).
 * The import token is fetched from the owner endpoint
 * (/api/settings/import-token) using the Access credentials.
 *
 * Writes performed (all self-cleaning or idempotent): one coach ask
 * (read-only inference), one dedup re-POST of an existing sample
 * (asserts inserted=0). Nothing else mutates data.
 *
 * Exit code: 1 if any check FAILs; skips do not fail the run.
 */
const BASE = (process.env.SMOKE_BASE || "https://openhrv.barkleesanders.workers.dev").replace(/\/$/, "");
const ID = process.env.SMOKE_ACCESS_CLIENT_ID || "";
const SECRET = process.env.SMOKE_ACCESS_CLIENT_SECRET || "";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

let pass = 0, fail = 0, skip = 0;
const ok = (name, cond, ev) => {
  if (cond) { pass++; console.log(`PASS ${name} :: ${ev}`); }
  else { fail++; console.log(`FAIL ${name} :: ${ev}`); }
};
const skipLoud = (name, why) => { skip++; console.log(`*** SKIP ${name} :: ${why} ***`); };

async function req(method, path, { access = true, headers = {}, body } = {}) {
  const h = { "User-Agent": UA, ...headers };
  if (access && ID && SECRET) {
    h["CF-Access-Client-Id"] = ID;
    h["CF-Access-Client-Secret"] = SECRET;
  }
  let data;
  if (body !== undefined) {
    data = typeof body === "string" ? body : JSON.stringify(body);
    if (typeof body !== "string") h["content-type"] = "application/json";
  }
  const r = await fetch(BASE + path, { method, headers: h, body: data, redirect: "manual" });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON is itself evidence */ }
  return { status: r.status, json, text };
}

const haveAccess = Boolean(ID && SECRET);

async function main() {
  // 1. The lock itself: unauthenticated requests redirect to Access.
  const unauth = await req("GET", "/", { access: false });
  ok("unauthenticated / redirects to Access", unauth.status === 302, `status=${unauth.status}`);

  if (!haveAccess) {
    for (const n of ["authenticated pages/APIs", "watch lanes", "import dedup", "exports", "strava status", "COACH ASK (real Workers AI)"]) {
      skipLoud(n, "SMOKE_ACCESS_CLIENT_ID/SMOKE_ACCESS_CLIENT_SECRET not set — set a scoped Access service token to run this check");
    }
    return summary();
  }

  // 2. Health + sha.
  const health = await req("GET", "/api/health");
  ok("GET /api/health", health.status === 200 && health.json?.ok === true && Boolean(health.json?.sha), `sha=${health.json?.sha}`);

  // 3. Home renders with the quick-glance panel first-class content.
  const home = await req("GET", "/");
  ok("GET / (Today)", home.status === 200 && home.text.includes("Quick glance"), `status=${home.status} bytes=${home.text.length}`);

  // 4. Core read APIs.
  for (const p of ["/api/today", "/api/scores", "/api/mydata/categories", "/api/impact", "/api/sleep", "/api/lab"]) {
    const r = await req("GET", p);
    ok(`GET ${p}`, r.status === 200 && r.json?.ok === true, `status=${r.status}`);
  }

  // 5. Import token + tokened lanes.
  const tok = await req("GET", "/api/settings/import-token");
  const importToken = tok.json?.token;
  ok("GET /api/settings/import-token", Boolean(importToken), `status=${tok.status}`);
  if (importToken) {
    const ih = { Authorization: `Bearer ${importToken}` };
    const watch = await req("GET", "/api/watch/today", { headers: ih });
    ok("GET /api/watch/today (import token)", watch.status === 200 && watch.json?.ok === true, `battery=${watch.json?.battery}`);
    const bad = await req("GET", "/api/watch/today", { headers: { Authorization: "Bearer bogus" } });
    ok("GET /api/watch/today bad token -> 401", bad.status === 401, `status=${bad.status}`);
    const wb = await req("GET", "/api/export/health-writeback", { headers: ih });
    ok("GET /api/export/health-writeback", wb.status === 200 && wb.json?.ok === true, `status=${wb.status}`);

    // 6. Dedup: re-POST one existing hourly sample in the sync's exact
    // shape — the endpoint must insert 0.
    const samples = await req("GET", "/api/samples?type=hrv_sdnn&limit=200");
    const rows = samples.json?.samples ?? [];
    const hourly = rows.find((s) => typeof s.external_id === "string" && s.external_id.includes(":hourly:"));
    if (hourly) {
      const src = String(hourly.external_id).split(":").slice(3).join(":");
      const payload = { data: { metrics: [{ name: "hrv_sdnn", units: "ms", data: [{ date: hourly.start_at, qty: hourly.value, source: src, granularity: "hourly" }] }] } };
      const dedup = await req("POST", "/api/import/health-auto-export", { headers: ih, body: payload });
      ok("HAE import dedup (inserted=0)", dedup.json?.ok === true && dedup.json?.inserted === 0, `inserted=${dedup.json?.inserted}`);
    } else {
      skipLoud("HAE import dedup", "no hourly hrv_sdnn sample found to re-POST");
    }
  } else {
    skipLoud("watch/import lanes", "import token unavailable");
  }

  // 7. Exports + reports + Strava status.
  const exp = await req("GET", "/api/export/data.json");
  ok("GET /api/export/data.json", exp.status === 200 && Array.isArray(exp.json?.samples), `status=${exp.status}`);
  const rep = await req("GET", "/reports/stress");
  ok("GET /reports/stress", rep.status === 200 && rep.text.length > 2000, `status=${rep.status}`);
  const strava = await req("GET", "/connect/strava/status");
  ok("GET /connect/strava/status", strava.status === 200 && strava.json?.connected === true, `connected=${strava.json?.connected} athlete=${strava.json?.athlete_id}`);

  // 8. THE COACH — the check whose absence shipped the 2026-11-04 bug.
  // Real deployed Worker -> real Workers AI binding -> real owner data.
  const coach = await req("POST", "/api/coach", { body: { message: "Why is my HRV so high?", history: [] } });
  const reply = coach.json?.reply ?? "";
  ok(
    "POST /api/coach (real Workers AI)",
    coach.status === 200 && coach.json?.ok === true && reply.length > 40 && !/did not match/i.test(reply),
    `status=${coach.status} reply="${reply.slice(0, 140)}"`,
  );

  summary();
}

function summary() {
  console.log(`\nSMOKE: ${pass} pass, ${fail} fail, ${skip} skip`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("SMOKE CRASHED:", e);
  process.exit(1);
});
