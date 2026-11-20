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
 *    somewhere durable (Airtable, below). A token pasted into an env var alone
 *    works exactly once and then dies; the env var is only a bootstrap value.
 *  - Since 20 July 2026 refresh tokens also expire six months after the
 *    original authorization, and refreshing does not extend that. When it
 *    lapses Spotify answers `invalid_grant`, which is not retryable: the
 *    only fix is signing in again on /season-puller.html and pasting the new
 *    token into Airtable.
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

/* ---- token store: one row in Airtable ----
   Base JKLOL, table "Jacks Listening To", the row whose Name is
   spotify-now-playing. Airtable's API has a monthly call budget, so this
   touches it as little as possible: one read when a server instance first
   needs a token or is about to refresh one, and one write each time Spotify
   issues a new token (about hourly, and only while people are visiting).
   In between, tokens are served from memory.  */
const AIRTABLE_API = "https://api.airtable.com/v0";
const airtableToken = process.env.AIRTABLE_TOKEN?.trim();
const airtableBase = process.env.AIRTABLE_BASE_ID?.trim();
const airtableTable = process.env.AIRTABLE_TABLE_ID?.trim();
const ROW_NAME = "spotify-now-playing";
const storeConfigured = Boolean(airtableToken && airtableBase && airtableTable);

/* Refresh a minute early so a token never expires mid-request. */
const EARLY_MS = 60_000;

interface Tokens {
  recordId: string | null;
  refreshToken: string | null;
  accessToken: string | null;
  accessExpires: number;
}

const NO_TOKENS: Tokens = { recordId: null, refreshToken: null, accessToken: null, accessExpires: 0 };

/* Lives as long as this server instance does. */
let memory: Tokens | null = null;
let memoryReadAt = 0;
let refreshing: Promise<string> | null = null;

function airtableHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${airtableToken}`, "Content-Type": "application/json" };
}

function tableUrl(): string {
  return `${AIRTABLE_API}/${encodeURIComponent(airtableBase as string)}/${encodeURIComponent(airtableTable as string)}`;
}

function cell(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function readStore(): Promise<Tokens> {
  if (!storeConfigured) return { ...NO_TOKENS };
  const params = new URLSearchParams({ filterByFormula: `{Name}='${ROW_NAME}'`, maxRecords: "1" });
  const response = await getJson(`${tableUrl()}?${params}`, { headers: airtableHeaders() });
  if (!response.ok) throw new Error(`Airtable read failed (${response.status})`);
  const data = (await response.json()) as { records?: Array<{ id: string; fields?: Record<string, unknown> }> };
  const row = data.records?.[0];
  if (!row) return { ...NO_TOKENS };
  const fields = row.fields ?? {};
  const expires = Date.parse(String(fields["Access Expires"] ?? ""));
  return {
    recordId: row.id,
    refreshToken: cell(fields["Refresh Token"]),
    accessToken: cell(fields["Access Token"]),
    accessExpires: Number.isFinite(expires) ? expires : 0,
  };
}

/* Returns the row's id (it is created on first write if it is missing). */
async function writeStore(tokens: Tokens): Promise<string | null> {
  if (!storeConfigured) return tokens.recordId;
  const fields = {
    Name: ROW_NAME,
    "Refresh Token": tokens.refreshToken ?? "",
    "Access Token": tokens.accessToken ?? "",
    "Access Expires": tokens.accessExpires ? new Date(tokens.accessExpires).toISOString() : null,
  };
  try {
    const response = tokens.recordId
      ? await getJson(`${tableUrl()}/${tokens.recordId}`, { method: "PATCH", headers: airtableHeaders(), body: JSON.stringify({ fields }) })
      : await getJson(tableUrl(), { method: "POST", headers: airtableHeaders(), body: JSON.stringify({ fields }) });
    if (!response.ok) {
      /* A lost write means the next refresh may use a token Spotify has
         already replaced, which ends in needs-auth. Say so in the logs. */
      console.error(`now-playing: Airtable write failed (${response.status})`);
      return tokens.recordId;
    }
    const data = (await response.json()) as { id?: string };
    return data.id ?? tokens.recordId;
  } catch (error) {
    console.error("now-playing: Airtable write failed", error);
    return tokens.recordId;
  }
}

class NeedsAuth extends Error {}
class NoToken extends Error {}

/* The usable access token, or null if there is none or it is about to expire. */
function usable(tokens: Tokens | null): string | null {
  return tokens?.accessToken && tokens.accessExpires - EARLY_MS > Date.now() ? tokens.accessToken : null;
}

async function refresh(clientId: string, rejected: string | null): Promise<string> {
  /* Re-read first (unless this instance just did): another server instance may
     have refreshed already, and Spotify only honours the newest refresh token. */
  const justRead = memory && Date.now() - memoryReadAt < 5_000;
  const stored: Tokens = storeConfigured && !justRead ? await readStore() : memory ?? { ...NO_TOKENS };
  if (stored !== memory) { memory = stored; memoryReadAt = Date.now(); }
  /* Take a stored access token only if it isn't the one Spotify just refused. */
  const ready = usable(stored);
  if (ready && ready !== rejected) return ready;

  const refreshToken = stored.refreshToken || process.env.SPOTIFY_REFRESH_TOKEN?.trim();
  if (!refreshToken) throw new NoToken();

  const response = await getJson(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    /* invalid_grant is terminal: retrying burns nothing but time. */
    if (response.status === 400 && detail.includes("invalid_grant")) throw new NeedsAuth();
    throw new Error(`Token refresh failed (${response.status})`);
  }

  const data = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Token refresh returned no access token");

  const next: Tokens = {
    recordId: stored.recordId,
    refreshToken: data.refresh_token || refreshToken,
    accessToken: data.access_token,
    accessExpires: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  memory = next;
  memoryReadAt = 0;
  /* Persist before using it, so a rotated refresh token is never lost. */
  next.recordId = await writeStore(next);
  return next.accessToken as string;
}

async function accessToken(force = false): Promise<string> {
  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  if (!clientId) throw new Error("SPOTIFY_CLIENT_ID is not set");

  if (!force) {
    const cached = usable(memory);
    if (cached) return cached;
    if (!memory && storeConfigured) {
      memory = await readStore();
      memoryReadAt = Date.now();
      const stored = usable(memory);
      if (stored) return stored;
    }
  }

  /* One refresh at a time per instance; concurrent requests share it. */
  const rejected = force ? memory?.accessToken ?? null : null;
  if (!refreshing) refreshing = refresh(clientId, rejected).finally(() => { refreshing = null; });
  return refreshing;
}

/* GET from Spotify, refreshing once if the cached token was rejected. */
async function spotifyGet(path: string): Promise<Response> {
  let response = await getJson(`${API}${path}`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (response.status === 401) {
    response = await getJson(`${API}${path}`, { headers: { Authorization: `Bearer ${await accessToken(true)}` } });
  }
  return response;
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
    const current = await spotifyGet("/me/player/currently-playing");
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

    const recent = await spotifyGet("/me/player/recently-played?limit=1");
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
    if (error instanceof NoToken) {
      send(res, 200, { state: "unconfigured" }, "public, max-age=60");
      return;
    }
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
