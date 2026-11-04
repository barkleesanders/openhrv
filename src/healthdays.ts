/**
 * OpenHRV — per-day health inputs derived from the normalized health_samples
 * store (Apple Health via Health Auto Export / Muse connector / Shortcut
 * lanes) plus the sleep table.
 *
 * The daily-aggregate path is a first-class gauge input (SPEC.md "Aggregate
 * score mappings"): in the reference app, imported Apple Health HRV is what
 * drives the morning gauges. Pure functions — no I/O, unit-tested.
 */

export interface HealthSampleLike {
  type: string;
  value: number | null;
  start_at: string;
  source?: string;
}

/** HRV SDNN lands under the canonical type plus two lane-specific variants. */
export const HRV_SDNN_TYPES: readonly string[] = ["hrv_sdnn", "hrv_sdnn_ms", "heart_rate_variability_sdnn"];
const CANONICAL_SDNN = "hrv_sdnn";

export interface HealthDay {
  date: string; // local calendar date (date slice of the stored timestamp)
  sdnnMs: number | null;
  sdnnSource: string | null;
  restingHrBpm: number | null;
  heartRateAvgBpm: number | null;
  steps: number | null;
  sleepHours: number | null; // longest sleep ending this date
}

export function healthDays(
  samples: HealthSampleLike[],
  sleep: Array<{ end_at: string; duration_s: number }>,
): HealthDay[] {
  const byDate = new Map<string, HealthDay>();
  const day = (date: string): HealthDay => {
    let d = byDate.get(date);
    if (!d) {
      d = {
        date,
        sdnnMs: null,
        sdnnSource: null,
        restingHrBpm: null,
        heartRateAvgBpm: null,
        steps: null,
        sleepHours: null,
      };
      byDate.set(date, d);
    }
    return d;
  };

  // SDNN per day: the canonical daily rollup wins; variant one-offs from
  // other lanes are only a fallback. Within the winning type, the latest
  // sample of the day is the day's value.
  const sdnnPick = new Map<string, { canonical: HealthSampleLike | null; variant: HealthSampleLike | null }>();
  const latestByType = new Map<string, HealthSampleLike>(); // `${date}|${type}` -> latest row
  for (const s of samples) {
    if (s.value === null) continue;
    const date = String(s.start_at).slice(0, 10);
    if (HRV_SDNN_TYPES.includes(s.type)) {
      const key = `${date}|${s.type}`;
      const prev = latestByType.get(key);
      if (!prev || String(s.start_at) > String(prev.start_at)) latestByType.set(key, s);
    }
    if (s.type === "resting_heart_rate" || s.type === "heart_rate") {
      const key = `${date}|${s.type}`;
      const prev = latestByType.get(key);
      if (!prev || String(s.start_at) > String(prev.start_at)) latestByType.set(key, s);
    }
    if (s.type === "step_count") {
      const d = day(date);
      d.steps = (d.steps ?? 0) + Number(s.value);
    }
  }
  for (const [key, s] of latestByType) {
    const [date, type] = key.split("|");
    const d = day(date);
    if (HRV_SDNN_TYPES.includes(type)) {
      let pick = sdnnPick.get(date);
      if (!pick) {
        pick = { canonical: null, variant: null };
        sdnnPick.set(date, pick);
      }
      if (type === CANONICAL_SDNN) pick.canonical = s;
      else if (!pick.variant || String(s.start_at) > String(pick.variant.start_at)) pick.variant = s;
    } else if (type === "resting_heart_rate") {
      d.restingHrBpm = Number(s.value);
    } else if (type === "heart_rate") {
      d.heartRateAvgBpm = Number(s.value);
    }
  }
  for (const [date, pick] of sdnnPick) {
    const chosen = pick.canonical ?? pick.variant;
    if (!chosen) continue;
    const d = day(date);
    d.sdnnMs = Number(chosen.value);
    d.sdnnSource = chosen.source ?? null;
  }

  // Sleep: longest record ending that date wins (main sleep, not a nap) —
  // same rule the Lab builder uses.
  for (const s of sleep) {
    const d = day(String(s.end_at).slice(0, 10));
    const hrs = Number(s.duration_s) / 3600;
    if (hrs > 0 && (d.sleepHours === null || hrs > d.sleepHours)) d.sleepHours = hrs;
  }

  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}
