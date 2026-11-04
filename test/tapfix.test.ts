import { describe, expect, it } from "vitest";
import { app, type Env } from "../src/index";
import { StubD1 } from "./d1stub";

/**
 * Phase A tap-fix: Barklee's tap test. Every home Favorites card must land
 * on a detail view whose FIRST chart is the hourly series for that metric
 * (Day range preselected), falling back honestly when no hourly data
 * exists. Tests enumerate the cards from the rendered home HTML and
 * follow each href through the real router.
 */
const OWNER = "barkleesanders@gmail.com";

function makeEnv(): { env: Env; db: StubD1 } {
  const db = new StubD1();
  const env = { DB: db, OWNER_EMAIL: OWNER, GIT_SHA: "test" } as unknown as Env;
  return { env, db };
}

let seq = 1;
function sample(db: StubD1, type: string, value: number, start_at: string, hourly = false) {
  db.table("health_samples").push({
    id: seq++, owner: OWNER, type, value, unit: "x",
    start_at, end_at: start_at, source: "health_auto_export:Muse Apple Health",
    external_id: `${type}-${seq}`, meta_json: hourly ? JSON.stringify({ granularity: "hourly" }) : "{}",
  });
}

/** 10 daily days (2026-10-20..29) + hourly buckets on the 29th. */
function seed(db: StubD1, withHourly: boolean) {
  for (let d = 20; d <= 29; d++) {
    const date = `2026-10-${d}`;
    sample(db, "hrv_sdnn", 110, `${date}T12:00:00-08:00`);
    sample(db, "resting_heart_rate", 50, `${date}T12:00:00-08:00`);
    sample(db, "heart_rate", 60, `${date}T12:00:00-08:00`);
    sample(db, "step_count", 4000, `${date}T12:00:00-08:00`);
    db.table("sleep").push({
      id: d, owner: OWNER, start_at: `2026-10-${d - 1}T23:10:00-08:00`,
      end_at: `${date}T06:40:00-08:00`, duration_s: 7.5 * 3600, source: "health_auto_export", stages_json: "{}",
    });
  }
  if (!withHourly) return;
  const D = "2026-10-29";
  for (let h = 7; h <= 18; h++) {
    const hh = String(h).padStart(2, "0");
    sample(db, "hrv_sdnn", 100 + h, `${D}T${hh}:00:00-08:00`, true);
    sample(db, "resting_heart_rate", 50, `${D}T${hh}:00:00-08:00`, true);
    sample(db, "heart_rate", h === 13 || h === 14 ? 78 : 55, `${D}T${hh}:00:00-08:00`, true);
    sample(db, "step_count", h === 13 || h === 14 ? 10 : 500, `${D}T${hh}:00:00-08:00`, true);
    sample(db, "active_energy", 20, `${D}T${hh}:00:00-08:00`, true);
  }
}

function favHrefs(html: string): string[] {
  return [...html.matchAll(/<a class="fav" href="([^"]+)"/g)].map((m) => m[1]);
}
function chartPoints(html: string): Array<{ v: number; full: string }> {
  const m = /data-points='([^']*)'/.exec(html);
  return m ? (JSON.parse(m[1]) as Array<{ v: number; full: string }>) : [];
}
const daySelected = (html: string): boolean => /range=day" class="on"/.test(html);
const monthSelected = (html: string): boolean => /range=month" class="on"/.test(html);
const hasHourLabels = (html: string): boolean => chartPoints(html).some((p) => /· \d{1,2}:00 [AP]M ·/.test(p.full)) || />\d{1,2}:00 [AP]M<\/text>/.test(html);

