/**
 * OpenHRV — My Data category summaries (pure functions, unit-tested).
 * Mirrors the reference app's category-detail structure (Activity,
 * Blood Pressure, Health, Body, Sleep & Mind) over the normalized
 * health_samples store. Every number shown comes from a stored sample.
 */

export interface SampleRow {
  type: string;
  value: number | null;
  unit: string;
  start_at: string;
  source: string;
}

export interface MetricSummary {
  type: string;
  label: string;
  count: number;
  latest: { value: number; unit: string; at: string; source: string } | null;
  avg7d: number | null;
  min: number | null;
  max: number | null;
}

export interface CategorySummary {
  key: string;
  title: string;
  blurb: string;
  metrics: MetricSummary[];
  sampleCount: number;
}

const DAY_MS = 86400000;

const CATEGORY_DEFS: Array<{
  key: string;
  title: string;
  blurb: string;
  metrics: Array<{ type: string; label: string }>;
}> = [
  {
    key: "activity",
    title: "Activity",
    blurb: "Steps, energy and workouts from Apple Health and Strava.",
    metrics: [
      { type: "step_count", label: "Steps" },
      { type: "active_energy", label: "Active energy" },
      { type: "workout", label: "Workouts" },
      { type: "distance_walking_running", label: "Walking + running distance" },
    ],
  },
  {
    key: "blood-pressure",
    title: "Blood Pressure",
    blurb: "Systolic and diastolic readings, paired on the detail page.",
    metrics: [
      { type: "blood_pressure_systolic", label: "Systolic" },
      { type: "blood_pressure_diastolic", label: "Diastolic" },
    ],
  },
  {
    key: "health",
    title: "Health",
    blurb: "Heart and respiratory markers imported from Apple Health.",
    metrics: [
      { type: "hrv_sdnn", label: "HRV (SDNN)" },
      { type: "resting_heart_rate", label: "Resting heart rate" },
      { type: "heart_rate", label: "Heart rate" },
      { type: "spo2", label: "Blood oxygen (SpO2)" },
      { type: "respiratory_rate", label: "Respiratory rate" },
    ],
  },
  {
    key: "body",
    title: "Body",
    blurb: "Body measurements (Withings joins this category in phase 2).",
    metrics: [{ type: "body_mass", label: "Body mass" }],
  },
  {
    key: "sleep-mind",
    title: "Sleep & Mind",
    blurb: "Sleep analysis and mindful minutes alongside the Sleep page.",
    metrics: [
      { type: "sleep_analysis", label: "Sleep analysis records" },
      { type: "mindful_session", label: "Mindful sessions" },
    ],
  },
];

export function categoryDefs(): Array<{ key: string; title: string; blurb: string }> {
  return CATEGORY_DEFS.map(({ key, title, blurb }) => ({ key, title, blurb }));
}

export function summarizeCategories(samples: SampleRow[], nowIso: string): CategorySummary[] {
  const now = new Date(nowIso).getTime();
  return CATEGORY_DEFS.map((def) => {
    const metrics: MetricSummary[] = def.metrics.map((m) => {
      const rows = samples
        .filter((s) => s.type === m.type && s.value !== null)
        .sort((a, b) => (a.start_at < b.start_at ? 1 : -1));
      const vals = rows.map((r) => Number(r.value));
      const recent = rows.filter((r) => now - new Date(String(r.start_at).replace(" ", "T")).getTime() <= 7 * DAY_MS);
      return {
        type: m.type,
        label: m.label,
        count: rows.length,
        latest: rows.length
          ? { value: Number(rows[0].value), unit: rows[0].unit, at: rows[0].start_at, source: rows[0].source }
          : null,
        avg7d: recent.length ? Math.round((recent.reduce((a, r) => a + Number(r.value), 0) / recent.length) * 10) / 10 : null,
        min: vals.length ? Math.min(...vals) : null,
        max: vals.length ? Math.max(...vals) : null,
      };
    });
    return {
      key: def.key,
      title: def.title,
      blurb: def.blurb,
      metrics,
      sampleCount: metrics.reduce((a, m) => a + m.count, 0),
    };
  });
}

/** Pair systolic/diastolic samples that share a timestamp into BP readings. */
export function bloodPressureReadings(
  samples: SampleRow[],
  limit = 30,
): Array<{ at: string; systolic: number; diastolic: number; source: string }> {
  const dia = new Map<string, SampleRow>();
  for (const s of samples) if (s.type === "blood_pressure_diastolic" && s.value !== null) dia.set(String(s.start_at), s);
  const out: Array<{ at: string; systolic: number; diastolic: number; source: string }> = [];
  for (const s of samples) {
    if (s.type !== "blood_pressure_systolic" || s.value === null) continue;
    const d = dia.get(String(s.start_at));
    if (d) out.push({ at: s.start_at, systolic: Number(s.value), diastolic: Number(d.value), source: s.source });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
}
