import { describe, expect, it } from "vitest";
import { buildLabDays, correlationPairs, generateInsights, pearson } from "../src/lab";
import { stageTotalsForNight, summarizeSleep } from "../src/sleep";
import { bloodPressureReadings, summarizeCategories } from "../src/categories";
import type { MeasurementLike } from "../src/insights";

const meas = (date: string, rmssd: number, si = 100, lfhf = 1.2): MeasurementLike => ({
  taken_at: `${date}T07:00:00.000Z`,
  rmssd_ms: rmssd,
  baevsky_si: si,
  lf_hf_ratio: lfhf,
});

describe("pearson", () => {
  it("perfect positive and negative correlations", () => {
    const pos = pearson([1, 2, 3, 4, 5, 6].map((x) => ({ x, y: x * 2 })));
    expect(pos?.r).toBeCloseTo(1, 6);
    const neg = pearson([1, 2, 3, 4, 5, 6].map((x) => ({ x, y: -x })));
    expect(neg?.r).toBeCloseTo(-1, 6);
  });
  it("returns null under 5 paired points or with zero variance", () => {
    expect(pearson([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toBeNull();
    expect(pearson([1, 2, 3, 4, 5].map((x) => ({ x, y: 7 })))).toBeNull();
    expect(pearson([{ x: 1, y: null }, { x: 2, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 4 }, { x: 5, y: 5 }, { x: 6, y: 6 }])?.n).toBe(5);
  });
});

describe("buildLabDays", () => {
  it("merges measurements, longest sleep, summed steps, mean mood and tags per day", () => {
    const days = buildLabDays(
      [meas("2026-10-01", 50), meas("2026-10-02", 40)],
      [
        { end_at: "2026-10-01T07:00:00.000Z", duration_s: 5 * 3600 },
        { end_at: "2026-10-01T13:00:00.000Z", duration_s: 1 * 3600 },
        { end_at: "2026-10-02T06:30:00.000Z", duration_s: 7.5 * 3600 },
      ],
      [
        { type: "step_count", value: 3000, start_at: "2026-10-01T10:00:00.000Z" },
        { type: "step_count", value: 2500, start_at: "2026-10-01T18:00:00.000Z" },
        { type: "heart_rate", value: 70, start_at: "2026-10-01T18:00:00.000Z" },
      ],
      [
        { created_at: "2026-10-01T20:00:00.000Z", mood: 6, tags_json: '["coffee"]' },
        { created_at: "2026-10-01T22:00:00.000Z", mood: 8, tags_json: '["coffee","run"]' },
      ],
    );
    const d1 = days.find((d) => d.date === "2026-10-01")!;
    expect(d1.rmssd).toBe(50);
    expect(d1.sleepHours).toBe(5); // longest record wins, not the nap
    expect(d1.steps).toBe(5500);
    expect(d1.mood).toBe(7);
    expect(d1.tags.sort()).toEqual(["coffee", "run"]);
    expect(days.find((d) => d.date === "2026-10-02")!.sleepHours).toBe(7.5);
  });
});

describe("correlationPairs", () => {
  it("ranks a strong sleep→RMSSD relationship first with its n", () => {
    const days = buildLabDays(
      [50, 55, 60, 65, 70, 75].map((r, i) => meas(`2026-10-0${i + 1}`, r)),
      [5, 6, 7, 8, 8.5, 9].map((h, i) => ({ end_at: `2026-10-0${i + 1}T07:00:00.000Z`, duration_s: h * 3600 })),
      [],
      [],
    );
    const pairs = correlationPairs(days);
    expect(pairs.length).toBeGreaterThan(0);
    const top = pairs[0];
    expect([top.x, top.y].sort()).toEqual(["rmssd", "sleepHours"]);
    expect(top.r).toBeGreaterThan(0.9);
    expect(top.n).toBe(6);
  });
});

describe("generateInsights", () => {
  const base = [50, 52, 48, 51, 49, 50].map((r, i) => meas(`2026-10-0${i + 1}`, r));
  it("flags an RMSSD drop vs baseline with the numbers used", () => {
    const days = buildLabDays([...base, meas("2026-10-07", 38)], [], [], []);
    const out = generateInsights(days, "2026-10-07T12:00:00.000Z");
    const hit = out.find((i) => i.kind === "rmssd_vs_baseline");
    expect(hit).toBeTruthy();
    expect(hit!.severity).toBe("warn");
    expect(hit!.text).toContain("38 ms");
  });
  it("flags a measurement gap and stays quiet on a fresh, stable series", () => {
    const days = buildLabDays(base, [], [], []);
    const gap = generateInsights(days, "2026-10-10T12:00:00.000Z");
    expect(gap.some((i) => i.kind === "gap")).toBe(true);
    const fresh = generateInsights(days, "2026-10-06T12:00:00.000Z");
    expect(fresh.some((i) => i.kind === "gap")).toBe(false);
    expect(fresh.some((i) => i.kind === "rmssd_vs_baseline")).toBe(false);
  });
  it("reports the sleep→RMSSD effect only with enough nights on both sides", () => {
    const ms: MeasurementLike[] = [];
    const sl: Array<{ end_at: string; duration_s: number }> = [];
    for (let i = 0; i < 4; i++) {
      ms.push(meas(`2026-10-0${i + 1}`, 60));
      sl.push({ end_at: `2026-10-0${i + 1}T07:00:00.000Z`, duration_s: 8 * 3600 });
    }
    for (let i = 0; i < 4; i++) {
      ms.push(meas(`2026-10-1${i}`, 40));
      sl.push({ end_at: `2026-10-1${i}T07:00:00.000Z`, duration_s: 5 * 3600 });
    }
    const out = generateInsights(buildLabDays(ms, sl, [], []), "2026-10-13T12:00:00.000Z");
    const hit = out.find((i) => i.kind === "sleep_rmssd");
    expect(hit).toBeTruthy();
    expect(hit!.text).toContain("60 ms");
    expect(hit!.text).toContain("40 ms");
  });
});

describe("summarizeSleep", () => {
  const rows = [
    { start_at: "2026-10-01T23:00:00.000Z", end_at: "2026-10-02T05:00:00.000Z", duration_s: 6 * 3600, source: "apple_health" },
    { start_at: "2026-10-02T23:00:00.000Z", end_at: "2026-10-03T07:00:00.000Z", duration_s: 8 * 3600, source: "apple_health" },
    { start_at: "2026-10-03T23:30:00.000Z", end_at: "2026-10-04T06:30:00.000Z", duration_s: 7 * 3600, source: "shortcut" },
  ];
  it("computes median, per-night debt vs target, and vs-median percentages", () => {
    const s = summarizeSleep(rows, 8);
    expect(s.count).toBe(3);
    expect(s.medianHours).toBe(7);
    expect(s.lastNight!.hours).toBe(7);
    expect(s.lastNight!.debtH).toBe(1);
    expect(s.nights[2].hours).toBe(6);
    expect(s.nights[2].vsMedianPct).toBeCloseTo(-14.3, 1);
    expect(s.debt7dH).toBe(3); // 2 + 0 + 1
  });
  it("derives stage totals from stage-bearing samples inside the night window", () => {
    const stages = stageTotalsForNight(
      [
        { start_at: "2026-10-02T00:00:00.000Z", value: 1.5, unit: "h", meta_json: '{"stage":"deep"}' },
        { start_at: "2026-10-02T02:00:00.000Z", value: 90, unit: "min", meta_json: '{"stage":"core"}' },
        { start_at: "2026-10-05T02:00:00.000Z", value: 3, unit: "h", meta_json: '{"stage":"deep"}' },
      ],
      rows[0].start_at,
      rows[0].end_at,
    );
    expect(stages).toEqual({ deep: 90, core: 90 });
    const s = summarizeSleep(rows, 8, [
      { start_at: "2026-10-02T00:00:00.000Z", value: 1.5, unit: "h", meta_json: '{"stage":"deep"}' },
    ]);
    expect(s.nights.find((n) => n.date === "2026-10-02")!.stages).toEqual({ deep: 90 });
  });
});

describe("summarizeCategories + bloodPressureReadings", () => {
  const samples = [
    { type: "blood_pressure_systolic", value: 121, unit: "mmHg", start_at: "2026-10-02T08:00:00.000Z", source: "apple_health" },
    { type: "blood_pressure_diastolic", value: 79, unit: "mmHg", start_at: "2026-10-02T08:00:00.000Z", source: "apple_health" },
    { type: "blood_pressure_systolic", value: 118, unit: "mmHg", start_at: "2026-10-01T08:00:00.000Z", source: "apple_health" },
    { type: "blood_pressure_diastolic", value: 76, unit: "mmHg", start_at: "2026-10-01T08:00:00.000Z", source: "apple_health" },
    { type: "step_count", value: 8000, unit: "count", start_at: "2026-10-02T12:00:00.000Z", source: "apple_health" },
    { type: "hrv_sdnn", value: 55, unit: "ms", start_at: "2026-10-02T07:00:00.000Z", source: "apple_health" },
  ];
  it("summarizes latest/avg/count per metric and pairs BP by timestamp", () => {
    const cats = summarizeCategories(samples, "2026-10-02T12:00:00.000Z");
    const bp = cats.find((c) => c.key === "blood-pressure")!;
    expect(bp.sampleCount).toBe(4);
    const sys = bp.metrics.find((m) => m.type === "blood_pressure_systolic")!;
    expect(sys.latest!.value).toBe(121);
    expect(sys.count).toBe(2);
    const health = cats.find((c) => c.key === "health")!;
    expect(health.metrics.find((m) => m.type === "hrv_sdnn")!.latest!.value).toBe(55);
    const readings = bloodPressureReadings(samples);
    expect(readings).toHaveLength(2);
    expect(readings[0]).toMatchObject({ systolic: 121, diastolic: 79 });
  });
});
