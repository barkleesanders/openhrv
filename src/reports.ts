/**
 * OpenHRV — Phase 2 report computations (pure, unit-tested).
 *
 * Stress Impact, Activity and Heart reports + the Health / Focus scores,
 * ANS balance and generated Key Insights. Every formula here is an
 * original, documented heuristic over the owner's own stored data —
 * behavior modeled on mainstream HRV apps, wording and math our own.
 * Anything estimated is labeled an estimate at the call site; anything
 * unknowable at the stored grain returns null instead of a guess.
 */

import { clamp } from "./insights";

export interface HourBucket {
  hour: number; // 0-23 local
  hr: number | null;
  steps: number | null;
  sdnn: number | null;
  activeKcal: number | null;
}

/** An hour counts as ELEVATED when its mean HR is at least 20% above the
 *  personal resting baseline; STATIONARY when it has fewer than 50 steps.
 *  Both thresholds are stated on the report page itself. */
export const ELEVATED_RATIO = 1.2;
export const STATIONARY_STEPS = 50;

export interface StressImpact {
  hoursWithData: number;
  stressMinutes: number | null; // null when no hourly HR exists
  morningLevelPct: number | null;
  elevatedHours: number;
  stationaryStressHours: number;
}

/** Stationary stress: heart working hard while the body sits still.
 *  At hourly grain each qualifying hour contributes a full hour — the
 *  page labels the number "at hourly resolution". */
export function stressImpactDay(buckets: HourBucket[], restingBaseline: number | null): StressImpact {
  const withHr = buckets.filter((b) => b.hr !== null);
  if (!withHr.length || restingBaseline === null || restingBaseline <= 0) {
    return { hoursWithData: withHr.length, stressMinutes: null, morningLevelPct: null, elevatedHours: 0, stationaryStressHours: 0 };
  }
  let elevated = 0;
  let stationaryStress = 0;
  for (const b of withHr) {
    if ((b.hr as number) >= restingBaseline * ELEVATED_RATIO) {
      elevated++;
      if ((b.steps ?? 0) < STATIONARY_STEPS) stationaryStress++;
    }
  }
  // Morning level: mean positive elevation (%) across the first three
  // hours with HR data from 04:00 on — how "revved" the morning started.
  const morning = withHr.filter((b) => b.hour >= 4).slice(0, 3);
  const morningLevelPct = morning.length
    ? Math.round(clamp((morning.reduce((a, b) => a + Math.max(0, ((b.hr as number) - restingBaseline) / restingBaseline), 0) / morning.length) * 100, 0, 100))
    : null;
  return {
    hoursWithData: withHr.length,
    stressMinutes: stationaryStress * 60,
    morningLevelPct,
    elevatedHours: elevated,
    stationaryStressHours: stationaryStress,
  };
}

export interface ActivityInput {
  buckets: HourBucket[];
  stepsDaily: number | null;
  activeKcalDaily: number | null;
  basalKcalDaily: number | null;
  workoutMinutes: number;
  restingBaseline: number | null;
  maxHrObserved: number | null;
  sleepHoursSet: Set<number>; // hours spent asleep (excluded from sedentary)
}

export interface ActivityDay {
  activeMinutes: number;
  activeMets: number | null; // MET-minutes, HR-reserve estimate
  activeCal: number | null;
  sedentaryMinutes: number;
  steps: number | null;
  totalCal: number | null;
  intenseMinutes: number;
  intenseMets: number | null;
  standHours: number;
  hoursWithData: number;
}

/** MET level from heart-rate reserve: 1 MET at rest scaling to ~10 METs
 *  at the observed max HR. An estimate by construction — labeled so. */
export function metLevel(hr: number, resting: number, maxHr: number): number {
  if (maxHr <= resting) return 1;
  return 1 + clamp((hr - resting) / (maxHr - resting), 0, 1) * 9;
}

export function activityDay(inp: ActivityInput): ActivityDay {
  const resting = inp.restingBaseline ?? 60;
  const maxHr = inp.maxHrObserved ?? 190;
  let activeHours = 0;
  let sedentaryHours = 0;
  let standHours = 0;
  let intenseHours = 0;
  let metMinutes = 0;
  let intenseMetMinutes = 0;
  let metHours = 0;
  for (const b of inp.buckets) {
    const steps = b.steps ?? 0;
    if (steps >= 100) standHours++;
    const isActive = steps >= 500 || (b.hr !== null && b.hr >= resting * 1.25);
    if (isActive) activeHours++;
    const waking = b.hour >= 6 && b.hour <= 22 && !inp.sleepHoursSet.has(b.hour);
    if (waking && steps < 100) sedentaryHours++;
    if (b.hr !== null) {
      const ml = metLevel(b.hr, resting, maxHr);
      if (isActive) {
        metMinutes += ml * 60;
        metHours++;
      }
      const intenseThreshold = resting + 0.75 * (maxHr - resting);
      if (b.hr >= intenseThreshold) {
        intenseHours++;
        intenseMetMinutes += ml * 60;
      }
    }
  }
  const activeMinutes = Math.max(activeHours * 60, inp.workoutMinutes);
  const intenseMinutes = Math.max(intenseHours * 60, 0);
  return {
    activeMinutes,
    activeMets: metHours ? Math.round(metMinutes) : null,
    activeCal: inp.activeKcalDaily,
    sedentaryMinutes: sedentaryHours * 60,
    steps: inp.stepsDaily,
    totalCal:
      inp.activeKcalDaily !== null && inp.basalKcalDaily !== null
        ? Math.round(inp.activeKcalDaily + inp.basalKcalDaily)
        : null,
    intenseMinutes,
    intenseMets: intenseHours ? Math.round(intenseMetMinutes) : null,
    standHours,
    hoursWithData: inp.buckets.length,
  };
}

