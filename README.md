# Jack’s Listening To

A new Spotify playlist every season since fall 2011. Live at https://www.jackslisteningto.com (the apex domain redirects to www).

Static pages on Vercel, plus a few small serverless functions in `api/`.

| Path | What it is |
| --- | --- |
| `/` (`index.html`) | The archive: player, the crates, and the stats |
| `/explorer/` | Visitors connect Spotify and analyze their own seasonal playlists |
| `/season-puller.html` | Admin tool that rebuilds `songs_data.csv` (not linked from the site) |
| `playlists.js` | **The one list of seasons.** Every page reads it |
| `songs_data.csv` | Track-level data behind the “by the numbers” section |
| `assets/` | Shared lounge stylesheet and self-hosted fonts (Fraunces, DM Sans; OFL) |

## Adding a new season

1. Add one line to `playlists.js`: `{ season: 'Winter', year: 2026, id: '<playlist id>' }`.
   The ID is the part of the Spotify URL after `/playlist/` and before `?si=`.
2. Commit. The player, the crates, the stats and the cover art pick it up automatically.
3. The stats only count seasons that are in `songs_data.csv`. To include the new one, run the season puller (below) and commit the fresh CSV.

## Environment variables (Vercel → jacks-listening-to → Settings → Environment Variables)

| Variable | Needed for | Without it |
| --- | --- | --- |
| `SPOTIFY_CLIENT_ID` | Explorer sign-in, season puller sign-in, now-playing card | Those features show a “not set up” message; the rest of the site works |
| `GETSONGBPM_API_KEY` | Tempo lookup in the season puller | The puller skips tempo |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Now-playing card (stores Spotify’s rotating refresh token; see `db/spotify_tokens.sql`) | The card stays hidden |
| `SITE_ORIGIN` (optional) | Overrides `https://www.jackslisteningto.com` in the Spotify redirect URIs | Defaults to www |

The cover art (`/api/covers`) needs no keys. It uses Spotify’s public oEmbed endpoint.

## Spotify app settings

In the Spotify developer dashboard, the app behind `SPOTIFY_CLIENT_ID` must list these exact redirect URIs:

```
https://www.jackslisteningto.com/explorer/
https://www.jackslisteningto.com/season-puller.html
```

While the app is in development mode, Spotify only lets accounts on the app’s user allowlist sign in, so the explorer won’t work for the general public until the app gets extended access.

## Refreshing the track data

Open `/season-puller.html`, sign in with the Spotify account that owns the playlists, run the pull, download `songs_data.csv`, and commit it to the repo root.
