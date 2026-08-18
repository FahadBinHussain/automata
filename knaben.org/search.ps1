# knaben.org torrent search + optional add to qBittorrent (headless)
# usage:
#   .\search.ps1 -Query "agents of shield s04"
#   .\search.ps1 -Query "agents of shield s04" -Add -Paused
#   .\search.ps1 -Query "shield" -MinSeeds 5 -Max 20
# notes:
#   - knaben.org is a DHT-based torrent aggregator (listed on FMHY aggregators)
#   - search URL: /search/<query> ; result rows have <a title="name" href="magnet:...">
#   - no login, no bot-wall (verified 2026-08-18: agents of shield s04 -> 50 rows w/ magnets)
#   - seeds/size are NOT exposed in search rows (aggregator); check in the client
#   - full-season packs are spotty: good for episodes, niche titles, and cross-checking gaps
param(
    [Parameter(Mandatory = $true)][string]$Query,
    [switch]$Add,
    [switch]$Paused,
    [int]$MinSeeds = 1,
    [int]$Max = 10
)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$url = "https://knaben.org/search/$([uri]::EscapeDataString($Query))"
$r = Invoke-WebRequest -Uri $url -TimeoutSec 25 -UseBasicParsing
$rows = [regex]::Matches($r.Content, '<a title="([^"]+)" href="(magnet:[^"]+)"')
if ($rows.Count -eq 0) { "no results"; exit }

$results = @()
foreach ($row in $rows) {
    $name = [System.Net.WebUtility]::HtmlDecode($row.Groups[1].Value)
    $results += [pscustomobject]@{ Name = $name; Magnet = $row.Groups[2].Value }
}
$results = @($results | Group-Object Name | ForEach-Object { $_.Group[0] }) | Select-Object -First $Max
"[$($results.Count) results for '$Query' (seeds unknown - aggregator)]"
$i = 0
foreach ($res in $results) {
    $i++
    "{0,2}. {1}" -f $i, $res.Name
}

if ($Add -and $results.Count -gt 0) {
    $add = "C:\Users\<user>\Downloads\automata\qbittorrent.com\add-torrent.ps1"
    $choice = if ($results.Count -eq 1) { 0 } else {
        $n = Read-Host "which one to add (1-$($results.Count), 0 = none)"
        [int]$n - 1
    }
    if ($choice -ge 0 -and $choice -lt $results.Count) {
        $args = @("-Url", $results[$choice].Magnet)
        if ($Paused) { $args += "-Paused" }
        & $add @args
    }
}