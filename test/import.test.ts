import { describe, expect, it } from "vitest";
import { parseExportXml, parseHealthAutoExport, parseShortcutJson } from "../src/import";
import { stravaActivitySample, stravaConfigured } from "../src/strava";

describe("parseHealthAutoExport", () => {
  it("normalizes metrics + workouts with source attribution", () => {
    const samples = parseHealthAutoExport({
      data: {
        metrics: [
          { name: "heart_rate_variability_sdnn", units: "ms", data: [{ qty: 62.5, date: "2026-11-03 07:00:00 -0800", source: "Watch" }] },
          { name: "sleep_analysis", units: "", data: [{ qty: 7.2, date: "2026-11-03 06:30:00 -0800", sleepStart: "2026-11-02 23:10:00 -0800", sleepEnd: "2026-11-03 06:30:00 -0800" }] },
        ],
        workouts: [{ name: "Run", start: "2026-11-03 12:00:00 -0800", end: "2026-11-03 12:30:00 -0800", duration: 1800 }],
      },
    });
    expect(samples).toHaveLength(3);
    expect(samples[0]).toMatchObject({ type: "heart_rate_variability_sdnn", value: 62.5, unit: "ms" });
    expect(samples[0].source).toContain("Watch");
    expect(samples[1].meta.sleepStart).toBeTruthy();
    expect(samples[2]).toMatchObject({ type: "workout", value: 1800 });
  });
});

describe("parseShortcutJson", () => {
  it("accepts flat health keys", () => {
    const s = parseShortcutJson({ hrv_sdnn_ms: 55, resting_hr_bpm: 57, date: "2026-11-03T07:00:00Z" });
    expect(s.map((x) => x.type)).toEqual(["hrv_sdnn_ms", "resting_hr_bpm"]);
    expect(s[0].source).toBe("shortcut");
  });
  it("accepts a samples array", () => {
    const s = parseShortcutJson({ samples: [{ type: "heart_rate", value: 61, unit: "bpm", date: "2026-11-03T07:00:00Z" }] });
    expect(s).toHaveLength(1);
    expect(s[0].value).toBe(61);
  });
});

describe("parseExportXml", () => {
  it("maps HK record types into the normalized store", () => {
    const xml = `<?xml version="1.0"?><HealthData>
      <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" sourceName="Watch" unit="ms" value="58.2" startDate="2026-11-03 07:00:00 -0800" endDate="2026-11-03 07:05:00 -0800"/>
      <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" value="8123" startDate="2026-11-03 00:00:00 -0800" endDate="2026-11-03 23:59:00 -0800"/>
    </HealthData>`;
    const s = parseExportXml(xml);
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ type: "hrv_sdnn", value: 58.2 });
    expect(s[1]).toMatchObject({ type: "step_count", value: 8123 });
  });
});

describe("strava helpers", () => {
  it("configured only with client id + secret", () => {
    expect(stravaConfigured({})).toBe(false);
    expect(stravaConfigured({ STRAVA_CLIENT_ID: "1", STRAVA_CLIENT_SECRET: "s" })).toBe(true);
  });
  it("maps an activity with HR fields", () => {
    const s = stravaActivitySample({ id: 99, name: "Morning Run", sport_type: "Run", start_date: "2026-11-03T15:00:00Z", elapsed_time: 1500, average_heartrate: 142, max_heartrate: 168, distance: 5000 });
    expect(s.type).toBe("workout");
    expect(s.source).toBe("strava");
    expect(s.meta.avg_hr_bpm).toBe(142);
    expect(s.external_id).toBe("strava-activity:99");
  });
});
