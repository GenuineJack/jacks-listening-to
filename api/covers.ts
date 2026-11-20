import type { IncomingMessage, ServerResponse } from "node:http";

/*
 * Cover art for the archive grid.
 *
 * Spotify's oEmbed endpoint returns a playlist's cover with no credentials,
 * but it is meant for servers, so the page asks here and this asks Spotify.
 * The answer is edge-cached for a day: covers rarely change, and one cached
 * response serves every visitor.
 *
 *   GET /api/covers?ids=<id>,<id>,...   →   { covers: { <id>: <image url> } }
 *
 * Any playlist that fails to resolve is simply left out; the page falls back
 * to a plain tile for it.
 */

const OEMBED = "https://open.spotify.com/oembed?url=";
const ID_RE = /^[A-Za-z0-9]{22}$/;
const MAX_IDS = 120;
const CONCURRENCY = 8;
const UPSTREAM_TIMEOUT_MS = 5000;

async function coverFor(id: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const target = encodeURIComponent(`https://open.spotify.com/playlist/${id}`);
    const response = await fetch(`${OEMBED}${target}`, { signal: controller.signal });
    if (!response.ok) return null;
    const data = (await response.json()) as { thumbnail_url?: string };
    const url = data.thumbnail_url?.trim();
    return url && url.startsWith("https://") ? url : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const query = new URL(req.url ?? "/", "http://localhost").searchParams.get("ids") ?? "";
  const ids = [...new Set(query.split(",").map((id) => id.trim()).filter((id) => ID_RE.test(id)))].slice(0, MAX_IDS);

  if (!ids.length) {
    res.statusCode = 400;
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: "Pass ?ids= with one or more Spotify playlist IDs" }));
    return;
  }

  const covers: Record<string, string> = {};
  let next = 0;
  async function worker(): Promise<void> {
    while (next < ids.length) {
      const id = ids[next++];
      const url = await coverFor(id);
      if (url) covers[id] = url;
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));

  const complete = Object.keys(covers).length === ids.length;
  res.statusCode = 200;
  /* A partial answer (Spotify hiccup) is cached briefly so it heals itself;
     a complete one is held for a day. */
  res.setHeader(
    "Cache-Control",
    complete
      ? "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800"
      : "public, max-age=60, s-maxage=300",
  );
  res.end(JSON.stringify({ covers }));
}
