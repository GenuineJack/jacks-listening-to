import type { IncomingMessage, ServerResponse } from "node:http";

/*
 * The crate: Jack's record collection, read from Discogs.
 *
 * GET /api/crate → { items, total, updatedAt }
 *
 * The Discogs username is used to fetch but never returned: the site stays
 * anonymous, so nothing here should point back to a Discogs profile.
 *
 * Read-only and public. The page needs the whole collection to filter and
 * sort it in the browser, so this walks every page server-side and returns one
 * response. That response is cached at the edge and in memory, because a large
 * collection is several Discogs requests and Discogs allows 60 a minute.
 *
 * Env:
 *   DISCOGS_API_TOKEN  required. Discogs → Settings → Developers → Generate token.
 *                      Needed for cover images too: Discogs leaves image URLs
 *                      out of unauthenticated responses.
 *   DISCOGS_USERNAME   optional. Looked up from the token when unset.
 *   DISCOGS_FOLDER_ID  optional. Defaults to 0, Discogs' "All" folder.
 *
 * Discogs specifics: auth is `Authorization: Discogs token=…`, and a
 * descriptive User-Agent is mandatory (requests without one get a 403).
 */

const DISCOGS_API = "https://api.discogs.com";
const DISCOGS_SITE = "https://www.discogs.com";
const USER_AGENT = "JacksListeningTo/1.0 +https://www.jackslisteningto.com";
const UPSTREAM_TIMEOUT_MS = 9000;
const PER_PAGE = 100;
const MAX_PAGES = 30;
const MEMORY_TTL_MS = 10 * 60_000;

interface Item {
  id: number;
  artist: string;
  title: string;
  year: number | null;
  formats: string[];
  labels: string[];
  catno: string | null;
  genres: string[];
  styles: string[];
  cover: string | null;
  thumb: string | null;
  url: string;
  added: string | null;
  copies: number;
}

interface Crate {
  items: Item[];
  total: number;
  updatedAt: string;
}

let cached: { at: number; value: Crate } | null = null;
let resolvedUsername: string | null = null;

class DiscogsError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown, cacheControl: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cacheControl);
  res.end(JSON.stringify(body));
}

