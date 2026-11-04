import { describe, expect, it } from "vitest";
import { app, type Env } from "../src/index";
import { StubD1 } from "./d1stub";
import { buildCoachContext, type CoachData } from "../src/coach";
import { parseHealthAutoExport } from "../src/import";
import { coachPage } from "../src/views";

/**
 * Production-truth regressions (2026-11-04). Barklee's production coach
 * ask rendered the raw platform string "The string did not match the
 * expected pattern." and, when it did answer, claimed no HRV data existed
 * while his dashboard showed SDNN 165.7 ms. Unit tests had stubbed
 * Workers AI, so no gate ever exercised the real request/response
 * contract or the error surface. These tests pin:
 *  1. AI failures map to a HUMAN error; the raw message never leaks.
 *  2. The coach request context carries the Apple Health aggregate HRV.
 *  3. Uncaught API errors return JSON (onError), never HTML/raw text.
 *  4. The coach page parses responses defensively (no raw e.message).
 *  5. HAE-app metric names normalize onto canonical sample types.
 */
const OWNER = "barkleesanders@gmail.com";
const jsonInit = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

function makeEnv(extra: Record<string, unknown> = {}): { env: Env; db: StubD1 } {
  const db = new StubD1();
  const env = { DB: db, OWNER_EMAIL: OWNER, GIT_SHA: "test", ...extra } as unknown as Env;
  return { env, db };
}

function seedHrvDay(db: StubD1, date: string, sdnn: number) {
  db.table("health_samples").push({
    id: Math.floor(Math.random() * 1e9) + 1,
    owner: OWNER, type: "hrv_sdnn", value: sdnn, unit: "ms",
    start_at: `${date}T12:00:00-08:00`, end_at: `${date}T12:00:00-08:00`,
    source: "health_auto_export:Muse Apple Health",
    external_id: `hrv_sdnn:${date}`, meta_json: "{}",
  });
}

const baseData: CoachData = {
  battery: 92, stress: 0, pressure: 0,
  latestMeasurement: null,
  days: [], sleepMedianH: null, sleepLastH: 7.5,
  impacts: [], recentMoods: [],
  counts: { measurements: 0, sleep: 4, journal: 0, breathing: 0, tests: 0 },
};

describe("coach context: aggregate HRV grounding", () => {
  it("cites the latest Apple Health SDNN day with its baseline delta", () => {
    const ctx = buildCoachContext({
      ...baseData,
      aggregate: { date: "2026-11-03", sdnnMs: 165.7, sdnnBaselineMs: 92.3, restingHrBpm: 41, sleepH: 7.5, steps: 2915 },
    });
    expect(ctx).toContain("Latest Apple Health day 2026-11-03");
    expect(ctx).toContain("HRV (SDNN) 165.7 ms");
    expect(ctx).toContain("baseline median 92.3 ms, +80%");
    expect(ctx).toContain("No RR measurements stored yet");
    expect(ctx).not.toContain("No measurements stored yet.");
  });

  it("POST /api/coach sends the aggregate HRV line to the model (request contract)", async () => {
    let captured: { messages: Array<{ role: string; content: string }> } | null = null;
    const ai = {
      run: async (_model: string, input: never) => {
        captured = input as { messages: Array<{ role: string; content: string }> };
        return { response: "Your SDNN is above baseline." };
      },
    };
    const { env, db } = makeEnv({ AI: ai as never });
    for (let d = 25; d <= 31; d++) seedHrvDay(db, `2026-10-${d}`, 92);
    seedHrvDay(db, "2026-11-03", 165.7);
    const r = await app.request("/api/coach", jsonInit({ message: "Why is my HRV so high?" }), env);
    expect(r.status).toBe(200);
    const j = (await r.json()) as { ok: boolean; reply: string };
    expect(j.ok).toBe(true);
    expect(captured).not.toBeNull();
    expect(captured!.messages[0].content).toContain("Latest Apple Health day 2026-11-03");
    expect(captured!.messages[0].content).toContain("HRV (SDNN) 165.7 ms");
  });
});

