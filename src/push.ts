/**
 * OpenHRV — Web Push sender (RFC 8291 message encryption + RFC 8292 VAPID),
 * implemented on WebCrypto only (no dependencies; runs identically in
 * Workers and in the Vitest/Node suite, which verifies the full round trip:
 * VAPID JWT signature against the public key, and payload decryption with
 * independently derived keys).
 *
 * Secrets: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (base64url) and
 * VAPID_SUBJECT (mailto:) live in Worker secrets — never in the repo.
 */

export interface VapidKeys {
  publicKey: string; // base64url, 65-byte uncompressed point
  privateKey: string; // base64url, 32-byte scalar
  subject: string; // e.g. mailto:owner@example.com
}

export interface PushSub {
  endpoint: string;
  p256dh: string; // base64url UA public key
  auth: string; // base64url auth secret
}

export function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const subtle = (): SubtleCrypto => crypto.subtle;
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await subtle().importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle().sign("HMAC", k, data as BufferSource));
}

/** One-block HKDF expand step used twice by RFC 8291 (L <= 32). */
async function hkdfExpand1(prk: Uint8Array, info: Uint8Array): Promise<Uint8Array> {
  return hmacSha256(prk, concat(info, new Uint8Array([1])));
}

/** Generate a VAPID keypair (used by the ops script that sets the secrets). */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const kp = (await subtle().generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pub = new Uint8Array((await subtle().exportKey("raw", kp.publicKey)) as ArrayBuffer);
  const jwk = (await subtle().exportKey("jwk", kp.privateKey)) as JsonWebKey;
  return { publicKey: b64urlEncode(pub), privateKey: b64urlEncode(b64urlDecode(jwk.d!)) };
}

async function vapidSigningKey(keys: VapidKeys): Promise<CryptoKey> {
  const pub = b64urlDecode(keys.publicKey);
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: b64urlEncode(pub.slice(1, 33)),
    y: b64urlEncode(pub.slice(33, 65)),
    d: keys.privateKey.replace(/-/g, "+").replace(/_/g, "/"), // importKey tolerates std b64 in JWK fields
  };
  // JWK fields must be base64url without padding; normalize d the same way.
  jwk.d = b64urlEncode(b64urlDecode(keys.privateKey));
  return subtle().importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/** ES256 VAPID JWT for a push-service audience (RFC 8292 §2). */
export async function createVapidJwt(keys: VapidKeys, audience: string, ttlSeconds = 12 * 3600): Promise<string> {
  const header = b64urlEncode(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64urlEncode(
    utf8(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + ttlSeconds, sub: keys.subject })),
  );
  const signingInput = `${header}.${payload}`;
  const key = await vapidSigningKey(keys);
  const sig = new Uint8Array(
    await subtle().sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(signingInput) as BufferSource),
  );
  return `${signingInput}.${b64urlEncode(sig)}`;
}

