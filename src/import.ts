/** OpenHRV — health-data import parsers (pure functions, unit-tested).
 *  Every parser emits NormalizedSample rows for the one normalized store,
 *  with source attribution preserved. */

export interface NormalizedSample {
  type: string;
  value: number | null;
  unit: string;
  start_at: string;
  end_at: string | null;
  source: string;
  external_id: string | null;
  meta: Record<string, unknown>;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** The real Health Auto Export app sends its own metric names
 *  ("heart_rate_variability", "blood_oxygen_saturation", ...). Map them
 *  onto OpenHRV's canonical sample types \u2014 without this, HAE-app data
 *  lands under raw names that no gauge, chart or category ever reads
 *  (found by the 2026-11-04 production sweep). external_id keeps the RAW
 *  name, so dedup keys of already-synced rows never change. */
const HAE_NAME_MAP: Record<string, string> = {
  heart_rate_variability: "hrv_sdnn",
  blood_oxygen_saturation: "spo2",
  basal_energy_burned: "basal_energy",
  walking_running_distance: "distance_walking_running",
};

/** Health Auto Export app JSON: { data: { metrics: [...], workouts: [...] } }
 *  (also accepts the metrics at top level). */
export function parseHealthAutoExport(root: unknown, source = "health_auto_export"): NormalizedSample[] {
  const out: NormalizedSample[] = [];
  const doc = (root as { data?: unknown })?.data ?? root;
  const metrics = (doc as { metrics?: unknown[] })?.metrics ?? [];
  for (const m of metrics as Array<Record<string, unknown>>) {
    const name = String(m.name ?? "unknown");
    const units = String(m.units ?? "");
    for (const pt of (m.data as Array<Record<string, unknown>>) ?? []) {
      const date = String(pt.date ?? new Date().toISOString());
      const meta: Record<string, unknown> = {};
      for (const k of ["value", "stage", "sleepStart", "sleepEnd", "inBedStart", "inBedEnd", "source", "stages"]) {
        if (pt[k] !== undefined) meta[k] = pt[k];
      }
      // Granularity wave: hourly points carry granularity:"hourly". Their
      // external_id gets an "hourly:" segment so a daily rollup and an
      // hourly point can never collide, while DAILY ids keep the exact
      // legacy format — existing rows keep deduping (no duplicate flood
      // on the first hourly sync).
      const hourly = pt.granularity === "hourly";
      if (hourly) meta.granularity = "hourly";
      out.push({
        type: HAE_NAME_MAP[name] ?? name,
        value: num(pt.qty),
        unit: units,
        start_at: date,
        end_at: typeof pt.sleepEnd === "string" ? pt.sleepEnd : null,
        source: typeof pt.source === "string" ? `${source}:${pt.source}` : source,
        external_id: hourly
          ? `${name}:hourly:${date}:${String(pt.source ?? "")}`
          : `${name}:${date}:${String(pt.source ?? "")}`,
        meta,
      });
    }
  }
  const workouts = (doc as { workouts?: unknown[] })?.workouts ?? [];
  for (const w of workouts as Array<Record<string, unknown>>) {
    const start = String(w.start ?? new Date().toISOString());
    out.push({
      type: "workout",
      value: num(w.duration),
      unit: "s",
      start_at: start,
      end_at: typeof w.end === "string" ? w.end : null,
      source,
      external_id: `workout:${start}:${String(w.name ?? "")}`,
      meta: {
        name: w.name ?? null,
        activeEnergy: w.activeEnergyBurned ?? null,
        distance: w.distance ?? null,
        avgHeartRate: (w.heartRateData as { avg?: number } | undefined)?.avg ?? null,
        maxHeartRate: (w.heartRateData as { max?: number } | undefined)?.max ?? null,
      },
    });
  }
  return out;
}

/** iOS Shortcuts payload: flexible —
 *  { samples: [{type, value, unit, date}] } | { metrics: [...] } (HAE shape) |
 *  flat { hrv_sdnn_ms: 62, resting_hr_bpm: 58, sleep_hours: 7.4, date?: ISO }. */
export function parseShortcutJson(root: unknown): NormalizedSample[] {
  const doc = root as Record<string, unknown>;
  if (Array.isArray(doc.samples)) {
    return (doc.samples as Array<Record<string, unknown>>).map((s) => ({
      type: String(s.type ?? "sample"),
      value: num(s.value),
      unit: String(s.unit ?? ""),
      start_at: String(s.date ?? s.start ?? new Date().toISOString()),
      end_at: typeof s.end === "string" ? s.end : null,
      source: "shortcut",
      external_id: null,
      meta: (s.meta as Record<string, unknown>) ?? {},
    }));
  }
  if (Array.isArray(doc.metrics)) return parseHealthAutoExport(root, "shortcut");
  const date = typeof doc.date === "string" ? doc.date : new Date().toISOString();
  const units: Record<string, string> = {
    hrv_sdnn_ms: "ms", resting_hr_bpm: "bpm", heart_rate_bpm: "bpm",
    sleep_hours: "h", steps: "count", spo2_pct: "%", respiratory_rate: "br/min",
  };
  const out: NormalizedSample[] = [];
  for (const [k, v] of Object.entries(doc)) {
    const n = num(v);
    if (n !== null && k !== "date") {
      out.push({ type: k, value: n, unit: units[k] ?? "", start_at: date, end_at: null, source: "shortcut", external_id: null, meta: {} });
    }
  }
  return out;
}

const HK_TYPE_MAP: Record<string, string> = {
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: "hrv_sdnn",
  HKQuantityTypeIdentifierHeartRate: "heart_rate",
  HKQuantityTypeIdentifierRestingHeartRate: "resting_heart_rate",
  HKQuantityTypeIdentifierBloodPressureSystolic: "blood_pressure_systolic",
  HKQuantityTypeIdentifierBloodPressureDiastolic: "blood_pressure_diastolic",
  HKQuantityTypeIdentifierOxygenSaturation: "spo2",
  HKQuantityTypeIdentifierRespiratoryRate: "respiratory_rate",
  HKQuantityTypeIdentifierStepCount: "step_count",
  HKQuantityTypeIdentifierActiveEnergyBurned: "active_energy",
  HKQuantityTypeIdentifierBodyMass: "body_mass",
  HKCategoryTypeIdentifierSleepAnalysis: "sleep_analysis",
  HKCategoryTypeIdentifierMindfulSession: "mindful_session",
};

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}

/** Apple Health export.xml — Record elements (regex extraction; capped). */
export function parseExportXml(xml: string, source = "apple_health", cap = 5000): NormalizedSample[] {
  const out: NormalizedSample[] = [];
  const re = /<Record\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null && out.length < cap) {
    const tag = m[0];
    const rawType = attr(tag, "type") ?? "";
    const type = HK_TYPE_MAP[rawType] ?? rawType.replace(/^HK(Quantity|Category)TypeIdentifier/, "").toLowerCase();
    const start = attr(tag, "startDate");
    if (!start) continue;
    out.push({
      type,
      value: num(attr(tag, "value")),
      unit: attr(tag, "unit") ?? "",
      start_at: start.replace(" ", "T"),
      end_at: (attr(tag, "endDate") ?? "").replace(" ", "T") || null,
      source: `${source}:${attr(tag, "sourceName") ?? ""}`,
      external_id: `${rawType}:${start}:${attr(tag, "value") ?? ""}`,
      meta: {},
    });
  }
  return out;
}
