-- yt watch progress tracker - table definition
-- the userscript's "Create table" button runs the same statement.

create table if not exists watch_progress (
  video_id   text primary key,
  title      text not null,
  channel    text,
  position   integer not null,
  duration   integer not null,
  finished   boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists watch_progress_updated_at_idx
  on watch_progress (updated_at desc);

-- floating launcher icon position, synced across devices.
-- one row per ui element, keyed by name ('ytp-btn').
create table if not exists ui_prefs (
  key        text primary key,
  x          integer not null,
  y          integer not null,
  updated_at timestamptz not null default now()
);

-- spotify/soundcloud visited-track history (merged into the same db, formerly
-- a google apps script backend). id = track uri, name = "artist - song",
-- updated_at = last time the track was seen.
create table if not exists visited_tracks (
  id         text primary key,
  name       text not null,
  source     text not null check (source in ('spotify','soundcloud')),
  updated_at timestamptz not null default now()
);

create index if not exists visited_tracks_updated_at_idx
  on visited_tracks (updated_at desc);

-- scoped role - use this connection string in the settings tab,
-- NOT the project owner one.
--
--   create role yt_progress with login password 'something-long';
--   grant select, insert, update on watch_progress to yt_progress;
--   grant select, insert, update on ui_prefs to yt_progress;
--   grant select, insert, update on visited_tracks to yt_progress;
