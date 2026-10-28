# search-all.ps1 - batch search across the root torrenting site scripts
# the single entry point for "find me this release": runs every site script with
# -Json, merges, dedupes, applies the user pick rule (4K/REMUX > BluRay > WEB >
# HDTV, then seeds), and optionally pushes the winner to qBittorrent.
#
# usage:
#   .\search-all.ps1 -Query "daredevil s03"
#   .\search-all.ps1 -Query "daredevil s03" -MinSeeds 5 -Max 30
#   .\search-all.ps1 -Query "daredevil s03" -Add            # pick + -> qbt
#   .\search-all.ps1 -Query "x" -Sources limetorrents,rutor
#
# adding a site later: one entry in $sites below + a row in AGENTS.md. the site
# script must honor the contract: -Query/-Max/-Json emitting NDJSON rows of
# {source,name,seeds,size,magnet,detail} (empty magnet -> batch fetches detail).
#
# failures are loud, never silent: a broken site prints its own LOUD FAIL line
# here with [!] and its exit code; results say how many sites answered.
param(
    [Parameter(Mandatory = $true)][string]$Query,
    [int]$MinSeeds = 0,
    [int]$Max = 20,
    [int]$PerSiteMax = 25,
    [switch]$Add,
    [switch]$Paused,
    [string[]]$Sources = @('knaben', 'rutor', 'torlock', 'limetorrents')
)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ProgressPreference = 'SilentlyContinue'

$sites = [ordered]@{
    knaben       = 'knaben.org\search.ps1'
    rutor        = 'rutor.info\search.ps1'
    torlock      = 'torlock.com\search.ps1'
    limetorrents = 'limetorrents.fun\search.ps1'
}
$ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
$hdr = @{ 'User-Agent' = $ua; 'Accept-Language' = 'en-US,en;q=0.9' }

function Quality-Rank($name) {
    $n = $name.ToUpper()
    if ($n -match '2160P|4K|UHD') { return 0 }
    if ($n -match 'REMUX|BD-?REMUX') { return 1 }
    if ($n -match 'BLURAY|BDRIP|BRRIP|BD-?RIP') { return 2 }
    if ($n -match 'WEB-?DL|WEBRIP|WEB-?RIP|AMZN|NF|DSNP|HULU') { return 3 }
    if ($n -match 'HDTV|SDTV|DVDRIP|DVDSCR') { return 4 }
    return 5
}

function Get-MagnetFromDetail([string]$detail) {
    try {
        $d = Invoke-WebRequest -Uri $detail -TimeoutSec 25 -UseBasicParsing -Headers $hdr
        $m = [regex]::Match($d.Content, 'href="(magnet:\?xt=urn:btih:[0-9a-fA-F]{40}[^"]*)"')
        if ($m.Success) { return $m.Groups[1].Value }
    } catch { }
    return $null
}

$all = @()
$failed = @()
$answered = @()

foreach ($key in $Sources) {
    if (-not $sites.Contains($key)) {
        Write-Host "[!] unknown source '$key' - known: $($sites.Keys -join ', ')"
        continue
    }
    $path = Join-Path $PSScriptRoot "..\$($sites[$key])"
    if (-not (Test-Path $path)) {
        $failed += [pscustomobject]@{ Site = $key; Why = "script missing: $path" }
        continue
    }
    $raw = @()
    try { $raw = @(& $path -Query $Query -Max $PerSiteMax -Json 2>&1 6>&1) } catch { $raw = @("EXCEPTION: $($_.Exception.Message)") }
    $code = $LASTEXITCODE
    $rows = @()
    $noise = @()
    foreach ($line in $raw) {
        $t = "$line".Trim()
        if ($t -like '{*') {
            try { $rows += ($t | ConvertFrom-Json) } catch { $noise += $t }
        } elseif ($t -ne '') { $noise += $t }
    }
    if ($rows.Count -gt 0) {
        $all += $rows
        $answered += $key
        if ($noise) { Write-Host "[~] $($sites[$key]) answered but noted: $($noise -join ' | ')" }
    } else {
        $why = if ($noise) { $noise -join ' | ' } else { "empty result (exit $code)" }
        if (-not $why) { $why = "empty result (exit $code)" }
        $failed += [pscustomobject]@{ Site = $key; Why = "exit ${code}: $why" }
    }
}

foreach ($f in $failed) {
    Write-Host "[!] $($f.Site) FAILED: $($f.Why)"
}
if ($answered.Count -eq 0) {
    Write-Host "LOUD FAIL: every source failed for '$Query' - no results to rank"
    exit 1
}

$merged = @{}
foreach ($row in $all) {
    $row.name = [System.Net.WebUtility]::HtmlDecode("$($row.name)").Trim()
    $row.size = ([System.Net.WebUtility]::HtmlDecode("$($row.size)").Replace([char]0x00A0, ' ')).Trim()
    if ($row.name -eq '' -or [int]$row.seeds -lt $MinSeeds) { continue }
    $key = $row.name.ToLower()
    if (-not $merged.ContainsKey($key) -or [int]$row.seeds -gt [int]$merged[$key].seeds) { $merged[$key] = $row }
}

$ranked = @($merged.Values | Sort-Object -Property @{Expression = { Quality-Rank $_.name }}, @{Expression = { [int]$_.seeds }; Descending = $true} | Select-Object -First $Max)

$scope = ($answered | ForEach-Object { $sites[$_] }) -join ', '
"[ $($ranked.Count) results for '$Query' across: $scope ]"
if ($failed.Count -gt 0) { "[ $($failed.Count)/$($Sources.Count) sources failed - see [!] lines above ]" }
$i = 0
foreach ($res in $ranked) {
    $i++
    $q = switch (Quality-Rank $res.name) { 0 { '4K' } 1 { 'REMUX' } 2 { 'BluRay' } 3 { 'WEB' } 4 { 'HDTV' } default { '' } }
    $qTag = if ($q) { " ($q)" } else { '' }
    "{0,2}. [{1,4} seeds] {2,-12} {3} [{4}]{5}" -f $i, [int]$res.seeds, $res.size, $res.name, $res.source, $qTag
}

if ($Add -and $ranked.Count -gt 0) {
    $add = "$PSScriptRoot\..\qbittorrent.com\add-torrent.ps1"
    $choice = if ($ranked.Count -eq 1) { 0 } else {
        [int](Read-Host "which one to add (1-$($ranked.Count), 0 = none)") - 1
    }
    if ($choice -ge 0 -and $choice -lt $ranked.Count) {
        $hit = $ranked[$choice]
        $magnet = if ("$($hit.magnet)") { "$($hit.magnet)" } else { Get-MagnetFromDetail "$($hit.detail)" }
        if ($magnet) {
            $p = @{ Url = $magnet }
            if ($Paused) { $p.Paused = $true }
            & $add @p
        } else {
            Write-Host "LOUD FAIL: no magnet for '$($hit.name)' - fetch manually: $($hit.detail)"
            exit 1
        }
    }
}
