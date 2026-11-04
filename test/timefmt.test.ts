import { describe, expect, it } from "vitest";
import { fmtHour12, fmtHourMin12, fmtTime12 } from "../src/timefmt";
import { hourlyPoints, type SeriesRow } from "../src/series";
import { hourRanges } from "../src/coachpanel";
import type { HourBucket } from "../src/reports";

/**
 * 12-hour display rule (Barklee, 2026-11-04): every human-visible clock
 * time in the UI is 12-hour. These tests pin the central formatter and
 * the two highest-traffic label producers (chart hourly points, coach
 * hour ranges). Machine formats stay ISO — only display strings change.
 */
describe("fmtHour12 / fmtHourMin12 / fmtTime12", () => {
  it("maps the day boundary hours correctly", () => {
    expect(fmtHour12(0)).toBe("12:00 AM");
    expect(fmtHour12(7)).toBe("7:00 AM");
    expect(fmtHour12(12)).toBe("12:00 PM");
    expect(fmtHour12(13)).toBe("1:00 PM");
    expect(fmtHour12(23)).toBe("11:00 PM");
  });
  it("formats minutes and rolls a 60th minute over", () => {
    expect(fmtHourMin12(6, 40)).toBe("6:40 AM");
    expect(fmtHourMin12(22, 10)).toBe("10:10 PM");
    expect(fmtHourMin12(7, 60)).toBe("8:00 AM");
    expect(fmtHourMin12(0, 51)).toBe("12:51 AM");
  });
  it("parses ISO timestamps and HH:MM strings", () => {
    expect(fmtTime12("2026-11-04T14:05:00")).toBe("2:05 PM");
    expect(fmtTime12("2026-11-03T23:12:00")).toBe("11:12 PM");
    expect(fmtTime12("06:40")).toBe("6:40 AM");
    expect(fmtTime12("00:51")).toBe("12:51 AM");
    expect(fmtTime12("12:00")).toBe("12:00 PM");
  });
});

describe("chart + coach labels are 12-hour", () => {
  it("hourlyPoints labels and readouts carry AM/PM, never 24h", () => {
    const rows = [
      { type: "heart_rate", value: 62, start_at: "2026-11-03T07:00:00", granularity: "hourly" },
      { type: "heart_rate", value: 71, start_at: "2026-11-03T13:00:00", granularity: "hourly" },
    ] as unknown as SeriesRow[];
    const pts = hourlyPoints(rows, "2026-11-03");
    expect(pts.map((p) => p.label)).toEqual(["7:00 AM", "1:00 PM"]);
    expect(pts[1].full).toContain("1:00 PM");
    for (const p of pts) expect(p.label).not.toMatch(/^\d{2}:00$/);
  });
  it("hourRanges renders a PM range", () => {
    const buckets: HourBucket[] = [
      { hour: 13, hr: 90, steps: 10, sdnn: null, activeKcal: null },
      { hour: 14, hr: 92, steps: 5, sdnn: null, activeKcal: null },
    ];
    expect(hourRanges(buckets, () => true)).toEqual(["1:00 PM–3:00 PM"]);
  });
});
