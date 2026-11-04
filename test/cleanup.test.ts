import { describe, expect, it } from "vitest";
import { app, type Env } from "../src/index";
import { StubD1 } from "./d1stub";

/**
 * Cleanup wave (Barklee 2026-11-04): "a panel exists only if it populates."
 * The fixture mirrors the PRODUCTION data shape — the measurements table
 * is EMPTY (his real data lives in health_samples), journal/breathing/
 * self_tests are empty, respiratory_rate has exactly 2 samples ever, and
 * blood pressure / body mass / mindful sessions have never synced.
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

function seedProductionShape(db: StubD1) {
  // 10 daily days, 2026-10-25 .. 2026-11-03; the last day is the strong
  // recovery day (HRV 165.7, RHR 41) production shows.
  for (let d = 25; d <= 31; d++) {
    const date = `2026-10-${d}`;
    sample(db, "hrv_sdnn", 110, `${date}T12:00:00-08:00`);
    sample(db, "resting_heart_rate", 50, `${date}T12:00:00-08:00`);
    sample(db, "heart_rate", 60, `${date}T12:00:00-08:00`);
    sample(db, "step_count", 4000, `${date}T12:00:00-08:00`);
    sample(db, "spo2", 97, `${date}T12:00:00-08:00`);
  }
  for (let d = 1; d <= 3; d++) {
    const date = `2026-11-0${d}`;
    const last = d === 3;
    sample(db, "hrv_sdnn", last ? 165.7 : 110, `${date}T12:00:00-08:00`);
    sample(db, "resting_heart_rate", last ? 41 : 50, `${date}T12:00:00-08:00`);
    sample(db, "heart_rate", 60, `${date}T12:00:00-08:00`);
    sample(db, "step_count", last ? 2915 : 4000, `${date}T12:00:00-08:00`);
    sample(db, "spo2", 97, `${date}T12:00:00-08:00`);
  }
  // Hourly buckets on the latest day (heart rate, HRV, steps).
  const D = "2026-11-03";
  for (let h = 9; h <= 18; h++) {
    const hh = String(h).padStart(2, "0");
    sample(db, "heart_rate", 55 + h, `${D}T${hh}:00:00-08:00`, true);
    sample(db, "hrv_sdnn", 120 + h, `${D}T${hh}:00:00-08:00`, true);
    sample(db, "step_count", 300, `${D}T${hh}:00:00-08:00`, true);
  }
  // Production's trace data: respiratory_rate exists exactly twice, ever.
  sample(db, "respiratory_rate", 17.9, "2026-10-09T12:00:00-08:00");
  sample(db, "respiratory_rate", 18.1, "2026-09-27T12:00:00-08:00");
  // Production also carries 4 sleep_analysis samples (Sleep & Mind's data).
  for (const date of ["2026-09-26", "2026-10-09", "2026-10-22", "2026-11-03"]) {
    sample(db, "sleep_analysis", 27000, `${date}T06:40:00-08:00`);
  }
  // Four recorded nights (production's sleep count).
  for (const [i, date] of ["2026-09-26", "2026-10-09", "2026-10-22", "2026-11-03"].entries()) {
    db.table("sleep").push({
      id: 100 + i, owner: OWNER, start_at: `${date}T23:12:00-08:00`,
      end_at: `${date}T06:40:00-08:00`, duration_s: 7.5 * 3600, source: "health_auto_export", stages_json: "{}",
    });
  }
  // measurements / journal / breathing / self_tests: intentionally empty.
}

function sections(html: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const re = /data-section="([^"]+)"/g;
  const hits: Array<{ name: string; at: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) hits.push({ name: m[1], at: m.index });
  hits.forEach((h, i) => {
    out.push({ name: h.name, body: html.slice(h.at, i + 1 < hits.length ? hits[i + 1].at : html.length) });
  });
  return out;
}

describe("cleanup wave: panel discipline on production-shaped data", () => {
  it("quick glance is the FIRST panel on Today and carries real values + the merged brief", async () => {
    const { env, db } = makeEnv();
    seedProductionShape(db);
    const home = await (await app.request("/", {}, env)).text();
    const secs = sections(home);
    expect(secs.length).toBeGreaterThan(0);
    expect(secs[0].name).toBe("glance");
    expect(secs[0].body).toContain("Quick glance");
    expect(secs[0].body).toContain("165.7"); // HRV key number, from health_samples
    expect(secs[0].body).toContain("2,915"); // steps key number
    expect(secs[0].body).toContain("Most important:");
    // The merged brief lives INSIDE the glance block, ahead of the coach cards.
    const glanceAt = home.indexOf('data-section="glance"');
    const coachAt = home.indexOf('data-section="coach-impacting"');
    const mostAt = home.indexOf("Most important:");
    expect(glanceAt).toBeGreaterThan(-1);
    expect(mostAt).toBeGreaterThan(glanceAt);
    expect(mostAt).toBeLessThan(coachAt);
  });

  it("every content panel on Today renders at least one real value (no hollow panels)", async () => {
    const { env, db } = makeEnv();
    seedProductionShape(db);
    const home = await (await app.request("/", {}, env)).text();
    const secs = sections(home);
    const names = secs.map((s) => s.name);
    for (const want of ["glance", "coach-impacting", "coach-drivers", "coach-actions", "ai-coach", "reports", "sleep-journal"]) {
      expect(names, want).toContain(want);
    }
    for (const s of secs) {
      if (s.name === "explore") continue; // link index, not a data panel
      expect(/\d/.test(s.body), `panel ${s.name} renders a real value`).toBe(true);
    }
  });

  it("the removed legacy panels' markup is absent from Today", async () => {
    const { env, db } = makeEnv();
    seedProductionShape(db);
    const home = await (await app.request("/", {}, env)).text();
    // Legacy lab Insights card: on production data it rendered ONLY
    // "No measurements yet — take your first HRV reading…" on a full
    // dashboard, duplicating the Coach panel.
    expect(home).not.toContain("No measurements yet — take your first HRV reading");
    expect(home).not.toContain("<h2>Insights</h2>");
    // Latest-measurement / Latest-from-Apple-Health card: duplicated the
    // glance + favorites numbers at the bottom of the page.
    expect(home).not.toContain("Latest from Apple Health");
    expect(home).not.toContain("<h2>Latest measurement</h2>");
    // Recent card: measurements-only, rendered nothing at all.
    expect(home).not.toContain("<h2>Recent</h2>");
    // Standalone Daily brief card: merged into the glance footer.
    expect(home).not.toContain('data-section="brief"');
  });

  it("My Data drops the hollow Measurement history card", async () => {
    const { env, db } = makeEnv();
    seedProductionShape(db);
    const html = await (await app.request("/mydata", {}, env)).text();
    expect(html).not.toContain("Measurement history");
    expect(html).toContain("Category details");
    expect(html).toContain("Imported samples");
  });

  it("categories API hides data-less categories and trace metrics", async () => {
    const { env, db } = makeEnv();
    seedProductionShape(db);
    const j = (await (await app.request("/api/mydata/categories", {}, env)).json()) as {
      categories: Array<{ key: string; metrics: Array<{ type: string }> }>;
    };
    const keys = j.categories.map((c) => c.key);
    expect(keys).toContain("activity");
    expect(keys).toContain("health");
    expect(keys).toContain("sleep-mind");
    expect(keys).not.toContain("blood-pressure"); // zero samples ever
    expect(keys).not.toContain("body"); // zero samples ever
    const health = j.categories.find((c) => c.key === "health")!;
    expect(health.metrics.map((m) => m.type)).not.toContain("respiratory_rate"); // 2 samples, no hourly
    expect(health.metrics.map((m) => m.type)).toContain("hrv_sdnn");
    const sleepMind = j.categories.find((c) => c.key === "sleep-mind")!;
    expect(sleepMind.metrics.map((m) => m.type)).not.toContain("mindful_session"); // zero samples
  });

  it("data-less category pages redirect; populated ones render without 'No data yet' blocks", async () => {
    const { env, db } = makeEnv();
    seedProductionShape(db);
    for (const key of ["blood-pressure", "body"]) {
      const r = await app.request(`/mydata/${key}`, {}, env);
      expect(r.status, key).toBe(302);
      expect(r.headers.get("location")).toBe("/mydata");
    }
    const health = await (await app.request("/mydata/health", {}, env)).text();
    expect(health).toContain("HRV (SDNN)");
    expect(health).not.toContain("Respiratory rate");
    expect(health).not.toContain("No data yet");
    const sleepMind = await (await app.request("/mydata/sleep-mind", {}, env)).text();
    expect(sleepMind).not.toContain("Mindful sessions");
    expect(sleepMind).not.toContain("No data yet");
  });
});
