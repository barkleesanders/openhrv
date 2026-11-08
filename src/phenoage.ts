/**
 * OpenHRV — blood PhenoAge (Levine 2018), ported from PLSI
 * (github.com/Insilico-org/plsi, MIT), src/plsi/map/derive.py.
 *
 * Method: Levine et al. 2018, "An epigenetic biomarker of aging for
 * lifespan and healthspan", doi:10.18632/aging.101414. The 9-marker
 * clinical PhenoAge: a Gompertz proportional-hazards model over
 * albumin, creatinine, glucose, CRP, lymphocyte %, MCV, RDW, ALP and
 * WBC plus chronological age, inverted through the 120-month mortality
 * score. Constants as verified against the BioAge reference
 * implementation via PLSI.
 *
 * PLSI boundary rule (kept): the 9 markers must come from the SAME
 * blood draw — never mix draws. Research/education, not a diagnosis.
 * Pure functions — no I/O, unit-tested against PLSI oracle vectors.
 */

export interface MarkerSpec {
  key: string;
  label: string;
  /** Canonical unit the formula consumes; lab_results stores this unit. */
  unit: string;
  /** Unit the entry form collects (US conventional). */
  entryUnit: string;
  /** canonical = entered * factor, when entered in entryUnit. */
  entryFactor: number;
}

export const MARKERS: MarkerSpec[] = [
  { key: "albumin", label: "Albumin", unit: "g/L", entryUnit: "g/dL", entryFactor: 10 },
  { key: "creatinine", label: "Creatinine", unit: "µmol/L", entryUnit: "mg/dL", entryFactor: 88.42 },
  { key: "glucose", label: "Glucose", unit: "mmol/L", entryUnit: "mg/dL", entryFactor: 0.0555062167 },
  { key: "crp", label: "CRP", unit: "mg/dL", entryUnit: "mg/L", entryFactor: 0.1 },
  { key: "lymphocyte_pct", label: "Lymphocytes", unit: "%", entryUnit: "%", entryFactor: 1 },
  { key: "mcv", label: "MCV", unit: "fL", entryUnit: "fL", entryFactor: 1 },
  { key: "rdw", label: "RDW", unit: "%", entryUnit: "%", entryFactor: 1 },
  { key: "alp", label: "ALP", unit: "U/L", entryUnit: "U/L", entryFactor: 1 },
  { key: "wbc", label: "WBC", unit: "10^3/uL", entryUnit: "K/uL", entryFactor: 1 },
];

export const MARKER_KEYS: readonly string[] = MARKERS.map((m) => m.key);

const SPEC_BY_KEY = new Map(MARKERS.map((m) => [m.key, m]));

/** Convert an entered value to the canonical unit. `entryUnit` may be
 *  the marker's canonical unit or its US entry unit (for WBC, "K/uL"
 *  and "10^3/uL" are the same scale). Throws on unknown marker/unit. */
export function toCanonical(marker: string, value: number, entryUnit: string): number {
  const spec = SPEC_BY_KEY.get(marker);
  if (!spec) throw new Error(`unknown marker: ${marker}`);
  if (!Number.isFinite(value)) throw new Error(`non-numeric value for ${marker}`);
  if (entryUnit === spec.unit) return value;
  if (entryUnit === spec.entryUnit) return value * spec.entryFactor;
  throw new Error(`unit ${entryUnit} not accepted for ${marker} (use ${spec.unit} or ${spec.entryUnit})`);
}

export type PhenoInputs = Record<string, number>;

/** Levine-2018 PhenoAge in years. `inputs` are CANONICAL units;
 *  `ageYears` is chronological age at the draw (fractional). */
export function phenoAge(inputs: PhenoInputs, ageYears: number): number {
  for (const k of MARKER_KEYS) {
    if (!Number.isFinite(inputs[k])) throw new Error(`missing marker: ${k}`);
  }
  if (!Number.isFinite(ageYears) || ageYears <= 0) throw new Error("age must be positive");
  const crp = inputs.crp;
  if (crp <= 0) throw new Error("crp must be > 0 (log transform)");
  const xb =
    -19.907 -
    0.0336 * inputs.albumin +
    0.0095 * inputs.creatinine +
    0.1953 * inputs.glucose +
    0.0954 * Math.log(crp) -
    0.012 * inputs.lymphocyte_pct +
    0.0268 * inputs.mcv +
    0.3306 * inputs.rdw +
    0.00188 * inputs.alp +
    0.0554 * inputs.wbc +
    0.0804 * ageYears;
  const g = 0.0076927;
  const mortality = 1 - Math.exp((-Math.exp(xb) * (Math.exp(120 * g) - 1)) / g);
  return 141.50225 + Math.log(-0.00553 * Math.log(1 - mortality)) / 0.090165;
}

/** PhenoAge acceleration: phenotypic minus chronological age (years). */
export function phenoAccel(inputs: PhenoInputs, ageYears: number): number {
  return phenoAge(inputs, ageYears) - ageYears;
}

export interface LabRowLike {
  marker: string;
  value: number;
  drawn_on: string;
}

export interface LabDraw {
  drawn_on: string;
  inputs: PhenoInputs;
  complete: boolean;
  missing: string[];
}

/** Group lab rows by draw date. A draw is complete when all 9 markers
 *  are present that day (PLSI same-draw rule). Newest first. */
export function completeDraws(rows: LabRowLike[]): LabDraw[] {
  const byDate = new Map<string, PhenoInputs>();
  for (const r of rows) {
    if (!MARKER_KEYS.includes(r.marker)) continue;
    let d = byDate.get(r.drawn_on);
    if (!d) {
      d = {};
      byDate.set(r.drawn_on, d);
    }
    d[r.marker] = Number(r.value);
  }
  return [...byDate.entries()]
    .map(([drawn_on, inputs]) => {
      const missing = MARKER_KEYS.filter((k) => !Number.isFinite(inputs[k]));
      return { drawn_on, inputs, complete: missing.length === 0, missing };
    })
    .sort((a, b) => (a.drawn_on < b.drawn_on ? 1 : -1));
}

/** Exact fractional age (years) from date of birth to a date, both
 *  YYYY-MM-DD. */
export function ageAt(dob: string, on: string): number {
  const t0 = Date.parse(`${dob}T00:00:00Z`);
  const t1 = Date.parse(`${on}T00:00:00Z`);
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) throw new Error("bad dates for age");
  return (t1 - t0) / (365.25 * 86_400_000);
}
