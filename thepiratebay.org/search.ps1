# thepiratebay.org search via the apibay.org JSON mirror. no browser needed.
# usage: .\search.ps1 -Query "thor god of thunder" [-Seeds 1] [-Add]
# prints: <tpb-id> | <name> | seeds=<n> | size=<GB> | hash=<hex>
# -Add: add the first result that meets the seed floor to qBittorrent via ..\qbittorrent.com\add-torrent.ps1
param(
  [Parameter(Mandatory = $true)][string]$Query,
  [int]$Seeds = 1,
  [switch]$Add
)

$r = Invoke-WebRequest -Uri "https://apibay.org/q.php?q=$([uri]::EscapeDataString($Query))&cat=0" -TimeoutSec 20 -UseBasicParsing
$j = $r.Content | ConvertFrom-Json
if (-not $j -or $j.name -eq 'No results returned') { "no results"; exit 1 }

$best = $null
foreach ($t in $j) {
  $gb = [math]::Round($t.size / 1GB, 2)
  "$($t.id) | $($t.name) | seeds=$($t.seeders) | size=$gb GB | hash=$($t.info_hash)"
  if (-not $best -and [int]$t.seeders -ge $Seeds) { $best = $t }
}

if ($Add -and $best) {
  $trs = "tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce&tr=udp%3A%2F%2Fopen.demonii.com%3A1337%2Fannounce&tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce&tr=udp%3A%2F%2Ftracker.torrent.eu.org%3A451%2Fannounce&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969%2Fannounce&tr=udp%3A%2F%2F9.rarbg.com%3A2710%2Fannounce"
  $magnet = "magnet:?xt=urn:btih:$($best.info_hash)&dn=$([uri]::EscapeDataString($best.name))&$trs"
  & (Join-Path $PSScriptRoot '..\qbittorrent.com\add-torrent.ps1') -Url $magnet
}
