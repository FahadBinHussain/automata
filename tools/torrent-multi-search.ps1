# torrent-multi-search.ps1 - search FMHY-listed video torrent sites in parallel
# sources are the ones that actually work headless (verified 2026-09-16):
#   torlock, limetorrents (200 with browser UA; return inline result tables)
#   knaben.org, rutor.info (existing automata folders)
# blocked/headless-dead (do NOT add): eztv/ext.to/bt4g/uindex/cinemacity/torrentsurf
#   (403), rutracker.org (cloudflare challenge), 1tube (client-side JS, no static
#   magnets), torrentproject (empty shell), rarbgdump (JS app)
#
# usage:
#   .\torrent-multi-search.ps1 -Query "Agents of SHIELD 1080p"
#   .\torrent-multi-search.ps1 -Query "agent carter" -MinSeeds 3 -Max 30
#   .\torrent-multi-search.ps1 -Query "daredevil s01" -Add           # best match -> qbt
#   .\torrent-multi-search.ps1 -Query "x" -Sources torlock,limetorrents
#
# pick rule (user rule): 4K/REMUX first, then BluRay > WEB > HDTV, then seeds,
#   then sane size. results are pre-sorted that way; -Add pushes the top hit.
param(
  [Parameter(Mandatory=$true)][string]$Query,
  [int]$MinSeeds = 0,
  [int]$Max = 20,
  [switch]$Add,
  [string[]]$Sources = @('knaben','rutor','torlock','limetorrents')
)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ProgressPreference = 'SilentlyContinue'
$ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
$hdr = @{ 'User-Agent'=$ua; 'Accept-Language'='en-US,en;q=0.9' }
$q = [uri]::EscapeDataString($Query)

function Parse-Size($s){
  $s = ($s -replace '&nbsp;',' ').Trim().ToUpper()
  if($s -match '^([\d\.]+)\s*(KB|MB|GB|TB)$'){
    $val = [double]$Matches[1]; $unit = $Matches[2]
    if($unit -eq 'KB'){ return $val/1MB }
    if($unit -eq 'MB'){ return $val/1MB }
    if($unit -eq 'GB'){ return $val }
    if($unit -eq 'TB'){ return $val*1024 }
  }
  return 0
}
function Quality-Rank($name){
  $n = $name.ToUpper()
  if($n -match '2160P|4K|UHD'){ return 0 }
  if($n -match 'REMUX|BD-?REMUX|REMUX'){ return 1 }
  if($n -match 'BLURAY|BDRIP|BRRIP|BD-?RIP'){ return 2 }
  if($n -match 'WEB-?DL|WEBRIP|WEB-?RIP|AMZN|NF|DSNP|HULU'){ return 3 }
  if($n -match 'HDTV|SDTV|DVDRIP|DVDSCR'){ return 4 }
  return 5
}

