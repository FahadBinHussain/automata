# 1337x magnet extractor - works without a browser via the 1337xx.to mirror detail pages
# usage:
#   .\get-magnet.ps1 -Url "https://1337x.to/torrent/348116/Iron-man-2-2010-1080p-BrRip-x264-1-60GB-YIFY/"
#   .\get-magnet.ps1 -Id 348116
# output: JSON { id, title, magnet, infohash, seeders, leechers, size, url }

param(
    [string]$Url,
    [string]$Id,
    [string]$Domain = "https://www.1337xx.to"
)

$ErrorActionPreference = "Stop"

if ($Url) {
    if ($Url -notmatch "/torrent/(\d+)/") { throw "not a 1337x torrent url: $Url" }
    $Id = $Matches[1]
}
if (-not $Id) { throw "pass -Url or -Id" }

$pageUrl = "$Domain/torrent/$Id/x/"

$r = Invoke-WebRequest -Uri $pageUrl -TimeoutSec 20 -UseBasicParsing
$c = $r.Content

if ($c -match "Error 404|The page you were looking for is not here") {
    Write-Output "{ `"id`": $Id, `"error`": `"not found`" }"
    exit 1
}

$magnet = $null
$m = [regex]::Match($c, 'magnet:\?xt=urn:btih:[A-Fa-f0-9]{40}[^"]*')
if ($m.Success) { $magnet = $m.Value }

$title = ""
$t = [regex]::Match($c, '<h1[^>]*>([^<]*)</h1>')
if ($t.Success) { $title = $t.Groups[1].Value.Trim() }

$infohash = ""
$h = [regex]::Match($c, 'urn:btih:([A-Fa-f0-9]{40})')
if ($h.Success) { $infohash = $h.Groups[1].Value }

$seeders = ""
$s = [regex]::Match($c, 'class="seeds">(\d+)')
if ($s.Success) { $seeders = $s.Groups[1].Value }

$leechers = ""
$l = [regex]::Match($c, 'class="leeches">(\d+)')
if ($l.Success) { $leechers = $l.Groups[1].Value }

$size = ""
$z = [regex]::Match($c, 'class="size">([^<]*)</')
if ($z.Success) { $size = $z.Groups[1].Value.Trim() }

if (-not $magnet) { throw "no magnet found on $pageUrl (challenge page?)" }

$out = [ordered]@{
    id       = [int]$Id
    title    = $title
    magnet   = $magnet
    infohash = $infohash
    seeders  = $seeders
    leechers = $leechers
    size     = $size
    url      = $pageUrl
}
$out | ConvertTo-Json