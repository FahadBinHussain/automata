# 1337x automation notes

status: magnet extraction by torrent ID works fully non-UI; 1337x search itself is a honeypot, but YTS API (yify movies) and TPB/apibay cover most needs without a browser.

## what works (no browser)

- `get-magnet.ps1` - fetch torrent by ID or URL from the 1337xx.to mirror, returns JSON with magnet/infohash/seeders/leechers/title.
  - the mirror serves real detail pages with plain HTTP (no cloudflare) - TUVIMEN scraped all 6.4M pages from one ip, ~60 req/s with 6 threads, no bans.
  - url format: `https://www.1337xx.to/torrent/<id>/<any-slug>/` - the slug can be anything (`x/` works), bare id 404s.
  - verify against official site: same infohash as browser-fetched page (B550A0A3... iron man 2 = identical).
- `probe-range.ps1` - concurrent title probing over an ID window (`-StartId -EndId -Pattern -MinSeeders`), writes hits to a file. good for hunting a known release era. category browse `/cat/Movies/1/` also works plain HTTP to read latest ids.
- **YTS API for YIFY movies (the bulk of 1337x movie releases)** - `..\yts.lt\search.ps1` (movie search by title, prints yts id + quality + seeds + infohash, optional `-Add` straight into qBittorrent). yts.mx is DNS-dead, yts.lt works.
- **TPB/apibay for everything else (games, console, niche)** - `..\thepiratebay.org\search.ps1` (JSON mirror search, optional `-Add`). good for game rips (ps3/xbox360/wii) that 1337x/YTS lack.

## what does not work (as of 2026-08)

- search on the 1337xx.to mirror is a honeypot: `/srch?search=`, `/sort-search/<key>/<sort>/<dir>/1/`, `/sort-category-search/...` all return the SAME trending rows regardless of query. page title reflects the query, rows don't. plain fetch and browser-UA fetch both fail.
- official 1337x.to: 403 cloudflare for all plain HTTP (search and detail pages).
- autocomplete endpoint `https://cdn.1337x.to/cdnsuggest.php?term=` : 403.
- r.jina.ai reader proxy on search url: cloudflare challenge page.
- hosted torrent-api apis: dead/404.
- apify actor store: no 1337x actor. `ondrejklinovsky/torrent-scraper` supports gloTorrents/TPB/limeTorrents/nyaa/solidTorrents only. torrent-downloader actors (maximedupre, epctex) only download from magnets you provide, no search.
- py1337x / cloudscraper style libs: JS challenge defeats them silently (0 results).

## known-good reference: TUVIMEN/1337x-scraper

- `torrents.py` iterates torrent ids directly (`/torrent/<id>/`) - 95% valid, works headless against the mirror. full site scrape published at https://huggingface.co/datasets/hexderm/1337x (single 26.4GB 1337x.json, id+title+magnet+infohash+seeders+size, snapshot ~2025-06).
- old `links.py` shows exact search url formats (now honeypotted).

## recommended flow

1. search: use the HF dataset (hexderm/1337x) locally if you need a full offline index; otherwise browser automation (agent-browser + mainframe profile) for live search - cloudflare turnstile checkbox click passes.
2. magnet: get-magnet.ps1 by id/url.
3. add to qbittorrent: `..\qbittorrent.com\add-torrent.ps1`.