import { describe, expect, it } from "vitest";
import { app, type Env } from "../src/index";
import { StubD1 } from "./d1stub";

const OWNER = "barkleesanders@gmail.com";

function makeEnv(): { env: Env; db: StubD1 } {
  const db = new StubD1();
  const env = { DB: db, OWNER_EMAIL: OWNER, GIT_SHA: "test" } as unknown as Env;
  return { env, db };
}

const jsonInit = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const GENETICS = {
  apoe: "ε2/ε3",
  snps: { rs429358: "TT", rs7412: "CT" },
  source: "Example genome export (fictional test fixture)",
};

const FAMILY = {
  members: [
    { name: "James Example", relation: "Father", born: 1960, died: 2020 },
    { name: "Robert Example", relation: "Paternal grandfather", born: 1935, died: 2019 },
    { name: "Mary Example", relation: "Mother", born: null, died: null, note: "living" },
  ],
};

describe("POST /api/settings/genetics + /api/settings/family", () => {
  it("round-trips genetics into the settings store", async () => {
    const { env, db } = makeEnv();
    const r = await app.request("/api/settings/genetics", jsonInit(GENETICS), env);
    expect(r.status).toBe(200);
    const row = db.table("settings").find((x) => x.key === "genetics");
    expect(row).toBeTruthy();
    const stored = JSON.parse(String(row!.value_json));
    expect(stored.apoe).toBe("ε2/ε3");
    expect(stored.snps).toEqual({ rs429358: "TT", rs7412: "CT" });
    expect(stored.source).toContain("Example genome export");
  });

  it("rejects a missing or oversized APOE with a human 400", async () => {
    const { env } = makeEnv();
    expect((await app.request("/api/settings/genetics", jsonInit({ snps: {} }), env)).status).toBe(400);
    expect((await app.request("/api/settings/genetics", jsonInit({ apoe: "ε2/ε3/ε2/ε3/waytoolong" }), env)).status).toBe(400);
    expect((await app.request("/api/settings/genetics", jsonInit({ apoe: "ε2/ε3", snps: ["TC"] }), env)).status).toBe(400);
  });

  it("round-trips family members, including a living member with null years", async () => {
    const { env, db } = makeEnv();
    const r = await app.request("/api/settings/family", jsonInit(FAMILY), env);
    expect(r.status).toBe(200);
    const row = db.table("settings").find((x) => x.key === "family_longevity");
    expect(row).toBeTruthy();
    const stored = JSON.parse(String(row!.value_json));
    expect(stored.members).toHaveLength(3);
    expect(stored.members[2].born).toBeNull();
    expect(stored.members[2].note).toBe("living");
  });

  it("rejects malformed family payloads", async () => {
    const { env } = makeEnv();
    expect((await app.request("/api/settings/family", jsonInit({ members: [] }), env)).status).toBe(400);
    expect(
      (await app.request("/api/settings/family", jsonInit({ members: [{ name: "X", relation: "Father", born: 1700, died: 2025 }] }), env)).status,
    ).toBe(400);
    expect(
      (await app.request("/api/settings/family", jsonInit({ members: [{ relation: "Father", born: 1960, died: 2020 }] }), env)).status,
    ).toBe(400);
  });
});

describe("GET /longevity genetics + family cards", () => {
  it("renders both cards when the settings exist", async () => {
    const { env } = makeEnv();
    await app.request("/api/settings/genetics", jsonInit(GENETICS), env);
    await app.request("/api/settings/family", jsonInit(FAMILY), env);
    const r = await app.request("/longevity", {}, env);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("Genetics — 23andMe");
    expect(html).toContain("ε2/ε3");
    expect(html).toContain("rs429358");
    expect(html).toContain("rs7412");
    expect(html).toContain("not a diagnosis and not destiny");
    expect(html).toContain("direct SNPs override older proxy-marker estimates");
    expect(html).toContain("Family longevity");
    expect(html).toContain("James Example");
    expect(html).toContain("1960–2020 · 60 yrs");
    expect(html).toContain("1935–2019 · 84 yrs");
    expect(html).toContain("Mary Example");
    expect(html).toContain("living");
    expect(html).toContain("kingsandersheritage.com");
  });

  it("omits both cards when the settings are unset", async () => {
    const { env } = makeEnv();
    const html = await (await app.request("/longevity", {}, env)).text();
    expect(html).not.toContain("Genetics — 23andMe");
    expect(html).not.toContain("Family longevity");
  });
});
