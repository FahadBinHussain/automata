# rutor.info torrent search + optional add to qBittorrent (headless, no UI needed)
# usage:
#   .\search.ps1 -Query "agents shield 4 sezon"
#   .\search.ps1 -Query "shield s04" -Add -Paused
#   .\search.ps1 -Query "shield s04" -MinSeeds 10 -Max 20
# notes:
#   - rutor.info is a Russian tracker; queries and results are often mixed RU/EN
#   - results page is windows-1251; English titles survive fine
#   - search URL: /search/0/0/000/0/<query> (0 results = not in index)
#   - each result row exposes a magnet directly in the HTML (no login needed)
#   - verified 2026-08-18: "avengers" -> 50 rows with magnets; AoS not in index
param(
    [Parameter(Mandatory = $true)][string]$Query,
    [switch]$Add,
    [switch]$Paused,
    [int]$MinSeeds = 1,
    [int]$Max = 10
)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$base = "https://rutor.info"
$url = "$base/search/0/0/000/0/$([uri]::EscapeDataString($Query))"

$r = Invoke-WebRequest -Uri $url -TimeoutSec 25 -UseBasicParsing
$content = $r.Content
$trs = [regex]::Matches($content, '<tr[^>]*class="(?:gai|tum)"(.*?)</tr>', [System.Text.RegularExpressions.RegexOptions]::Singleline)

$results = @()
foreach ($tr in $trs) {
    $c = $tr.Groups[1].Value
    $mag = [regex]::Match($c, 'href="(magnet:\?xt=urn:btih:[0-9a-fA-F]{40}[^"]*)"')
    if (-not $mag.Success) { continue }
    $nameM = [regex]::Match($c, '<a[^>]*href="/torrent/\d+/[^"]*"[^>]*>(.*?)</a>')
    $name = $nameM.Groups[1].Value -replace '<[^>]+>', ''
    $sizeM = [regex]::Match($c, '<td[^>]*align="right"[^>]*>(.*?)</td>')
    $size = ($sizeM.Groups[1].Value -replace '<[^>]+>', '').Trim()
    $seedM = [regex]::Match($c, 'class="green"[^>]*>.*?&nbsp;(\d+)</span>')
    $seeds = if ($seedM.Success) { [int]$seedM.Groups[1].Value } else { 0 }
    $results += [pscustomobject]@{ Name = $name; Size = $size; Seeds = $seeds; Magnet = $mag.Groups[1].Value }
}

$results = $results | Where-Object { $_.Seeds -ge $MinSeeds } | Sort-Object Seeds -Descending | Select-Object -First $Max
"[$($results.Count) results for '$Query']"
$i = 0
foreach ($res in $results) {
    $i++
    "{0,2}. [{1,3} seeds] {2,-12} {3}" -f $i, $res.Seeds, $res.Size, $res.Name
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