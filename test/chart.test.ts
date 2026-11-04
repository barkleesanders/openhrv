import { describe, expect, it } from "vitest";
import { barChart, lineChart, miniGauge, multiLineChart, segmentChart, stageBar, type ChartPoint } from "../src/chart";
import { HEART_STATE_COLORS, HEART_STATE_LABELS } from "../src/reports";
import { hourlyPoints, dailyPoints, baselineMedian, seriesCaption, type SeriesRow } from "../src/series";
import { healthDays } from "../src/healthdays";
import { parseHealthAutoExport } from "../src/import";
import { workoutPage } from "../src/views";

const pts = (n: number): ChartPoint[] =>
  Array.from({ length: n }, (_, i) => ({ v: 50 + i * 2, label: `Nov ${i + 1}`, full: `Mon Nov ${i + 1} · ${50 + i * 2} ms` }));

describe("chart contract — labeled axes on every chart", () => {
  it("renders y-axis unit title and 4 gridline tick values", () => {
    const html = lineChart({ id: "t-hrv", points: pts(10), unit: "ms", color: "#ff3b30", yLabel: "HRV (ms)", decimals: 0 });
    expect(html).toContain("HRV (ms)"); // axis title carries the unit
    expect((html.match(/chart-tick/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(html).toContain("chart-grid");
  });

  it("renders real x labels and min/max value labels", () => {
    const html = lineChart({ id: "t-hrv", points: pts(10), unit: "ms", color: "#ff3b30", yLabel: "HRV (ms)", decimals: 0 });
    expect(html).toContain("Nov 1");
    expect(html).toContain("Nov 10");
    expect(html).toContain("min 50");
    expect(html).toContain("max 68");
  });

  it("embeds the crosshair payload (data-points with full timestamps) + readout + table toggle", () => {
    const html = lineChart({ id: "t-hrv5", points: pts(5), unit: "ms", color: "#ff3b30", yLabel: "HRV (ms)", decimals: 0 });
    expect(html).toContain("data-points=");
    expect(html).toContain("Mon Nov 3 · 54 ms"); // full timestamp text in payload
    expect(html).toContain("chart-readout");
    expect(html).toContain("Data table");
    expect(html).toContain("<table");
  });

  it("zone bands render with labels (workout HR zones)", () => {
    const html = lineChart({
      id: "t-zones",
      points: pts(12),
      unit: "bpm",
      color: "#ff2d55",
      yLabel: "Heart rate (bpm)",
      decimals: 0,
      zones: [{ vFrom: 90, vTo: 110, color: "#30d158", label: "Z2 Endurance" }],
    });
    expect(html).toContain("chart-zone");
    expect(html).toContain("Z2 Endurance");
  });

  it("empty series renders an honest empty state, never a fake line", () => {
    const html = lineChart({ id: "t-empty", points: [], unit: "ms", color: "#000", yLabel: "HRV (ms)", decimals: 0 });
    expect(html).toContain("No data in this range yet.");
    expect(html).not.toContain("<polyline");
  });

  it("stage bar renders proportional segments with a legend and the durations-not-sequence caption", () => {
    const html = stageBar([
      { stage: "deep", minutes: 60 },
      { stage: "core", minutes: 240 },
      { stage: "rem", minutes: 90 },
      { stage: "awake", minutes: 30 },
    ]);
    expect(html).toContain("stagebar");
    expect(html).toContain("Deep");
    expect(html).toContain("REM");
    expect(html).toContain("1 h"); // 60 min formatted
    expect(html).toContain("Stage totals for the night");
    expect(html).toContain("not their sequence"); // durations, never an invented timeline
  });
});

describe("series shaping", () => {
  const row = (type: string, value: number, start_at: string, granularity?: string): SeriesRow => ({
    type,
    value,
    unit: "",
    start_at,
    granularity,
  });

  it("hourlyPoints picks only the requested day's hourly rows, sorted", () => {
    const rows = [
      row("heart_rate", 62, "2026-11-03 09", "hourly"),
      row("heart_rate", 55, "2026-11-03 07", "hourly"),
      row("heart_rate", 70, "2026-11-02 07", "hourly"),
      row("heart_rate", 58, "2026-11-03 08:00:00"), // daily grain — excluded
    ];
    const out = hourlyPoints(rows, "2026-11-03");
    expect(out.map((p) => p.v)).toEqual([55, 62]);
    expect(out[0].label).toBe("7:00 AM");
  });

  it("dailyPoints aggregates sum-types and takes latest for gauges", () => {
    const steps = dailyPoints(
      [row("step_count", 100, "2026-11-01"), row("step_count", 250, "2026-11-01"), row("step_count", 90, "2026-11-02")],
      "2026-11-02",
      7,
    );
    expect(steps.map((p) => p.v)).toEqual([350, 90]);
    const hrv = dailyPoints(
      [row("hrv_sdnn", 50, "2026-11-01"), row("hrv_sdnn", 60, "2026-11-01"), row("hrv_sdnn", 55, "2026-11-02")],
      "2026-11-02",
      7,
    );
    expect(hrv.map((p) => p.v)).toEqual([60, 55]);
  });

  it("dailyPoints never zero-fills gaps and ignores hourly rows", () => {
    const out = dailyPoints(
      [row("hrv_sdnn", 50, "2026-11-01"), row("hrv_sdnn", 99, "2026-11-03 05", "hourly"), row("hrv_sdnn", 55, "2026-11-03")],
      "2026-11-03",
      7,
    );
    expect(out).toHaveLength(2); // Nov 2 missing stays missing
    expect(out[1].v).toBe(55);
  });

  it("baselineMedian uses only days strictly before the window", () => {
    const rows = [
      row("hrv_sdnn", 40, "2026-10-01"),
      row("hrv_sdnn", 60, "2026-10-02"),
      row("hrv_sdnn", 50, "2026-10-03"),
      row("hrv_sdnn", 999, "2026-11-01"),
    ];
    expect(baselineMedian(rows, "2026-11-01")).toBe(50);
  });

  it("seriesCaption is specific: avg, range, peak moment, baseline delta", () => {
    const cap = seriesCaption(
      [
        { v: 50, label: "Mon", full: "Mon Nov 2 · 50" },
        { v: 70, label: "Tue", full: "Tue Nov 3 · 70" },
      ],
      "ms",
      0,
      50,
    );
    expect(cap?.text).toContain("Avg 60 ms");
    expect(cap?.text).toContain("range 50–70 ms");
    expect(cap?.text).toContain("peak 70 ms");
    expect(cap?.text).toContain("Tue Nov 3");
    expect(cap?.text).toContain("+20% vs your baseline");
  });
});

describe("hourly import mapping + stable-id dedup", () => {
  const payload = {
    data: {
      metrics: [
        {
          name: "heart_rate",
          units: "bpm",
          data: [
            { qty: 55, date: "2026-11-03 07:00:00", source: "Watch", granularity: "hourly" },
            { qty: 62, date: "2026-11-03 08:00:00", source: "Watch", granularity: "hourly" },
            { qty: 58, date: "2026-11-03 00:00:00", source: "Watch" },
          ],
        },
      ],
    },
  };

  it("hourly points carry meta granularity and an hourly: external id; daily id format unchanged", () => {
    const out = parseHealthAutoExport(payload);
    expect(out).toHaveLength(3);
    const hourly = out.filter((s) => s.external_id?.includes(":hourly:"));
    expect(hourly).toHaveLength(2);
    expect(hourly[0].meta.granularity).toBe("hourly");
    const daily = out.find((s) => !s.external_id?.includes(":hourly:"));
    expect(daily?.external_id).toBe("heart_rate:2026-11-03 00:00:00:Watch");
    expect(daily?.meta.granularity).toBeUndefined();
  });

  it("re-parsing the same payload yields identical external ids (INSERT OR IGNORE inserts 0)", () => {
    const a = parseHealthAutoExport(payload).map((s) => s.external_id);
    const b = parseHealthAutoExport(payload).map((s) => s.external_id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });

  it("healthDays ignores hourly rows for the SDNN pick and step sums", () => {
    const days = healthDays(
      [
        { type: "hrv_sdnn", value: 50, start_at: "2026-11-03" },
        { type: "hrv_sdnn", value: 999, start_at: "2026-11-03 23:00:00", granularity: "hourly" },
        { type: "step_count", value: 1000, start_at: "2026-11-03" },
        { type: "step_count", value: 5000, start_at: "2026-11-03 10:00:00", granularity: "hourly" },
      ],
      [],
    );
    expect(days).toHaveLength(1);
    expect(days[0].sdnnMs).toBe(50); // not the 23:00 hourly bucket
  });
});

describe("workout page", () => {
  it("renders the stream chart slot and stats; honest empty state without a stream", () => {
    const withStream = workoutPage({
      id: 7,
      name: "Morning Run",
      sport: "Run",
      whenLabel: "Tue Nov 3 · 07:12",
      source: "strava",
      stats: [["Duration", "32:10"]],
      chartHtml: lineChart({ id: "t-whr", points: pts(8), unit: "bpm", color: "#ff2d55", yLabel: "Heart rate (bpm)", decimals: 0 }),
      caption: "HR stream · 8 points",
      hasStream: true,
    });
    expect(withStream).toContain("Morning Run");
    expect(withStream).toContain("Heart rate (bpm)");
    const without = workoutPage({
      id: 8,
      name: "Ride",
      sport: "Ride",
      whenLabel: "Tue Nov 3 · 08:00",
      source: "strava",
      stats: [],
      chartHtml: "",
      caption: "",
      hasStream: false,
    });
    expect(without).toContain("No heart-rate stream stored");
  });
});

describe("phase 2 chart types", () => {
  it("multiLineChart labels axes, names every series in the legend, and combines the crosshair payload", () => {
    const days = ["2026-11-01", "2026-11-02", "2026-11-03"];
    const mk = (vs: number[]) => days.map((d, i) => ({ v: vs[i], label: d, full: d }));
    const html = multiLineChart({
      id: "ml",
      unit: "%",
      yLabel: "Score (%)",
      series: [
        { label: "Stress", color: "#ff453a", points: mk([30, 44, 20]) },
        { label: "Energy", color: "#34c759", points: mk([70, 66, 80]) },
        { label: "Health", color: "#0a84ff", points: mk([75, 72, 78]) },
      ],
    });
    expect(html).toContain("Score (%)");
    expect(html).toContain('class="chart-grid"');
    expect(html).toContain("Stress 20 %");
    expect(html).toContain("Health 78 %");
    expect(html).toContain("Energy 66");
  });

  it("barChart draws bars with labeled axes and a max callout", () => {
    const html = barChart({
      id: "bars",
      unit: "steps",
      color: "#34c759",
      yLabel: "Steps",
      points: [
        { v: 4000, label: "11-01", full: "2026-11-01 · 4,000 steps" },
        { v: 9500, label: "11-02", full: "2026-11-02 · 9,500 steps" },
      ],
    });
    expect(html).toContain("<rect");
    expect(html).toContain("max 9500 steps");
    expect(html).toContain("Steps");
  });

  it("segmentChart colors runs by state and legends every state present", () => {
    const html = segmentChart({
      id: "seg",
      unit: "bpm",
      yLabel: "Heart rate (bpm)",
      segColors: HEART_STATE_COLORS,
      segLabels: HEART_STATE_LABELS,
      points: [
        { v: 52, label: "03:00", full: "03:00 · 52 bpm · Sleep", seg: "sleep" },
        { v: 55, label: "04:00", full: "04:00 · 55 bpm · Sleep", seg: "sleep" },
        { v: 150, label: "12:00", full: "12:00 · 150 bpm · Exercise", seg: "exercise" },
        { v: 70, label: "15:00", full: "15:00 · 70 bpm · Rest", seg: "rest" },
      ],
    });
    expect(html).toContain('stroke="#0a84ff"'); // sleep blue run
    expect(html).toContain('stroke="#34c759"'); // exercise green run
    expect(html).toContain("Sleep");
    expect(html).toContain("Exercise");
    expect(html).toContain("max 150 bpm");
  });

  it("miniGauge renders needle + value arc; null renders a hollow glyph", () => {
    const g = miniGauge(29, "#ffcc00");
    expect(g).toContain("<line");
    expect(g).toContain('stroke="#ffcc00"');
    expect(g).toContain('aria-label="Gauge 29 percent"');
    const empty = miniGauge(null, "#ffcc00");
    expect(empty).not.toContain("<line");
  });
});
