# torlock.com automata

headless torrent search on torlock.com (FMHY-listed video torrent site). no login
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
- search URL: `https://www.torlock.com/all/torrents/<urlencoded query>.html` -
  200 with a browser UA (verified 2026-09-16 as a source of the old
  `tools\torrent-multi-search.ps1`; split into this standalone script 2026-10-02)
- result rows: `<tr>` cells after tag-strip = name | date | size | seed | leech |
  category; detail link `href="/torrent/<id>/<slug>"` - **no inline magnet**
- `-Add` fetches the detail page and extracts `href="magnet:?xt=urn:btih:..."`;
  if that ever stops being on the page it loud-fails with the manual URL
- seeds = first bare number in the row (the parse skips the size cell first)
- sort is seeds-desc here; quality ranking (4K/REMUX first) lives in the root
  batch script so one site's low-seed 4K beats nothing at site level

## cross-checks
- same title can appear in multiple uploads - dedupe by name keeping the higher seed

## gotchas

- **2026-10-02: search endpoint 502 site-side** - homepage 200, but every search
  variant (`/all/torrents/<q>.html`, `/?q=`, `/search/<q>`, POST `/`) answers
  502 Bad Gateway. the script loud-fails with that exact diagnosis. re-probe before
  assuming the parser broke; if torlock never recovers, the root batch script drops
  it as a source (do not silently swap in torrentz.cc - that is its own site/folder).
