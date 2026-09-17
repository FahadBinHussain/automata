# tools/torrent-multi-search.ps1

multi-source video torrent search across FMHY-listed sites. one query, all
sources, quality-ranked, deduped, optional add-to-qbt.

## usage
```powershell
.\torrent-multi-search.ps1 -Query "Agents of SHIELD 1080p"
.\torrent-multi-search.ps1 -Query "agent carter" -MinSeeds 3 -Max 30
.\torrent-multi-search.ps1 -Query "daredevil s01" -Add        # top hit -> qbt
.\torrent-multi-search.ps1 -Query "x" -Sources torlock,limetorrents
```

## sources (verified working headless 2026-09-16)

- `torlock` - browser UA needed, inline result table, detail-page links (no
  inline magnets - fetch the detail page for the magnet)
- `limetorrents` - browser UA needed, inline table. row layout after tag-strip:
  `<title> | <added - in <cat>> | <size> | <seed> | <leech>` - **title is
  `$parts[0]`**, NOT `$parts[1]` (that's the "1 Year+ - in TV shows" string)
- `knaben` / `rutor` - delegated to their own automata folders' `search.ps1`

## dead sources (do NOT re-add - all probed 2026-09-16)

403 with browser UA: eztv, ext.to, bt4g, uindex, cinemacity, torrentsurf,
psarips, mkvbase, cinetaro, xdmovies (530).
cloudflare challenge: rutracker.org.
client-side JS, no static content (fetch returns shell only): 1tube (both the
page and `_next/data/*.json` routes), rarbgdump, msearch, heartive, ddlbase
(XenForo, search needs login + JS), rentry.co/FMHYB64.
empty/zero-result search: torrentproject, snowfl (404), kontrast (404),
youplex (404), katworld, olamovies, 4khdhub, modlist, tvsboy, multishows,
ciniverse, stagatv, tfpdl, levidia, sharemania, hdmovieshub, movy,
best-moviez, medeberiya, kmmovies, hindmoviez, 1shows (search returns generic
landing page), seriesvault (result page is a category listing, no episode
links), pahe (search returns trending titles, not query matches).
google CSE (all 3 video/torrent cx ids): JS-rendered, 0 static results.
telegram bots (SearchMoviesBot, TVSeriesSearchBot): need a real TG client,
`/s/` preview is static-only.
mov-cli (pypi 4.4.20): NO media scraper plugin exists - only mov-cli-test /
youtube / soundcloud / jellyplex / files / tui. dead for video search.

## what still might work (untested, listed in FMHY video section)

- OlaMovies (requires Google account), ShowBox (throwaway gmail), ShareBB
  (signup) - login-walled
- Rive / CorsFlix (streaming, not download), PlayTorrio (multi-site
  downloader app)
- HDEncode / RapidMoviez - debrid-required forums
- Soulseek / Nicotine+ (slsk) - P2P, unsearched for this title
- ruTorrent private trackers (invite-only)

## gotchas baked in

- **parse-size `$matches` clobber**: powershell `switch` does regex matching and
  silently overwrites `$matches` - capture `$val`/`$unit` BEFORE any switch, or
  use plain `if` chains. this made every size parse as ~0 for a full debug cycle.
- **limetorrents fake rows**: the "Full Version / High-Definition / REAL" rows
  have no `href="/...torrent-..."` link - the `torrent-` href filter drops them
- **dedupe**: same release lists many times; keep the highest-seed row per name
  (the `$results` hashtable keyed on name)
- `-Add` only works for sources with inline magnets (rutor). torlock/limetorrents
  return detail-page URLs - fetch the page for the magnet before adding.