describe("Phase A: home-card click-through lands hourly-first", () => {
  it("enumerates the six favorites and follows every href to an hourly-first landing", async () => {
    const { env, db } = makeEnv();
    seed(db, true);
    const home = await (await app.request("/", {}, env)).text();
    // The quick-glance tiles repeat the three gauge hrefs ahead of the
    // Favorites grid (cleanup wave) — the click-through contract covers
    // the six unique favorite landings.
    const hrefs = [...new Set(favHrefs(home))];
    expect(hrefs).toEqual([
      "/battery",
      "/stress",
      "/pressure",
      "/mydata/health?metric=hrv_sdnn",
      "/mydata/health?metric=resting_heart_rate",
      "/sleep",
    ]);
    for (const href of hrefs) {
      const r = await app.request(href, {}, env);
      expect(r.status, href).toBe(200);
      const html = await r.text();
      if (href === "/sleep") {
        // Sleep leads with the hourly context card (no range control on
        // that page by design): hourly HR chart with hour labels.
        expect(html).toContain("Hourly context");
        expect(html).toContain('data-chart="m-heart_rate"');
        expect(hasHourLabels(html)).toBe(true);
        continue;
      }
      expect(daySelected(html), href).toBe(true);
      expect(chartPoints(html).length, href).toBeGreaterThan(0);
      expect(hasHourLabels(html), href).toBe(true);
    }
  });

  it("gauge landings lead with their own hourly driver (Battery→HRV, Stress→HR + steps, Pressure→HR)", async () => {
    const { env, db } = makeEnv();
    seed(db, true);
    const battery = await (await app.request("/battery", {}, env)).text();
    expect(battery).toContain('data-chart="m-hrv_sdnn"');
    expect(battery).toContain("hourly HRV (SDNN) behind it");
    const stress = await (await app.request("/stress", {}, env)).text();
    expect(stress).toContain('data-chart="m-heart_rate"');
    expect(stress).toContain("Steps by hour");
    expect(stress).toContain("Stationary stress that day: 120 min");
    const pressure = await (await app.request("/pressure", {}, env)).text();
    expect(pressure).toContain('data-chart="m-heart_rate"');
  });

  it("metric focus puts the tapped metric's chart first", async () => {
    const { env, db } = makeEnv();
    seed(db, true);
    const rhr = await (await app.request("/mydata/health?metric=resting_heart_rate", {}, env)).text();
    expect(rhr.indexOf("Resting heart rate")).toBeLessThan(rhr.indexOf("HRV (SDNN)"));
    expect(rhr).toContain("range=day");
    // Range links preserve the metric focus.
    expect(rhr).toContain("/mydata/health?metric=resting_heart_rate&range=week");
    const hrv = await (await app.request("/mydata/health?metric=hrv_sdnn", {}, env)).text();
    expect(hrv.indexOf("HRV (SDNN)")).toBeLessThan(hrv.indexOf("Resting heart rate"));
  });

  it("My Data category landings default to hourly Day where hourly exists", async () => {
    const { env, db } = makeEnv();
    seed(db, true);
    const activity = await (await app.request("/mydata/activity", {}, env)).text();
    expect(daySelected(activity)).toBe(true);
    expect(hasHourLabels(activity)).toBe(true);
  });

  it("no-hourly fallback: daily chart + the reason stated at the top, never a blank", async () => {
    const { env, db } = makeEnv();
    seed(db, false);
    const cat = await (await app.request("/mydata/health?metric=hrv_sdnn", {}, env)).text();
    expect(cat).toContain("No hourly data for these metrics yet");
    expect(monthSelected(cat)).toBe(true);
    expect(chartPoints(cat).length).toBeGreaterThan(0);
    const battery = await (await app.request("/battery", {}, env)).text();
    expect(battery).toContain("No hourly HRV (SDNN) data yet");
    expect(monthSelected(battery)).toBe(true);
    const sleep = await (await app.request("/sleep", {}, env)).text();
    expect(sleep).toContain("No hourly heart-rate data yet");
  });

  it("explicit ranges still win over the hourly default", async () => {
    const { env, db } = makeEnv();
    seed(db, true);
    const html = await (await app.request("/mydata/health?metric=hrv_sdnn&range=month", {}, env)).text();
    expect(monthSelected(html)).toBe(true);
  });
});
