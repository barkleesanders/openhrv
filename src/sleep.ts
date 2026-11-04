/**
 * OpenHRV — sleep summarisation (pure functions, unit-tested).
 * Nights come from the `sleep` table; stage totals come from imported
 * sleep_analysis samples when the source provides stage segments.
 */

export interface SleepNightRow {
  id?: number;
  start_at: string;
  end_at: string;
  duration_s: number;
  source: string;
  stages_json?: string;
}

export interface SleepNightSummary {
  date: string; // local date the sleep ended (YYYY-MM-DD slice)
  start_at: string;
  end_at: string;
  hours: number;
  debtH: number; // hours short of target (0 when at/over target)
  vsMedianPct: number | null; // vs the owner's median night
  source: string;
  stages: Record<string, number> | null; // stage -> minutes, when known
}

export interface SleepSummary {
  nights: SleepNightSummary[]; // most recent first
  count: number;
  medianHours: number | null;
  avgHours: number | null;
  lastNight: SleepNightSummary | null;
  debt7dH: number; // total debt across the last 7 recorded nights
  targetH: number;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Stage totals (minutes) from sleep_analysis samples inside a night window.
 *  Import shapes: Health Auto Export points carry meta.stage with qty in the
 *  metric's unit (hours); export.xml category values arrive as value=null, so
 *  only stage-bearing samples contribute. */
export function stageTotalsForNight(
  samples: Array<{ start_at: string; value: number | null; unit: string; meta_json?: string }>,
  startIso: string,
  endIso: string,
): Record<string, number> | null {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const totals = new Map<string, number>();
  for (const s of samples) {
    const t = new Date(String(s.start_at).replace(" ", "T")).getTime();
    if (!Number.isFinite(t) || t < start - 3600_000 || t > end + 3600_000) continue;
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(String(s.meta_json ?? "{}")) as Record<string, unknown>;
    } catch {
      meta = {};
    }
    // Granularity wave: the Muse Health connector exposes only stage
    // DURATIONS (no stage intervals), so the sync attaches them to the
    // night's sleep point as meta.stages = {stage: minutes}. Prefer that
    // object; else fall back to the single-stage meta.stage rows.
    const stagesObj = meta.stages;
    if (stagesObj && typeof stagesObj === "object" && !Array.isArray(stagesObj)) {
      for (const [k, v] of Object.entries(stagesObj as Record<string, unknown>)) {
        const mins = Number(v);
        if (Number.isFinite(mins) && mins > 0) totals.set(k.toLowerCase(), (totals.get(k.toLowerCase()) ?? 0) + mins);
      }
      continue;
    }
    const stage = typeof meta.stage === "string" ? meta.stage.toLowerCase() : null;
    if (!stage || s.value === null) continue;
    const minutes = s.unit === "min" ? s.value : s.unit === "h" || s.unit === "hr" ? s.value * 60 : s.value * 60;
    totals.set(stage, (totals.get(stage) ?? 0) + minutes);
  }
  if (!totals.size) return null;
  return Object.fromEntries([...totals.entries()].map(([k, v]) => [k, Math.round(v)]));
}

export function summarizeSleep(
  rows: SleepNightRow[],
  targetH = 8,
  stageSamples: Array<{ start_at: string; value: number | null; unit: string; meta_json?: string }> = [],
): SleepSummary {
  const sorted = [...rows].sort((a, b) => (a.end_at < b.end_at ? 1 : -1));
  const hours = sorted.map((r) => Number(r.duration_s) / 3600).filter((h) => h > 0);
  const med = hours.length ? median(hours) : null;
  const nights: SleepNightSummary[] = sorted.map((r) => {
    const h = Number(r.duration_s) / 3600;
    let stages: Record<string, number> | null = null;
    try {
      const parsed = JSON.parse(String(r.stages_json ?? "{}")) as Record<string, number>;
      if (Object.keys(parsed).length) stages = parsed;
    } catch {
      stages = null;
    }
    if (!stages && stageSamples.length) stages = stageTotalsForNight(stageSamples, r.start_at, r.end_at);
    return {
      date: String(r.end_at).slice(0, 10),
      start_at: r.start_at,
      end_at: r.end_at,
      hours: Math.round(h * 100) / 100,
      debtH: Math.round(Math.max(0, targetH - h) * 100) / 100,
      vsMedianPct: med ? Math.round(((h - med) / med) * 1000) / 10 : null,
      source: r.source,
      stages,
    };
  });
  const last7 = nights.slice(0, 7);
  return {
    nights,
    count: nights.length,
    medianHours: med !== null ? Math.round(med * 100) / 100 : null,
    avgHours: hours.length ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 100) / 100 : null,
    lastNight: nights[0] ?? null,
    debt7dH: Math.round(last7.reduce((a, n) => a + n.debtH, 0) * 10) / 10,
    targetH,
  };
}
