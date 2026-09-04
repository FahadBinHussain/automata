# subtitle-download: batch-download English subtitles for local videos

downloads matching-name `.srt` files next to local video files so mpv/VLC pick
them up automatically (mpv auto-loads a subtitle whose filename equals the
video's, e.g. `Show.S01E01.mkv` + `Show.S01E01.srt`).

## run

```powershell
pip install subliminal          # one-time (subliminal mode)
scoop install alass             # one-time (sync step — REQUIRED)

# subliminal mode (free, no key, ~half coverage on TV packs)
.\sub-download.ps1 "C:\path\to\video.mkv"
.\sub-download.ps1 -Path "C:\path\to\show-folder" -Language en

# Wyzie API mode (better coverage + release matching; needs vault key)
.\sub-download.ps1 -Path "C:\path\to\show-folder" -WyzieKey "wyzie-..."

.\sub-download.ps1 -Path "C:\vids\movie.mkv" -Force
```

`-Path` accepts files or directories; directories are scanned recursively for
mkv/mp4/avi/webm.

## the pipeline (all modes)

1. **fetch** — subliminal (free providers) or Wyzie API
2. **sanitize** — `sanitize-srt.py` strips HTML tags and fixes SRT structure
3. **sync** — `alass` aligns the sub to the actual video audio (fingerprint),
   fixing timing drift regardless of which release cut the sub came from

This last step is what makes subs "match" — subliminal/API often return a sub
for a *different* release of the same episode (different cut, offset timing).
alass re-aligns it to the exact file on disk.

## Wyzie API mode

`sub.wyzie.io` is a free open-source subtitle-scraping API (OpenSubtitles +
Subf2m + Subdl + more). One request returns all matches with exact release
names, so it can pick a BluRay/BRRip sub (best for BluRay encodes).

- **key**: free at `https://store.wyzie.io/redeem` (Gmail verification,
  1,000 req/day). Store in vault as `store.wyzie.io` with `[api key]` header.
  Never commit the key.
- **API**: `GET https://sub.wyzie.io/search?id=<tmdb-id>&season=&episode=&language=en&format=srt&key=`
- the script currently has a small hardcoded tmdb-id map for known shows.
  Add new shows there, or pass the tmdb id.
- free tier sources = OpenSubtitles + TVSubtitles (same as subliminal free);
  paid sources (Subf2m, Subdl) need a Pro key — better coverage if you have one.
- the biggest win over subliminal: Wyzie returns *per-episode* subs and lets
  you filter by release/origin, so a mis-tagged combined sub (e.g. a 107-min
  SRT for a 44-min episode) can be avoided by picking the BluRay match.

## gotchas

- **`opensubtitlescom` subliminal provider needs an API key** and is discarded
  without one. With only free providers, coverage was ~half the episodes
  of a TV pack; the rest had zero matches on any provider.
- the deprecated `opensubtitles.com` API-key route no longer works — use
  Wyzie (above) for the OpenSubtitles data.
- filenames like `Show_S01E01_720p_BluRay_x264.mkv`
  are parsed correctly.
- **subliminal's loose matching can return the WRONG sub** (e.g. a combined
  107-min SRT for a 44-min episode). Always run the sanitize + alass sync, and
  prefer Wyzie with BluRay release filter for TV packs.
- `sanitize-srt.py` uses `utf-8-sig` read and writes clean SRT (index/timing/
  text/blank) — this fixes files alass refuses to parse (HTML tags, empty
  text blocks, stray `[speaking Spanish]` lines).
- missing/partial video files (stalled torrents, EBML header parse errors from
  ffprobe) can't be subtitle-matched reliably — subtitle the files that are
  actually complete on disk.
- the CLI is `python -m subliminal download ...` (no `subdl`/`subed` on this
  machine; `pip install subliminal` is the toolchain).
- **directory `-Path` detection bug (fixed 2026-08-31)**: `Resolve-Path` returns
  `PathInfo` objects which have NO `.PSIsContainer` property, so a directory
  passed via `-Path` was treated as a single "video" — the download still worked
  (subliminal scans the dir itself) but the sanitize/alass sync loop then
  iterated the wrong item and failed with `Move-Item: Destination path cannot
  be a subdirectory of the source or the source itself: ...\s01\s01.`.
  Detection now uses `Test-Path -LiteralPath $r.Path -PathType Container`.
- **cross-season contamination is the common mismatch mode (seen 2026-09-03)**:
  a whole batch of SHIELD S01 files (E09, E12–E14, E16–E21) carried S02/S03
  dialogue. audit trick: scan every srt for later-season proper nouns
  (Diviner/Whitehall/Jiaying/Daisy/Terrigen/ATCU/Mack/Hunter/Bobbi for S01;
  case-sensitive `\bMack\b` etc. to dodge "flash drive"/"flash point" false
  hits on `lash`, and "trip" the english word vs Triplett). legit exceptions:
  `Kree` in S01E15 (Sif names alien races), `Werner Reinhardt` in S02E08
  (Whitehall-origin episode), `framework` as an ordinary noun.
- **opensubtitles dl bot-wall (2026-09-03)**: plain `curl.exe` to
  `dl.opensubtitles.org/...` can return a 5.7KB "not a bot!" HTML page instead
  of the srt (direct egress). retry through mihomo socks with a browser UA:
  `curl.exe -s -L --socks5-hostname 127.0.0.1:7891 -A "<chrome UA>" -o out.srt
  <url>` — always validate the download (must contain 100+ `-->` cues, no
  `<html`). python `urllib` to `sub.wyzie.io` gets 403; `curl.exe` works.
- **alass from python subprocess needs the shell**: bare `alass` fails with
  `[WinError 2]` under `subprocess.run` (it's `scoop\shims\alass.cmd` — run
  alass from powershell, or `shell=True`, or invoke `alass.cmd`).
