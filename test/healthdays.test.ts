import { describe, expect, it } from "vitest";
import { healthDays, type HealthSampleLike } from "../src/healthdays";
import {
  measurementGaugeDays,
  mergeGaugeDays,
  scoreHealthDays,
  type HealthDayInput,
} from "../src/insights";

const S = (type: string, value: number, start_at: string, source = "test"): HealthSampleLike => ({
  type,
  value,
  start_at,
  source,
});

describe("healthDays (health_samples -> per-day gauge inputs)", () => {
  it("prefers the canonical hrv_sdnn rollup over variant one-offs on the same day", () => {
    const days = healthDays(
      [
        S("heart_rate_variability_sdnn", 57, "2026-11-03T07:00:00-08:00"),
        S("hrv_sdnn_ms", 61, "2026-11-03T15:00:00-08:00"),
        S("hrv_sdnn", 165.7, "2026-11-03T12:00:00-08:00", "health_auto_export:Muse Apple Health"),
      ],
      [],
    );
    expect(days).toHaveLength(1);
    expect(days[0].sdnnMs).toBe(165.7);
    expect(days[0].sdnnSource).toContain("Apple Health");
  });
  it("falls back to a variant type when no canonical sample exists that day", () => {
    const days = healthDays([S("hrv_sdnn_ms", 88, "2026-11-01T09:00:00-08:00")], []);
    expect(days).toHaveLength(1);
    expect(days[0].sdnnMs).toBe(88);
  });
  it("takes the latest resting HR of the day, sums steps, longest sleep wins", () => {
    const days = healthDays(
      [
        S("resting_heart_rate", 57, "2026-11-03T07:00:00-08:00"),
        S("resting_heart_rate", 41, "2026-11-03T12:00:00-08:00"),
        S("step_count", 1000, "2026-11-03T12:00:00-08:00"),
        S("step_count", 500, "2026-11-03T18:00:00-08:00"),
      ],
      [
        { end_at: "2026-11-03T06:40:00-08:00", duration_s: 7.47 * 3600 },
        { end_at: "2026-11-03T15:00:00-08:00", duration_s: 0.5 * 3600 },
      ],
    );
    expect(days).toHaveLength(1);
    expect(days[0].restingHrBpm).toBe(41);
    expect(days[0].steps).toBe(1500);
    expect(days[0].sleepHours).toBeCloseTo(7.47, 2);
  });
});

describe("scoreHealthDays (aggregate score mappings)", () => {
  const flat: HealthDayInput[] = Array.from({ length: 10 }, (_, i) => ({
    date: `2026-10-${20 + i}`,
    sdnnMs: 100,
    restingHrBpm: 50,
    sleepHours: 8,
  }));

  it("a flat personal baseline scores neutral (stress ~42, battery ~62)", () => {
    const scored = scoreHealthDays(flat);
    expect(scored).toHaveLength(10);
    const last = scored[scored.length - 1];
    expect(last.stress).toBeCloseTo(42, 0);
    expect(last.battery).toBeCloseTo(62, 0);
    expect(last.source).toBe("health");
    expect(last.hrvKind).toBe("sdnn");
  });
  it("a high-SDNN day charges the Battery and lowers Stress vs baseline", () => {
    const scored = scoreHealthDays([
      ...flat,
      { date: "2026-10-30", sdnnMs: 140, restingHrBpm: 46, sleepHours: 8 },
    ]);
    const last = scored[scored.length - 1];
    expect(last.battery).toBeGreaterThan(72);
    expect(last.stress).toBeLessThan(15);
    expect(last.baselineHrvMs).toBe(100);
  });
  it("a low-SDNN, high-RHR, short-sleep day spikes Stress and drains Battery", () => {
    const scored = scoreHealthDays([
      ...flat,
      { date: "2026-10-30", sdnnMs: 65, restingHrBpm: 58, sleepHours: 5 },
    ]);
    const last = scored[scored.length - 1];
    expect(last.stress).toBeGreaterThanOrEqual(90);
    expect(last.battery).toBeLessThan(45);
    expect(last.parts!.stressSleepTerm).toBe(15);
  });
  it("days without SDNN produce no gauge point but still feed the RHR baseline", () => {
    const scored = scoreHealthDays([
      { date: "2026-10-20", sdnnMs: null, restingHrBpm: 60, sleepHours: null },
      { date: "2026-10-21", sdnnMs: 100, restingHrBpm: 50, sleepHours: 8 },
    ]);
    expect(scored).toHaveLength(1);
    expect(scored[0].date).toBe("2026-10-21");
  });
});

describe("mergeGaugeDays", () => {
  it("a real measurement wins its day; health fills the rest", () => {
    const health = scoreHealthDays(
      Array.from({ length: 3 }, (_, i) => ({
        date: `2026-10-${20 + i}`,
        sdnnMs: 100,
        restingHrBpm: 50,
        sleepHours: 8,
      })),
    );
    const meas = measurementGaugeDays([
      { taken_at: "2026-10-21T08:00:00.000Z", rmssd_ms: 80, baevsky_si: 120, lf_hf_ratio: 1.1 },
    ]);
    const merged = mergeGaugeDays(meas, health);
    expect(merged.map((d) => d.date)).toEqual(["2026-10-20", "2026-10-21", "2026-10-22"]);
    expect(merged[1].source).toBe("measurement");
    expect(merged[1].hrvKind).toBe("rmssd");
    expect(merged[0].source).toBe("health");
  });
});
