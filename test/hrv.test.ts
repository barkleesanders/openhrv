import { describe, expect, it } from "vitest";
import { cleanRr, computeHrv, parseRrText } from "../src/hrv";
import oracle from "../oracle/vectors.json";

interface Expected {
  count: number;
  artifacts_removed: number;
  mean_rr_ms: number;
  mean_hr_bpm: number;
  sdnn_ms: number;
  rmssd_ms: number;
  pnn50_pct: number;
  baevsky_si: number;
  lf_ms2: number;
  hf_ms2: number;
  lf_hf_ratio: number;
}

function relClose(actual: number, expected: number, tol: number) {
  const denom = Math.max(1e-9, Math.abs(expected));
  expect(Math.abs(actual - expected) / denom).toBeLessThanOrEqual(tol);
}

describe("oracle vectors (independent Python reference)", () => {
  const tol = oracle.tolerances;
  for (const v of oracle.vectors) {
    it(`oracle vector ${v.name}: engine reproduces Python reference`, () => {
      const e = v.expected as Expected;
      const r = computeHrv(v.rr_ms);
      expect(r.count).toBe(e.count);
      expect(r.artifactsRemoved).toBe(e.artifacts_removed);
      relClose(r.meanRrMs, e.mean_rr_ms, tol.time_domain_rel);
      relClose(r.meanHrBpm, e.mean_hr_bpm, tol.time_domain_rel);
      relClose(r.sdnnMs, e.sdnn_ms, tol.time_domain_rel);
      relClose(r.rmssdMs, e.rmssd_ms, tol.time_domain_rel);
      relClose(r.pnn50Pct, e.pnn50_pct, tol.time_domain_rel + 0.005);
      relClose(r.baevskySi, e.baevsky_si, tol.baevsky_rel);
      relClose(r.lfMs2, e.lf_ms2, tol.band_power_rel);
      relClose(r.hfMs2, e.hf_ms2, tol.band_power_rel);
      relClose(r.lfHfRatio, e.lf_hf_ratio, tol.lf_hf_rel);
    });
  }
});

describe("cleanRr", () => {
  it("drops physiologically impossible intervals", () => {
    const { cleaned, removed } = cleanRr([800, 100, 810, 820, 5000, 805, 815, 825, 830, 840, 850, 845]);
    expect(removed).toBe(2);
    expect(cleaned).toHaveLength(10);
  });
  it("rejects too-short series in computeHrv", () => {
    expect(() => computeHrv([800, 810, 820])).toThrow();
  });
});

describe("parseRrText", () => {
  it("parses comma/space-separated milliseconds", () => {
    expect(parseRrText("800, 810\n820 830")).toEqual([800, 810, 820, 830]);
  });
  it("converts seconds to milliseconds", () => {
    expect(parseRrText("0.8,0.81,0.79")).toEqual([800, 810, 790]);
  });
});
