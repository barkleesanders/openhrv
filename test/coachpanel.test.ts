import { describe, expect, it } from "vitest";
import { app, type Env } from "../src/index";
import { StubD1 } from "./d1stub";
import { buildCoachPanel, scheduleLoad, type CoachInput } from "../src/coachpanel";
import { stressImpactDay, type HourBucket } from "../src/reports";
import type { FactorImpact } from "../src/insights";

/**
 * Phase B: the Today Coach panel is deterministic — every card is tested
 * against fixture days, and the calendar lane is tested end-to-end
 * (token auth, prune, panel integration, no leakage to Watch endpoints).
 */
const OWNER = "barkleesanders@gmail.com";

const buckets = (spec: Array<[number, number | null, number | null]>): HourBucket[] =>
  spec.map(([hour, hr, steps]) => ({ hour, hr, steps, sdnn: null, activeKcal: null }));

function baseInput(over: Partial<CoachInput> = {}): CoachInput {
  return {
    date: "2026-10-29",
    battery: 62, stress: 42, pressure: 30,
    hrvMs: 110, baselineHrvMs: 110, restingHrBpm: 50, restingBaseline: 50,
    sleepHours: 7.5, sleepMedian: 7.5, sleepDebtH: 0.5, wakeTime: "06:40",
    impacts: [], buckets: [], impact: null,
    standHours: null, bestStandHours: null, breathingOnDate: false,
    eventsToday: [], eventsTomorrow: [],
    ...over,
  };
}

const shortSleepImpact: FactorImpact = {
  factor: "Short sleep (<6h)", nWith: 3, nWithout: 47, enoughData: true,
  metrics: {
    rmssd: { withMean: 90, withoutMean: 110, deltaPct: -18 },
    battery: { withMean: 58, withoutMean: 62, deltaPct: -6.7 },
    stress: { withMean: 72, withoutMean: 42, deltaPct: 71.9 },
  },
};

describe("coach panel: drivers, actions, protective mode", () => {
  it("high-stress fixture: stationary block + sleep debt drive, actions fire with numbers", () => {
    const b = buckets([[12, 55, 600], [13, 80, 10], [14, 82, 5], [15, 60, 400], [16, 58, 700]]);
    const panel = buildCoachPanel(baseInput({
      stress: 68, battery: 45, sleepHours: 6, sleepDebtH: 2,
      buckets: b, impact: stressImpactDay(b, 50),
      standHours: 3, bestStandHours: 8,
      impacts: [shortSleepImpact],
    }));
    expect(panel.protective).toBe(false);
    expect(panel.drivers[0].text).toContain("Stationary stress 120 min");
    expect(panel.drivers[0].text).toContain("13:00–15:00");
    expect(panel.drivers.map((d) => d.text).join(" ")).toContain("Sleep debt 2 h");
    const acts = panel.actions.map((a) => a.text).join(" ");
    expect(acts).toContain("lights-out by 21:10");
    expect(acts).toContain("10-minute walk");
    expect(panel.chips.map((c) => c.question)).toContain("Why is my stress up today?");
    expect(panel.chips.map((c) => c.question)).toContain("How do I repay my sleep debt?");
    expect(panel.impacting[0].text).toContain("Short sleep (<6h): Battery -7%, Stress +72%");
    expect(panel.impacting[0].text).toContain("3 of 50 days");
  });

  it("low-stress fixture: protective mode names what's keeping it low, never an empty card", () => {
    const b = buckets([[8, 52, 800], [9, 55, 900], [10, 54, 700], [11, 56, 650], [12, 53, 800], [13, 55, 750]]);
    const panel = buildCoachPanel(baseInput({
      stress: 0, battery: 92, hrvMs: 166, baselineHrvMs: 92,
      sleepHours: 7.7, sleepDebtH: 0.3, buckets: b, impact: stressImpactDay(b, 50),
      standHours: 6, bestStandHours: 6,
    }));
    expect(panel.protective).toBe(true);
    expect(panel.driversTitle).toBe("What's keeping stress low");
    expect(panel.drivers.length).toBeGreaterThan(0);
    expect(panel.drivers.map((d) => d.text).join(" ")).toContain("Zero stationary-stress minutes");
    expect(panel.headline).toContain("Recovered");
    expect(panel.topAction).toContain("Capacity is there");
    expect(panel.chips.map((c) => c.question)).toContain("Why is my HRV so high?");
  });

  it("low stress with a small sleep debt is protective, with the debt as a Watch line", () => {
    const panel = buildCoachPanel(baseInput({
      stress: 0, battery: 92, hrvMs: 166, baselineHrvMs: 92,
      sleepHours: 7.5, sleepDebtH: 0.5, standHours: 6, bestStandHours: 6,
    }));
    expect(panel.protective).toBe(true);
    expect(panel.driversTitle).toBe("What's keeping stress low");
    expect(panel.drivers.map((d) => d.text).join(" ")).toContain("Watch: Sleep debt 0.5 h");
    expect(panel.chips.map((c) => c.question)).not.toContain("Why is my stress up today?");
  });

  it("actions stay silent when thresholds are not met", () => {
    const panel = buildCoachPanel(baseInput({
      stress: 30, sleepDebtH: 0.2, standHours: 7, bestStandHours: 8,
      impact: { hoursWithData: 8, stressMinutes: 0, morningLevelPct: 0, elevatedHours: 0, stationaryStressHours: 0 },
    }));
    expect(panel.actions).toHaveLength(0);
  });

  it("elevated stress with no breathing logged suggests the breathing reset, linked", () => {
    const panel = buildCoachPanel(baseInput({ stress: 75, breathingOnDate: false }));
    const a = panel.actions.find((x) => x.text.includes("box-breathing"));
    expect(a).toBeDefined();
    expect(a!.href).toBe("/more#breathing");
  });
});

