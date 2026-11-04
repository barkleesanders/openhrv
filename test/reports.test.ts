import { describe, expect, it } from "vitest";
import {
  activityDay,
  ansBalance,
  focusFromLfHf,
  focusProxy,
  healthScore,
  keyInsights,
  metLevel,
  segmentHeartDay,
  stressImpactDay,
  type HourBucket,
} from "../src/reports";

const bucket = (hour: number, hr: number | null, steps: number | null, sdnn: number | null = null): HourBucket => ({
  hour,
  hr,
  steps,
  sdnn,
  activeKcal: null,
});

describe("stressImpactDay — stationary stress detection", () => {
  it("counts elevated+stationary hours as stress minutes, elevated+moving hours not", () => {
    const buckets = [
      bucket(9, 90, 10), // elevated (>= 60*1.2=72) + stationary -> stress
      bucket(10, 95, 30), // elevated + stationary -> stress
      bucket(11, 110, 4000), // elevated but moving -> not stationary stress
      bucket(12, 58, 5), // calm -> neither
    ];
    const r = stressImpactDay(buckets, 60);
    expect(r.stressMinutes).toBe(120);
    expect(r.elevatedHours).toBe(3);
    expect(r.stationaryStressHours).toBe(2);
    expect(r.hoursWithData).toBe(4);
  });

  it("returns nulls (never a fabricated zero) when no hourly HR exists", () => {
    const r = stressImpactDay([bucket(9, null, 100)], 60);
    expect(r.stressMinutes).toBeNull();
    expect(r.morningLevelPct).toBeNull();
  });

  it("morning level averages the positive elevation of the first waking hours", () => {
    const buckets = [bucket(5, 72, 0), bucket(6, 72, 0), bucket(7, 60, 0), bucket(15, 120, 0)];
    const r = stressImpactDay(buckets, 60);
    // (20% + 20% + 0%) / 3 = 13.33 -> 13
    expect(r.morningLevelPct).toBe(13);
  });
});

describe("activityDay — stand hours, sedentary, METs", () => {
  const base = {
    stepsDaily: 8000,
    activeKcalDaily: 400,
    basalKcalDaily: 1600,
    workoutMinutes: 0,
    restingBaseline: 60,
    maxHrObserved: 180,
    sleepHoursSet: new Set<number>([2, 3]),
  };

  it("stand hour = >=100 steps; sedentary excludes sleep hours and active hours", () => {
    const buckets = [
      bucket(2, 55, 10), // asleep hour — not sedentary
      bucket(9, 58, 150), // stand hour, not active, not sedentary
      bucket(10, 57, 20), // sedentary waking hour
      bucket(11, 120, 3000), // active hour
    ];
    const r = activityDay({ ...base, buckets });
    expect(r.standHours).toBe(2); // 09:00 and 11:00
    expect(r.sedentaryMinutes).toBe(60); // only 10:00
    expect(r.activeMinutes).toBe(60);
    expect(r.totalCal).toBe(2000);
    expect(r.steps).toBe(8000);
  });

  it("intense hours are the top quarter of heart-rate reserve", () => {
    // threshold = 60 + 0.75*(180-60) = 150
    const buckets = [bucket(11, 149, 3000), bucket(12, 151, 3000)];
    const r = activityDay({ ...base, buckets });
    expect(r.intenseMinutes).toBe(60);
    expect(r.intenseMets).not.toBeNull();
  });

  it("MET level scales 1 at rest to 10 at observed max", () => {
    expect(metLevel(60, 60, 180)).toBe(1);
    expect(metLevel(180, 60, 180)).toBe(10);
    expect(metLevel(120, 60, 180)).toBeCloseTo(5.5, 5);
  });

  it("workout minutes floor the active time when hourly data is thin", () => {
    const r = activityDay({ ...base, buckets: [], workoutMinutes: 45 });
    expect(r.activeMinutes).toBe(45);
    expect(r.activeMets).toBeNull(); // no HR hours -> no MET estimate, not a guess
  });
});

