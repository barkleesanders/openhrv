import { afterEach, describe, expect, it, vi } from "vitest";
import {
  b64urlDecode,
  b64urlEncode,
  createVapidJwt,
  dueNotifications,
  encryptPayload,
  generateVapidKeys,
  localParts,
  DEFAULT_NOTIFICATION_CONFIG,
  type DueState,
  type NotificationConfig,
  type NotificationType,
} from "../src/push";
import { app, runScheduled, type Env } from "../src/index";
import { StubD1 } from "./d1stub";

const subtle = crypto.subtle;
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const concat = (...ps: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(ps.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of ps) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle.sign("HMAC", k, data as BufferSource));
}

/** Independent RFC 8291 decryption, written from the RFC for the tests —
 *  the production encrypt path must interoperate with THIS code. */
async function decryptPushBody(body: Uint8Array, uaPrivate: CryptoKey, uaPublicRaw: Uint8Array, auth: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const senderPub = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const senderKey = await subtle.importKey("raw", senderPub as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhAlg = { name: "ECDH", public: senderKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const secret = new Uint8Array(await subtle.deriveBits(ecdhAlg, uaPrivate, 256));
  const keyInfo = concat(utf8("WebPush: info"), new Uint8Array([0]), uaPublicRaw, senderPub);
  const ikm = await hmac(await hmac(auth, secret), concat(keyInfo, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(utf8("Content-Encoding: aes128gcm"), new Uint8Array([0, 1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(utf8("Content-Encoding: nonce"), new Uint8Array([0, 1])))).slice(0, 12);
  const cekKey = await subtle.importKey("raw", cek as BufferSource, { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce as BufferSource, tagLength: 128 }, cekKey, cipher as BufferSource));
  // Strip padding: trailing 0x02 delimiter is the last non-zero byte.
  let end = plain.length;
  while (end > 0 && plain[end - 1] === 0) end--;
  expect(plain[end - 1]).toBe(2);
  return new TextDecoder().decode(plain.slice(0, end - 1));
}

async function makeUa() {
  const kp = (await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const pub = new Uint8Array((await subtle.exportKey("raw", kp.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { private: kp.privateKey, pubRaw: pub, auth, p256dh: b64urlEncode(pub), authB64: b64urlEncode(auth) };
}

describe("VAPID JWT (RFC 8292)", () => {
  it("signs an ES256 JWT that verifies against the generated public key", async () => {
    const keys = await generateVapidKeys();
    const jwt = await createVapidJwt({ ...keys, subject: "mailto:barkleesanders@gmail.com" }, "https://web.push.apple.com");
    const [h, p, s] = jwt.split(".");
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p))) as { aud: string; sub: string; exp: number };
    expect(payload.aud).toBe("https://web.push.apple.com");
    expect(payload.sub).toBe("mailto:barkleesanders@gmail.com");
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    const pubRaw = b64urlDecode(keys.publicKey);
    const verifyKey = await subtle.importKey(
      "jwk",
      { kty: "EC", crv: "P-256", x: b64urlEncode(pubRaw.slice(1, 33)), y: b64urlEncode(pubRaw.slice(33, 65)) },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const ok = await subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      verifyKey,
      b64urlDecode(s) as BufferSource,
      utf8(`${h}.${p}`) as BufferSource,
    );
    expect(ok).toBe(true);
  });
});

describe("payload encryption (RFC 8291)", () => {
  it("round-trips through an independent decryptor", async () => {
    const ua = await makeUa();
    const body = await encryptPayload({ endpoint: "https://push.example.com/abc", p256dh: ua.p256dh, auth: ua.authB64 }, JSON.stringify({ title: "Hi", body: "there" }));
    const text = await decryptPushBody(body, ua.private, ua.pubRaw, ua.auth);
    expect(JSON.parse(text)).toEqual({ title: "Hi", body: "there" });
  });
});

describe("localParts + dueNotifications", () => {
  it("converts UTC to the owner timezone", () => {
    const p = localParts(new Date("2026-11-04T16:00:00.000Z"), "America/Los_Angeles");
    expect(p.date).toBe("2026-11-04");
    expect(p.minutes).toBe(480); // 08:00 PST
  });
  const cfg: NotificationConfig = JSON.parse(JSON.stringify(DEFAULT_NOTIFICATION_CONFIG)) as NotificationConfig;
  const state: DueState = {
    localDate: "2026-11-04",
    localMinutes: 500,
    hasMeasurementToday: false,
    hasBreathingToday: false,
    battery: null,
    batteryAt: null,
    stress: null,
    sentToday: new Set<NotificationType>(),
    lastLowBatteryAt: null,
    nowIso: "2026-11-04T16:20:00.000Z",
  } as const;
  it("reminder fires without a measurement; readiness needs one", () => {
    const due = dueNotifications(cfg, { ...state });
    expect(due.map((d) => d.type)).toContain("measurement_reminder");
    expect(due.map((d) => d.type)).not.toContain("morning_readiness");
    const withMeas = dueNotifications(cfg, { ...state, hasMeasurementToday: true, battery: 62, stress: 40 });
    expect(withMeas.map((d) => d.type)).toContain("morning_readiness");
    expect(withMeas.map((d) => d.type)).not.toContain("measurement_reminder");
  });
  it("low battery fires under 25%, respects the 20 h cooldown and prefs", () => {
    const low = dueNotifications(cfg, { ...state, hasMeasurementToday: true, battery: 18 });
    expect(low.map((d) => d.type)).toContain("low_battery");
    const cooled = dueNotifications(cfg, { ...state, hasMeasurementToday: true, battery: 18, lastLowBatteryAt: "2026-11-04T10:00:00.000Z" });
    expect(cooled.map((d) => d.type)).not.toContain("low_battery");
    const off: NotificationConfig = { ...cfg, enabled: { ...cfg.enabled, low_battery: false } };
    expect(dueNotifications(off, { ...state, hasMeasurementToday: true, battery: 18 }).map((d) => d.type)).not.toContain("low_battery");
  });
  it("sent-today dedup and breathing nudge timing", () => {
    const sent = dueNotifications(cfg, { ...state, sentToday: new Set<NotificationType>(["measurement_reminder"]) });
    expect(sent.map((d) => d.type)).not.toContain("measurement_reminder");
    const evening = dueNotifications(cfg, { ...state, localMinutes: 1210, hasMeasurementToday: true, battery: 60 });
    expect(evening.map((d) => d.type)).toContain("breathing_nudge");
    const didBreathe = dueNotifications(cfg, { ...state, localMinutes: 1210, hasMeasurementToday: true, battery: 60, hasBreathingToday: true });
    expect(didBreathe.map((d) => d.type)).not.toContain("breathing_nudge");
  });
});

describe("push endpoints + dispatch (stub D1, stubbed fetch)", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function setupEnv() {
    const vapid = await generateVapidKeys();
    const db = new StubD1();
    const env = {
      DB: db,
      OWNER_EMAIL: "barkleesanders@gmail.com",
      GIT_SHA: "test",
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      VAPID_SUBJECT: "mailto:barkleesanders@gmail.com",
    } as unknown as Env;
    return { env, db, vapid };
  }

  it("subscribe → test send delivers an encrypted, VAPID-signed POST and logs it", async () => {
    const { env, db } = await setupEnv();
    const ua = await makeUa();
    const bad = await app.request("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: "http://insecure.example/x" }) }, env);
    expect(bad.status).toBe(400);
    const sub = await app.request(
      "/api/push/subscribe",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription: { endpoint: "https://web.push.apple.com/xyz", keys: { p256dh: ua.p256dh, auth: ua.authB64 } } }),
      },
      env,
    );
    expect(sub.status).toBe(200);
    const count = (await (await app.request("/api/push/subscriptions", {}, env)).json()) as { count: number };
    expect(count.count).toBe(1);

    const captured: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      captured.push({ url, init });
      return new Response(null, { status: 201 });
    });
    const test = await app.request("/api/notifications/test", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }, env);
    const tj = (await test.json()) as { ok: boolean; results: Array<{ status: string; http_status: number }> };
    expect(tj.ok).toBe(true);
    expect(tj.results[0]).toMatchObject({ status: "sent", http_status: 201 });
    expect(captured).toHaveLength(1);
    const headers = captured[0].init.headers as Record<string, string>;
    expect(headers["content-encoding"]).toBe("aes128gcm");
    expect(headers.authorization).toMatch(/^vapid t=eyJ/);
    const plain = await decryptPushBody(new Uint8Array(captured[0].init.body as Uint8Array), ua.private, ua.pubRaw, ua.auth);
    expect(JSON.parse(plain)).toMatchObject({ title: "OpenHRV test notification" });

    const log = (await (await app.request("/api/notifications/log", {}, env)).json()) as { log: Array<{ type: string; status: string; http_status: number }> };
    expect(log.log[0]).toMatchObject({ type: "test", status: "sent", http_status: 201 });
    void db;
  });

  it("a 410 from the push service removes the subscription and logs 'gone'", async () => {
    const { env, db } = await setupEnv();
    const ua = await makeUa();
    await app.request(
      "/api/push/subscribe",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subscription: { endpoint: "https://push.example.com/dead", keys: { p256dh: ua.p256dh, auth: ua.authB64 } } }) },
      env,
    );
    vi.stubGlobal("fetch", async () => new Response(null, { status: 410 }));
    const test = await app.request("/api/notifications/test", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }, env);
    const tj = (await test.json()) as { results: Array<{ status: string }> };
    expect(tj.results[0].status).toBe("gone");
    expect(db.table("push_subscriptions")).toHaveLength(0);
    expect(db.table("notification_log")[0].status).toBe("gone");
  });

  it("prefs toggle suppresses a type in the effective config", async () => {
    const { env } = await setupEnv();
    await app.request(
      "/api/notifications/config",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "low_battery", enabled: false }) },
      env,
    );
    const cfg = (await (await app.request("/api/notifications/config", {}, env)).json()) as { types: Array<{ type: string; enabled: boolean }> };
    expect(cfg.types.find((t) => t.type === "low_battery")!.enabled).toBe(false);
    expect(cfg.types.find((t) => t.type === "morning_readiness")!.enabled).toBe(true);
  });

  it("runScheduled dispatches a due reminder once, then dedups via the log", async () => {
    const { env } = await setupEnv();
    const ua = await makeUa();
    await app.request(
      "/api/push/subscribe",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subscription: { endpoint: "https://push.example.com/live", keys: { p256dh: ua.p256dh, auth: ua.authB64 } } }) },
      env,
    );
    await app.request(
      "/api/notifications/config",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "measurement_reminder", time: "00:00" }) },
      env,
    );
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      return new Response(null, { status: 201 });
    });
    const first = await runScheduled(env);
    expect(first.due).toContain("measurement_reminder");
    expect(first.sent).toBeGreaterThanOrEqual(1);
    const afterFirst = calls;
    const second = await runScheduled(env);
    expect(second.due).not.toContain("measurement_reminder");
    expect(second.sent).toBe(0);
    expect(calls).toBe(afterFirst);
  });
});
