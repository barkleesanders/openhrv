import { describe, expect, it } from "vitest";
import {
  aboutPage,
  categoryPage,
  coachPage,
  impactPage,
  journalPage,
  labPage,
  measurePage,
  morePage,
  myDataPage,
  scoreDetailPage,
  sleepPage,
  storiesPage,
  testsPage,
  themesPage,
  todayPage,
  welcomePage,
  type TodayData,
} from "../src/views";

/**
 * BUG-2 regression gate: every inline <script> block in every rendered
 * page must PARSE. A quoting bug inside a template-built script block
 * (the /mydata shareText SyntaxError) kills the whole block silently in
 * the browser — this test makes that failure class loud at build time.
 */
function inlineScripts(html: string): string[] {
  const out: string[] = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

const emptyToday: TodayData = { battery: null, stress: null, pressure: null, latest: null, history: [] };
const filledToday: TodayData = {
  battery: 76,
  stress: 12,
  pressure: 8,
  scoreSource: "health",
  scoreAt: "2026-11-03",
  healthLatest: {
    date: "2026-11-03",
    sdnnMs: 165.7,
    restingHrBpm: 41,
    sleepHours: 7.47,
    source: "health_auto_export:Muse Apple Health",
  },
  latest: {
    taken_at: "2026-11-03T08:00:00.000Z",
    source: "manual",
    mean_hr_bpm: 55,
    rmssd_ms: 120.4,
    sdnn_ms: 150.2,
    pnn50_pct: 40.1,
    baevsky_si: 90,
    lf_hf_ratio: 1.2,
  },
  history: [],
};

const pages: Array<[string, string]> = [
  ["today (empty)", todayPage(emptyToday, "test")],
  ["today (health-filled)", todayPage(filledToday, "test")],
  ["measure", measurePage("test")],
  ["journal", journalPage("test")],
  ["mydata", myDataPage("test")],
  ["more", morePage("test")],
  ["battery detail", scoreDetailPage("battery", "test")],
  ["stress detail", scoreDetailPage("stress", "test")],
  ["pressure detail", scoreDetailPage("pressure", "test")],
  ["impact", impactPage("test")],
  ["sleep", sleepPage("test")],
  ["category", categoryPage("health", "Health", "test")],
  ["lab", labPage("test")],
  ["coach", coachPage("test")],
  ["stories", storiesPage("test")],
  ["welcome", welcomePage("test")],
  ["tests", testsPage("test")],
  ["themes", themesPage("test")],
  ["about", aboutPage("test")],
];

describe("every inline <script> block in every page parses (BUG-2 regression)", () => {
  for (const [name, html] of pages) {
    it(name, () => {
      const scripts = inlineScripts(html);
      expect(scripts.length).toBeGreaterThan(0);
      for (const code of scripts) {
        expect(() => new Function(code)).not.toThrow();
      }
    });
  }
  it("mydata share buttons use data-i + listeners, not inline onclick strings", () => {
    expect(myDataPage("test")).not.toContain("onclick='shareText");
    expect(myDataPage("test")).toContain("sharebtn");
  });
  it("score detail pages settle the drivers panel in the no-data state (BUG-3)", () => {
    const html = scoreDetailPage("battery", "test");
    expect(html).toContain("No data yet");
    expect(html).toContain('getElementById("drivers")');
  });
  it("Phase-2 Apple Health design layer is present (favorites, browse rows, segmented trend)", () => {
    const today = todayPage(filledToday, "test");
    expect(today).toContain("Favorites");
    expect(today).toContain('class="fav"');
    expect(today).toContain("165.7"); // HRV favorite carries the real value
    expect(myDataPage("test")).toContain("brow");
    expect(scoreDetailPage("battery", "test")).toContain('class="seg"');
  });
});
