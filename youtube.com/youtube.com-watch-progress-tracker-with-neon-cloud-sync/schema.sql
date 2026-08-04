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

-- scoped role - use this connection string in the settings tab,
-- NOT the project owner one.
--
--   create role yt_progress with login password 'something-long';
--   grant select, insert, update on watch_progress to yt_progress;
