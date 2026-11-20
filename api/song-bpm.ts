import type { IncomingMessage, ServerResponse } from "node:http";

/*
 * Proxy for the GetSongBPM API.
 *
 * Spotify's /audio-features endpoint (tempo, key, danceability) has returned 403
 * for non-grandfathered apps since 27 Nov 2024 and has no replacement, so tempo
 * now comes from GetSongBPM instead.
 *
 * This lives server-side for two reasons: the API key must not ship in the
 * public season-puller page, and api.getsong.co sends no CORS headers, so a
 * browser cannot call it directly.
 *
 * Using this data requires a visible backlink to getsongbpm.com — it is in the
 * footer of the home page. Do not remove it while this endpoint is in use.
 */

const API_BASE = "https://api.getsong.co";
const UPSTREAM_TIMEOUT_MS = 8000;

interface BpmPayload {
  tempo: number | null;
  keyOf: string | null;
  timeSignature: string | null;
  danceability: number | null;
  acousticness: number | null;
  matchedSong: string | null;
  matchedArtist: string | null;
}

const EMPTY: BpmPayload = {
  tempo: null,
  keyOf: null,
  timeSignature: null,
  danceability: null,
  acousticness: null,
  matchedSong: null,
  matchedArtist: null,
};

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  cacheControl: string,
): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cacheControl);
  res.end(JSON.stringify(body));
}

/* A track's tempo never changes, so successful lookups cache hard at the edge.
   That keeps a re-run of the puller from re-hitting the upstream quota. */
const CACHE_HIT = "public, max-age=86400, s-maxage=31536000";
const CACHE_MISS = "public, max-age=600, s-maxage=86400";

function toNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function toText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

/* Strip the decorations Spotify titles carry that GetSongBPM's index does not:
   "Song - 2011 Remaster", "Song (feat. X)", "Song [Live]". */
function simplifyTitle(title: string): string {
  return title
    .replace(/\s*[([][^)\]]*(?:feat|ft|with|remaster|live|version|edit|mix|mono|stereo|deluxe|bonus)[^)\]]*[)\]]/gi, "")
    .replace(/\s+-\s+.*(?:remaster|live|version|edit|mix|mono|stereo|deluxe|bonus|anniversary).*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function getJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (response.status === 429) throw new Error("rate-limited");
    if (!response.ok) return null;
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/* GetSongBPM returns `search` as an array of hits, but as an object such as
   { error: "no result" } when there is no match — handle both. */
function firstHit(payload: unknown): Record<string, unknown> | null {
  const search = (payload as { search?: unknown } | null)?.search;
  if (Array.isArray(search) && search.length) {
    return search[0] as Record<string, unknown>;
  }
  return null;
}

function shape(song: Record<string, unknown>): BpmPayload {
  const artist = song.artist as { name?: unknown } | undefined;
  return {
    tempo: toNumber(song.tempo),
    keyOf: toText(song.key_of),
    timeSignature: toText(song.time_sig),
    danceability: toNumber(song.danceability),
    acousticness: toNumber(song.acousticness),
    matchedSong: toText(song.title),
    matchedArtist: toText(artist?.name),
  };
}

async function lookup(song: string, artist: string, apiKey: string): Promise<BpmPayload | null> {
  const lookupValue = `song:${song} artist:${artist}`;
  const url = `${API_BASE}/search/?api_key=${encodeURIComponent(apiKey)}&type=both&limit=1&lookup=${encodeURIComponent(lookupValue)}`;
  const hit = firstHit(await getJson(url));
  if (!hit) return null;

  /* type=both usually carries tempo inline; if this hit does not, resolve it. */
  const shaped = shape(hit);
  if (shaped.tempo !== null) return shaped;

  const id = toText(hit.id);
  if (!id) return shaped;
  const detail = await getJson(
    `${API_BASE}/song/?api_key=${encodeURIComponent(apiKey)}&id=${encodeURIComponent(id)}`,
  );
  const detailSong = (detail as { song?: Record<string, unknown> } | null)?.song;
  return detailSong ? shape(detailSong) : shaped;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    sendJson(res, 405, { error: "Method not allowed" }, "no-store");
    return;
  }

  const apiKey = process.env.GETSONGBPM_API_KEY?.trim();
  if (!apiKey) {
    sendJson(res, 503, { error: "GetSongBPM is not configured" }, "no-store");
    return;
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  const song = (url.searchParams.get("song") ?? "").trim();
  const artist = (url.searchParams.get("artist") ?? "").trim();
  if (!song || !artist) {
    sendJson(res, 400, { error: "song and artist are required" }, "no-store");
    return;
  }

  try {
    let result = await lookup(song, artist, apiKey);

    /* Retry once with a simplified title before accepting a miss. */
    if (!result || result.tempo === null) {
      const simplified = simplifyTitle(song);
      if (simplified && simplified.toLowerCase() !== song.toLowerCase()) {
        const retry = await lookup(simplified, artist, apiKey);
        if (retry && retry.tempo !== null) result = retry;
      }
    }

    if (!result) {
      sendJson(res, 200, { ...EMPTY, found: false }, CACHE_MISS);
      return;
    }
    sendJson(
      res,
      200,
      { ...result, found: result.tempo !== null },
      result.tempo !== null ? CACHE_HIT : CACHE_MISS,
    );
  } catch (error) {
    const rateLimited = error instanceof Error && error.message === "rate-limited";
    sendJson(
      res,
      rateLimited ? 429 : 502,
      { error: rateLimited ? "Upstream rate limit" : "Lookup failed" },
      "no-store",
    );
  }
}