/** RFC 8291 §3: encrypt a UTF-8 payload for one subscription (aes128gcm). */
export async function encryptPayload(sub: PushSub, payload: string): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(sub.p256dh);
  const authSecret = b64urlDecode(sub.auth);
  const sender = (await subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const senderPublic = new Uint8Array((await subtle().exportKey("raw", sender.publicKey)) as ArrayBuffer);
  const uaKey = await subtle().importKey("raw", uaPublic as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
  // NB: @cloudflare/workers-types v5 mangles EcdhKeyDeriveParams' `public`
  // field (as `$public`) — cast to the declared algorithm type; the runtime
  // WebCrypto API takes the standard `public` property.
  const ecdhAlg = { name: "ECDH", public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const ecdhSecret = new Uint8Array(await subtle().deriveBits(ecdhAlg, sender.privateKey, 256));
  // Key derivation: IKM binds the auth secret + both public keys.
  const keyInfo = concat(utf8("WebPush: info"), new Uint8Array([0]), uaPublic, senderPublic);
  const prk1 = await hmacSha256(authSecret, ecdhSecret);
  const ikm = await hkdfExpand1(prk1, keyInfo);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk2 = await hmacSha256(salt, ikm);
  const cek = (await hkdfExpand1(prk2, concat(utf8("Content-Encoding: aes128gcm"), new Uint8Array([0])))).slice(0, 16);
  const nonce = (await hkdfExpand1(prk2, concat(utf8("Content-Encoding: nonce"), new Uint8Array([0])))).slice(0, 12);
  const cekKey = await subtle().importKey("raw", cek as BufferSource, { name: "AES-GCM" }, false, ["encrypt"]);
  const record = concat(utf8(payload), new Uint8Array([2])); // 0x02 = final-record delimiter
  const cipher = new Uint8Array(
    await subtle().encrypt({ name: "AES-GCM", iv: nonce as BufferSource, tagLength: 128 }, cekKey, record as BufferSource),
  );
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([senderPublic.length]), senderPublic, cipher);
}

export interface PushSendResult {
  status: number;
  ok: boolean;
}

/** POST one encrypted notification to a subscription endpoint. */
export async function sendWebPush(
  keys: VapidKeys,
  sub: PushSub,
  payload: string,
  fetchImpl: typeof fetch,
  opts: { ttl?: number; urgency?: string } = {},
): Promise<PushSendResult> {
  const audience = new URL(sub.endpoint).origin;
  const jwt = await createVapidJwt(keys, audience);
  const body = await encryptPayload(sub, payload);
  const res = await fetchImpl(sub.endpoint, {
    method: "POST",
    headers: {
      authorization: `vapid t=${jwt}, k=${keys.publicKey}`,
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(opts.ttl ?? 86400),
      urgency: opts.urgency ?? "normal",
    },
    body: body as unknown as BodyInit,
  });
  return { status: res.status, ok: res.ok || res.status === 201 };
}

// ------------------------------------------------------------ cron decisions

export type NotificationType = "morning_readiness" | "measurement_reminder" | "low_battery" | "breathing_nudge";

export const NOTIFICATION_TYPES: Array<{ type: NotificationType; label: string; defaultTime: string }> = [
  { type: "morning_readiness", label: "Morning readiness (once today's first measurement exists)", defaultTime: "07:30" },
  { type: "measurement_reminder", label: "Measurement reminder (if no reading yet)", defaultTime: "08:00" },
  { type: "low_battery", label: "Low-Battery alert (charge under 25%)", defaultTime: "" },
  { type: "breathing_nudge", label: "Evening breathing nudge (if none logged today)", defaultTime: "20:00" },
];

export interface NotificationConfig {
  enabled: Record<NotificationType, boolean>;
  times: Partial<Record<NotificationType, string>>; // "HH:MM" local
  timeZone: string;
}

export const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
  enabled: { morning_readiness: true, measurement_reminder: true, low_battery: true, breathing_nudge: true },
  times: { morning_readiness: "07:30", measurement_reminder: "08:00", breathing_nudge: "20:00" },
  timeZone: "America/Los_Angeles",
};

/** Local date + minutes-since-midnight in an IANA timezone (Workers + Node
 *  both carry full ICU data). */
export function localParts(now: Date, timeZone: string): { date: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

const timeToMinutes = (t: string | undefined, fallback: number): number => {
  if (!t) return fallback;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : fallback;
};

export interface DueState {
  localDate: string;
  localMinutes: number;
  hasMeasurementToday: boolean;
  hasBreathingToday: boolean;
  battery: number | null; // latest Battery from a measurement taken today
  batteryAt: string | null;
  stress: number | null;
  sentToday: Set<NotificationType>;
  lastLowBatteryAt: string | null; // ISO of last low_battery send
  nowIso: string;
}

export interface DueNotification {
  type: NotificationType;
  title: string;
  body: string;
}

/** Pure scheduler: which notifications are due right now. */
export function dueNotifications(cfg: NotificationConfig, s: DueState): DueNotification[] {
  const out: DueNotification[] = [];
  const due = (t: NotificationType): boolean => cfg.enabled[t] && !s.sentToday.has(t);

  if (due("morning_readiness") && s.hasMeasurementToday && s.battery !== null) {
    if (s.localMinutes >= timeToMinutes(cfg.times.morning_readiness, 450)) {
      out.push({
        type: "morning_readiness",
        title: "Your morning readiness is in",
        body: `Battery ${Math.round(s.battery)}%${s.stress !== null ? ` · Stress ${Math.round(s.stress)}%` : ""}. Open OpenHRV for the full picture.`,
      });
    }
  }
  if (due("measurement_reminder") && !s.hasMeasurementToday) {
    if (s.localMinutes >= timeToMinutes(cfg.times.measurement_reminder, 480)) {
      out.push({
        type: "measurement_reminder",
        title: "Time for your HRV reading",
        body: "A one-minute morning measurement keeps your Battery and Stress scores current.",
      });
    }
  }
  if (due("low_battery") && s.battery !== null && s.battery < 25 && s.hasMeasurementToday) {
    const lastOk =
      !s.lastLowBatteryAt || new Date(s.nowIso).getTime() - new Date(s.lastLowBatteryAt).getTime() > 20 * 3600_000;
    if (lastOk) {
      out.push({
        type: "low_battery",
        title: "Battery is low",
        body: `Charge is ${Math.round(s.battery)}% — deep in the red. Prioritise rest today and re-measure tomorrow morning.`,
      });
    }
  }
  if (due("breathing_nudge") && !s.hasBreathingToday) {
    if (s.localMinutes >= timeToMinutes(cfg.times.breathing_nudge, 1200)) {
      out.push({
        type: "breathing_nudge",
        title: "Two minutes to wind down",
        body: "No breathing session logged today. A short box-breathing session is in More → Breathing.",
      });
    }
  }
  return out;
}
