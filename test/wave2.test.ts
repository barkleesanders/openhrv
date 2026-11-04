import { describe, expect, it } from "vitest";
import { app, type Env } from "../src/index";
import { StubD1 } from "./d1stub";

const OWNER = "barkleesanders@gmail.com";
const RR = Array.from({ length: 60 }, (_, i) => 800 + Math.round(28 * Math.sin(i / 5)));

class StubMedia {
  store = new Map<string, { bytes: Uint8Array; type: string }>();
  async get(key: string) {
    const v = this.store.get(key);
    if (!v) return null;
    return {
      body: new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(v.bytes);
          c.close();
        },
      }),
      httpMetadata: { contentType: v.type },
    };
  }
  async put(key: string, value: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) {
    this.store.set(key, { bytes: new Uint8Array(value), type: opts?.httpMetadata?.contentType ?? "" });
  }
  async delete(key: string) {
    this.store.delete(key);
  }
}

function makeEnv(extra: Partial<Env> = {}): { env: Env; db: StubD1 } {
  const db = new StubD1();
  const env = { DB: db, OWNER_EMAIL: OWNER, GIT_SHA: "test", ...extra } as unknown as Env;
  return { env, db };
}
const jsonInit = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("wave-2 pages render", () => {
  const { env } = makeEnv();
  const pages: Array<[string, string]> = [
    ["/sleep", "Last night"],
    ["/lab", "Science Lab"],
    ["/coach", "Ask your data"],
    ["/stories", "What RMSSD actually measures"],
    ["/welcome", "What OpenHRV is"],
    ["/tests", "Reaction time"],
    ["/themes", "Face gallery"],
    ["/about", "Feedback"],
  ];
  for (const [path, marker] of pages) {
    it(`GET ${path} renders (${marker})`, async () => {
      const r = await app.request(path, {}, env);
      expect(r.status).toBe(200);
      expect(await r.text()).toContain(marker);
    });
  }
  it("GET /mydata/bogus is a 404", async () => {
    const r = await app.request("/mydata/bogus", {}, env);
    expect(r.status).toBe(404);
  });
  it("cleanup wave: a category with no data behind it redirects to /mydata; one with data renders", async () => {
    const { env, db } = makeEnv();
    const empty = await app.request("/mydata/blood-pressure", {}, env);
    expect(empty.status).toBe(302);
    expect(empty.headers.get("location")).toBe("/mydata");
    for (let i = 0; i < 3; i++) {
      db.table("health_samples").push({ id: 50 + i, owner: OWNER, type: "step_count", value: 8000 + i, unit: "count", start_at: `2026-10-0${i + 1}T12:00:00.000Z`, end_at: null, source: "apple_health", external_id: `st${i}`, meta_json: "{}" });
    }
    const ok = await app.request("/mydata/activity", {}, env);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("Activity");
  });
  it("manifest carries the PWA shortcuts (home-screen quick actions)", async () => {
    const m = (await (await app.request("/manifest.webmanifest", {}, env)).json()) as { shortcuts: Array<{ url: string }> };
    expect(m.shortcuts.map((s) => s.url)).toEqual(["/measure", "/journal", "/more", "/tests"]);
  });
});

