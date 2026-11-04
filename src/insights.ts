/**
 * OpenHRV — score mappings + factor-impact analysis (SPEC.md "Score mappings").
 * Pure functions; formulas are original heuristics over published HRV metrics.
 */

export const clamp = (v: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, v));

export function batteryCharge(rmssdMs: number, baselineRmssdMs: number | null): number {
  const ref = baselineRmssdMs && baselineRmssdMs > 0 ? baselineRmssdMs : 45;
  return clamp(62 + 38 * Math.log(rmssdMs / ref));
}
export function batteryState(v: number): string {
  return v >= 75 ? "Charged" : v >= 50 ? "Moderate" : v >= 25 ? "Low" : "Depleted";
}

export function stressPct(baevskySi: number, lfHfRatio: number): number {
  const siTerm = (100 * (Math.log(Math.max(1, baevskySi)) - Math.log(20))) / (Math.log(800) - Math.log(20));
  const lfTerm = clamp((lfHfRatio - 0.5) * 25, 0, 100);
  return clamp(0.8 * siTerm + 0.2 * lfTerm);
}
export function stressState(v: number): string {
  return v < 25 ? "Low" : v < 50 ? "Moderate" : v < 75 ? "High" : "Very high";
}

export function pressurePct(baevskySi: number, lfHfRatio: number): number {
  return clamp(baevskySi / 3.2 + Math.max(0, lfHfRatio - 1) * 6);
}
export function pressureState(v: number): string {
  return v < 33 ? "Light" : v < 66 ? "Loaded" : "Overloaded";
}

export interface MeasurementLike {
  taken_at: string;
  rmssd_ms: number;
  baevsky_si: number;
  lf_hf_ratio: number;
  source?: string;
}

export interface ScoredPoint {
  at: string;
  battery: number;
  stress: number;
  pressure: number;
  rmssd: number;
  si: number;
  lfhf: number;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Score a chronological series; each point's Battery baseline is the median
 *  RMSSD of all PRIOR points (cold-start reference 45 ms). */
export function scoreSeries(asc: MeasurementLike[]): ScoredPoint[] {
  const out: ScoredPoint[] = [];
  const prior: number[] = [];
  for (const m of asc) {
    const baseline = prior.length ? median(prior) : null;
    out.push({
      at: m.taken_at,
      battery: batteryCharge(m.rmssd_ms, baseline),
      stress: stressPct(m.baevsky_si, m.lf_hf_ratio),
      pressure: pressurePct(m.baevsky_si, m.lf_hf_ratio),
      rmssd: m.rmssd_ms,
      si: m.baevsky_si,
      lfhf: m.lf_hf_ratio,
    });
    prior.push(m.rmssd_ms);
  }
  return out;
}

export interface DayAggregate {
  date: string; // YYYY-MM-DD
  rmssd: number;
  battery: number;
  stress: number;
  pressure: number;
  count: number;
}

export function dailyAggregates(asc: MeasurementLike[]): DayAggregate[] {
  const scored = scoreSeries(asc);
  const byDay = new Map<string, ScoredPoint[]>();
  for (const p of scored) {
    const d = p.at.slice(0, 10);
    byDay.set(d, [...(byDay.get(d) ?? []), p]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, pts]) => ({
      date,
      rmssd: pts.reduce((a, p) => a + p.rmssd, 0) / pts.length,
      battery: pts.reduce((a, p) => a + p.battery, 0) / pts.length,
      stress: pts.reduce((a, p) => a + p.stress, 0) / pts.length,
      pressure: pts.reduce((a, p) => a + p.pressure, 0) / pts.length,
      count: pts.length,
    }));
}

export interface FactorMetricImpact {
  withMean: number;
  withoutMean: number;
  deltaPct: number; // (with - without) / without * 100
}
export interface FactorImpact {
  factor: string;
  nWith: number;
  nWithout: number;
  enoughData: boolean;
  metrics: { rmssd: FactorMetricImpact; battery: FactorMetricImpact; stress: FactorMetricImpact } | null;
}

export const MIN_FACTOR_DAYS = 3;

function metricImpact(days: DayAggregate[], withSet: Set<string>, pick: (d: DayAggregate) => number): FactorMetricImpact {
  const w = days.filter((d) => withSet.has(d.date)).map(pick);
  const wo = days.filter((d) => !withSet.has(d.date)).map(pick);
  const wm = w.reduce((a, b) => a + b, 0) / w.length;
  const wom = wo.reduce((a, b) => a + b, 0) / wo.length;
  return { withMean: wm, withoutMean: wom, deltaPct: wom !== 0 ? ((wm - wom) / Math.abs(wom)) * 100 : 0 };
}

/** Days-with vs days-without impact per factor, vs the personal baseline
 *  (the without-days ARE the baseline). Honest insufficient-data state below
 *  MIN_FACTOR_DAYS on either side. */
export function factorImpact(days: DayAggregate[], factors: Array<{ name: string; dates: Set<string> }>): FactorImpact[] {
  return factors.map((f) => {
    const nWith = days.filter((d) => f.dates.has(d.date)).length;
    const nWithout = days.length - nWith;
    const enoughData = nWith >= MIN_FACTOR_DAYS && nWithout >= MIN_FACTOR_DAYS;
    return {
      factor: f.name,
      nWith,
      nWithout,
      enoughData,
      metrics: enoughData
        ? {
            rmssd: metricImpact(days, f.dates, (d) => d.rmssd),
            battery: metricImpact(days, f.dates, (d) => d.battery),
            stress: metricImpact(days, f.dates, (d) => d.stress),
          }
        : null,
    };
  });
}
