# sub-download.ps1

<#
.SYNOPSIS
  Download English subtitles for local video files via subliminal or Wyzie API,
  sanitize, and sync to the actual video audio with alass.

.DESCRIPTION
  Detects the show/episode/movie from the filename and queries subtitle
  providers for a matching English subtitle, saving as <video>.srt.

  The pipeline:
    0. extract embedded text subtitle tracks to sidecars via ffmpeg (releases
       tagged ESub/MSubs already carry subs inside the mkv - no download
       needed; bitmap/PGS tracks are skipped loudly, they render in-player)
    1. fetch via subliminal (free providers) or Wyzie API (needs vault key)
    2. sanitize the SRT (strip HTML tags, fix structure)
    3. sync to the video audio with alass (fingerprint alignment)

  subliminal:  pip install subliminal
  alass:       scoop install alass
  Wyzie key:   store in vault as "store.wyzie.io" with "[api key]" header

.PARAMETER Path
  One or more video files, or a directory to scan recursively.

.PARAMETER Language
  IETF code, default "en". e.g. -Language "pt-BR".

.PARAMETER Force
  Re-download even if a .srt already exists.

.PARAMETER WyzieKey
  Use Wyzie Subs API (aggregates OpenSubtitles + more) instead of subliminal.
  Delegates to sub.wyzie.io\fetch.ps1 (key, tmdb map, pick logic live there);
  free key: https://store.wyzie.io/redeem (Gmail verification).

.EXAMPLE
  .\sub-download.ps1 "C:\Videos\Some.Show.S01E01.mkv"
  .\sub-download.ps1 -Path "C:\Videos\Agents of SHIELD S1" -Language en
  .\sub-download.ps1 -Path "C:\Videos\movie.mkv" -Force -WyzieKey "wyzie-..."
#>
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string[]]$Path,
  [string]$Language = "en",
  [switch]$Force,
  [string]$WyzieKey = ""
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $PSCommandPath

# ---- resolve videos ----
$videos = @()
foreach ($p in $Path) {
  $resolved = Resolve-Path -LiteralPath $p -ErrorAction SilentlyContinue
  if (-not $resolved) { Write-Warning "path not found: $p"; continue }
  foreach ($r in $resolved) {
    # PathInfo has no .PSIsContainer — use Test-Path -PathType Container
    if (Test-Path -LiteralPath $r.Path -PathType Container) {
      $videos += Get-ChildItem -LiteralPath $r.Path -Recurse -File -Include *.mkv,*.mp4,*.avi,*.webm -ErrorAction SilentlyContinue
    } else {
      $videos += Get-Item -LiteralPath $r.Path -ErrorAction SilentlyContinue
    }
  }
}
$videos = $videos | Sort-Object FullName -Unique
if ($videos.Count -eq 0) { Write-Error "no video files found"; exit 1 }
Write-Host "found $($videos.Count) videos"

# ---- check tools ----
$hasAlass = Get-Command alass -ErrorAction SilentlyContinue
# subliminal is detected via its CLI shim, NOT `python -c "import subliminal"`:
# this box has two pythons (scoop python vs python312) and the module lives in
# python312, so the import check against the default `python` always failed and
# the engine died with "subliminal not installed" (fixed 2026-10-25). the shim
# resolves to the right interpreter itself - invoke it directly.
$subliminalExe = Get-Command subliminal -ErrorAction SilentlyContinue
$hasSubliminal = [bool]$subliminalExe

# ---- stage 0: extract embedded TEXT subtitle tracks to sidecars ----
# release tags ESub/MSubs mean subs are baked INTO the mkv; text tracks
# (subrip/ass/...) are pulled out to <video>.srt. they are already timed to
# this exact file, so extracted videos skip both the fetch and the alass sync.
# bitmap (PGS) tracks cannot be extracted - extract-embedded.ps1 says so loudly.
$extractor = Join-Path $scriptDir 'extract-embedded.ps1'
if (-not (Test-Path $extractor)) { Write-Error "extractor not found: $extractor"; exit 1 }
Write-Host "stage 0: extract embedded text tracks (loud per file)"
$extracted = @()   # video paths whose sidecar came from the embedded track
$needFetch = @()   # videos still without any sidecar after stage 0
foreach ($v in $videos) {
  $srt = $v.FullName -replace '\.(mkv|mp4|avi|webm)$', '.srt'
  if ((Test-Path $srt) -and -not $Force) { continue }   # pre-existing sidecar: no extract, no fetch; sync loop still processes it
  & $extractor -Path $v.FullName -Language $Language -Force:$Force
  if (Test-Path $srt) { $extracted += $v.FullName } else { $needFetch += $v }
}

# ---- fetch ----
if ($WyzieKey) {
  Write-Host "using Wyzie API"
  $fetcher = Join-Path (Split-Path -Parent $scriptDir) 'sub.wyzie.io\fetch.ps1'
  if (-not (Test-Path $fetcher)) { Write-Error "wyzie fetcher not found: $fetcher"; exit 1 }
  foreach ($v in $needFetch) {
    $srt = $v.FullName -replace '\.(mkv|mp4|avi|webm)$', '.srt'
    if (Test-Path $srt -and -not $Force) { continue }
    Write-Host "  $($v.Name)..."
    try {
      & $fetcher -Video $v.BaseName -Out $srt -Key $WyzieKey -Language $Language
    } catch { Write-Warning "    wyzie failed: $_" }
  }
} elseif ($needFetch.Count -eq 0) {
  Write-Host "fetch: nothing to do - every video either has a sidecar already or was handled by stage 0"
} else {
  if (-not $hasSubliminal) { Write-Error "subliminal CLI not found on PATH. Run: pip install subliminal"; exit 1 }
  Write-Host "engine: subliminal (free providers) for $($needFetch.Count) video(s)"
  $subliminalArgs = @("download", "-l", $Language, "-s")
  if ($Force) { $subliminalArgs += "-f" }
  $subliminalArgs += @($needFetch | ForEach-Object { $_.FullName })
  & $subliminalExe @subliminalArgs
  if ($LASTEXITCODE -ne 0) { Write-Warning "subliminal exited with $LASTEXITCODE" }
}

# ---- sanitize + sync ----
$sanitizer = Join-Path $scriptDir "sanitize-srt.py"
if (-not (Test-Path $sanitizer)) {
  Write-Error "sanitizer script not found at $sanitizer"
  exit 1
}
if (-not $hasAlass) { Write-Warning "alass not installed. Run: scoop install alass"; exit 1 }

foreach ($v in $videos) {
  if ($extracted -contains $v.FullName) { continue }   # embedded track = already timed to this cut, no sync
  $srt = $v.FullName -replace '\.(mkv|mp4|avi|webm)$', '.srt'
  if (-not (Test-Path $srt)) { continue }
  Write-Host "  sync $($v.Name)..."
  python $sanitizer $srt
  if ($LASTEXITCODE -ne 0) { Write-Warning "  sanitize FAILED ($LASTEXITCODE): $srt"; continue }
  $cleaned = $srt -replace '\.srt$', '.cleaned.srt'
  if (Test-Path $cleaned) { Move-Item -Force $cleaned $srt }
  $alassOut = & alass $v.FullName $srt $srt 2>&1
  if ($LASTEXITCODE -ne 0) { Write-Warning "  alass sync FAILED ($LASTEXITCODE): $($v.Name)`n$($alassOut -join "`n")" }
}
Write-Host "done"