describe("sleep + categories APIs (seeded stub data)", () => {
  it("sleep summary reflects stored nights", async () => {
    const { env, db } = makeEnv();
    db.table("sleep").push(
      { id: 1, owner: OWNER, start_at: "2026-10-01T23:00:00.000Z", end_at: "2026-10-02T06:00:00.000Z", duration_s: 7 * 3600, source: "shortcut", stages_json: "{}" },
      { id: 2, owner: OWNER, start_at: "2026-10-02T23:00:00.000Z", end_at: "2026-10-03T06:30:00.000Z", duration_s: 7.5 * 3600, source: "shortcut", stages_json: "{}" },
    );
    const j = (await (await app.request("/api/sleep", {}, env)).json()) as { summary: { count: number; lastNight: { hours: number } } };
    expect(j.summary.count).toBe(2);
    expect(j.summary.lastNight.hours).toBe(7.5);
  });
  it("categories pair blood-pressure samples and report latest values", async () => {
    const { env, db } = makeEnv();
    // Cleanup wave visibility rule: a metric surfaces with >= 3 daily
    // samples (or any hourly) — seed three pairs; the pairing + latest
    // assertions are unchanged.
    let id = 1;
    for (const [at, sys, dia] of [
      ["2026-09-30T08:00:00.000Z", 118, 76],
      ["2026-10-01T08:00:00.000Z", 119, 78],
      ["2026-10-02T08:00:00.000Z", 120, 80],
    ] as const) {
      db.table("health_samples").push(
        { id: id++, owner: OWNER, type: "blood_pressure_systolic", value: sys, unit: "mmHg", start_at: at, end_at: null, source: "apple_health", external_id: `s${id}`, meta_json: "{}" },
        { id: id++, owner: OWNER, type: "blood_pressure_diastolic", value: dia, unit: "mmHg", start_at: at, end_at: null, source: "apple_health", external_id: `d${id}`, meta_json: "{}" },
      );
    }
    const j = (await (await app.request("/api/mydata/categories", {}, env)).json()) as {
      categories: Array<{ key: string; sampleCount: number }>;
      bpReadings: Array<{ systolic: number; diastolic: number }>;
    };
    expect(j.categories.find((c) => c.key === "blood-pressure")!.sampleCount).toBe(6);
    expect(j.bpReadings[0]).toMatchObject({ systolic: 120, diastolic: 80 });
  });
});

describe("self-tests API", () => {
  it("validates the test type and stores + trends results", async () => {
    const { env } = makeEnv();
    const bad = await app.request("/api/self-tests", jsonInit({ test_type: "nope", result: {} }), env);
    expect(bad.status).toBe(400);
    const ok = await app.request("/api/self-tests", jsonInit({ test_type: "reaction_time", result: { mean_ms: 243, best_ms: 201 } }), env);
    expect(ok.status).toBe(200);
    const list = (await (await app.request("/api/self-tests", {}, env)).json()) as { tests: Array<{ test_type: string; result: { mean_ms: number } }> };
    expect(list.tests[0].test_type).toBe("reaction_time");
    expect(list.tests[0].result.mean_ms).toBe(243);
  });
});

describe("voice comments (stub R2 + Whisper)", () => {
  it("uploads audio, transcribes best-effort, serves playback, attaches to journal", async () => {
    const media = new StubMedia();
    const ai = {
      run: async (model: string) => (model.includes("whisper") ? { text: "felt tired today" } : { response: "ok" }),
    };
    const { env } = makeEnv({ MEDIA: media as never, AI: ai as never });
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array([9, 8, 7])], "v.webm", { type: "audio/webm" }));
    fd.append("duration_s", "4");
    const up = (await (await app.request("/api/voice", { method: "POST", body: fd }, env)).json()) as { ok: boolean; id: number; transcript: string };
    expect(up.ok).toBe(true);
    expect(up.transcript).toBe("felt tired today");
    const audio = await app.request(`/api/voice/${up.id}/audio`, {}, env);
    expect(audio.status).toBe(200);
    expect(new Uint8Array(await audio.arrayBuffer())).toEqual(new Uint8Array([9, 8, 7]));
    const entry = (await (await app.request("/api/journal", jsonInit({ body: "voice day", voice_note_id: up.id }), env)).json()) as { ok: boolean };
    expect(entry.ok).toBe(true);
    const list = (await (await app.request("/api/journal", {}, env)).json()) as { entries: Array<{ voice_note_id: string }> };
    expect(list.entries[0].voice_note_id).toBe(String(up.id));
  });
  it("returns 501 when R2 media is not configured", async () => {
    const { env } = makeEnv();
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array([1])], "v.webm", { type: "audio/webm" }));
    const r = await app.request("/api/voice", { method: "POST", body: fd }, env);
    expect(r.status).toBe(501);
  });
});