describe("healthScore / focus scores vs fixture days", () => {
  const typical = {
    sdnnMs: 100,
    baselineSdnn: 100,
    restingHrBpm: 55,
    baselineRhr: 55,
    sleepHours: 7.5,
    sleepMedian: 7.5,
    lfHf: null,
  };

  it("a day exactly at baseline scores in the Stable band", () => {
    const h = healthScore(typical);
    expect(h).not.toBeNull();
    expect(h as number).toBeGreaterThanOrEqual(55);
    expect(h as number).toBeLessThan(90);
  });

  it("crushed HRV + short sleep + hot resting HR scores far lower", () => {
    const bad = healthScore({ ...typical, sdnnMs: 45, restingHrBpm: 66, sleepHours: 5 });
    const good = healthScore(typical) as number;
    expect(bad as number).toBeLessThan(good - 25);
  });

  it("returns null when nothing is known", () => {
    expect(healthScore({ sdnnMs: null, baselineSdnn: null, restingHrBpm: null, baselineRhr: null, sleepHours: null, sleepMedian: null, lfHf: null })).toBeNull();
  });

  it("focus peaks near LF/HF balance and falls off both ways", () => {
    const balanced = focusFromLfHf(1.6);
    expect(balanced).toBeGreaterThan(95);
    expect(focusFromLfHf(6)).toBeLessThan(balanced - 40);
    expect(focusFromLfHf(0.2)).toBeLessThan(balanced - 40);
  });

  it("focus proxy tracks the HRV direction", () => {
    const up = focusProxy({ ...typical, sdnnMs: 140 });
    const down = focusProxy({ ...typical, sdnnMs: 60 });
    expect(up as number).toBeGreaterThan(down as number);
  });
});

describe("ansBalance", () => {
  it("LF/HF 1.0 splits 50/50; 3.0 leans sympathetic 75/25", () => {
    expect(ansBalance({ lfHf: 1, sdnnMs: null, baselineSdnn: null })).toEqual({ symPct: 50, paraPct: 50, basis: "lfhf" });
    const b = ansBalance({ lfHf: 3, sdnnMs: null, baselineSdnn: null });
    expect(b?.symPct).toBe(75);
    expect(b?.basis).toBe("lfhf");
  });

  it("falls back to the labeled SDNN proxy without a spectrum", () => {
    const b = ansBalance({ lfHf: null, sdnnMs: 150, baselineSdnn: 100 });
    expect(b?.basis).toBe("sdnn-proxy");
    expect(b?.paraPct as number).toBeGreaterThan(55);
  });
});

describe("segmentHeartDay — state segmentation priority", () => {
  const windows = {
    sleep: [[0, 7]] as Array<[number, number]>,
    workouts: [[12, 13]] as Array<[number, number]>,
    breathingHours: new Set([21]),
  };

  it("exercise beats sleep, mindfulness beats move, move needs steps, else rest", () => {
    const buckets = [
      bucket(3, 52, 0), // sleep
      bucket(12, 150, 800), // exercise (inside workout window)
      bucket(18, 80, 2000), // move (high steps, no window)
      bucket(21, 60, 10), // mindfulness (breathing hour)
      bucket(15, 70, 100), // rest
    ];
    const { points, peak } = segmentHeartDay(buckets, windows);
    expect(points.map((p) => p.state)).toEqual(["sleep", "exercise", "move", "mindfulness", "rest"]);
    expect(peak).toEqual({ hr: 150, hour: 12 });
  });

  it("a workout window inside the sleep window still reads exercise", () => {
    const buckets = [bucket(5, 130, 0)];
    const { points } = segmentHeartDay(buckets, { sleep: [[0, 7]], workouts: [[5, 6]], breathingHours: new Set() });
    expect(points[0].state).toBe("exercise");
  });
});

describe("keyInsights — generated from the day's own numbers", () => {
  it("mentions the actual SDNN delta and stationary minutes", () => {
    const lines = keyInsights({
      stress: 40,
      battery: 60,
      health: 70,
      sdnnMs: 130,
      baselineSdnn: 100,
      restingHrBpm: 55,
      baselineRhr: 55,
      sleepHours: 7.6,
      stressMinutes: 120,
    });
    const joined = lines.join(" ");
    expect(joined).toContain("130 ms");
    expect(joined).toContain("+30%");
    expect(joined).toContain("120 minutes");
    expect(lines.length).toBeLessThanOrEqual(4);
  });

  it("says nothing when nothing is known", () => {
    expect(
      keyInsights({ stress: null, battery: null, health: null, sdnnMs: null, baselineSdnn: null, restingHrBpm: null, baselineRhr: null, sleepHours: null, stressMinutes: null }),
    ).toEqual([]);
  });
});