describe("schedule load math", () => {
  it("counts events, hours, before-noon load and early starts", () => {
    const load = scheduleLoad([
      { title: "A", start_at: "2026-11-04T09:00:00-08:00", end_at: "2026-11-04T10:30:00-08:00", calendar_name: "Personal" },
      { title: "B", start_at: "2026-11-04T13:00:00-08:00", end_at: "2026-11-04T14:00:00-08:00", calendar_name: "Personal" },
    ], "08:45");
    expect(load.count).toBe(2);
    expect(load.totalHours).toBe(2.5);
    expect(load.beforeNoonHours).toBe(1.5);
    expect(load.firstStart).toBe("09:00");
    expect(load.earlyStart).toBe(true);
  });
});

// ------------------------------------------------------------ endpoint + page
function makeEnv(): { env: Env; db: StubD1 } {
  const db = new StubD1();
  const env = { DB: db, OWNER_EMAIL: OWNER, GIT_SHA: "test" } as unknown as Env;
  return { env, db };
}
let seq = 1000;
function seedHealth(db: StubD1) {
  for (let d = 20; d <= 29; d++) {
    const date = `2026-10-${d}`;
    db.table("health_samples").push(
      { id: seq++, owner: OWNER, type: "hrv_sdnn", value: 110, unit: "ms", start_at: `${date}T12:00:00-08:00`, end_at: `${date}T12:00:00-08:00`, source: "hae", external_id: `h${seq}`, meta_json: "{}" },
      { id: seq++, owner: OWNER, type: "resting_heart_rate", value: 50, unit: "bpm", start_at: `${date}T12:00:00-08:00`, end_at: `${date}T12:00:00-08:00`, source: "hae", external_id: `r${seq}`, meta_json: "{}" },
    );
    db.table("sleep").push({ id: d, owner: OWNER, start_at: `2026-10-${d - 1}T23:10:00-08:00`, end_at: `${date}T06:40:00-08:00`, duration_s: 7.5 * 3600, source: "hae", stages_json: "{}" });
  }
  db.table("settings").push({ owner: OWNER, key: "import_token", value_json: "tok-test" });
}
const laToday = (): string => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

