import { describe, expect, it } from "vitest";
import { app } from "../src/index";

// No D1 binding in unit tests: DB helpers degrade to empty results by design,
// so page shells and discovery surfaces must still render.
const env = { OWNER_EMAIL: "barkleesanders@gmail.com", GIT_SHA: "testsha" } as never;

describe("app shell + discovery (Phase 1.4w WebMCP surface)", () => {
  it("GET /api/health reports ok + sha", async () => {
    const r = await app.request("/api/health", {}, env);
    expect(r.status).toBe(200);
    const j = (await r.json()) as { ok: boolean; sha: string };
    expect(j.ok).toBe(true);
    expect(j.sha).toBe("testsha");
  });
  it("GET / renders the Today dashboard with bottom nav", async () => {
    const r = await app.request("/", {}, env);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("Battery");
    expect(html).toContain("Pressure");
    expect(html).toContain("/measure");
    expect(html).toContain("/mydata");
    expect(html).toContain('rel="manifest"');
  });
  it("GET /.well-known/webmcp.json lists tools + endpoint", async () => {
    const r = await app.request("/.well-known/webmcp.json", {}, env);
    expect(r.status).toBe(200);
    const j = (await r.json()) as { tools: Array<{ name: string }>; toolsEndpoint: string };
    expect(j.tools.map((t) => t.name)).toContain("openhrv_create_measurement");
    expect(j.toolsEndpoint).toContain("/api/webmcp");
  });
  it("robots.txt and llms.txt advertise WebMCP discovery", async () => {
    const robots = await (await app.request("/robots.txt", {}, env)).text();
    const llms = await (await app.request("/llms.txt", {}, env)).text();
    expect(robots).toContain("/.well-known/webmcp.json");
    expect(llms).toContain("/.well-known/webmcp.json");
  });
  it("manifest + service worker are served for PWA install", async () => {
    const m = await app.request("/manifest.webmanifest", {}, env);
    expect(m.status).toBe(200);
    expect(((await m.json()) as { display: string }).display).toBe("standalone");
    const sw = await app.request("/sw.js", {}, env);
    expect(sw.status).toBe(200);
    expect(await sw.text()).toContain("push");
  });
  it("favicon.ico is a real ICO and apple-touch-icon a PNG", async () => {
    const ico = await app.request("/favicon.ico", {}, env);
    expect(ico.headers.get("content-type")).toContain("image/x-icon");
    const buf = new Uint8Array(await ico.arrayBuffer());
    expect([buf[0], buf[1], buf[2], buf[3]]).toEqual([0, 0, 1, 0]);
    const png = await app.request("/apple-touch-icon.png", {}, env);
    const pbuf = new Uint8Array(await png.arrayBuffer());
    expect([pbuf[0], pbuf[1], pbuf[2], pbuf[3]]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
  it("POST /api/webmcp rejects unknown tools and runs get_today", async () => {
    const bad = await app.request("/api/webmcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool: "nope" }) }, env);
    expect(bad.status).toBe(404);
    const ok = await app.request("/api/webmcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool: "openhrv_get_today", arguments: {} }) }, env);
    expect(ok.status).toBe(200);
  });
  it("owner lock: a different Access identity is forbidden on /api/*", async () => {
    const r = await app.request("/api/today", { headers: { "cf-access-authenticated-user-email": "someoneelse@example.com" } }, env);
    expect(r.status).toBe(403);
  });
});
