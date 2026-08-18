# rutor.info automata

headless torrent search on rutor.info (Russian tracker). no login needed for search/magnets.

## files
- `search.ps1` - search + optional add to qBittorrent

## usage
```powershell
.\search.ps1 -Query "agents shield 4 sezon"
.\search.ps1 -Query "shield s04" -Add -Paused
.\search.ps1 -Query "avengers" -MinSeeds 10 -Max 20
```

## verified facts (2026-08-18)
- search URL: `https://rutor.info/search/0/0/000/0/<query>` - no auth, no bot-wall
- page is `charset=UTF-8` (server header says so - do NOT force windows-1251, that double-encodes)
- result rows: `<tr class="gai">` or `<tr class="tum">`; title link `<a href="/torrent/<id>/<slug>">`, size in `<td align="right">`, seeds in `<span class="green">...&nbsp;N</span>`
- magnets are inline in each row (rutor's own tracker set: opentor.net + retracker.local - user should re-add public trackers via qBittorrent when metadata stalls)
- `[Console]::OutputEncoding = UTF8` is required at script top for Cyrillic titles to render
- sample volume: "avengers" -> 50 rows, "thor" -> 30 rows, "shield" -> 22 rows (mostly unrelated)
- known gap: Marvel's Agents of S.H.I.E.L.D. series NOT in rutor index (only 1998 Nick Fury movie); Runaways not in index either

## cross-checks
- rutor is mostly RU-titled releases (RU name first, EN after ` / `) - parse from the EN side
- same-name results dedupe not needed (regex anchors per-row magnet)
