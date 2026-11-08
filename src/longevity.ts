/**
 * OpenHRV — wearables monthly projection, after PLSI's sleep_activity
 * map (github.com/Insilico-org/plsi, MIT): the last 3 calendar months
 * of sleep / resting HR / HRV / steps / training summarized per month.
 *
 * Pure function over health_samples-shaped rows. Granularity rules
 * mirror src/healthdays.ts: hourly rows never enter daily derivation;
 * per-day resting HR and SDNN take the day's latest daily row (SDNN:
 * the canonical hrv_sdnn type wins over lane variants); steps sum the
 * day's daily rows; sleep takes the LONGEST sleep_analysis record per
 * night (main sleep, not segments/naps). The route additionally maps
 * `sleep` table rows into sleep_analysis-shaped entries (value in
 * hours) before calling, the same merge healthDayInputs performs.
 */

import { HRV_SDNN_TYPES } from "./healthdays";

export interface MonthSampleRow {
  type: string;
  value: number | null;
  unit?: string;
  start_at: string;
  end_at?: string | null;
  granularity?: string;
}

export interface MonthSummary {
  month: string; // YYYY-MM
  partial: boolean; // the current calendar month
  sleepH: number | null; // mean hours per recorded night
  restingHr: number | null; // mean of daily resting HR
  hrvMs: number | null; // mean of daily SDNN
  stepsPerDay: number | null; // mean of daily step totals
  workoutMin: number | null; // total workout minutes in the month
  activeDays: number; // days with a daily step total > 0
  vo2max: number | null; // latest VO2max reading in the month
}

const VO2_TYPES: readonly string[] = ["vo2_max", "vo2max"];
const CANONICAL_SDNN = "hrv_sdnn";

const mean = (xs: number[]): number | null =>
  xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;

/** Sleep duration (hours) for one sleep_analysis row: the start->end
 *  span when both timestamps parse, else the value in its unit. */
function sleepHoursOf(r: MonthSampleRow): number | null {
  if (r.end_at) {
    const a = Date.parse(String(r.start_at).replace(" ", "T"));
    const b = Date.parse(String(r.end_at).replace(" ", "T"));
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) return (b - a) / 3_600_000;
  }
  if (r.value === null || !Number.isFinite(r.value)) return null;
  const u = (r.unit ?? "").toLowerCase();
  if (u === "h" || u === "hr" || u === "hours") return r.value;
  if (u === "min") return r.value / 60;
  if (u === "s" || u === "sec") return r.value / 3600;
  return r.value; // connector lane stores sleep durations in hours
}

function workoutMinutesOf(r: MonthSampleRow): number | null {
  if (r.value !== null && Number.isFinite(r.value)) {
    const u = (r.unit ?? "").toLowerCase();
    if (u === "s" || u === "sec") return r.value / 60;
    if (u === "min") return r.value;
    if (u === "h" || u === "hr") return r.value * 60;
  }
  if (r.end_at) {
    const a = Date.parse(String(r.start_at).replace(" ", "T"));
    const b = Date.parse(String(r.end_at).replace(" ", "T"));
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) return (b - a) / 60_000;
  }
  return null;
}

/** The last 3 calendar months (newest first), `today` = YYYY-MM-DD. */
export function monthMeans(rows: MonthSampleRow[], today: string): MonthSummary[] {
  const months: string[] = [];
  const [ty, tm] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  for (let i = 0; i < 3; i++) {
    const d = new Date(Date.UTC(ty, tm - 1 - i, 1));
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  const inScope = new Set(months);

  // Per-day buckets, following healthdays.ts conventions.
  const rhrByDay = new Map<string, { at: string; v: number }>();
  const sdnnByDay = new Map<string, { canonical: { at: string; v: number } | null; variant: { at: string; v: number } | null }>();
  const stepsByDay = new Map<string, number>();
  const sleepByNight = new Map<string, number>();
  const workoutMinByMonth = new Map<string, number>();
  const vo2ByMonth = new Map<string, { at: string; v: number }>();

  for (const r of rows) {
    if (r.value === null && r.type !== "sleep_analysis" && r.type !== "workout") continue;
    const date = String(r.start_at).slice(0, 10);
    const month = date.slice(0, 7);
    if (!inScope.has(month)) continue;

    if (r.type === "sleep_analysis") {
      const hrs = sleepHoursOf(r);
      if (hrs === null || hrs <= 0) continue;
      const night = String(r.end_at ?? r.start_at).slice(0, 10);
      if (!inScope.has(night.slice(0, 7))) continue;
      const prev = sleepByNight.get(night);
      if (prev === undefined || hrs > prev) sleepByNight.set(night, hrs);
      continue;
    }
    if (r.type === "workout") {
      const mins = workoutMinutesOf(r);
      if (mins !== null && mins > 0) workoutMinByMonth.set(month, (workoutMinByMonth.get(month) ?? 0) + mins);
      continue;
    }
    if (VO2_TYPES.includes(r.type)) {
      if (r.value === null) continue;
      const prev = vo2ByMonth.get(month);
      if (!prev || String(r.start_at) > prev.at) vo2ByMonth.set(month, { at: String(r.start_at), v: Number(r.value) });
      continue;
    }
    if (r.granularity === "hourly") continue;
    if (r.value === null) continue;
    if (r.type === "resting_heart_rate") {
      const prev = rhrByDay.get(date);
      if (!prev || String(r.start_at) > prev.at) rhrByDay.set(date, { at: String(r.start_at), v: Number(r.value) });
    } else if (HRV_SDNN_TYPES.includes(r.type)) {
      let pick = sdnnByDay.get(date);
      if (!pick) {
        pick = { canonical: null, variant: null };
        sdnnByDay.set(date, pick);
      }
      const slot = r.type === CANONICAL_SDNN ? "canonical" : "variant";
      const prev = pick[slot];
      if (!prev || String(r.start_at) > prev.at) pick[slot] = { at: String(r.start_at), v: Number(r.value) };
    } else if (r.type === "step_count") {
      stepsByDay.set(date, (stepsByDay.get(date) ?? 0) + Number(r.value));
    }
  }

  const byMonth = <T,>(m: Map<string, T>, month: string): T[] =>
    [...m.entries()].filter(([d]) => d.startsWith(month)).map(([, v]) => v);
  const nightsByMonth = (month: string): number[] =>
    [...sleepByNight.entries()].filter(([d]) => d.startsWith(month)).map(([, v]) => v);

  return months.map((month) => {
    const stepDays = byMonth(stepsByDay, month);
    return {
      month,
      partial: month === today.slice(0, 7),
      sleepH: mean(nightsByMonth(month)),
      restingHr: mean(byMonth(rhrByDay, month).map((x) => x.v)),
      hrvMs: mean(
        byMonth(sdnnByDay, month)
          .map((p) => (p.canonical ?? p.variant)?.v)
          .filter((v): v is number => v !== undefined),
      ),
      stepsPerDay: mean(stepDays),
      workoutMin: workoutMinByMonth.has(month) ? Math.round(workoutMinByMonth.get(month)!) : null,
      activeDays: stepDays.filter((v) => v > 0).length,
      vo2max: vo2ByMonth.get(month)?.v ?? null,
    };
  });
}
