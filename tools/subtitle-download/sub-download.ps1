# sub-download.ps1

<#
.SYNOPSIS
  Download English subtitles for local video files via subliminal or Wyzie API,
  sanitize, and sync to the actual video audio with alass.

.DESCRIPTION
  Detects the show/episode/movie from the filename and queries subtitle
  providers for a matching English subtitle, saving as <video>.srt.

  The pipeline:
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
  Get a free key at https://store.wyzie.io/redeem (Gmail verification).

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
    if ($r.PSIsContainer) {
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
$hasSubliminal = $false
python -c "import subliminal" 2>$null; if ($LASTEXITCODE -eq 0) { $hasSubliminal = $true }

# ---- fetch ----
if ($WyzieKey) {
  Write-Host "using Wyzie API"
  $tmdbCache = @{}
  foreach ($v in $videos) {
    $srt = $v.FullName -replace '\.(mkv|mp4|avi|webm)$', '.srt'
    if (Test-Path $srt -and -not $Force) { continue }
    Write-Host "  $($v.Name)..."
    # parse season/episode from filename (e.g. S01E01)
    $m = [regex]::Match($v.BaseName, 'S(\d+)E(\d+)', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $m.Success) { Write-Warning "    can't parse season/episode from filename"; continue }
    $season = [int]$m.Groups[1].Value; $episode = [int]$m.Groups[2].Value
    $tmdbId = $null
    # try to find tmdb id from the show part of the filename (before SxxExx)
    $showPart = $v.BaseName -replace 'S\d+E\d+.*$', '' -replace '[^a-zA-Z0-9]', ''
    # lazy: try known tmdb ids for common shows
    $known = @{
      "AgentsofSHIELD" = 1403; "MarvelsAgentsofSHIELD" = 1403
    }
    foreach ($k in $known.Keys) { if ($showPart -match [regex]::Escape($k)) { $tmdbId = $known[$k] } }
    if (-not $tmdbId) { Write-Warning "    unknown show — add its tmdb id to the script"; continue }
    $url = "https://sub.wyzie.io/search?id=$tmdbId&season=$season&episode=$episode&language=$Language&format=srt&key=$WyzieKey"
    try {
      $res = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30 -ErrorAction Stop
      $results = $res.Content | ConvertFrom-Json
    } catch { Write-Warning "    Wyzie search failed: $_"; continue }
    if (-not $results -or $results.Count -eq 0) { Write-Warning "    no results"; continue }
    # pick best: prefer BRRIP/BluRay origin, then 1080p, then any
    $best = $results | Sort-Object @{e={$_.origin -match 'bluray|brrip' -or $_.release -match 'bluray|brrip'}; Descending=$true},
      @{e={$_.release -match '1080p'}; Descending=$true} | Select-Object -First 1
    Write-Host "    picked: $($best.release)"
    $dlUrl = $best.url
    if (-not $dlUrl) { Write-Warning "    no download url"; continue }
    try {
      Invoke-WebRequest -Uri $dlUrl -UseBasicParsing -TimeoutSec 40 -OutFile $srt -ErrorAction Stop
      Write-Host "    downloaded $((Get-Item $srt).Length) bytes"
    } catch { Write-Warning "    download failed: $_"; continue }
  }
} else {
  if (-not $hasSubliminal) { Write-Error "subliminal not installed. Run: pip install subliminal"; exit 1 }
  $subliminalArgs = @("-m", "subliminal", "download", "-l", $Language, "-s")
  if ($Force) { $subliminalArgs += "-f" }
  $subliminalArgs += @($videos | ForEach-Object { $_.FullName })
  & python @subliminalArgs
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
  $srt = $v.FullName -replace '\.(mkv|mp4|avi|webm)$', '.srt'
  if (-not (Test-Path $srt)) { continue }
  Write-Host "  sync $($v.Name)..."
  python $sanitizer $srt 2>$null
  $cleaned = $srt -replace '\.srt$', '.cleaned.srt'
  if (Test-Path $cleaned) { Move-Item -Force $cleaned $srt }
  & alass $v.FullName $srt $srt 2>&1 | Out-Null
}
Write-Host "done"