/**
 * OpenHRV — Science Lab series builder, correlations, and rule-based insights.
 * Pure functions over the owner's own stored data (no external calls).
 * Daily grain: a "day" is the local calendar date (UTC date slice of the
 * stored ISO timestamps, consistent with insights.ts dailyAggregates).
 */
import { dailyAggregates, type MeasurementLike } from "./insights";

export interface LabDay {
  date: string; // YYYY-MM-DD
  rmssd: number | null;
  battery: number | null;
  stress: number | null;
  pressure: number | null;
  sleepHours: number | null; // sleep that ENDED on this date (last night)
  steps: number | null;
  mood: number | null; // mean journal mood that day
  tags: string[]; // journal tags logged that day
}

export interface SleepRowLike {
  end_at: string;
  duration_s: number;
}
export interface SampleRowLike {
  type: string;
  value: number | null;
  start_at: string;
}
export interface JournalRowLike {
  created_at: string;
  mood: number;
  tags_json: string;
}

/** Assemble the daily series the Lab and Insights run on. */
export function buildLabDays(
  measurements: MeasurementLike[],
  sleep: SleepRowLike[],
  samples: SampleRowLike[],
  journal: JournalRowLike[],
): LabDay[] {
  const agg = dailyAggregates(measurements);
  const byDate = new Map<string, LabDay>();
  const day = (date: string): LabDay => {
    let d = byDate.get(date);
    if (!d) {
      d = { date, rmssd: null, battery: null, stress: null, pressure: null, sleepHours: null, steps: null, mood: null, tags: [] };
      byDate.set(date, d);
    }
    return d;
  };
  for (const a of agg) {
    const d = day(a.date);
    d.rmssd = a.rmssd;
    d.battery = a.battery;
    d.stress = a.stress;
    d.pressure = a.pressure;
  }
  for (const s of sleep) {
    const d = day(String(s.end_at).slice(0, 10));
    const hrs = Number(s.duration_s) / 3600;
    // Longest sleep record ending that date wins (main sleep, not a nap).
    if (d.sleepHours === null || hrs > d.sleepHours) d.sleepHours = hrs;
  }
  for (const s of samples) {
    if (s.type !== "step_count" || s.value === null) continue;
    const d = day(String(s.start_at).slice(0, 10));
    d.steps = (d.steps ?? 0) + Number(s.value);
  }
  const moods = new Map<string, number[]>();
  for (const j of journal) {
    const date = String(j.created_at).slice(0, 10);
    const d = day(date);
    moods.set(date, [...(moods.get(date) ?? []), Number(j.mood) || 5]);
    for (const t of JSON.parse(String(j.tags_json ?? "[]")) as string[]) {
      if (!d.tags.includes(t)) d.tags.push(t);
    }
  }
  for (const [date, ms] of moods) day(date).mood = ms.reduce((a, b) => a + b, 0) / ms.length;
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Pearson product-moment correlation over pairwise-complete observations. */
export function pearson(
  pairs: Array<{ x: number | null; y: number | null }>,
): { r: number; n: number } | null {
  const pts = pairs.filter(
    (p): p is { x: number; y: number } => p.x !== null && p.y !== null && Number.isFinite(p.x) && Number.isFinite(p.y),
  );
  if (pts.length < 5) return null;
  const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (const p of pts) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return { r: sxy / Math.sqrt(sxx * syy), n: pts.length };
}

export interface Correlation {
  x: string;
  y: string;
  r: number;
  n: number;
}

const SERIES_LABELS: Record<string, string> = {
  rmssd: "HRV · RMSSD",
  battery: "Battery",
  stress: "Stress",
  pressure: "Pressure",
  sleepHours: "Sleep (h)",
  steps: "Steps",
  mood: "Mood",
};
export const labSeriesLabel = (k: string): string => SERIES_LABELS[k] ?? k;

/** Ranked correlations across every numeric daily series + frequent tags. */
export function correlationPairs(days: LabDay[], limit = 12): Correlation[] {
  const keys = Object.keys(SERIES_LABELS) as Array<keyof typeof SERIES_LABELS>;
  const series = new Map<string, Array<number | null>>();
  for (const k of keys) series.set(k, days.map((d) => d[k as keyof LabDay] as number | null));
  // Tag presence series for tags logged on >= 3 days.
  const tagCounts = new Map<string, number>();
  for (const d of days) for (const t of d.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  for (const [tag, n] of tagCounts) {
    if (n >= 3) series.set(`tag:${tag}`, days.map((d) => (d.tags.includes(tag) ? 1 : 0)));
  }
  const names = [...series.keys()];
  const out: Correlation[] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const xs = series.get(names[i])!;
      const ys = series.get(names[j])!;
      const res = pearson(xs.map((x, k) => ({ x, y: ys[k] })));
      if (res && Math.abs(res.r) >= 0.2) out.push({ x: names[i], y: names[j], r: res.r, n: res.n });
    }
  }
  return out.sort((a, b) => Math.abs(b.r) - Math.abs(a.r)).slice(0, limit);
}

