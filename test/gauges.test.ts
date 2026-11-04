import { describe, expect, it } from "vitest";
import { app, type Env } from "../src/index";
import { StubD1 } from "./d1stub";

/**
 * BUG-1 regression: imported Apple Health daily aggregates (health_samples)
 * must drive the gauges, scores and factor impact — not only RR
 * measurements. Seeds the stub with a 10-day imported series and reads the
 * real endpoints.
 */
const OWNER = "barkleesanders@gmail.com";
const RR = Array.from({ length: 60 }, (_, i) => 800 + Math.round(28 * Math.sin(i / 5)));

function makeEnv(): { env: Env; db: StubD1 } {
  const db = new StubD1();
  const env = { DB: db, OWNER_EMAIL: OWNER, GIT_SHA: "test" } as unknown as Env;
  return { env, db };
}

/** 10 imported days (2026-10-20..29): SDNN 110 except 70 on the mornings
 *  after the three short-sleep nights (ending 21/22/23, 5 h each). */
function seedHealth(db: StubD1) {
  const low = new Set([21, 22, 23]);
  for (let d = 20; d <= 29; d++) {
    const date = `2026-10-${d}`;
    db.table("health_samples").push(
      {
        id: d * 10 + 1, owner: OWNER, type: "hrv_sdnn", value: low.has(d) ? 70 : 110, unit: "ms",
        start_at: `${date}T12:00:00-08:00`, end_at: `${date}T12:00:00-08:00`,
        source: "health_auto_export:Muse Apple Health", external_id: `hrv-${d}`, meta_json: "{}",
      },
      {
        id: d * 10 + 2, owner: OWNER, type: "resting_heart_rate", value: 50, unit: "bpm",
        start_at: `${date}T12:00:00-08:00`, end_at: `${date}T12:00:00-08:00`,
        source: "health_auto_export:Muse Apple Health", external_id: `rhr-${d}`, meta_json: "{}",
      },
    );
  }
  for (const d of [21, 22, 23]) {
    db.table("sleep").push({
      id: d, owner: OWNER,
      start_at: `2026-10-${d - 1}T23:00:00-08:00`, end_at: `2026-10-${d}T04:00:00-08:00`,
      duration_s: 5 * 3600, source: "health_auto_export", stages_json: "{}",
    });
  }
}

interface GaugeJson {
  value: number | null;
  state: string | null;
  source?: string;
  trend: Array<{ at: string; value: number }>;
  contributors: Array<{ label: string; detail: string }>;
}

describe("gauges from imported Apple Health aggregates (BUG-1)", () => {
  it("GET /api/scores is populated from health_samples alone", async () => {
    const { env, db } = makeEnv();
    seedHealth(db);
    const j = (await (await app.request("/api/scores", {}, env)).json()) as {
      battery: GaugeJson; stress: GaugeJson; pressure: GaugeJson;
    };
    expect(j.battery.value).not.toBeNull();
    expect(j.stress.value).not.toBeNull();
    expect(j.pressure.value).not.toBeNull();
    expect(j.battery.source).toBe("health");
    // Last day sits exactly on its own baseline -> neutral scores.
    expect(j.battery.value!).toBeCloseTo(62, 0);
    expect(j.stress.value!).toBeCloseTo(42, 0);
    expect(j.battery.trend).toHaveLength(10);
    expect(j.battery.contributors.map((ct) => `${ct.label} ${ct.detail}`).join(" ")).toContain("Health aggregates");
    expect(j.stress.contributors.map((ct) => `${ct.label} ${ct.detail}`).join(" ")).toContain("from daily Health aggregates");
  });

  it("GET /api/today carries the gauges + an Apple Health latest card", async () => {
    const { env, db } = makeEnv();
    seedHealth(db);
    const j = (await (await app.request("/api/today", {}, env)).json()) as {
      battery: number | null; stress: number | null; pressure: number | null;
      scoreSource: string | null;
      healthLatest: { date: string; sdnnMs: number } | null;
    };
    expect(j.battery).not.toBeNull();
    expect(j.stress).not.toBeNull();
    expect(j.pressure).not.toBeNull();
    expect(j.scoreSource).toBe("health");
    expect(j.healthLatest?.date).toBe("2026-10-29");
    expect(j.healthLatest?.sdnnMs).toBe(110);
  });

  it("GET /api/impact intersects sleep factors with the imported day series", async () => {
    const { env, db } = makeEnv();
    seedHealth(db);
    const j = (await (await app.request("/api/impact", {}, env)).json()) as {
      days: number; hrvBasis: string;
      impacts: Array<{ factor: string; nWith: number; nWithout: number; enoughData: boolean; metrics: { rmssd: { deltaPct: number } } | null }>;
    };
    expect(j.days).toBe(10);
    expect(j.hrvBasis).toBe("sdnn");
    const short = j.impacts.find((f) => f.factor.includes("Short sleep"));
    expect(short).toBeDefined();
    expect(short!.nWith).toBe(3);
    expect(short!.nWithout).toBe(7);
    expect(short!.enoughData).toBe(true);
    expect(short!.metrics!.rmssd.deltaPct).toBeLessThan(-20);
  });

  it("GET /api/watch/today returns the aggregate gauges behind the import token", async () => {
    const { env, db } = makeEnv();
    seedHealth(db);
    db.table("settings").push({ owner: OWNER, key: "import_token", value_json: "tok-test" });
    const denied = await app.request("/api/watch/today", {}, env);
    expect(denied.status).toBe(401);
    const r = await app.request("/api/watch/today", { headers: { authorization: "Bearer tok-test" } }, env);
    expect(r.status).toBe(200);
    const j = (await r.json()) as { battery: number | null; stress: number | null; pressure: number | null };
    expect(j.battery).not.toBeNull();
    expect(j.stress).not.toBeNull();
    expect(j.pressure).not.toBeNull();
  });

  it("a real RR measurement still wins over the aggregates", async () => {
    const { env, db } = makeEnv();
    seedHealth(db);
    const post = await app.request(
      "/api/measurements",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rr_ms: RR, source: "manual" }) },
      env,
    );
    expect(post.status).toBe(200);
    const j = (await (await app.request("/api/scores", {}, env)).json()) as { battery: GaugeJson };
    expect(j.battery.source).toBe("measurement");
  });
});
