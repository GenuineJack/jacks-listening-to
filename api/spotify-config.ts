import type { IncomingMessage, ServerResponse } from "node:http";

const REDIRECT_URI = "https://www.jackslisteningto.com/explorer/";
/* The puller signs in on its own page, so it needs its own redirect URI.
   Both must be registered in the Spotify app's dashboard settings. */
const PULLER_REDIRECT_URI = "https://www.jackslisteningto.com/season-puller.html";

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  if (!clientId) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: "Spotify is not configured" }));
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
  res.end(JSON.stringify({ clientId, redirectUri: REDIRECT_URI, pullerRedirectUri: PULLER_REDIRECT_URI }));
}