describe("calendar lane: token, storage, prune, panel use, no leakage", () => {
  it("rejects a bad token, stores good events, and keeps them out of the Watch endpoint", async () => {
    const { env, db } = makeEnv();
    seedHealth(db);
    const today = laToday();
    const payload = { events: [
      { id: "ev1", title: "Dentist appointment", start: `${today}T14:00:00-08:00`, end: `${today}T15:00:00-08:00`, calendar: "Personal" },
      { id: "ev2", title: "Call", start: `${today}T09:00:00-08:00`, end: `${today}T09:30:00-08:00`, calendar: "Personal" },
    ]};
    const bad = await app.request("/api/import/calendar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }, env);
    expect(bad.status).toBe(401);
    const ok = await app.request("/api/import/calendar", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + "tok-test" }, body: JSON.stringify(payload) }, env);
    expect(ok.status).toBe(200);
    const j = (await ok.json()) as { stored: number };
    expect(j.stored).toBe(2);
    // Panel uses the events generically (count + hours), on Today.
    const home = await (await app.request("/", {}, env)).text();
    expect(home).toContain("Today's schedule: 2 events, 1.5 h booked");
    // Watch endpoints never expose calendar data.
    const watch = await (await app.request("/api/watch/today", { headers: { authorization: "Bearer " + "tok-test" } }, env)).text();
    expect(watch).not.toContain("Dentist");
    expect(watch).not.toContain("schedule");
  });

  it("prunes events older than 14 days on POST", async () => {
    const { env, db } = makeEnv();
    seedHealth(db);
    db.table("calendar_events").push({ id: 999, owner: OWNER, external_id: "old1", title: "Old", start_at: "2026-09-01T09:00:00-07:00", end_at: "2026-09-01T10:00:00-07:00", calendar_name: "P", fetched_at: "2026-09-01" });
    const today = laToday();
    const ok = await app.request("/api/import/calendar", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + "tok-test" }, body: JSON.stringify({ events: [{ id: "new1", title: "New", start: `${today}T10:00:00-08:00`, end: `${today}T11:00:00-08:00`, calendar: "P" }] }) }, env);
    const j = (await ok.json()) as { pruned: number };
    expect(j.pruned).toBe(1);
    expect(db.table("calendar_events").map((r) => r.external_id)).toEqual(["new1"]);
  });

  it("zero calendar rows: the panel renders fully and never mentions a gap", async () => {
    const { env, db } = makeEnv();
    seedHealth(db);
    const home = await (await app.request("/", {}, env)).text();
    expect(home).toContain('data-section="glance"');
    expect(home).toContain('data-section="coach-impacting"');
    expect(home).not.toContain("Today's schedule");
    expect(home).not.toContain("calendar");
  });
});

describe("Today is the home page (addendum structure)", () => {
  it("renders every section in order", async () => {
    const { env, db } = makeEnv();
    seedHealth(db);
    const home = await (await app.request("/", {}, env)).text();
    const order = ["glance", "coach-impacting", "coach-drivers", "coach-actions", "ai-coach", "reports", "sleep-journal"];
    let last = -1;
    for (const s of order) {
      const i = home.indexOf(`data-section="${s}"`);
      expect(i, s).toBeGreaterThan(last);
      last = i;
    }
    expect(home.indexOf("Favorites")).toBeGreaterThan(last);
    expect(home.indexOf('data-section="explore"')).toBeGreaterThan(home.indexOf("Favorites"));
    expect(home).toContain("Talk to your coach");
    expect(home).toContain("/coach?q=");
  });

  it("every internal link on the More page is also reachable from Today", async () => {
    const { env, db } = makeEnv();
    seedHealth(db);
    const more = await (await app.request("/more", {}, env)).text();
    const home = await (await app.request("/", {}, env)).text();
    const hrefs = new Set([...more.matchAll(/href="([^"]+)"/g)].map((m) => m[1]));
    for (const h of hrefs) {
      if (h.startsWith("https://")) continue;
      const path = h.split("#")[0].split("?")[0];
      expect(home.includes(path), `${h} reachable from Today`).toBe(true);
    }
  });
});
