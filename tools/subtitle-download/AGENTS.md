# subtitle-download: batch-download English subtitles for local videos

downloads matching-name `.srt` files next to local video files so mpv/VLC pick
them up automatically (mpv auto-loads a subtitle whose filename equals the
video's, e.g. `Show.S01E01.mkv` + `Show.S01E01.srt`).

## run

```powershell
pip install subliminal              # one-time
.\sub-download.ps1 "C:\path\to\video.mkv"
.\sub-download.ps1 "C:\path\to\show-folder" -Language en
.\sub-download.ps1 -Path "C:\vids\movie.mkv" -Force
```

`-Path` accepts files or directories; directories are scanned recursively for
mkv/mp4/avi/webm.

## how it works

subliminal parses the show name, season, and episode number from the filename,
then queries every configured provider (OpenSubtitles, Addic7ed, Podnapisi,
TVSubtitles, BSPlayer, Subsource, ...) and saves the best English match as
`<video>.srt`.

## gotchas (verified 2026-08-22 on AoS S1-3 30nama pack)

- **`opensubtitlescom` provider needs an API key** and is discarded without one
  (`Some providers have been discarded due to unexpected errors:
  opensubtitlescom`). With only the free providers, coverage was ~half the
  episodes (20 of 38 AoS episodes); the rest had zero matches on any provider.
  Adding an OpenSubtitles API key (via `--provider` config or
  `opensubtitlescom` credentials) should close most of the gap.
- filenames like `Agents_of_SHIELD_S01E01_x265_1080p_BluRay_30nama_30NAMA.mkv`
  are parsed correctly by subliminal (show = "Agents of S.H.I.E.L.D.", S01E01).
- `-s`/`--single` saves without a language code suffix (clean `<video>.srt`);
  `-f` forces re-download even when a `.srt` already exists.
- Run the whole directory in one pass: `subliminal download -l en -f -s <files...>`.
  Per-file retries help when a provider is temporarily rate-limited; space the
  retries ~20s apart.
- missing/partial video files (stalled torrents, EBML header parse errors from
  ffprobe) can't be subtitle-matched reliably — subtitle the files that are
  actually complete on disk.
- the CLI is `python -m subliminal download ...` (there is no `subdl`/`subed`
  installed on this machine; `pip install subliminal` is the toolchain).
