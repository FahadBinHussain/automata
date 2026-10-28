# sub.wyzie.io — Wyzie subtitle API (fetch.ps1)

`fetch.ps1` = the Wyzie mode of the subtitle pipeline: one call per episode
returns the best-matching English srt (release-aware pick) and writes it to
`-Out`. the general pipeline (discovery / sanitize / alass sync) stays in
`subtitle-download\` — split 2026-10-08, link-shortener pattern.

## run

    .\fetch.ps1 -Video "Agents.of.SHIELD.S01E03.720p" -Out "C:\vids\S01E03.srt" -Key "wyzie-..."
    .\fetch.ps1 -Video ... -Out ... -Key ... -Language pt-BR

- **key**: free (1,000 req/day) at `https://store.wyzie.io/redeem` (Gmail
  verification). vault item `store.wyzie.io` with `[api key]` header.
  never commit the key.
- **api**: `GET https://sub.wyzie.io/search?id=<tmdb-id>&season=&episode=&language=en&format=srt&key=`
- **tmdb map**: `$known` inside `fetch.ps1` (show-name-stripped -> id); an
  unknown show throws loudly telling you to add it — the search never fires
  without an id. add new shows there.

## gotchas

- pick order: BRRIP/BluRay origin first, then 1080p, then anything — that is
  how a mis-tagged combined sub (107-min srt for a 44-min episode) gets
  avoided: pick the BluRay match.
- downloads whose URL is on an `opensubtitles.*` host are delegated to
  `..\opensubtitles.org\dl.ps1` (bot wall — see that AGENTS); other hosts go
  direct via `Invoke-WebRequest`.
- python `urllib` to `sub.wyzie.io` gets 403; `curl.exe` / `Invoke-WebRequest`
  work.
- free-tier sources = OpenSubtitles + TVSubtitles (same as subliminal free);
  paid sources (Subf2m, Subdl) need a Pro key — better coverage if you have one.
- why wyzie over subliminal: per-episode results + release/origin filter,
  vs subliminal's loose matching (~half coverage on TV packs + wrong-release
  risk). the pipeline's sanitize + alass steps still run afterwards.