describe("coach error surface", () => {
  it("an AI.run throw maps to the human message — the raw platform string never leaks", async () => {
    const ai = {
      run: async () => {
        throw new Error("The string did not match the expected pattern");
      },
    };
    const { env } = makeEnv({ AI: ai as never });
    const r = await app.request("/api/coach", jsonInit({ message: "Why is my HRV so high?" }), env);
    expect(r.status).toBe(502);
    const j = (await r.json()) as { ok: boolean; error: string };
    expect(j.ok).toBe(false);
    expect(j.error).toBe("The coach couldn\u2019t answer just now \u2014 please try again in a moment.");
    expect(j.error).not.toContain("did not match");
  });

  it("uncaught API errors return JSON via onError, never HTML or the raw message", async () => {
    const explodingDb = {
      prepare: () => {
        throw new Error("boom-raw-internal");
      },
      batch: async () => [],
    };
    const { env } = makeEnv({ DB: explodingDb as never });
    const rr = Array.from({ length: 300 }, (_, i) => 800 + Math.round(30 * Math.sin(i / 7)));
    const r = await app.request("/api/measurements", jsonInit({ rr_ms: rr }), env);
    expect(r.status).toBe(500);
    expect(r.headers.get("content-type")).toContain("application/json");
    const j = (await r.json()) as { ok: boolean; error: string };
    expect(j.ok).toBe(false);
    expect(j.error).toContain("Something went wrong on the server");
    expect(j.error).not.toContain("boom-raw-internal");
  });

  it("the coach page parses defensively and never renders e.message", () => {
    const html = coachPage("test");
    expect(html).toContain("JSON.parse(t)");
    expect(html).toContain("could not be reached");
    expect(html).not.toContain('e.message');
    // Scope to the coach ask block itself: the shared layout legitimately
    // uses r.json() for its WebMCP registration fetches.
    const ask = html.slice(html.indexOf('fetch("/api/coach"'), html.indexOf('fetch("/api/coach"') + 600);
    expect(ask).toContain("return r.text()");
    expect(ask).not.toContain("r.json()");
  });
});

describe("HAE metric-name normalization", () => {
  it("maps the HAE app's own names onto canonical types, external_id keeps the raw name", () => {
    const out = parseHealthAutoExport({
      data: {
        metrics: [
          { name: "heart_rate_variability", units: "ms", data: [{ date: "2026-11-03T18:00:00-08:00", qty: 169.5, source: "Watch" }] },
          { name: "blood_oxygen_saturation", units: "%", data: [{ date: "2026-11-03T18:00:00-08:00", qty: 98 }] },
          { name: "basal_energy_burned", units: "kcal", data: [{ date: "2026-11-03T00:00:00-08:00", qty: 1500 }] },
          { name: "hrv_sdnn", units: "ms", data: [{ date: "2026-11-03T12:00:00-08:00", qty: 165.7, source: "Muse Apple Health" }] },
        ],
      },
    });
    expect(out.map((s) => s.type)).toEqual(["hrv_sdnn", "spo2", "basal_energy", "hrv_sdnn"]);
    expect(out[0].external_id).toBe("heart_rate_variability:2026-11-03T18:00:00-08:00:Watch");
  });
});

describe("coach assembly guard (2026-11-04 deploy-window 500)", () => {
  it("a binding-layer throw during the ask maps to the human 502, never the onError 500", async () => {
    // The read helpers swallow D1 errors and row shapes are coerced, so
    // the realistic uncaught-throw class is the platform layer itself:
    // during the 2026-11-04 deploy rollout Barklee's asks returned the
    // onError 500 while identical asks minutes later returned 200. A DB
    // binding that throws on access models that failure faithfully.
    const ai = { run: async () => ({ response: "unused" }) };
    const env = { OWNER_EMAIL: OWNER, GIT_SHA: "test", AI: ai } as unknown as Env;
    Object.defineProperty(env, "DB", {
      get() { throw new Error("simulated binding failure during rollout"); },
    });
    const r = await app.request("/api/coach", jsonInit({ message: "What moves my numbers most?" }), env);
    expect(r.status).toBe(502);
    const j = (await r.json()) as { ok: boolean; error: string };
    expect(j.ok).toBe(false);
    expect(j.error).toContain("try again in a moment");
    expect(j.error).not.toContain("Something went wrong on the server");
    expect(j.error).not.toContain("simulated binding failure");
  });

  it("the coach page script retries once on a server error before surfacing it", () => {
    const html = coachPage("test");
    expect(html).toContain("attempt(0)");
    expect(html).toContain("res.status >= 500");
  });
});
