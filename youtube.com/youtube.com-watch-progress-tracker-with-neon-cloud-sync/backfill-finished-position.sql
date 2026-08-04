-- Backfill for watch_progress rows that were flattened by the old clobbering
-- record() writes: finished = true but position = 0 (or NULL / > duration).
--
-- Symptom: paintThumb derived the bar width purely from position / duration,
-- so these rows painted a "done"-coloured bar at 0% width -- a blank bar on
-- the history page for videos that were actually watched fully.
--
-- Run against the Neon branch that backs the userscript.
-- Schema: watch_progress(video_id, title, channel, position, duration, finished, updated_at)

-- 1. Inspect the damage first (read-only).
select video_id,
       title,
       channel,
       position,
       duration,
       finished,
       updated_at
from watch_progress
where finished
  and (position is null or position <= 0 or (duration is not null and position > duration))
order by updated_at desc;

-- 2. Count, so you know what the UPDATE should touch.
select count(*) as damaged_rows
from watch_progress
where finished
  and (position is null or position <= 0 or (duration is not null and position > duration));

-- 3. Repair. Finished means position should sit at duration.
--    Rows with no usable duration are left alone -- the userscript patch now
--    paints those at 100% from the finished flag, and inventing a duration
--    here would poison the greatest(position) monotonic upsert.
begin;

update watch_progress
set position   = duration,
    updated_at = now()
where finished
  and duration is not null
  and duration > 0
  and (position is null or position <= 0 or position > duration);

-- Verify inside the transaction before committing.
select count(*) as still_damaged
from watch_progress
where finished
  and duration is not null
  and duration > 0
  and (position is null or position <= 0 or position > duration);

commit;
-- rollback;  -- use this instead if still_damaged looks wrong

-- 4. Leftovers: finished rows with no usable duration. These cannot be
--    repaired from data alone; the client-side fix covers their rendering.
select video_id, title, channel, position, duration, updated_at
from watch_progress
where finished
  and (duration is null or duration <= 0)
order by updated_at desc;
