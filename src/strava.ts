/** OpenHRV — Strava connector helpers (OAuth + token encryption at rest).
 *  Credentials come from Worker secrets: STRAVA_CLIENT_ID,
 *  STRAVA_CLIENT_SECRET, STRAVA_VERIFY_TOKEN, TOKEN_ENC_KEY (base64, 32 bytes).
 *  Without them the connector reports a clear "needs keys" state. */

export interface StravaEnv {
  STRAVA_CLIENT_ID?: string;
  STRAVA_CLIENT_SECRET?: string;
  STRAVA_VERIFY_TOKEN?: string;
  TOKEN_ENC_KEY?: string;
}

export function stravaConfigured(env: StravaEnv): boolean {
  return Boolean(env.STRAVA_CLIENT_ID && env.STRAVA_CLIENT_SECRET);
}

export function stravaAuthorizeUrl(env: StravaEnv, redirectUri: string): string {
  const u = new URL("https://www.strava.com/oauth/authorize");
  u.searchParams.set("client_id", env.STRAVA_CLIENT_ID ?? "");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "read,activity:read_all");
  u.searchParams.set("approval_prompt", "auto");
  return u.toString();
}

async function aesKey(env: StravaEnv): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(env.TOKEN_ENC_KEY ?? ""), (ch) => ch.charCodeAt(0));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(env: StravaEnv, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), new TextEncoder().encode(plaintext));
  const pack = new Uint8Array(iv.length + ct.byteLength);
  pack.set(iv);
  pack.set(new Uint8Array(ct), iv.length);
  return btoa(String.fromCharCode(...pack));
}

export async function decryptToken(env: StravaEnv, packed: string): Promise<string> {
  const bytes = Uint8Array.from(atob(packed), (ch) => ch.charCodeAt(0));
  const iv = bytes.slice(0, 12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await aesKey(env), bytes.slice(12));
  return new TextDecoder().decode(pt);
}

/** Parse a Strava streams response into [elapsed_s, hr] pairs.
 *  Accepts both response shapes: key_by_type object form
 *  ({ time: { data: [...] }, heartrate: { data: [...] } }) and the
 *  array form ([{ type: "time", data: [...] }, ...]). */
export function parseStreamPairs(raw: unknown): Array<[number, number]> {
  let time: unknown;
  let hr: unknown;
  if (Array.isArray(raw)) {
    for (const s of raw as Array<Record<string, unknown>>) {
      if (s.type === "time") time = s.data;
      if (s.type === "heartrate") hr = s.data;
    }
  } else if (raw && typeof raw === "object") {
    const o = raw as Record<string, { data?: unknown }>;
    time = o.time?.data;
    hr = o.heartrate?.data;
  }
  if (!Array.isArray(time) || !Array.isArray(hr)) return [];
  const out: Array<[number, number]> = [];
  const n = Math.min(time.length, hr.length);
  for (let i = 0; i < n; i++) {
    const t = Number(time[i]);
    const h = Number(hr[i]);
    if (Number.isFinite(t) && Number.isFinite(h) && h > 0) out.push([t, h]);
  }
  return out;
}

/** Downsample [t, hr] pairs to at most one point per `minGapS` seconds
 *  (first and last points always kept). Strava streams are ~1 pt/s; at
 *  5 s spacing a 3-hour ride is ~2,160 points — plenty for a chart. */
export function downsampleStream(
  pairs: Array<[number, number]>,
  minGapS = 5,
  cap = 4000,
): Array<[number, number]> {
  if (pairs.length <= 2) return pairs;
  const out: Array<[number, number]> = [pairs[0]];
  let lastT = pairs[0][0];
  for (let i = 1; i < pairs.length - 1; i++) {
    if (pairs[i][0] - lastT >= minGapS) {
      out.push(pairs[i]);
      lastT = pairs[i][0];
    }
  }
  const last = pairs[pairs.length - 1];
  if (out[out.length - 1][0] !== last[0]) out.push(last);
  if (out.length <= cap) return out;
  const stride = Math.ceil(out.length / cap);
  const capped = out.filter((_, i) => i % stride === 0);
  if (capped[capped.length - 1][0] !== last[0]) capped.push(last);
  return capped;
}

/** Map a Strava activity to a normalized workout sample (meta-rich). */
export function stravaActivitySample(a: Record<string, unknown>): {
  type: string; value: number | null; unit: string; start_at: string; end_at: null;
  source: string; external_id: string; meta: Record<string, unknown>;
} {
  const start = String(a.start_date ?? new Date().toISOString());
  const elapsed = typeof a.elapsed_time === "number" ? a.elapsed_time : null;
  return {
    type: "workout",
    value: elapsed,
    unit: "s",
    start_at: start,
    end_at: null,
    source: "strava",
    external_id: `strava-activity:${String(a.id)}`,
    meta: {
      name: a.name ?? null,
      sport: a.sport_type ?? a.type ?? null,
      distance_m: a.distance ?? null,
      moving_time_s: a.moving_time ?? null,
      avg_hr_bpm: a.average_heartrate ?? null,
      max_hr_bpm: a.max_heartrate ?? null,
      calories: a.calories ?? null,
    },
  };
}
