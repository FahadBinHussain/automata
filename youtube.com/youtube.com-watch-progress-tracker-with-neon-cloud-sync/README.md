# YouTube watch progress tracker (Neon cloud sync)

tracks how far you are into every youtube video and syncs it to a neon postgres
database, so progress survives reinstalls and follows you across machines. ui is
a floating panel on youtube pages with a progress list and a settings tab.

## files

- `youtube.com-watch-progress-tracker-with-neon-cloud-sync.user.js` — the whole
  thing. no build step, install straight into tampermonkey.
- `schema.sql` — table definition, if you'd rather create it yourself than use
  the **Create table** button.

## install

1. install the userscript in tampermonkey or violentmonkey (both work as-is —
   same `GM_setValue` / `GM_getValue` / `GM_xmlhttpRequest` grants, and
   violentmonkey honours the `@connect neon.tech` line the same way)
2. open any youtube page, click the red **YT** button bottom-right
3. go to **Settings**, paste your neon connection string, hit **Save**
4. hit **Create table** once
5. play a video — progress starts recording immediately

## how it works

- binds to the page's `<video>` element and samples `currentTime` every 5s,
  plus on `pause` and `beforeunload`
- youtube is an spa, so it rebinds on `yt-navigate-finish` and re-polls every 2s
  (shorts and the miniplayer use different video elements)
- writes land in tampermonkey storage first, so the panel is instant and works
  offline; a background timer flushes to neon every 2 minutes and on pause
- talks to neon over its sql-over-http endpoint via `GM_xmlhttpRequest`, so
  there's no driver to bundle and no cors config
- upsert uses `greatest(existing, incoming)` on position, so a stale flush from
  another tab can never rewind your progress
- a video is marked `finished` at 90%

## security — read this

the settings tab holds a **full postgres connection string**. keeping it out of
git is real, but it doesn't make it safe — it just moves the secret into your
browser, on every machine you use. anything that can read tampermonkey storage
owns whatever that role can reach.

so don't hand it the owner role. make a scoped one:

```sql
create role yt_progress with login password 'something-long';
grant select, insert, update on watch_progress to yt_progress;
```

paste the connection string for `yt_progress`, not for `neondb_owner`. worst
case then is someone learns what videos you watched, not that they drop your
project.

if that ever feels too loose, the fix is a thin api: put the connection string
in a vercel env var, have the userscript send a rotatable device token instead,
and nothing changes on this side except the two fetch calls.

## notes

- no build step, so no drizzle here — drizzle can't run in a raw userscript
  without bundling, and against a single table over http it wouldn't earn its
  keep. `schema.sql` is the source of truth for the table shape.
- the panel only appears on youtube pages. if you want to check progress from
  any tab, that's the one thing that needs a real extension with a toolbar
  popup — the tracking logic ports over close to unchanged.
