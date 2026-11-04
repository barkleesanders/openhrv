import { describe, expect, it } from "vitest";
import {
  batteryCharge,
  batteryState,
  dailyAggregates,
  factorImpact,
  stressPct,
  stressState,
} from "../src/insights";

describe("score mappings (SPEC normative formulas)", () => {
  it("battery is monotonic in RMSSD and states map correctly", () => {
    expect(batteryCharge(90, 45)).toBeGreaterThan(batteryCharge(45, 45));
    expect(batteryState(80)).toBe("Charged");
    expect(batteryState(10)).toBe("Depleted");
  });
  it("stress rises with Baevsky SI", () => {
    expect(stressPct(400, 2)).toBeGreaterThan(stressPct(60, 1));
    expect(stressState(stressPct(30, 0.8))).toBe("Low");
  });
});

describe("factorImpact", () => {
  const days = dailyAggregates(
    Array.from({ length: 10 }, (_, i) => ({
      taken_at: `2026-10-${String(i + 1).padStart(2, "0")}T08:00:00.000Z`,
      rmssd_ms: i % 2 === 0 ? 30 : 60, // even days = factor days, low RMSSD
      baevsky_si: i % 2 === 0 ? 220 : 90,
      lf_hf_ratio: 1.4,
    })),
  );
  const factorDays = new Set(days.filter((_, i) => i % 2 === 0).map((d) => d.date));

  it("detects a negative RMSSD impact with sample counts", () => {
    const [f] = factorImpact(days, [{ name: "caffeine", dates: factorDays }]);
    expect(f.enoughData).toBe(true);
    expect(f.nWith).toBe(5);
    expect(f.nWithout).toBe(5);
    expect(f.metrics!.rmssd.deltaPct).toBeLessThan(-40);
    expect(f.metrics!.stress.deltaPct).toBeGreaterThan(0);
  });
  it("reports honest insufficient-data below the minimum sample", () => {
    const [f] = factorImpact(days, [{ name: "rare", dates: new Set([days[0].date]) }]);
    expect(f.enoughData).toBe(false);
    expect(f.metrics).toBeNull();
    expect(f.nWith).toBe(1);
  });
});