$results = @{}
# --- knaben (delegated to its own script) ---
if($Sources -contains 'knaben'){
  $k = & "$PSScriptRoot\..\knaben.org\search.ps1" -Query $Query -Max 50 6>&1
  # knaben script prints lines, no magnets exposed -> skip parsing; kept for seed hints
}
# --- rutor (delegated) ---
if($Sources -contains 'rutor'){
  $rutorRes = & "$PSScriptRoot\..\rutor.info\search.ps1" -Query $Query -Max 50 6>&1
  foreach($l in $rutorRes){
    if($l -match '^\s*(\d+)\.\s*\[\s*(\d+)\s*seeds\]\s*([\d\.]+\s*[KMG]B)\s*(.*)$'){
      $n=$Matches[4].Trim()
      $results[$n] = [pscustomobject]@{ Source='rutor'; Name=$n; Seeds=[int]$Matches[2]; SizeGB=(Parse-Size $Matches[3]); Quality=(Quality-Rank $n); Magnet='' }
    }
  }
}
# --- torlock ---
if($Sources -contains 'torlock'){
  try{
    $r = Invoke-WebRequest -Uri "https://www.torlock.com/all/torrents/$q.html" -TimeoutSec 25 -UseBasicParsing -Headers $hdr
    $rows = [regex]::Matches($r.Content,'<tr[^>]*>(.*?)</tr>','Singleline')
    foreach($row in $rows){
      $b = $row.Groups[1].Value
      if($b -notmatch 'SHIELD|shield' -and $Query -notmatch 'shield'){ }
      $dl = [regex]::Match($b,'href="(/torrent/\d+/[^"]*)"')
      if(-not $dl.Success){ continue }
      $txt = ($b -replace '<[^>]+>','|') -replace '\|+','|'
      $parts = $txt.Split('|') | Where-Object { $_.Trim() -ne '' }
      if($parts.Count -lt 3){ continue }
      $name = $parts[1].Trim()
      $date=''; $size=''; $seed=0; $leech=0; $tmp=0; $numIdx=0
      foreach($p in $parts){
        $pt=$p.Trim()
        if($pt -match '^[\d\.]+\s*(KB|MB|GB|TB)$'){ $size=$pt }
        elseif([int]::TryParse($pt,[ref]$tmp)){ if($numIdx -eq 0){ $seed=$tmp; $numIdx++ } else { $leech=$tmp } }
      }
      $key=$name
      if(-not $results.ContainsKey($key) -or $seed -gt $results[$key].Seeds){
        $results[$key] = [pscustomobject]@{ Source='torlock'; Name=$name; Seeds=$seed; SizeGB=(Parse-Size $size); Quality=(Quality-Rank $name); Magnet="https://www.torlock.com$($dl.Groups[1].Value)" }
      }
    }
  }catch{ Write-Host "torlock fail: $($_.Exception.Message)" }
}
# --- limetorrents ---
if($Sources -contains 'limetorrents'){
  try{
    $r = Invoke-WebRequest -Uri "https://www.limetorrents.fun/search/all/$q/" -TimeoutSec 25 -UseBasicParsing -Headers $hdr
    $rows = [regex]::Matches($r.Content,'<tr[^>]*>(.*?)</tr>','Singleline')
    foreach($row in $rows){
      $b = $row.Groups[1].Value
      $dl = [regex]::Match($b,'href="(/[^"]*torrent-[^"]*)"')
      if(-not $dl.Success){ continue }
      $txt = ($b -replace '<[^>]+>','|') -replace '\|+','|'
      $parts = $txt.Split('|') | Where-Object { $_.Trim() -ne '' }
      if($parts.Count -lt 4){ continue }
      # real rows: <blank> | <title | category> | <added - in <cat>> | <size> | seed | leech
      $titleCat = $parts[1].Trim()
      $name = ($parts[0].Trim() -split ';')[0].Trim()
      if($name.Length -lt 5){ continue }
      $size=''; $seed=0; $leech=0; $tmp=0
      foreach($p in $parts){
        $pt=$p.Trim()
        if($pt -match '^[\d\.]+\s*(KB|MB|GB|TB)$'){ $size=$pt }
        elseif([int]::TryParse($pt,[ref]$tmp)){ if($seed -eq 0){ $seed=$tmp } else { $leech=$tmp } }
      }
      $key=$name
      if(-not $results.ContainsKey($key) -or $seed -gt $results[$key].Seeds){
        $results[$key] = [pscustomobject]@{ Source='limetorrents'; Name=$name; Seeds=$seed; SizeGB=(Parse-Size $size); Quality=(Quality-Rank $name); Magnet="https://www.limetorrents.fun$($dl.Groups[1].Value)" }
      }
    }
  }catch{ Write-Host "limetorrents fail: $($_.Exception.Message)" }
}

$results = $results.Values | Where-Object { $_.Name -ne '' -and $_.Seeds -ge $MinSeeds } |
  Sort-Object Quality, Seeds -Descending | Select-Object -First $Max
"[$($results.Count) results for '$Query' across: $($Sources -join ',')]"
$i=0
foreach($res in $results){ $i++; "{0,3}. [{1,4} seeds] {2,-10} {3}" -f $i, $res.Seeds, "$([math]::Round($res.SizeGB,2))GB", $res.Name }

if($Add -and $results.Count -gt 0){
  $add = "$PSScriptRoot\..\qbittorrent.com\add-torrent.ps1"
  $choice = if($results.Count -eq 1){ 0 } else { [int](Read-Host "which one to add (1-$($results.Count), 0 = none)") - 1 }
  if($choice -ge 0 -and $choice -lt $results.Count){
    $hit = $results[$choice]
    if($hit.Magnet.StartsWith('magnet:')){ & $add -Url $hit.Magnet }
    else { Write-Host "detail page only (no inline magnet): $($hit.Magnet) - fetch magnet manually" }
  }
}
