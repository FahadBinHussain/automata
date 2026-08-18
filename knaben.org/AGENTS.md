# knaben.org automata

headless torrent search on knaben.org (DHT-based aggregator, listed on FMHY aggregators). no login, no bot-wall.

## files
- `search.ps1` - search + optional add to qBittorrent

## usage
```powershell
.\search.ps1 -Query "agents of shield s04"
.\search.ps1 -Query "agents of shield s04" -Add -Paused
.\search.ps1 -Query "shield" -Max 20
```

## verified facts (2026-08-18)
- search URL: `https://knaben.org/search/<urlencoded query>` - GET works headless
- result rows: `<a title="<name>" href="magnet:...">` (50 rows for "agents of shield s04")
- seeds/size are NOT in the search HTML (aggregator) - quality unknown until added to client
- `Select-Object -Unique` BUG: on pscustomobject it compares via ToString() and collapses all rows to 1 - dedupe with `Group-Object Name` instead (fixed in script)
- HTML entities in names: `Marvel&#039;s` - decode with `[System.Net.WebUtility]::HtmlDecode`

## known gaps (as of 2026-08-18)
- AoS S04/S06: only per-episode results (S04E01..E18 individual, Rapta 1080p episodes exist for S06), NO complete-season 1080p packs
- Runaways S01 1080p: not found (S01E08 1080p PSA episode only); S02/S03 COMPLETE 1080p packs exist
- cross-check with apibay/rutor before concluding a gap is unfillable
