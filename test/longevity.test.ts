import { describe, expect, it } from "vitest";
import { app, type Env } from "../src/index";
import { StubD1 } from "./d1stub";
import { monthMeans, type MonthSampleRow } from "../src/longevity";
import { MARKERS } from "../src/phenoage";

const OWNER = "barkleesanders@gmail.com";

function makeEnv(): { env: Env; db: StubD1 } {
  const db = new StubD1();
  const env = { DB: db, OWNER_EMAIL: OWNER, GIT_SHA: "test" } as unknown as Env;
  return { env, db };
}

const jsonInit = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

// ---------------------------------------------------------------- monthMeans
describe("monthMeans (PLSI wearables monthly projection)", () => {
  const rows: MonthSampleRow[] = [
    // October 2026 — two full days of daily aggregates
    { type: "resting_heart_rate", value: 50, unit: "bpm", start_at: "2026-10-10T07:00:00-07:00" },
    { type: "resting_heart_rate", value: 52, unit: "bpm", start_at: "2026-10-11T07:00:00-07:00" },
    { type: "hrv_sdnn", value: 90, unit: "ms", start_at: "2026-10-10T07:00:00-07:00" },
    { type: "hrv_sdnn", value: 110, unit: "ms", start_at: "2026-10-11T07:00:00-07:00" },
    { type: "step_count", value: 8000, unit: "count", start_at: "2026-10-10T07:00:00-07:00" },
    { type: "step_count", value: 10000, unit: "count", start_at: "2026-10-11T07:00:00-07:00" },
    { type: "sleep_analysis", value: 7, unit: "h", start_at: "2026-10-09T23:00:00-07:00", end_at: "2026-10-10T06:00:00-07:00" },
    { type: "sleep_analysis", value: 8, unit: "h", start_at: "2026-10-10T23:00:00-07:00", end_at: "2026-10-11T07:00:00-07:00" },
    { type: "workout", value: 1800, unit: "s", start_at: "2026-10-10T17:00:00-07:00" },
    { type: "vo2_max", value: 41, unit: "ml/kg/min", start_at: "2026-10-05T07:00:00-07:00" },
    { type: "vo2_max", value: 42, unit: "ml/kg/min", start_at: "2026-10-20T07:00:00-07:00" },
    // hourly rows must NEVER enter the daily derivation
    { type: "step_count", value: 99999, unit: "count", start_at: "2026-10-10T12:00:00-07:00", granularity: "hourly" },
    { type: "hrv_sdnn", value: 5, unit: "ms", start_at: "2026-10-10T12:00:00-07:00", granularity: "hourly" },
    // November 2026 (partial month) — one day so far
    { type: "step_count", value: 6000, unit: "count", start_at: "2026-11-02T07:00:00-08:00" },
    { type: "sleep_analysis", value: 6, unit: "h", start_at: "2026-11-01T23:30:00-08:00", end_at: "2026-11-02T05:30:00-08:00" },
    // August is outside the 3-month window
    { type: "step_count", value: 20000, unit: "count", start_at: "2026-08-15T07:00:00-07:00" },
  ];

  it("computes the known monthly means, newest first, current month partial", () => {
    const out = monthMeans(rows, "2026-11-04");
    expect(out.map((m) => m.month)).toEqual(["2026-11", "2026-10", "2026-09"]);
    const nov = out[0];
    expect(nov.partial).toBe(true);
    expect(nov.stepsPerDay).toBe(6000);
    expect(nov.activeDays).toBe(1);
    expect(nov.sleepH).toBe(6);
    const oct = out[1];
    expect(oct.partial).toBe(false);
    expect(oct.restingHr).toBe(51);
    expect(oct.hrvMs).toBe(100);
    expect(oct.stepsPerDay).toBe(9000);
    expect(oct.activeDays).toBe(2);
    expect(oct.sleepH).toBe(7.5);
    expect(oct.workoutMin).toBe(30);
    expect(oct.vo2max).toBe(42); // latest in month wins
    const sep = out[2];
    expect(sep.stepsPerDay).toBeNull();
    expect(sep.activeDays).toBe(0);
    expect(sep.vo2max).toBeNull();
  });
});