async function discogs<T>(path: string, token: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(`${DISCOGS_API}${path}`, {
      signal: controller.signal,
      headers: { Authorization: `Discogs token=${token}`, "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!response.ok) throw new DiscogsError(response.status, `Discogs responded ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/* ---- normalising ---- */

function text(value: unknown): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

/* Discogs disambiguates same-named artists with a numeric suffix:
   "Nirvana (2)". Nobody wants to read that on a sleeve. */
function cleanName(name: string): string {
  return name.replace(/\s*\(\d+\)\s*$/, "").trim();
}

interface RawArtist { name?: unknown; anv?: unknown; join?: unknown }

/* `anv` is the name as printed on this release; `join` is the connector
   Discogs stores between credits ("&", ",", "Feat."). */
function joinArtists(artists: readonly RawArtist[] | undefined): string {
  if (!artists?.length) return "";
  return artists
    .map((artist, index) => {
      const name = cleanName(String(artist.anv || artist.name || "").trim());
      if (!name) return "";
      const join = String(artist.join ?? "").trim();
      if (index === artists.length - 1 || !join) return name;
      return join === "," ? `${name}, ` : `${name} ${join} `;
    })
    .join("")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function unique(values: readonly (string | null)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/* Discogs serves a generic placeholder sleeve for releases with no art; the
   page's own empty sleeve looks better. */
function realImage(value: unknown): string | null {
  const url = text(value);
  if (!url || url.includes("spacer.gif")) return null;
  return /\/A-150-|\/spacer|images\/record90\.png/.test(url) ? null : url;
}

interface RawRelease {
  id?: unknown;
  date_added?: unknown;
  basic_information?: {
    id?: unknown;
    title?: unknown;
    year?: unknown;
    thumb?: unknown;
    cover_image?: unknown;
    artists?: RawArtist[];
    formats?: Array<{ name?: unknown; text?: unknown; descriptions?: unknown }>;
    labels?: Array<{ name?: unknown; catno?: unknown }>;
    genres?: unknown;
    styles?: unknown;
  };
}

function normalize(raw: RawRelease): Item | null {
  const basic = raw.basic_information ?? {};
  const id = Number.parseInt(String(basic.id ?? raw.id ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) return null;

  /* { name: "Vinyl", text: "Orange", descriptions: ["LP", "Album"] } → one line. */
  const formatParts: (string | null)[] = [];
  for (const format of basic.formats ?? []) {
    formatParts.push(text(format.name));
    if (Array.isArray(format.descriptions)) for (const d of format.descriptions) formatParts.push(text(d));
    formatParts.push(text(format.text));
  }
  const labels = basic.labels ?? [];
  const year = Number(basic.year);
  const list = (value: unknown) => (Array.isArray(value) ? unique(value.map(text)) : []);

  return {
    id,
    artist: joinArtists(basic.artists),
    title: String(basic.title ?? "").trim(),
    year: Number.isFinite(year) && year > 0 ? year : null,
    formats: unique(formatParts),
    labels: unique(labels.map((label) => cleanName(String(label.name ?? "")))),
    catno: text(labels[0]?.catno),
    genres: list(basic.genres),
    styles: list(basic.styles),
    cover: realImage(basic.cover_image) ?? realImage(basic.thumb),
    thumb: realImage(basic.thumb),
    url: `${DISCOGS_SITE}/release/${id}`,
    added: text(raw.date_added),
    copies: 1,
  };
}

/* ---- loading ---- */

async function username(token: string): Promise<string> {
  const configured = process.env.DISCOGS_USERNAME?.trim();
  if (configured) return configured;
  if (resolvedUsername) return resolvedUsername;
  const identity = await discogs<{ username?: unknown }>("/oauth/identity", token);
  const name = text(identity.username);
  if (!name) throw new DiscogsError(502, "Discogs did not name the token's owner");
  resolvedUsername = name;
  return name;
}

async function loadCrate(token: string): Promise<Crate> {
  const user = await username(token);
  const raw = Number.parseInt(process.env.DISCOGS_FOLDER_ID?.trim() ?? "", 10);
  const folder = Number.isFinite(raw) && raw >= 0 ? raw : 0;

  /* Owning a record twice shouldn't put it in the bin twice: keep the newest
     copy's spot and count the rest. */
  const byId = new Map<number, Item>();
  const items: Item[] = [];
  let total = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const query = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE), sort: "added", sort_order: "desc" });
    const data = await discogs<{ pagination?: { pages?: unknown; items?: unknown }; releases?: RawRelease[] }>(
      `/users/${encodeURIComponent(user)}/collection/folders/${folder}/releases?${query}`,
      token,
    );
    for (const release of data.releases ?? []) {
      const item = normalize(release);
      if (!item) continue;
      const seen = byId.get(item.id);
      if (seen) { seen.copies += 1; continue; }
      byId.set(item.id, item);
      items.push(item);
    }
    total = Number(data.pagination?.items) || items.length;
    const pages = Number(data.pagination?.pages) || 1;
    if (page >= pages) break;
  }

  return { items, total: items.length, updatedAt: new Date().toISOString() };
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    send(res, 405, { error: "Method not allowed" }, "no-store");
    return;
  }

  const token = process.env.DISCOGS_API_TOKEN?.trim();
  if (!token) {
    send(res, 503, { error: "not-configured" }, "public, max-age=60");
    return;
  }

  /* Edge cache: fresh for 15 minutes, then served stale for up to a day while
     one request rebuilds it, so visitors never wait on Discogs. */
  const cacheControl = "public, max-age=300, s-maxage=900, stale-while-revalidate=86400";

  if (cached && Date.now() - cached.at < MEMORY_TTL_MS) {
    send(res, 200, cached.value, cacheControl);
    return;
  }

  try {
    const value = await loadCrate(token);
    cached = { at: Date.now(), value };
    send(res, 200, value, cacheControl);
  } catch (error) {
    /* Better a slightly old crate than an empty one. */
    if (cached) {
      send(res, 200, cached.value, "public, max-age=60");
      return;
    }
    const status = error instanceof DiscogsError ? error.status : 0;
    const message =
      status === 401 || status === 403 ? "Discogs rejected the token."
      : status === 429 ? "Discogs is rate-limiting right now. Try again in a minute."
      : error instanceof Error && error.name === "AbortError" ? "Discogs took too long to answer."
      : "Couldn't reach Discogs.";
    send(res, 502, { error: message }, "no-store");
  }
}