// ------------------------------------------------------------------ scores

export function healthState(v: number): string {
  return v >= 75 ? "Stable" : v >= 55 ? "Steady" : v >= 35 ? "Strained" : "Depleted";
}
export function focusState(v: number): string {
  return v >= 70 ? "Sharp" : v >= 45 ? "Moderate" : v >= 25 ? "Foggy" : "Scattered";
}
/** Stress state labels for the trio (Welltory-style wording, our scale):
 *  reuses the insights stress bands but names the middle band Elevated's
 *  neighbor consistently across pages. */
export function trioStressState(v: number): string {
  return v < 25 ? "Low" : v < 50 ? "Moderate" : v < 75 ? "Elevated" : "High";
}
export function trioEnergyState(v: number): string {
  return v >= 75 ? "Charged" : v >= 45 ? "Moderate" : v >= 25 ? "Low" : "Depleted";
}
export function stateColor(state: string): string {
  const good = ["Stable", "Sharp", "Charged", "Low", "Steady"];
  const mid = ["Moderate", "Elevated", "Foggy"];
  if (good.includes(state)) return "#34c759";
  if (mid.includes(state)) return "#ffcc00";
  return "#ff453a";
}

export interface HealthFocusInput {
  sdnnMs: number | null;
  baselineSdnn: number | null;
  restingHrBpm: number | null;
  baselineRhr: number | null;
  sleepHours: number | null;
  sleepMedian: number | null;
  lfHf: number | null; // measurement days only
}

/** Health: how the body's core markers sit vs the personal baseline —
 *  HRV level (50%), resting HR (25%), sleep duration vs own median (25%).
 *  Missing components renormalize; all missing -> null. */
export function healthScore(inp: HealthFocusInput): number | null {
  const parts: Array<[number, number]> = []; // [score, weight]
  if (inp.sdnnMs !== null && inp.baselineSdnn) {
    parts.push([clamp(62 + 38 * Math.log(inp.sdnnMs / inp.baselineSdnn)), 0.5]);
  }
  if (inp.restingHrBpm !== null && inp.baselineRhr) {
    parts.push([clamp(70 - (inp.restingHrBpm - inp.baselineRhr) * 4), 0.25]);
  }
  if (inp.sleepHours !== null) {
    const ref = inp.sleepMedian ?? 8;
    parts.push([clamp(100 - Math.abs(inp.sleepHours - ref) * 14), 0.25]);
  }
  if (!parts.length) return null;
  const w = parts.reduce((a, p) => a + p[1], 0);
  return Math.round(parts.reduce((a, p) => a + p[0] * p[1], 0) / w);
}

/** Focus from a real LF/HF: peaks near a balanced ratio (~1.6) and falls
 *  off in both directions (drowsy << 1, wired >> 3). */
export function focusFromLfHf(lfHf: number): number {
  return Math.round(clamp(100 - 45 * Math.abs(Math.log(Math.max(0.05, lfHf) / 1.6))));
}

/** Focus proxy for aggregate days (no spectrum exists): HRV level vs
 *  baseline, taxed by resting HR above baseline. ALWAYS labeled estimate. */
export function focusProxy(inp: HealthFocusInput): number | null {
  if (inp.sdnnMs === null || !inp.baselineSdnn) return null;
  let v = 55 + 45 * Math.log(inp.sdnnMs / inp.baselineSdnn);
  if (inp.restingHrBpm !== null && inp.baselineRhr) v -= 0.8 * Math.max(0, inp.restingHrBpm - inp.baselineRhr);
  return Math.round(clamp(v));
}

export interface AnsBalance {
  symPct: number;
  paraPct: number;
  basis: "lfhf" | "sdnn-proxy";
}

/** Nervous-system balance: sympathetic vs parasympathetic share.
 *  Real: from LF/HF (share = ratio / (1 + ratio)). Aggregate days: an
 *  SDNN-level proxy — higher variability reads as more parasympathetic. */
export function ansBalance(inp: { lfHf: number | null; sdnnMs: number | null; baselineSdnn: number | null }): AnsBalance | null {
  if (inp.lfHf !== null && inp.lfHf > 0) {
    const sym = Math.round((inp.lfHf / (1 + inp.lfHf)) * 100);
    return { symPct: sym, paraPct: 100 - sym, basis: "lfhf" };
  }
  if (inp.sdnnMs !== null && inp.baselineSdnn) {
    const para = Math.round(clamp(50 + 50 * Math.log(inp.sdnnMs / inp.baselineSdnn), 10, 90));
    return { symPct: 100 - para, paraPct: para, basis: "sdnn-proxy" };
  }
  return null;
}

