# fetch.ps1 - one episode's subtitle via the Wyzie API (sub.wyzie.io)
# split out of tools\subtitle-download\sub-download.ps1 2026-10-08 (site part).
# key: vault item store.wyzie.io, free at https://store.wyzie.io/redeem

param(
  [Parameter(Mandatory = $true)]
  [string]$Video,   # video basename, e.g. "Agents.of.SHIELD.S01E03.720p"
  [Parameter(Mandatory = $true)]
  [string]$Out,     # target .srt path
  [Parameter(Mandatory = $true)]
  [string]$Key,     # wyzie-... key
  [string]$Language = "en"
)

$ErrorActionPreference = "Stop"

# parse season/episode from the filename (e.g. S01E01)
$m = [regex]::Match($Video, 'S(\d+)E(\d+)', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
if (-not $m.Success) { throw "can't parse season/episode from '$Video'" }
$season = [int]$m.Groups[1].Value
$episode = [int]$m.Groups[2].Value

# tmdb id from the show part (before SxxExx); add shows to $known
$showPart = ([IO.Path]::GetFileNameWithoutExtension($Video) -replace 'S\d+E\d+.*$', '') -replace '[^a-zA-Z0-9]', ''
$known = @{
  "AgentsofSHIELD" = 1403; "MarvelsAgentsofSHIELD" = 1403
}
$tmdbId = $null
foreach ($k in $known.Keys) { if ($showPart -match [regex]::Escape($k)) { $tmdbId = $known[$k] } }
if (-not $tmdbId) { throw "unknown show '$showPart' - add its tmdb id to `$known in fetch.ps1" }

$url = "https://sub.wyzie.io/search?id=$tmdbId&season=$season&episode=$episode&language=$Language&format=srt&key=$Key"
try {
  $res = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30 -ErrorAction Stop
  $results = $res.Content | ConvertFrom-Json
} catch { throw "Wyzie search failed: $_" }
if (-not $results -or $results.Count -eq 0) { throw "no results for S$($season)E$episode (tmdb $tmdbId)" }

# pick best: prefer BRRIP/BluRay origin, then 1080p, then any
$best = $results | Sort-Object @{e={$_.origin -match 'bluray|brrip' -or $_.release -match 'bluray|brrip'}; Descending=$true},
  @{e={$_.release -match '1080p'}; Descending=$true} | Select-Object -First 1
Write-Host "    picked: $($best.release)"
$dlUrl = $best.url
if (-not $dlUrl) { throw "best match ('$($best.release)') has no download url" }

if ($dlUrl -match '^https?://([^/]+\.)?opensubtitles\.(org|com)/') {
  # bot wall: opensubtitles hosts always go through the validated downloader
  $dl = Join-Path (Split-Path -Parent $PSScriptRoot) 'opensubtitles.org\dl.ps1'
  if (-not (Test-Path $dl)) { throw "sibling downloader missing: $dl" }
  & $dl -Url $dlUrl -Out $Out
} else {
  try {
    Invoke-WebRequest -Uri $dlUrl -UseBasicParsing -TimeoutSec 40 -OutFile $Out -ErrorAction Stop
  } catch { throw "download failed: $_" }
  Write-Host "    downloaded $((Get-Item $Out).Length) bytes"
}
