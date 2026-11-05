import { describe, expect, it } from "vitest";
import { app, type Env } from "../src/index";
import { StubD1 } from "./d1stub";

const OWNER = "barkleesanders@gmail.com";

function makeEnv(): { env: Env; db: StubD1 } {
  const db = new StubD1();
  const env = { DB: db, OWNER_EMAIL: OWNER, GIT_SHA: "test" } as unknown as Env;
  return { env, db };
}

function seedSample(db: StubD1) {
  // Category pages redirect away until the category is visible
  // (visibility rule: >= 3 daily points or any hourly points).
  ["2026-11-01", "2026-11-02", "2026-11-03"].forEach((d, i) => {
    db.table("health_samples").push({
      id: i + 1, owner: OWNER, type: "hrv_sdnn", value: 100 + i, unit: "ms",
      start_at: `${d}T12:00:00-08:00`, end_at: `${d}T12:00:00-08:00`,
      source: "health_auto_export:Muse Apple Health",
      external_id: `hrv_sdnn:${d}`, meta_json: "{}",
    });
  });
}

// 2026-11-04: Barklee's app kept saying it couldn't show the data —
// production data and APIs were verified healthy; the failure was
// client-side: the Access session lasts 24h, and when it lapses the
// data fetches return the login page (non-JSON). Pages parsed it with
// r.json(), threw, and sat on "Loading…" forever. Every data page now
// loads through apiJson (detects the non-JSON/session case) and
// settles via apiFail with a sign-in prompt; the service worker no
// longer caches redirected/login responses and purges its old cache.
describe("session-resilient data loading (2026-11-04)", () => {
  it("every page carries the apiJson/apiFail helpers with a sign-in path", async () => {
    const { env } = makeEnv();
    const html = await (await app.request("/", {}, env)).text();
    expect(html).toContain("window.apiJson");
    expect(html).toContain("window.apiFail");
    expect(html).toContain("sign-in session expired");
    expect(html).toContain("Tap here to sign in again");
  });

  it("sleep page loads via apiJson and settles through apiFail", async () => {
    const { env } = makeEnv();
    const html = await (await app.request("/sleep", {}, env)).text();
    expect(html).toContain('apiJson("/api/sleep")');
    expect(html).toContain('apiFail("lastsub"');
    expect(html).not.toContain('fetch("/api/sleep")');
  });

  it("mydata + category + impact + score pages are wired the same way", async () => {
    const { env } = makeEnv();
    const mydata = await (await app.request("/mydata", {}, env)).text();
    expect(mydata).toContain('apiFail("cats"');
    expect(mydata).toContain('apiFail("samples"');
    seedSample((env as unknown as { DB: StubD1 }).DB);
    const cat = await (await app.request("/mydata/health", {}, env)).text();
    expect(cat).toContain('apiFail("recent"');
    const impact = await (await app.request("/impact", {}, env)).text();
    expect(impact).toContain('apiFail("cards"');
    const score = await (await app.request("/battery", {}, env)).text();
    expect(score).toContain('apiFail("drivers"');
    expect(score).not.toContain("Could not load");
  });

  it("the service worker is v2, purges old caches, and caches only good GET responses", async () => {
    const { env } = makeEnv();
    const js = await (await app.request("/sw.js", {}, env)).text();
    expect(js).toContain('const C = "openhrv-v2"');
    expect(js).toContain("caches.delete");
    expect(js).toContain("r.ok && !r.redirected");
    expect(js).toContain("/cdn-cgi/");
  });
});
