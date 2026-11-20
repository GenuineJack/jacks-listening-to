import type { IncomingMessage, ServerResponse } from "node:http";

/*
 * What is playing right now, for the "now playing" card on the home page.
 *
 * Visitors call this; it calls Spotify. The refresh token never leaves the
 * server and no visitor ever sees a Spotify credential.
 *
 * Two Spotify behaviours drive the shape of this:
 *
 *  - Refresh tokens rotate. Every refresh returns a new refresh token and
 *    invalidates the one just used, so the new value has to be written back
 *    somewhere durable. A token pasted into an env var alone works exactly
 *    once and then dies — the env var is only the bootstrap value.
 *  - Since 20 July 2026 refresh tokens also expire six months after the
 *    original authorization, and refreshing does not extend that. When it
 *    lapses Spotify answers `invalid_grant`, which is not retryable: the
 *    only fix is signing in again on /season-puller.html.
 */

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";
const UPSTREAM_TIMEOUT_MS = 6000;

type State = "playing" | "paused" | "recent" | "idle" | "needs-auth" | "unconfigured";

interface Payload {
  state: State;
  track?: string;
  artist?: string;
  album?: string;
  albumArt?: string;
  url?: string;
  progressMs?: number;
  durationMs?: number;
  playedAt?: string;
  message?: string;
}

function send(res: ServerResponse, status: number, body: Payload, cacheControl: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cacheControl);
  res.end(JSON.stringify(body));
}

async function getJson(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* ---- token store ----
   Optional but strongly recommended: without it the rotated token cannot be
   kept and the widget stops working after the first refresh. Any Postgres
   reachable over PostgREST works; the table is one row.  */
const storeUrl = process.env.SUPABASE_URL?.trim().replace(/\/$/, "");
const storeKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const STORE_TABLE = "spotify_tokens";
const STORE_ID = "now-playing";
const storeConfigured = Boolean(storeUrl && storeKey);

/* Works with either Supabase key style. A legacy service_role key is a JWT and
   goes in both headers. A newer secret key (sb_secret_...) is not a JWT: it
   belongs in `apikey` only, and sending it as a Bearer token is rejected. */
function storeHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    apikey: storeKey as string,
    "Content-Type": "application/json",
  };
  if (storeKey?.startsWith("eyJ")) headers.Authorization = `Bearer ${storeKey}`;
  return headers;
}

async function readStoredToken(): Promise<string | null> {
  if (!storeConfigured) return null;
  try {
    const response = await getJson(
      `${storeUrl}/rest/v1/${STORE_TABLE}?id=eq.${STORE_ID}&select=refresh_token`,
      { headers: storeHeaders() },
    );
    if (!response.ok) return null;
    const rows = (await response.json()) as Array<{ refresh_token?: string }>;
    return rows?.[0]?.refresh_token?.trim() || null;
  } catch {
    return null;
  }
}

async function writeStoredToken(refreshToken: string): Promise<void> {
  if (!storeConfigured) return;
  try {
    await getJson(`${storeUrl}/rest/v1/${STORE_TABLE}`, {
      method: "POST",
      headers: { ...storeHeaders(), Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        id: STORE_ID,
        refresh_token: refreshToken,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch {
    /* A failed write means the next refresh uses a stale token and needs
       re-auth. Nothing useful to do here beyond not breaking this response. */
  }
}

class NeedsAuth extends Error {}

async function accessToken(): Promise<string> {
  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  if (!clientId) throw new Error("SPOTIFY_CLIENT_ID is not set");

  const refreshToken = (await readStoredToken()) || process.env.SPOTIFY_REFRESH_TOKEN?.trim();
  if (!refreshToken) throw new Error("No refresh token stored or configured");

  const response = await getJson(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    /* invalid_grant is terminal — retrying burns nothing but time. */
    if (response.status === 400 && detail.includes("invalid_grant")) throw new NeedsAuth();
    throw new Error(`Token refresh failed (${response.status})`);
  }

  const data = (await response.json()) as { access_token?: string; refresh_token?: string };
  if (!data.access_token) throw new Error("Token refresh returned no access token");
  /* Persist the rotated token before anything else can fail. */
  if (data.refresh_token && data.refresh_token !== refreshToken) {
    await writeStoredToken(data.refresh_token);
  }
  return data.access_token;
}

interface SpotifyTrack {
  name?: string;
  duration_ms?: number;
  artists?: Array<{ name?: string }>;
  album?: { name?: string; images?: Array<{ url?: string; width?: number }> };
  external_urls?: { spotify?: string };
}

/* Prefer a mid-size cover: the largest is 640px and needless for a small card. */
function coverArt(track: SpotifyTrack): string | undefined {
  const images = track.album?.images ?? [];
  const sorted = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sorted.find((image) => (image.width ?? 0) >= 200) ?? sorted[sorted.length - 1])?.url;
}

function describe(track: SpotifyTrack): Omit<Payload, "state"> {
  return {
    track: track.name ?? "",
    artist: (track.artists ?? []).map((artist) => artist.name).filter(Boolean).join(", "),
    album: track.album?.name ?? "",
    albumArt: coverArt(track),
    url: track.external_urls?.spotify,
    durationMs: track.duration_ms,
  };
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    send(res, 405, { state: "idle", message: "Method not allowed" }, "no-store");
    return;
  }

  if (!process.env.SPOTIFY_CLIENT_ID?.trim() || (!storeConfigured && !process.env.SPOTIFY_REFRESH_TOKEN?.trim())) {
    send(res, 200, { state: "unconfigured" }, "public, max-age=60");
    return;
  }

  try {
    const token = await accessToken();
    const auth = { Authorization: `Bearer ${token}` };

    const current = await getJson(`${API}/me/player/currently-playing`, { headers: auth });
    /* 204 means the player is idle rather than absent. */
    if (current.status === 200) {
      const data = (await current.json()) as { item?: SpotifyTrack; is_playing?: boolean; progress_ms?: number };
      if (data.item) {
        send(
          res,
          200,
          {
            state: data.is_playing ? "playing" : "paused",
            ...describe(data.item),
            progressMs: data.progress_ms ?? 0,
          },
          /* Short edge cache: fresh enough to feel live, and it keeps a busy
             page from turning into a Spotify request per visitor. */
          "public, max-age=10, s-maxage=20, stale-while-revalidate=40",
        );
        return;
      }
    }

    const recent = await getJson(`${API}/me/player/recently-played?limit=1`, { headers: auth });
    if (recent.ok) {
      const data = (await recent.json()) as { items?: Array<{ track?: SpotifyTrack; played_at?: string }> };
      const item = data.items?.[0];
      if (item?.track) {
        send(
          res,
          200,
          { state: "recent", ...describe(item.track), playedAt: item.played_at },
          "public, max-age=30, s-maxage=60, stale-while-revalidate=120",
        );
        return;
      }
    }

    send(res, 200, { state: "idle" }, "public, max-age=30, s-maxage=60");
  } catch (error) {
    if (error instanceof NeedsAuth) {
      send(
        res,
        200,
        { state: "needs-auth", message: "Spotify authorization expired. Sign in again on the season puller." },
        "no-store",
      );
      return;
    }
    send(res, 200, { state: "idle", message: "Spotify is unavailable right now." }, "no-store");
  }
}
