# torrenting — root batch for the torrent site scripts

| field | value |
|---|---|
| purpose | one entry point: search every torrent site folder at once, rank, optionally add to qBittorrent |
| script | `search-all.ps1` |
| sources | `knaben`, `rutor`, `torlock`, `limetorrents` (see table below) |
| split from | `tools\torrent-multi-search.ps1` (inline copy), 2026-10-02 |

## usage

```powershell
pwsh torrenting\search-all.ps1 -Query "daredevil s03"
pwsh torrenting\search-all.ps1 -Query "daredevil s03" -MinSeeds 5 -Max 30
pwsh torrenting\search-all.ps1 -Query "daredevil s03" -Add          # pick -> qbt
pwsh torrenting\search-all.ps1 -Query "x" -Sources limetorrents,rutor
```

## sources (each has its own folder + AGENTS.md)

| key | folder | magnet in search page | notes |
|---|---|---|---|
| `knaben` | `knaben.org\` | yes | seeds/size unknown at search time (DHT aggregator) |
| `rutor` | `rutor.info\` | yes | RU/EN mixed titles, windows-1251 page |
| `torlock` | `torlock.com\` | no - detail page | **search 502 site-side since 2026-10-02**, loud-fails |
| `limetorrents` | `limetorrents.fun\` | no - detail page | mirror domains rotate |

## site script contract

every source script must accept `-Query` / `-Max` / `-Json` and, with `-Json`, print
one NDJSON row per result:

```json
{"source":"limetorrents.fun","name":"...","seeds":894,"size":"522.62 MB","magnet":"","detail":"https://..."}
```

`magnet` empty ⇒ the batch fetches `detail` itself at add time. a site script that
fails prints its own LOUD FAIL and exits non-zero; the batch shows it as
`[!] <site> FAILED: ...` and reports `N/M sources failed` — failures are never
silent.

## ranking (user rule)

site scripts sort seeds-desc only; **cross-site quality ranking happens here**:
4K/REMUX → BluRay → WEB → HDTV, then seeds, then top `-Max`. dedupe is by exact
name (lowercased), keeping the higher seed count.

## adding a site later

1. create the site's own hostname folder with `search.ps1` honoring the contract
   (copy an existing one, keep loud-fail style).
2. add one line to `$sites` in `search-all.ps1` + a row in the table above.
3. do **not** touch a site's parse logic here — fix it in its folder.

## source parse notes (inherited from the retired `tools\torrent-multi-search.ps1`, verified 2026-09-16)

- `torlock` - browser UA needed, inline result table, detail-page links (no
  inline magnets - fetch the detail page for the magnet)
- `limetorrents` - browser UA needed, inline table. row layout after tag-strip:
  `<title> | <added - in <cat>> | <size> | <seed> | <leech>` - **title is
  `$parts[0]`**, NOT `$parts[1]` (that's the "1 Year+ - in TV shows" string)
- `knaben` / `rutor` - their own automata folders' `search.ps1`

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
  (the `$merged` hashtable keyed on name)
- `-Add` only works for sources with inline magnets (knaben/rutor). torlock and
  limetorrents return detail-page URLs - the batch fetches the page for the
  magnet at add time (site scripts do it inside their own `-Add`).
