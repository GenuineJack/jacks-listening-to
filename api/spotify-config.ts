import type { IncomingMessage, ServerResponse } from "node:http";

/*
 * Public Spotify app settings for the season puller.
 *
 * It signs in with PKCE, so only the client ID is needed here (never the
 * secret). Its redirect URI must be listed exactly in the Spotify app's
 * dashboard (Settings → Redirect URIs):
 *
 *   https://www.jackslisteningto.com/season-puller.html
 *
 * The apex domain redirects to www on Vercel, so www is the origin that
 * actually serves the pages. Override with SITE_ORIGIN if that changes.
 */

const SITE_ORIGIN = (process.env.SITE_ORIGIN?.trim() || "https://www.jackslisteningto.com").replace(/\/$/, "");

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  if (!clientId) {
    res.statusCode = 503;
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: "Spotify is not configured (SPOTIFY_CLIENT_ID is not set)" }));
    return;
  }

  res.statusCode = 200;
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
  res.end(
    JSON.stringify({
      clientId,
      pullerRedirectUri: `${SITE_ORIGIN}/season-puller.html`,
    }),
  );
}
