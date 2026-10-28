# limetorrents.fun automata

headless torrent search on limetorrents (FMHY-listed video torrent site). no login
for search; detail page carries the magnet.

## files
- `search.ps1` - search + optional add to qBittorrent

## usage
```powershell
.\search.ps1 -Query "daredevil s03"
.\search.ps1 -Query "daredevil s03" -Add -Paused
.\search.ps1 -Query "x" -MinSeeds 5 -Max 20
```

## verified facts
- search URL: `https://www.limetorrents.fun/search/all/<urlencoded query>/` -
  200 with a browser UA (verified 2026-09-16 as a source of the old
  `tools\torrent-multi-search.ps1`; split into this standalone script 2026-10-02)
- result rows after tag-strip: `<blank> | <title; category> | <added - in cat> |
  <size> | seed | leech`; detail link is the `…torrent-…` href - **no inline magnet**
- the title cell is `parts[0]` after empty-cell filtering; name = part before the
  semicolon (title;category)
- `-Add` fetches the detail page and extracts `href="magnet:?xt=urn:btih:..."`;
  if that ever stops being on the page it loud-fails with the manual URL
- sort is seeds-desc here; quality ranking (4K/REMUX first) lives in the root
  batch script so one site's low-seed 4K beats nothing at site level

## cross-checks
- mirror domains rotate (.fun vs .info etc.) - if search starts failing, re-probe
  the current domain and update `$base` here, not in the batch script