export interface Insight {
  kind: string;
  severity: "good" | "info" | "warn";
  text: string;
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (v: number): string => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`;

/**
 * Rule-based insights from the daily series. Every rule needs a minimum
 * sample and reports the numbers it used — no invented effects.
 * `nowIso` is injectable for tests.
 */
export function generateInsights(days: LabDay[], nowIso: string, breathingDates: Set<string> = new Set()): Insight[] {
  const out: Insight[] = [];
  const scored = days.filter((d) => d.rmssd !== null);
  const last = scored[scored.length - 1];

  // Measurement recency.
  if (last) {
    const gapDays = Math.floor((new Date(nowIso).getTime() - new Date(`${last.date}T12:00:00Z`).getTime()) / 86400000);
    if (gapDays >= 2) {
      out.push({ kind: "gap", severity: "info", text: `No HRV measurement in ${gapDays} days — a short morning reading keeps your Battery and Stress scores honest.` });
    }
  } else {
    out.push({ kind: "gap", severity: "info", text: "No measurements yet — take your first HRV reading to start your personal baselines." });
    return out;
  }

  // RMSSD vs the prior baseline (up to 14 earlier scored days).
  const prior = scored.slice(0, -1).slice(-14);
  if (prior.length >= 5 && last.rmssd !== null) {
    const base = mean(prior.map((d) => d.rmssd!));
    const delta = ((last.rmssd - base) / base) * 100;
    if (Math.abs(delta) >= 10) {
      out.push({
        kind: "rmssd_vs_baseline",
        severity: delta < 0 ? "warn" : "good",
        text: `Latest RMSSD is ${pct(delta)} versus your ${prior.length}-day baseline (${last.rmssd.toFixed(0)} ms vs ${base.toFixed(0)} ms)${delta < 0 ? " — recovery may be lagging today." : " — a strong recovery signal."}`,
      });
    }
  }

  // Battery trend over the last 3 scored days.
  const last3 = scored.slice(-3);
  if (last3.length === 3 && last3.every((d) => d.battery !== null)) {
    const [a, b, c] = last3.map((d) => d.battery!);
    if (b < a && c < b && a - c >= 8) {
      out.push({ kind: "battery_trend", severity: "warn", text: `Battery has fallen three readings in a row (${a.toFixed(0)} → ${b.toFixed(0)} → ${c.toFixed(0)}). Prioritise sleep and an easier day.` });
    } else if (b > a && c > b && c - a >= 8) {
      out.push({ kind: "battery_trend", severity: "good", text: `Battery is climbing (${a.toFixed(0)} → ${b.toFixed(0)} → ${c.toFixed(0)}) — your recent load is suiting you.` });
    }
  }

  // Stress streak.
  let streak = 0;
  for (let i = scored.length - 1; i >= 0; i--) {
    if ((scored[i].stress ?? 0) >= 60) streak++;
    else break;
  }
  if (streak >= 3) {
    out.push({ kind: "stress_streak", severity: "warn", text: `Stress has scored 60+ on ${streak} consecutive measured days. A breathing session or a lighter evening is worth trying — then measure the effect.` });
  }

  // Sleep → next-measured-day RMSSD (sleep that ended that morning vs the
  // same day's RMSSD, the standard morning-reading pairing).
  const goodSleep = days.filter((d) => d.sleepHours !== null && d.sleepHours >= 7 && d.rmssd !== null);
  const shortSleep = days.filter((d) => d.sleepHours !== null && d.sleepHours < 6 && d.rmssd !== null);
  if (goodSleep.length >= 3 && shortSleep.length >= 3) {
    const g = mean(goodSleep.map((d) => d.rmssd!));
    const s = mean(shortSleep.map((d) => d.rmssd!));
    const delta = ((g - s) / s) * 100;
    if (Math.abs(delta) >= 8) {
      out.push({
        kind: "sleep_rmssd",
        severity: delta > 0 ? "good" : "info",
        text: `After 7h+ nights your RMSSD averages ${g.toFixed(0)} ms vs ${s.toFixed(0)} ms after short nights (${pct(delta)}, ${goodSleep.length + shortSleep.length} nights) — sleep is measurably moving your HRV.`,
      });
    }
  }

  // Sleep debt over the last 7 nights with sleep recorded.
  const withSleep = days.filter((d) => d.sleepHours !== null).slice(-7);
  if (withSleep.length >= 4) {
    const debt = withSleep.reduce((a, d) => a + Math.max(0, 8 - d.sleepHours!), 0);
    if (debt >= 5) {
      out.push({ kind: "sleep_debt", severity: "warn", text: `Sleep debt is about ${debt.toFixed(1)} h across your last ${withSleep.length} recorded nights (vs an 8 h target).` });
    }
  }

  // Breathing days vs other days (stress).
  if (breathingDates.size >= 3) {
    const onDays = scored.filter((d) => breathingDates.has(d.date));
    const offDays = scored.filter((d) => !breathingDates.has(d.date));
    if (onDays.length >= 3 && offDays.length >= 3) {
      const on = mean(onDays.map((d) => d.stress ?? 0));
      const off = mean(offDays.map((d) => d.stress ?? 0));
      if (off - on >= 5) {
        out.push({ kind: "breathing_effect", severity: "good", text: `On days you logged a breathing session, Stress averaged ${on.toFixed(0)} vs ${off.toFixed(0)} on other days (${onDays.length} vs ${offDays.length} days).` });
      }
    }
  }

  return out.slice(0, 6);
}