// ------------------------------------------------------------- heart report

export type HeartState = "sleep" | "exercise" | "move" | "mindfulness" | "rest";

export const HEART_STATE_COLORS: Record<HeartState, string> = {
  sleep: "#0a84ff",
  exercise: "#34c759",
  move: "#ff9f0a",
  mindfulness: "#64d2ff",
  rest: "#d1d1d6",
};
export const HEART_STATE_LABELS: Record<HeartState, string> = {
  sleep: "Sleep",
  exercise: "Exercise",
  move: "Move",
  mindfulness: "Mindfulness",
  rest: "Rest",
};

export interface DayWindows {
  sleep: Array<[number, number]>; // [startHourFloat, endHourFloat] within the day
  workouts: Array<[number, number]>;
  breathingHours: Set<number>;
}

/** Segment one day's hourly HR by what the body was doing. Priority:
 *  exercise > mindfulness > sleep > move > rest (a workout inside the
 *  sleep window is still exercise; a breathing session beats the label
 *  its hour would otherwise get). */
export function segmentHeartDay(
  buckets: HourBucket[],
  w: DayWindows,
): { points: Array<{ hour: number; hr: number; state: HeartState }>; peak: { hr: number; hour: number } | null } {
  const inWin = (h: number, wins: Array<[number, number]>): boolean => wins.some(([a, b]) => h >= a && h < b);
  const points: Array<{ hour: number; hr: number; state: HeartState }> = [];
  let peak: { hr: number; hour: number } | null = null;
  for (const b of buckets) {
    if (b.hr === null) continue;
    let state: HeartState = "rest";
    if (inWin(b.hour, w.workouts)) state = "exercise";
    else if (w.breathingHours.has(b.hour)) state = "mindfulness";
    else if (inWin(b.hour, w.sleep)) state = "sleep";
    else if ((b.steps ?? 0) >= 500) state = "move";
    points.push({ hour: b.hour, hr: b.hr, state });
    if (!peak || b.hr > peak.hr) peak = { hr: b.hr, hour: b.hour };
  }
  return { points, peak };
}

// ------------------------------------------------------------ key insights

export interface InsightFacts {
  stress: number | null;
  battery: number | null;
  health: number | null;
  sdnnMs: number | null;
  baselineSdnn: number | null;
  restingHrBpm: number | null;
  baselineRhr: number | null;
  sleepHours: number | null;
  stressMinutes: number | null;
}

/** Generated narrative — original wording, assembled from the day's real
 *  numbers and deltas. 2-4 sentences; says nothing the data can't back. */
export function keyInsights(f: InsightFacts): string[] {
  const out: string[] = [];
  if (f.stress !== null && f.battery !== null) {
    if (f.stress >= 60 && f.battery < 55)
      out.push("Stress ran high while your charge stayed low — the kind of day that quietly costs more than it feels like. Keep the load light where you can and protect tonight's sleep.");
    else if (f.stress >= 60)
      out.push("Stress ran high today, but your charge held up — you absorbed it. Watch for a delayed dip tomorrow morning.");
    else if (f.battery >= 75)
      out.push("You woke up well recovered, with variability comfortably supporting a fuller day. If a hard session or a hard conversation is waiting, today is the better day for it.");
    else if (f.battery < 40)
      out.push("Recovery is thin today. Short walks, daylight and an earlier night will do more than pushing through.");
  }
  if (f.sdnnMs !== null && f.baselineSdnn) {
    const d = Math.round(((f.sdnnMs - f.baselineSdnn) / f.baselineSdnn) * 100);
    if (Math.abs(d) >= 10)
      out.push(`HRV (SDNN) came in at ${Math.round(f.sdnnMs)} ms, ${d >= 0 ? "+" : ""}${d}% versus your usual ${Math.round(f.baselineSdnn)} ms — ${d >= 0 ? "a stronger-than-usual recovery signal" : "a sign the system is still catching up"}.`);
  }
  if (f.sleepHours !== null) {
    if (f.sleepHours < 6.5) out.push(`Sleep was short at ${f.sleepHours.toFixed(1)} h — that alone explains a good part of today's numbers.`);
    else if (f.sleepHours >= 7.5) out.push(`Sleep did its job at ${f.sleepHours.toFixed(1)} h, right in the range where your next-day numbers usually look best.`);
  }
  if (f.stressMinutes !== null && f.stressMinutes > 0) {
    out.push(`Your heart spent about ${f.stressMinutes} minutes working hard while you were sitting still — stationary stress is the load this report watches, and breaking it up with short walks is what moves it.`);
  }
  if (f.restingHrBpm !== null && f.baselineRhr && f.restingHrBpm - f.baselineRhr >= 3) {
    out.push(`Resting heart rate sat ${Math.round(f.restingHrBpm - f.baselineRhr)} bpm above your usual ${Math.round(f.baselineRhr)} — worth noting if you also feel off; it often tags along with poor sleep, illness or accumulated fatigue.`);
  }
  return out.slice(0, 4);
}
