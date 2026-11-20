# Jack’s Listening To

The hub for Jack’s music: seasonal playlists, the record collection, and (later) writing and social. Live at https://www.jackslisteningto.com (the apex domain redirects to www).

Static pages on Vercel, plus a few small serverless functions in `api/`.

| Path | What it is |
| --- | --- |
| `/` (`index.html`) | **The Season.** A new Spotify playlist every season since fall 2011: player, the seasons grid, the stats, and the now-playing card |
| `/crate/` | **The Crate.** Every record in Jack’s Discogs collection |
| `/season-puller.html` | Admin tool that rebuilds `songs_data.csv` (not linked from the site) |
| `playlists.js` | **The one list of seasons.** The home page and the puller both read it |
| `songs_data.csv` | Track-level data behind the “by the numbers” section |
| `assets/` | Shared listening-bar stylesheet and self-hosted fonts (Fraunces, DM Sans; OFL) |

Old genuinejack.xyz-style paths redirect: `/seasons/…` → `/`, `/collection` → `/crate/`, `/explorer` → `/`.

## Adding a new season

1. Add one line to `playlists.js`: `{ season: 'Winter', year: 2026, id: '<playlist id>' }`.
   The ID is the part of the Spotify URL after `/playlist/` and before `?si=`.
2. Commit. The player, the seasons grid, the stats and the cover art pick it up automatically.
3. The stats only count seasons that are in `songs_data.csv`. To include the new one, run the season puller (below) and commit the fresh CSV.

## Environment variables (Vercel → jacks-listening-to → Settings → Environment Variables)

| Variable | Needed for | Without it |
| --- | --- | --- |
| `SPOTIFY_CLIENT_ID` | Season puller sign-in, now-playing card | The puller can’t sign in; the card stays hidden |
| `AIRTABLE_TOKEN` | Now-playing card: an Airtable personal access token with `data.records:read` and `data.records:write` on the JKLOL base. Mark it Sensitive | The card stays hidden |
| `AIRTABLE_BASE_ID`, `AIRTABLE_TABLE_ID` | Where that token lives: JKLOL (`appQqBy4c04QjwS4j`), table “Jacks Listening To” (`tblcoMAUKmrl6iV33`) | The card stays hidden |
| `DISCOGS_API_TOKEN` | The Crate. Discogs → Settings → Developers → Generate new token. Mark it Sensitive | The crate says it’s still being wired up |
| `DISCOGS_USERNAME` (optional) | The Crate. Looked up from the token when unset | — |
| `DISCOGS_FOLDER_ID` (optional) | The Crate: show one Discogs folder instead of the whole collection | Defaults to 0, “All” |
| `GETSONGBPM_API_KEY` (optional) | Tempo lookup in the season puller | The puller skips tempo |
| `SPOTIFY_REFRESH_TOKEN` (optional) | Bootstrap for the now-playing card if the Airtable row is empty | Paste the token into Airtable instead |
| `SITE_ORIGIN` (optional) | Overrides `https://www.jackslisteningto.com` in the puller’s Spotify redirect URI | Defaults to www |

The cover art on the seasons grid (`/api/covers`) needs no keys. It uses Spotify’s public oEmbed endpoint.

## Spotify app settings

In the Spotify developer dashboard, the app behind `SPOTIFY_CLIENT_ID` must list this exact redirect URI:

```
https://www.jackslisteningto.com/season-puller.html
```

## Refreshing the track data

Open `/season-puller.html`, sign in with the Spotify account that owns the playlists, run the pull, download `songs_data.csv`, and commit it to the repo root.

## Turning on the now-playing card

The card under the hero shows what Jack is playing on Spotify right now (or the last thing played). Its Spotify token lives in Airtable: base **JKLOL**, table **Jacks Listening To**, row **spotify-now-playing**. Don’t rename the row or its fields; the site finds them by name.

1. **Airtable token.** At https://airtable.com/create/tokens create a token with scopes `data.records:read` and `data.records:write`, access limited to the JKLOL base. Add it in Vercel as `AIRTABLE_TOKEN` (Sensitive).
2. **Spotify token.** On https://www.jackslisteningto.com/season-puller.html sign in, click “copy server token for /api/now-playing”, and paste it into the row’s **Refresh Token** cell. Then **close that tab without running a pull**: Spotify replaces a refresh token each time it is used, so the puller and the site can’t share one. Sign in again later when you want to pull.
3. **Redeploy** (or wait for the next deploy) so the function picks up the env vars.

From then on the site keeps the row up to date itself. To stay inside Airtable’s monthly API budget it caches the Spotify access token: Airtable sees roughly one read when a server instance starts and one write an hour while people are visiting.

Spotify refresh tokens expire six months after sign-in no matter how often they’re used. When the card disappears and `/api/now-playing` says `needs-auth`, repeat step 2.
