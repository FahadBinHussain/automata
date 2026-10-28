# opensubtitles.org — bot-wall-safe srt download (dl.ps1)

`dl.ps1 -Url <srt url> -Out <file.srt>` downloads one subtitle past the
OpenSubtitles bot wall and validates that it really is an srt. split out of
`tools\subtitle-download` 2026-10-08; caller: `..\sub.wyzie.io\fetch.ps1`
(opensubtitles-hosted URLs), works standalone too.

## run

    .\dl.ps1 -Url "https://dl.opensubtitles.org/..." -Out "C:\vids\movie.srt"

## gotchas

- **bot wall (seen 2026-09-03)**: plain `curl.exe` to `dl.opensubtitles.org/...`
  from a direct egress can return a 5.7 KB "not a bot!" HTML page instead of
  the srt. dl.ps1 therefore ALWAYS goes through mihomo socks
  (`--socks5-hostname 127.0.0.1:7891`) with a browser UA.
- **every download is validated**: >=100 `-->` cues AND no `<html` — anything
  else throws `BOT WALL` with the first bytes of the body and deletes the
  partial file. never trust a 200 here: the wall page arrives at HTTP 200.
- curl exit != 0 = mihomo not listening on `127.0.0.1:7891` — the error names
  it instead of writing a bogus srt.

## related

- the subliminal CLI (`subtitle-download\`): its `opensubtitlescom`
  provider needs an API key and is discarded without one (~half coverage on TV
  packs without it); the deprecated opensubtitles.com API-key route no longer
  works — Wyzie (`..\sub.wyzie.io\`) is the route to OpenSubtitles data now.
- Wyzie free tier scrapes OpenSubtitles + TVSubtitles; paid Subf2m/Subdl need
  a Pro key.
