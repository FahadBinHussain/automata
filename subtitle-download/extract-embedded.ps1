# extract-embedded.ps1

<#
.SYNOPSIS
  Extract embedded TEXT subtitle tracks from video files into sidecar files
  so players and tools that only read external subs pick them up.

.DESCRIPTION
  Probes each video with ffprobe and extracts every text subtitle track
  (subrip / ass / ssa / mov_text) with ffmpeg:

    - best track (non-SDH first, then the default-flagged one) -> <video>.srt
      (ass/ssa sources keep their real extension: <video>.ass)
    - every extra text track -> <video>.<title-slug>.srt

  Bitmap tracks (hdmv_pgs_subtitle / dvd_subtitle / dvb_subtitle) CANNOT be
  converted to text without OCR - they are skipped with a loud note; players
  render them from inside the file anyway (the ESub/MSubs release tags mean
  exactly this: subs are baked into the MKV as images).

  Embedded tracks are already timed to the exact file on disk, so extracted
  sidecars need NO alass sync (that is why sub-download.ps1 skips the sync
  stage for files handled here).

.PARAMETER Path
  One or more video files, or a directory to scan recursively.

.PARAMETER Language
  Language tag to match, default "en". Matched against the track's language
  tag 2-letter/3-letter prefix style ("en" matches tag "eng"). Tracks with NO
  language tag are extracted too (untagged = the release's only subs, common
  on dual-audio rips) and the extraction is printed loudly.

.PARAMETER Force
  Re-extract even if the sidecar already exists.
#>

param(
  [Parameter(Mandatory = $true, ValueFromPipeline = $true)]
  [string[]]$Path,
  [string]$Language = 'en',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

# ---- resolve inputs (same container/file detection as sub-download.ps1) ----
$videos = foreach ($r in $Path) {
  $resolved = Resolve-Path -LiteralPath $r
  foreach ($item in @($resolved)) {
    if (Test-Path -LiteralPath $item.Path -PathType Container) {
      Get-ChildItem -LiteralPath $item.Path -Recurse -File |
        Where-Object { $_.Extension -match '^\.(mkv|mp4|avi|webm)$' }
    } else {
      Get-Item -LiteralPath $item.Path
    }
  }
}
if (-not $videos) { Write-Error "no video files found in: $($Path -join ', ')"; exit 1 }

$ffprobe = Get-Command ffprobe -ErrorAction SilentlyContinue
$ffmpeg  = Get-Command ffmpeg  -ErrorAction SilentlyContinue
if (-not $ffprobe -or -not $ffmpeg) {
  Write-Error "ffprobe/ffmpeg not found on PATH. Run: scoop install ffmpeg"
  exit 1
}

$textCodecs = @('subrip', 'ass', 'ssa', 'mov_text', 'text')
$failures = 0

foreach ($v in $videos) {
  Write-Host "[$($v.Name)]"

  $probeJson = & ffprobe -v error -select_streams s `
    -show_entries 'stream=index:stream=codec_name:stream_tags=language:stream_tags=title:stream_disposition=default' `
    -of json -- $v.FullName 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "  ffprobe FAILED ($LASTEXITCODE): $probeJson"
    $failures++
    continue
  }

  $streams = @()
  try { $streams = @(($probeJson | Out-String | ConvertFrom-Json).streams) } catch { $streams = @() }
  if ($streams.Count -eq 0) {
    Write-Host "  no subtitle streams inside the file"
    continue
  }

  # language match: "en" <-> tag "eng" prefix style, case-insensitive
  $matchLang = {
    param($tag)
    if ([string]::IsNullOrWhiteSpace($tag)) { return $true }   # untagged = always extract
    $t = $tag.ToLower(); $l = $Language.ToLower()
    return ($t -eq $l -or $t.StartsWith($l) -or $l.StartsWith($t))
  }

  $selected = @()
  foreach ($s in $streams) {
    $codec  = [string]$s.codec_name
    $tag    = $null; $title = $null
    if ($s.tags) { $tag = $s.tags.language; $title = $s.tags.title }
    $isDefault = $false
    if ($s.disposition) { $isDefault = [bool]$s.disposition.default }

    if ($textCodecs -contains $codec) {
      if (& $matchLang $tag) {
        $selected += [pscustomobject]@{
          index = $s.index; codec = $codec; title = $title; default = $isDefault
          untagged = [string]::IsNullOrWhiteSpace($tag)
        }
      }
    } elseif ($codec -match 'pgs|dvd_subtitle|dvb_subtitle') {
      Write-Host ("  SKIPPED bitmap track #{0} ({1}, lang={2}) - image-based, cannot become .srt without OCR; " -f $s.index, $codec, $(if ($tag) { $tag } else { 'untagged' })) -NoNewline
      Write-Host "player renders it in-file"
    } else {
      Write-Host "  SKIPPED unknown codec track #$($s.index) ($codec)"
    }
  }

  if ($selected.Count -eq 0) {
    Write-Host "  no TEXT tracks matching language '$Language'"
    continue
  }

  # plain sidecar = non-SDH first, then default-flagged, then stream order
  $ranked = $selected | Sort-Object `
    @{ e = { if ($_.title -match 'sdh') { 1 } else { 0 } } },
    @{ e = { -not $_.default } },
    @{ e = { $_.index } }

  $i = 0
  foreach ($t in $ranked) {
    $ext = if ($t.codec -in @('ass', 'ssa')) { 'ass' } else { 'srt' }
    if ($i -eq 0) {
      $out = [System.IO.Path]::ChangeExtension($v.FullName, $ext)
    } else {
      $slug = if ($t.title) { ($t.title -replace '[^A-Za-z0-9]+', '.').Trim('.') } else { "track$($t.index)" }
      $out = Join-Path $v.DirectoryName "$($v.BaseName).$slug.$ext"
    }
    if ((Test-Path -LiteralPath $out) -and -not $Force) {
      Write-Host "  exists, keeping: $(Split-Path -Leaf $out)"
      $i++
      continue
    }
    # codec is picked by ffmpeg from the output extension - never force -c:s here
    $ffOut = & ffmpeg -y -v error -i $v.FullName -map "0:$($t.index)" -- $out 2>&1
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $out)) {
      Write-Warning "  ffmpeg extraction FAILED ($LASTEXITCODE) for track #$($t.index): $ffOut"
      $failures++
    } else {
      $note = if ($t.untagged) { " [untagged language - extracted anyway]" } else { "" }
      Write-Host ("  extracted #{0} ({1}{2}) -> {3}{4}" -f $t.index, $t.codec, $(if ($t.title) { ", '$($t.title)'" } else { "" }), (Split-Path -Leaf $out), $note)
    }
    $i++
  }
}

if ($failures -gt 0) {
  Write-Error "extract-embedded: $failures track extraction(s) FAILED"
  exit 1
}
exit 0
