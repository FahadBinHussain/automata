# subtitle-download: batch-download English subtitles for local videos

downloads matching-name `.srt` files next to local video files so mpv/VLC pick
them up automatically (mpv auto-loads a subtitle whose filename equals the
video's, e.g. `Show.S01E01.mkv` + `Show.S01E01.srt`) — and EXTRACTS embedded
text subtitle tracks to the same sidecars when the MKV already carries them
(release tags ESub/MSubs mean subs are baked into the file; see `extract-embedded.ps1`).

split 2026-10-08 (link-shortener pattern): this folder keeps the GENERAL
pipeline only (orchestrator + sanitizer); the site-specific fetchers live in
their own host folders and are delegated to:

- `-WyzieKey` mode -> `sub.wyzie.io\fetch.ps1` (key, tmdb map, API url,
  release pick; it calls `opensubtitles.org\dl.ps1` itself for
  opensubtitles-hosted URLs)
- opensubtitles bot-wall download -> `opensubtitles.org\dl.ps1`
- keyless default stays inline: `python -m subliminal` (multi-provider CLI,
  not one site)

moved to the repo root 2026-10-08 — the last piece out of `tools\`, which
is now dissolved and removed (its dated move log lives in the root
`AGENTS.md` "tools dissolution log" section). it is a capability folder like
`redirect-bypass\` / `sethc-swap\` because the pipeline spans services
(subliminal, wyzie, opensubtitles, alass) with no single host.

## run

```powershell
pip install subliminal          # one-time (subliminal mode)
scoop install alass             # one-time (sync step — REQUIRED)

# subliminal mode (free, no key, ~half coverage on TV packs)
.\sub-download.ps1 "C:\path\to\video.mkv"
.\sub-download.ps1 -Path "C:\path\to\show-folder" -Language en

# extract only — embedded text tracks -> sidecar, zero network (stage 0 alone)
.\extract-embedded.ps1 "C:\path\to\video.mkv"
.\extract-embedded.ps1 -Path "C:\path\to\show-folder" -Language en

# Wyzie API mode (delegated to sub.wyzie.io\fetch.ps1; key = vault store.wyzie.io)
.\sub-download.ps1 -Path "C:\path\to\show-folder" -WyzieKey "wyzie-..."

.\sub-download.ps1 -Path "C:\vids\movie.mkv" -Force
```

`-Path` accepts files or directories; directories are scanned recursively for
mkv/mp4/avi/webm.

## the pipeline (all modes)

0. **extract** — `extract-embedded.ps1` probes every video for embedded TEXT
   subtitle tracks (subrip/ass/ssa/mov_text) and writes them as sidecars
   (best non-SDH track -> `<video>.srt`, extras -> `<video>.<title-slug>.srt`).
   bitmap tracks (PGS etc.) are skipped LOUDLY — they cannot become `.srt`
   without OCR, and the player renders them from inside the file anyway.
   videos handled here leave the pipeline (no fetch, no sync).
1. **fetch** — subliminal (free providers) or Wyzie via `sub.wyzie.io\fetch.ps1`
   for the videos that still have no sidecar
2. **sanitize** — `sanitize-srt.py` strips HTML tags and fixes SRT structure
3. **sync** — `alass` aligns the sub to the actual video audio (fingerprint),
   fixing timing drift regardless of which release cut the sub came from

This last step is what makes subs "match" — subliminal/API often return a sub
for a *different* release of the same episode (different cut, offset timing).
alass re-aligns it to the exact file on disk.

## gotchas

- **`opensubtitlescom` subliminal provider needs an API key** and is discarded
  without one. With only free providers, coverage was ~half the episodes
  of a TV pack; the rest had zero matches on any provider.
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
- **alass from python subprocess needs the shell**: bare `alass` fails with
  `[WinError 2]` under `subprocess.run` (it's `scoop\shims\alass.cmd` — run
  alass from powershell, or `shell=True`, or invoke `alass.cmd`).
- **two pythons on this box: detect subliminal via its `subliminal` shim, never
  `python -c "import subliminal"` (bug fixed 2026-10-25)**: scoop `python`
  (first on PATH) and `python312` are separate installs; subliminal lives in
  python312 and only exposes `subliminal.exe` in its `Scripts`. the old import
  check ran against scoop `python` -> always false -> the engine died with
  "subliminal not installed" even though `subliminal --version` worked.
  sub-download.ps1 now does `Get-Command subliminal` and invokes the shim
  directly (`subliminal download ...`), which resolves the right interpreter
  itself. same shape of bug applies to any other pip-installed tool here.
- **release tags ESub/MSubs = subs live INSIDE the MKV, not missing**: ffprobe
  `-select_streams s` first; a text track (subrip/ass/...) means extract with
  `extract-embedded.ps1` (zero network, no alass needed — the track is timed to
  that exact file). `hdmv_pgs_subtitle` (PGS) is bitmap: it CANNOT become
  `.srt` without OCR — the extractor says so loudly per track and the player
  renders it in-file, so a PGS-only file needs neither extraction nor download
  for playback.
- **ffmpeg picks the subtitle codec from the output extension** (`.srt` ->
  subrip, `.ass` -> ass) — never force `-c:s srt` in the extraction: the
  encoder name differs across builds (`srt` vs `subrip`) and a wrong one fails
  the whole extract.
- **subliminal `-s` = `--single`**: saves WITHOUT the language code, i.e. plain
  `<video>.srt` — that is exactly why the sanitize/alass loop's `<video>.srt`
  name matches what the fetch produces. dropping `-s` yields `<video>.en.srt`
  and the loop silently finds nothing.
- extracted embedded tracks deliberately SKIP the sanitize/alass loop
  (sub-download.ps1 `$extracted` list): they are already synced to the file;
  re-running alass would fingerprint GB-sized files for a no-op.
- **sanitizer/alass failures are loud now (2026-10-25)**: the sync loop checks
  `$LASTEXITCODE` and prints the warning (plus alass's captured output)
  instead of the old `2>$null` / `| Out-Null` silence — fail loudly, no silent
  pass over a broken sub.
- gotcha hit 2026-10-25: `& $script.ps1` batch calls die silently when the
  session between them drops (opencode server restart mid-run) — the pipeline
  is resume-safe by design (stage 0 skips existing sidecars, fetch is skipped
  when every video has one), so just re-run the same `-Path` list and the
  stages pick up where the state actually is.