describe("AI coach grounding", () => {
  it("503s without the AI binding, 403s when flagged off, answers with data context when on", async () => {
    const noAi = makeEnv();
    await app.request("/api/measurements", jsonInit({ rr_ms: RR, source: "manual" }), noAi.env);
    const r503 = await app.request("/api/coach", jsonInit({ message: "How am I doing?" }), noAi.env);
    expect(r503.status).toBe(503);

    let captured: { messages: Array<{ role: string; content: string }> } | null = null;
    const ai = {
      run: async (_model: string, input: never) => {
        captured = input as { messages: Array<{ role: string; content: string }> };
        return { response: "Your latest RMSSD is in line with your baseline." };
      },
    };
    const withAi = makeEnv({ AI: ai as never });
    await app.request("/api/measurements", jsonInit({ rr_ms: RR, source: "manual" }), withAi.env);
    const ok = (await (await app.request("/api/coach", jsonInit({ message: "How am I doing?" }), withAi.env)).json()) as { ok: boolean; reply: string };
    expect(ok.ok).toBe(true);
    expect(ok.reply).toContain("RMSSD");
    expect(captured!.messages[0].content).toContain("DATA — the owner's stored OpenHRV data");
    expect(captured!.messages[0].content).toContain("Latest measurement");

    await app.request("/api/settings/flags", jsonInit({ ai_coach: false }), withAi.env);
    const r403 = await app.request("/api/coach", jsonInit({ message: "hi" }), withAi.env);
    expect(r403.status).toBe(403);
  });
});

describe("settings: onboarding + delete-my-data", () => {
  it("onboarding flag round-trips", async () => {
    const { env } = makeEnv();
    const before = (await (await app.request("/api/settings/onboarded", {}, env)).json()) as { onboarded: boolean };
    expect(before.onboarded).toBe(false);
    await app.request("/api/settings/onboarded", { method: "POST" }, env);
    const after = (await (await app.request("/api/settings/onboarded", {}, env)).json()) as { onboarded: boolean };
    expect(after.onboarded).toBe(true);
  });
  it("delete requires the exact confirm and wipes owner tables", async () => {
    const { env } = makeEnv();
    await app.request("/api/measurements", jsonInit({ rr_ms: RR, source: "manual" }), env);
    await app.request("/api/journal", jsonInit({ body: "note" }), env);
    const bad = await app.request("/api/account/delete", jsonInit({ confirm: "delete" }), env);
    expect(bad.status).toBe(400);
    const ok = (await (await app.request("/api/account/delete", jsonInit({ confirm: "DELETE" }), env)).json()) as { ok: boolean; deleted: Record<string, number> };
    expect(ok.ok).toBe(true);
    expect(ok.deleted.measurements).toBe(1);
    expect(ok.deleted.journal).toBe(1);
    const md = (await (await app.request("/api/mydata", {}, env)).json()) as { counts: { measurements: number } };
    expect(md.counts.measurements).toBe(0);
  });
});

describe("watch companion lanes (import-token auth)", () => {
  it("rejects bad tokens and serves today + measurement intake with the owner token", async () => {
    const { env } = makeEnv();
    const noTok = await app.request("/api/watch/today", {}, env);
    expect(noTok.status).toBe(401);
    const tok = (await (await app.request("/api/settings/import-token", {}, env)).json()) as { token: string };
    const headers = { authorization: `Bearer ${tok.token}`, "content-type": "application/json" };
    const today = await app.request("/api/watch/today", { headers }, env);
    expect(today.status).toBe(200);
    const post = await app.request("/api/watch/measurements", { method: "POST", headers, body: JSON.stringify({ rr_ms: RR }) }, env);
    expect(post.status).toBe(200);
    const list = (await (await app.request("/api/measurements", {}, env)).json()) as { measurements: Array<{ source: string }> };
    expect(list.measurements[0].source).toBe("watch");
  });
});
