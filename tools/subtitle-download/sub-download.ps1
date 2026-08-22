# sub-download.ps1

<#
.SYNOPSIS
  Download English subtitles for local video files using subliminal, saved as
  matching-name .srt next to each video (mpv/VLC auto-load them).

.DESCRIPTION
  Detects the show/episode/movie from the filename and queries subtitle
  providers (OpenSubtitles, Addic7ed, Podnapisi, TVSubtitles, ...) for a
  matching English subtitle, saving it as <video>.srt.

  install the tool once:  pip install subliminal

.PARAMETER Path
  One or more video files, or a directory to scan recursively.

.PARAMETER Language
  IETF code, default "en". e.g. -Language "pt-BR".

.PARAMETER Force
  Re-download even if a .srt already exists.

.EXAMPLE
  .\sub-download.ps1 "C:\Videos\Some.Show.S01E01.mkv"
  .\sub-download.ps1 -Path "C:\Videos\Agents of SHIELD S1" -Language en
  .\sub-download.ps1 -Path "C:\Videos\movie.mkv" -Force
#>
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string[]]$Path,
  [string]$Language = "en",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

python -c "import subliminal" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Error "subliminal not installed. Run: pip install subliminal"
  exit 1
}

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

if ($videos.Count -eq 0) {
  Write-Error "no video files found in the given paths"
  exit 1
}
Write-Host "found $($videos.Count) videos"

$subliminalArgs = @("-m", "subliminal", "download", "-l", $Language, "-s")
if ($Force) { $subliminalArgs += "-f" }
$subliminalArgs += @($videos | ForEach-Object { $_.FullName })

& python @subliminalArgs
exit $LASTEXITCODE
