-- Storage for the rotating Spotify refresh token used by /api/now-playing.
--
-- Spotify invalidates a refresh token as soon as it is used and issues a
-- replacement, so the current value has to live somewhere writable. One row is
-- all that is needed. Run this once against whichever Postgres you point
-- SUPABASE_URL at.

create table if not exists public.spotify_tokens (
  id            text primary key,
  refresh_token text        not null,
  updated_at    timestamptz not null default now()
);

-- The token is a credential. Row Level Security stays on with no policies, so
-- the anon and authenticated roles cannot read it; /api/now-playing reaches it
-- with the service role key, which bypasses RLS and is server-side only.
alter table public.spotify_tokens enable row level security;

-- Seed with the refresh token from the season puller's "copy server token"
-- button, then remove SPOTIFY_REFRESH_TOKEN from the environment if you set it:
--
--   insert into public.spotify_tokens (id, refresh_token)
--   values ('now-playing', 'PASTE_TOKEN_HERE')
--   on conflict (id) do update set refresh_token = excluded.refresh_token,
--                                  updated_at    = now();
