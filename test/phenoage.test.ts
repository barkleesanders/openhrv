import { describe, expect, it } from "vitest";
import { MARKERS, ageAt, completeDraws, phenoAccel, phenoAge, toCanonical } from "../src/phenoage";

// Oracle vectors computed with PLSI's own Python (Levine-2018 PhenoAge,
// src/plsi/map/derive.py) — the TS port must match to 3+ decimals.
const ORACLE_1 = { albumin: 45, creatinine: 80, glucose: 5.0, crp: 0.1, lymphocyte_pct: 30, mcv: 90, rdw: 13, alp: 70, wbc: 6 };
const ORACLE_2 = { albumin: 38, creatinine: 110, glucose: 6.5, crp: 0.5, lymphocyte_pct: 22, mcv: 95, rdw: 15.5, alp: 110, wbc: 9 };

describe("phenoAge (PLSI oracle vectors)", () => {
  it("matches PLSI for the younger draw", () => {
    expect(phenoAge(ORACLE_1, 40)).toBeCloseTo(32.9721, 3);
    expect(phenoAccel(ORACLE_1, 40)).toBeCloseTo(-7.0279, 3);
  });

  it("matches PLSI for the older draw", () => {
    expect(phenoAge(ORACLE_2, 60)).toBeCloseTo(75.9221, 3);
    expect(phenoAccel(ORACLE_2, 60)).toBeCloseTo(15.9221, 3);
  });

  it("throws on crp <= 0 (log transform domain)", () => {
    expect(() => phenoAge({ ...ORACLE_1, crp: 0 }, 40)).toThrow();
    expect(() => phenoAge({ ...ORACLE_1, crp: -0.5 }, 40)).toThrow();
  });

  it("throws when a marker is missing", () => {
    const { alp: _dropped, ...partial } = ORACLE_1;
    expect(() => phenoAge(partial, 40)).toThrow();
  });
});

describe("toCanonical (US entry units -> canonical)", () => {
  it("converts the four scaled markers", () => {
    expect(toCanonical("albumin", 4.5, "g/dL")).toBeCloseTo(45, 6);
    expect(toCanonical("creatinine", 1.0, "mg/dL")).toBeCloseTo(88.42, 6);
    expect(toCanonical("glucose", 100, "mg/dL")).toBeCloseTo(5.5506, 3);
    expect(toCanonical("crp", 3, "mg/L")).toBeCloseTo(0.3, 6);
  });

  it("passes canonical units through unchanged", () => {
    expect(toCanonical("albumin", 45, "g/L")).toBe(45);
    expect(toCanonical("creatinine", 80, "µmol/L")).toBe(80);
    expect(toCanonical("glucose", 5.0, "mmol/L")).toBe(5.0);
    expect(toCanonical("crp", 0.1, "mg/dL")).toBeCloseTo(0.1, 6);
  });

  it("identity markers and the WBC K/uL alias", () => {
    expect(toCanonical("lymphocyte_pct", 30, "%")).toBe(30);
    expect(toCanonical("mcv", 90, "fL")).toBe(90);
    expect(toCanonical("rdw", 13, "%")).toBe(13);
    expect(toCanonical("alp", 70, "U/L")).toBe(70);
    expect(toCanonical("wbc", 6, "K/uL")).toBe(6);
    expect(toCanonical("wbc", 6, "10^3/uL")).toBe(6);
  });

  it("rejects unknown markers and mismatched units", () => {
    expect(() => toCanonical("sodium", 140, "mmol/L")).toThrow();
    expect(() => toCanonical("albumin", 4.5, "mg/dL")).toThrow();
  });

  it("MARKERS covers exactly the 9 formula inputs", () => {
    expect(MARKERS.map((m) => m.key).sort()).toEqual(
      ["albumin", "alp", "creatinine", "crp", "glucose", "lymphocyte_pct", "mcv", "rdw", "wbc"].sort(),
    );
  });
});

describe("completeDraws", () => {
  const full = (drawn_on: string, base = 0) =>
    MARKERS.map((m, i) => ({ marker: m.key, value: 10 + base + i, drawn_on }));

  it("groups by draw date and flags only the full day complete", () => {
    const rows = [
      ...full("2026-10-01"),
      ...full("2026-11-01").filter((r) => r.marker !== "alp" && r.marker !== "crp"),
      { marker: "albumin", value: 44, drawn_on: "2026-09-01" },
    ];
    const draws = completeDraws(rows);
    expect(draws.map((d) => d.drawn_on)).toEqual(["2026-11-01", "2026-10-01", "2026-09-01"]);
    const oct = draws.find((d) => d.drawn_on === "2026-10-01")!;
    expect(oct.complete).toBe(true);
    expect(oct.missing).toEqual([]);
    const nov = draws.find((d) => d.drawn_on === "2026-11-01")!;
    expect(nov.complete).toBe(false);
    expect(nov.missing.sort()).toEqual(["alp", "crp"]);
    const sep = draws.find((d) => d.drawn_on === "2026-09-01")!;
    expect(sep.complete).toBe(false);
    expect(sep.missing).toHaveLength(8);
  });

  it("ignores unknown markers", () => {
    const draws = completeDraws([{ marker: "sodium", value: 140, drawn_on: "2026-10-01" }]);
    expect(draws).toEqual([]);
  });
});

describe("ageAt", () => {
  it("computes fractional years", () => {
    expect(ageAt("1986-11-03", "2026-11-03")).toBeCloseTo(40, 6);
    expect(ageAt("2000-01-01", "2000-07-02")).toBeCloseTo(0.5, 1);
  });
});
