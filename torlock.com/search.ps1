# torlock.com torrent search + optional add to qBittorrent (headless)
# usage:
#   .\search.ps1 -Query "daredevil s03"
#   .\search.ps1 -Query "daredevil s03" -Add
#   .\search.ps1 -Query "x" -MinSeeds 5 -Max 20
# notes:
#   - search URL: /all/torrents/<query>.html - inline result table, 200 with a
#     browser UA (verified 2026-09-16 as a source of the retired tools\torrent-multi-search.ps1,
#     re-split into this standalone script 2026-10-02)
#   - rows expose a DETAIL page link, not a magnet: -Add fetches that page and
#     pulls href="magnet:?xt=..." before handing it to qbittorrent
#   - row parse: seeds = first bare number in the row, size = the KB/MB/GB/TB cell
#   - site-level sort is seeds-desc; quality ranking (4K/REMUX first) belongs to the
#     root batch script, which ranks across all sites
param(
    [Parameter(Mandatory = $true)][string]$Query,
    [switch]$Add,
    [switch]$Paused,
    [int]$MinSeeds = 1,
    [int]$Max = 20,
    [switch]$Json
)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ProgressPreference = 'SilentlyContinue'
$ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
$hdr = @{ 'User-Agent' = $ua; 'Accept-Language' = 'en-US,en;q=0.9' }
$q = [uri]::EscapeDataString($Query)
$base = 'https://www.torlock.com'

function Parse-Size($s) {
    $s = ($s -replace '&nbsp;', ' ').Trim().ToUpper()
    if ($s -match '^([\d\.]+)\s*(KB|MB|GB|TB)$') {
        $val = [double]$Matches[1]; $unit = $Matches[2]
        if ($unit -eq 'KB') { return $val / 1MB }
        if ($unit -eq 'MB') { return $val / 1MB }
        if ($unit -eq 'GB') { return $val }
        if ($unit -eq 'TB') { return $val * 1024 }
    }
    return 0
}

try {
    $r = Invoke-WebRequest -Uri "$base/all/torrents/$q.html" -TimeoutSec 25 -UseBasicParsing -Headers $hdr
} catch {
    $code = ''
    try { if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode } } catch {}
    Write-Host "LOUD FAIL: torlock.com search endpoint is broken site-side (HTTP $code) - homepage answers 200 but /all/torrents/<q>.html, /?q=, /search/<q> all 502 (probed 2026-10-02). retry later; this is not a parse bug."
    exit 1
}

$results = @{}
$rows = [regex]::Matches($r.Content, '<tr[^>]*>(.*?)</tr>', 'Singleline')
foreach ($row in $rows) {
    $b = $row.Groups[1].Value
    $dl = [regex]::Match($b, 'href="(/torrent/\d+/[^"]*)"')
    if (-not $dl.Success) { continue }
    $txt = ($b -replace '<[^>]+>', '|') -replace '\|+', '|'
    $parts = $txt.Split('|') | Where-Object { $_.Trim() -ne '' }
    if ($parts.Count -lt 3) { continue }
    $name = $parts[1].Trim()
    $size = ''; $seed = 0; $tmp = 0; $numIdx = 0
    foreach ($p in $parts) {
        $pt = $p.Trim()
        if ($pt -match '^[\d\.]+\s*(KB|MB|GB|TB)$') { $size = $pt }
        elseif ([int]::TryParse($pt, [ref]$tmp)) { if ($numIdx -eq 0) { $seed = $tmp; $numIdx++ } }
    }
    $key = $name
    if (-not $results.ContainsKey($key) -or $seed -gt $results[$key].Seeds) {
        $results[$key] = [pscustomobject]@{
            Name   = $name
            Seeds  = $seed
            Size   = $size
            Detail = "$base$($dl.Groups[1].Value)"
        }
    }
}

$found = @($results.Values | Where-Object { $_.Name -ne '' -and $_.Seeds -ge $MinSeeds } |
    Sort-Object Seeds -Descending | Select-Object -First $Max)

if ($Json) {
    foreach ($res in $found) {
        [pscustomobject]@{ source = 'torlock.com'; name = $res.Name; seeds = $res.Seeds; size = $res.Size; magnet = ''; detail = $res.Detail } | ConvertTo-Json -Compress
    }
    exit 0
}

"[$($found.Count) results for '$Query' on torlock.com]"
$i = 0
foreach ($res in $found) { $i++; "{0,2}. [{1,3} seeds] {2,-12} {3}" -f $i, $res.Seeds, $res.Size, $res.Name }

if ($Add -and $found.Count -gt 0) {
    $add = "$PSScriptRoot\..\qbittorrent.com\add-torrent.ps1"
    $choice = if ($found.Count -eq 1) { 0 } else {
        [int](Read-Host "which one to add (1-$($found.Count), 0 = none)") - 1
    }
    if ($choice -ge 0 -and $choice -lt $found.Count) {
        $hit = $found[$choice]
        $magnet = $null
        try {
            $d = Invoke-WebRequest -Uri $hit.Detail -TimeoutSec 25 -UseBasicParsing -Headers $hdr
            $m = [regex]::Match($d.Content, 'href="(magnet:\?xt=urn:btih:[0-9a-fA-F]{40}[^"]*)"')
            if ($m.Success) { $magnet = $m.Groups[1].Value }
        } catch { Write-Host "detail fetch fail: $($_.Exception.Message)" }
        if ($magnet) {
            $params = @{ Url = $magnet }
            if ($Paused) { $params.Paused = $true }
            & $add @params
        } else {
            Write-Host "LOUD FAIL: no magnet on the detail page for '$($hit.Name)' - add manually: $($hit.Detail)"
            exit 1
        }
    }
}
