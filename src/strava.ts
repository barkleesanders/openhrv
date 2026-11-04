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
