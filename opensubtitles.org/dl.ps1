# dl.ps1 - download one subtitle from opensubtitles past the bot wall
# (mihomo socks + browser UA + strict srt validation). split out of
# tools\subtitle-download 2026-10-08. caller: sub.wyzie.io\fetch.ps1

param(
  [Parameter(Mandatory = $true)]
  [string]$Url,
  [Parameter(Mandatory = $true)]
  [string]$Out
)

$ErrorActionPreference = "Stop"
$ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
$tmp = "$Out.dlpart"

# direct egress can get the 5.7KB "not a bot!" page - always through mihomo socks
& curl.exe -s -L --fail --socks5-hostname 127.0.0.1:7891 -A $ua -o $tmp $Url
if ($LASTEXITCODE -ne 0) {
  Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
  throw "curl failed (exit $LASTEXITCODE) for $Url - mihomo not listening on 127.0.0.1:7891?"
}

$text = Get-Content -LiteralPath $tmp -Raw -ErrorAction SilentlyContinue
if (-not $text) {
  Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
  throw "empty download from $Url"
}
$cues = ([regex]::Matches($text, '-->')).Count
if ($text -match '<html' -or $cues -lt 100) {
  $head = $text.Substring(0, [Math]::Min(160, $text.Length)) -replace '\s+', ' '
  Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
  throw "BOT WALL: $Url returned html/short body ($cues cues, expected 100+): $head"
}
Move-Item -LiteralPath $tmp -Destination $Out -Force
Write-Host "    $([IO.Path]::GetFileName($Out)): $cues cues"
