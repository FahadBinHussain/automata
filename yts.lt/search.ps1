# yts.lt (YTS) movie search via the public JSON API. no browser needed.
# usage: .\search.ps1 -Query "x-men first class" [-Quality 1080p] [-Seeds 10] [-Add] [-Allow720]
# prints: <yts-id> | <title> (<year>) | <quality> <type> seeds=<n> hash=<hex>
# -Add: pick the top match and add its magnet to qBittorrent via ..\qbittorrent.com\add-torrent.ps1
# default pick rule: never below 1080p. -Allow720 relaxes that only when nothing >=1080p exists.
param(
  [Parameter(Mandatory = $true)][string]$Query,
  [string]$Quality,
  [int]$Seeds = 0,
  [switch]$Add,
  [switch]$Allow720
)

$tiers = if ($Allow720) { @('1080p', '720p', '2160p') } else { @('1080p', '2160p') }
$base = "https://yts.lt/api/v2/list_movies.json?query_term=$([uri]::EscapeDataString($Query))&limit=5"
$r = Invoke-WebRequest -Uri $base -TimeoutSec 20 -UseBasicParsing
$j = ($r.Content | ConvertFrom-Json)
if (-not $j.data -or -not $j.data.movies) { "no results"; exit 1 }

foreach ($m in $j.data.movies) {
  $cands = $m.torrents | Where-Object { $tiers -contains $_.quality }
  $picks = if ($Quality) { $cands | Where-Object { $_.quality -eq $Quality } } else {
    $s = $cands | Where-Object { $_.seeds -ge $Seeds } | Sort-Object { $tiers.IndexOf($_.quality) }
    if ($s) { @($s)[0] } else { $null }
  }
  if ($picks) {
    $t = if ($picks -is [array]) { $picks[0] } else { $picks }
    "$($m.id) | $($m.title) ($($m.year)) | $($t.quality) $($t.type) seeds=$($t.seeds) hash=$($t.hash)"
    if ($Add) {
      $trs = "tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce&tr=udp%3A%2F%2Fopen.demonii.com%3A1337%2Fannounce&tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce&tr=udp%3A%2F%2Ftracker.torrent.eu.org%3A451%2Fannounce&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969%2Fannounce&tr=udp%3A%2F%2F9.rarbg.com%3A2710%2Fannounce"
      $magnet = "magnet:?xt=urn:btih:$($t.hash)&dn=$([uri]::EscapeDataString("$($m.title) ($($m.year)) $($t.quality) $($t.type) - YIFY"))&$trs"
      & (Join-Path $PSScriptRoot '..\qbittorrent.com\add-torrent.ps1') -Url $magnet
    }
  }
}
