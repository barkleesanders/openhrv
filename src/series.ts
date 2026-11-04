/**
 * OpenHRV — time-series shaping for the chart system (granularity wave).
 *
 * health_samples holds two grains side by side: daily rollups (the original
 * sync) and hourly points (meta granularity = "hourly", added by the
 * granularity-wave sync). These pure helpers turn stored rows into chart
 * points at the grain a view asks for, and compute the insight caption
 * every chart carries. Unit-tested; no I/O.
 */

import type { ChartPoint } from "./chart";

export interface SeriesRow {
  type: string;
  value: number | null;
  unit: string;
  start_at: string;
  granularity?: string;
}

/** Types whose daily value is a SUM of the day's daily-grain rows (the
 *  connector emits one daily row per type, but other lanes may emit
 *  several). Everything else takes the day's LATEST daily row. */
export const SUM_TYPES: ReadonlySet<string> = new Set([
  "step_count",
  "active_energy",
  "basal_energy",
  "distance_walking_running",
]);

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 3" from a YYYY-MM-DD slice (noon-UTC weekday math — TZ-safe). */
export function dayLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  if (!Number.isFinite(d.getTime())) return dateStr;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function dayFull(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  if (!Number.isFinite(d.getTime())) return dateStr;
  return `${WEEKDAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

const isHourly = (r: SeriesRow): boolean => r.granularity === "hourly";

/** Hourly points for one local date (YYYY-MM-DD), oldest → newest. */
export function hourlyPoints(rows: SeriesRow[], dateStr: string): ChartPoint[] {
  return rows
    .filter((r) => isHourly(r) && r.value !== null && String(r.start_at).slice(0, 10) === dateStr)
    .sort((a, b) => (a.start_at < b.start_at ? -1 : 1))
    .map((r) => {
      const hh = String(r.start_at).slice(11, 13);
      return {
        v: Number(r.value),
        label: `${hh}:00`,
        full: `${dayFull(dateStr)} · ${hh}:00 · ${Number(r.value)}`,
      };
    });
}

/** Daily-grain points for the `days`-long window ending at endDate
 *  (inclusive), oldest → newest. Days with no data are skipped, never
 *  zero-filled — a gap is honest, an invented zero is not. */
export function dailyPoints(rows: SeriesRow[], endDate: string, days: number): ChartPoint[] {
  const mode = rows.length && SUM_TYPES.has(rows[0].type) ? "sum" : "latest";
  const byDate = new Map<string, SeriesRow[]>();
  for (const r of rows) {
    if (isHourly(r) || r.value === null) continue;
    const d = String(r.start_at).slice(0, 10);
    if (d > endDate) continue;
    const arr = byDate.get(d) ?? [];
    arr.push(r);
    byDate.set(d, arr);
  }
  const dates = [...byDate.keys()].sort().slice(-days);
  return dates.map((d) => {
    const dayRows = byDate.get(d)!.sort((a, b) => (a.start_at < b.start_at ? -1 : 1));
    const v =
      mode === "sum"
        ? dayRows.reduce((a, r) => a + Number(r.value), 0)
        : Number(dayRows[dayRows.length - 1].value);
    return { v: Math.round(v * 10) / 10, label: dayLabel(d), full: `${dayFull(d)} · ${Math.round(v * 10) / 10}` };
  });
}

/** Median of daily-grain values strictly BEFORE `beforeDate`, looking back
 *  at most `lookbackDays` — the personal baseline captions compare against. */
export function baselineMedian(rows: SeriesRow[], beforeDate: string, lookbackDays = 60): number | null {
  const mode = rows.length && SUM_TYPES.has(rows[0].type) ? "sum" : "latest";
  const byDate = new Map<string, number>();
  const sorted = [...rows].filter((r) => !isHourly(r) && r.value !== null).sort((a, b) => (a.start_at < b.start_at ? -1 : 1));
  for (const r of sorted) {
    const d = String(r.start_at).slice(0, 10);
    if (d >= beforeDate) continue;
    if (mode === "sum") byDate.set(d, (byDate.get(d) ?? 0) + Number(r.value));
    else byDate.set(d, Number(r.value));
  }
  const dates = [...byDate.keys()].sort().slice(-lookbackDays);
  if (!dates.length) return null;
  const vals = dates.map((d) => byDate.get(d)!).sort((a, b) => a - b);
  const m = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2;
}

export interface SeriesCaption {
  avg: number;
  min: number;
  max: number;
  peakFull: string;
  baselineDeltaPct: number | null;
  text: string;
}

/** The one-line insight caption every chart carries: average, range, peak
 *  moment, and (when a baseline exists) how this window compares to the
 *  owner's own prior baseline. All numbers derive from the visible points. */
export function seriesCaption(
  points: ChartPoint[],
  unit: string,
  decimals: number,
  baseline: number | null,
): SeriesCaption | null {
  if (!points.length) return null;
  const fmt = (v: number): string => (decimals > 0 ? v.toFixed(decimals) : String(Math.round(v)));
  const vals = points.map((p) => p.v);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const peak = points[vals.indexOf(max)];
  const baselineDeltaPct =
    baseline !== null && baseline !== 0 ? Math.round(((avg - baseline) / Math.abs(baseline)) * 1000) / 10 : null;
  const peakWhen = peak.full.replace(/ · [^·]*$/, "");
  let text = `Avg ${fmt(avg)}${unit ? " " + unit : ""} · range ${fmt(min)}–${fmt(max)}${unit ? " " + unit : ""} · peak ${fmt(max)}${unit ? " " + unit : ""} · ${peakWhen}`;
  if (baselineDeltaPct !== null && baseline !== null) {
    text += ` · ${baselineDeltaPct >= 0 ? "+" : ""}${baselineDeltaPct}% vs your baseline (${fmt(baseline)}${unit ? " " + unit : ""})`;
  }
  return { avg, min, max, peakFull: peak.full, baselineDeltaPct, text };
}