// ---------------------------------------------------------------- labs API
describe("POST /api/labs + /api/settings/dob", () => {
  const usValues = {
    albumin: { value: 4.5, unit: "g/dL" },
    creatinine: { value: 1.0, unit: "mg/dL" },
    glucose: { value: 100, unit: "mg/dL" },
    crp: { value: 3, unit: "mg/L" },
    lymphocyte_pct: { value: 30, unit: "%" },
    mcv: { value: 90, unit: "fL" },
    rdw: { value: 13, unit: "%" },
    alp: { value: 70, unit: "U/L" },
    wbc: { value: 6, unit: "K/uL" },
  };

  it("stores canonical values and upserts per marker+date", async () => {
    const { env, db } = makeEnv();
    const r = await app.request("/api/labs", jsonInit({ drawn_on: "2026-11-01", values: usValues }), env);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { saved: number }).saved).toBe(9);
    const stored = db.table("lab_results");
    expect(stored).toHaveLength(9);
    const creat = stored.find((x) => x.marker === "creatinine")!;
    expect(Number(creat.value)).toBeCloseTo(88.42, 6);
    expect(creat.unit).toBe("µmol/L");
    const crp = stored.find((x) => x.marker === "crp")!;
    expect(Number(crp.value)).toBeCloseTo(0.3, 6);
    // Upsert: re-post one marker with a new value — still 9 rows.
    const r2 = await app.request(
      "/api/labs",
      jsonInit({ drawn_on: "2026-11-01", values: { albumin: { value: 4.8, unit: "g/dL" } } }),
      env,
    );
    expect(r2.status).toBe(200);
    expect(db.table("lab_results")).toHaveLength(9);
    expect(Number(db.table("lab_results").find((x) => x.marker === "albumin")!.value)).toBeCloseTo(48, 6);
  });

  it("rejects unknown markers, non-numeric values and bad dates with human 400s", async () => {
    const { env } = makeEnv();
    const bad1 = await app.request("/api/labs", jsonInit({ drawn_on: "2026-11-01", values: { sodium: { value: 140, unit: "mmol/L" } } }), env);
    expect(bad1.status).toBe(400);
    const bad2 = await app.request("/api/labs", jsonInit({ drawn_on: "11/01/2026", values: usValues }), env);
    expect(bad2.status).toBe(400);
    const bad3 = await app.request("/api/labs", jsonInit({ drawn_on: "2026-11-01", values: {} }), env);
    expect(bad3.status).toBe(400);
  });

  it("validates DOB range", async () => {
    const { env, db } = makeEnv();
    const ok = await app.request("/api/settings/dob", jsonInit({ dob: "1986-11-03" }), env);
    expect(ok.status).toBe(200);
    expect(db.table("settings").find((x) => x.key === "dob")!.value_json).toBe("1986-11-03");
    const bad = await app.request("/api/settings/dob", jsonInit({ dob: "1800-01-01" }), env);
    expect(bad.status).toBe(400);
  });
});

// ---------------------------------------------------------------- the page
describe("GET /longevity", () => {
  it("renders the missing state on an empty DB", async () => {
    const { env } = makeEnv();
    const r = await app.request("/longevity", {}, env);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("No lab draws yet");
    expect(html).toContain('id="lab-date"');
    expect(html).toContain('id="lab-dob"'); // DOB field offered while unset
    expect(html).toContain("Levine 2018");
  });

  it("is linked from the Reports hub and the More Explore list", async () => {
    const { env } = makeEnv();
    const reports = await (await app.request("/reports", {}, env)).text();
    expect(reports).toContain('href="/longevity"');
    const more = await (await app.request("/more", {}, env)).text();
    expect(more).toContain('href="/longevity"');
  });

  it("renders PhenoAge for a seeded complete draw + DOB", async () => {
    const { env, db } = makeEnv();
    db.table("settings").push({ owner: OWNER, key: "dob", value_json: "1986-11-03" });
    const oracle = { albumin: 45, creatinine: 80, glucose: 5.0, crp: 0.1, lymphocyte_pct: 30, mcv: 90, rdw: 13, alp: 70, wbc: 6 };
    for (const m of MARKERS) {
      db.table("lab_results").push({
        owner: OWNER,
        marker: m.key,
        value: oracle[m.key as keyof typeof oracle],
        unit: m.unit,
        drawn_on: "2026-11-03",
        source: "manual",
      });
    }
    const r = await app.request("/longevity", {}, env);
    expect(r.status).toBe(200);
    const html = await r.text();
    // Age at draw is exactly 40.0 -> PhenoAge 32.9721 -> "33.0", accel -7.0
    expect(html).toContain("33.0");
    expect(html).toContain("aging slower");
    expect(html).toContain("2026-11-03");
    expect(html).not.toContain('id="lab-dob"'); // DOB known -> field hidden
  });

  it("shows the missing-markers checklist for an incomplete newest draw", async () => {
    const { env, db } = makeEnv();
    db.table("settings").push({ owner: OWNER, key: "dob", value_json: "1986-11-03" });
    db.table("lab_results").push({ owner: OWNER, marker: "albumin", value: 45, unit: "g/L", drawn_on: "2026-11-03", source: "manual" });
    const html = await (await app.request("/longevity", {}, env)).text();
    expect(html).toContain("missing markers");
    expect(html).toContain("Creatinine");
  });
});
