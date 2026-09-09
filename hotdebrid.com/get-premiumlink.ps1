# hotdebrid rapidgator -> direct file. no agent-browser. needs: node/npx + Edge.
# usage: pwsh get-premiumlink.ps1 -Url "https://rapidgator.net/file/....html" [-OutDir "C:\Users\<user>\Downloads"]
# flow (all proven 2026-09-09): headed Edge opens generator -> fill link -> trusted click
# Generate (eval-click does NOT fire handler) -> /api returns ticket/next/link ->
# b1(link,'_self',next,ticket) form-POSTs (page's own fn) through box_03/box_04 ->
# directDl=1 -> Edge downloads single-use /dl itself (cookies + single connection).
param(
  [Parameter(Mandatory = $true)][string]$Url,
  [string]$OutDir = "C:\Users\<user>\Downloads",
  [int]$TimeoutMin = 20
)
$ErrorActionPreference = 'Stop'
$PW = @('npx', '--yes', '--package', '@playwright/cli', 'playwright-cli')
function pw([string[]]$a) { & $PW[0] $PW[1..($PW.Count - 1)] @a 2>&1 | Out-String }
function pweval([string]$js) {
  $lit = ConvertTo-Json $js -Compress
  $o = pw @('eval', "() => eval($lit)") | Out-String
  $lines = $o -split "`r?`n"
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^### Result\s*$' -and ($i + 1) -lt $lines.Count) { return $lines[$i + 1].Trim() }
  }
  return $o.Trim()
}
function apiLast() {
  $reqs = pw @('requests', '--filter', 'hotdebrid.com/api')
  $ids = [regex]::Matches($reqs, '(?m)^(\d+)\. \[POST\]') | ForEach-Object { $_.Groups[1].Value }
  if (-not $ids) { return $null }
  return (pw @('response-body', ($ids | Select-Object -Last 1)) | Out-String)
}
$deadline = (Get-Date).AddMinutes($TimeoutMin)
try {
  Write-Output '[1/5] opening generator...'
  $prof = Join-Path $PSScriptRoot 'edge-profile'
  $prefDir = Join-Path $prof 'Default'
  if (-not (Test-Path (Join-Path $prefDir 'Preferences'))) {
    New-Item -ItemType Directory -Force -Path $prefDir | Out-Null
    $dl = $OutDir -replace '\\', '\\'
    Set-Content (Join-Path $prefDir 'Preferences') "{`"download`":{`"default_directory`":`"$dl`",`"directory_upgrade`":true}}"
  }
  & $PW[0] $PW[1..($PW.Count - 1)] @('--browser', 'msedge', 'open', '--headed', '--persistent', '--profile', $prof, 'https://www.hotdebrid.com/premium-link-generator/rapidgator') 2>&1 | Out-Null
  Start-Sleep 6
  if ((pweval '1+1') -notmatch '2') { throw 'browser eval broken' }

  Write-Output '[2/5] submitting link...'
  pweval "document.getElementById('links').value='$Url';" | Out-Null
  $snap = pw @('snapshot')
  $m = [regex]::Match($snap, 'button "Generate Premium Link" \[ref=([^\]]+)\]')
  if (-not $m.Success) { throw 'generate button ref not found' }
  pw @('click', $m.Groups[1].Value) 2>&1 | Out-Null

  $final = ''; $fname = ''; $expectedSize = ''
  while ((Get-Date) -lt $deadline) {
    Start-Sleep 12
    $body = apiLast
    if (-not $body) { Write-Output '... waiting for /api'; continue }
    $next = ([regex]::Match($body, '"next"\s*:\s*"([^"]+)"')).Groups[1].Value
    $link = ([regex]::Match($body, '"link"\s*:\s*"([^"]+)"')).Groups[1].Value
    $tick = ([regex]::Match($body, '"ticket"\s*:\s*"([^"]+)"')).Groups[1].Value
    $nm = ([regex]::Match($body, '"name"\s*:\s*"([^"]+)"')).Groups[1].Value
    if ($nm) { $fname = $nm }
    $szm = [regex]::Match($body, '"s"\s*:\s*"(\d+)')
    if ($szm.Success) { $expectedSize = $szm.Groups[1].Value }
    if ($body -match '"directDl"\s*:\s*"1"' -and $link) {
      $final = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($link))
      Write-Output "DIRECT: $final"
      break
    }
    if ($next -and $link -and $tick) {
      Write-Output "maze: next=$next file=$fname"
      pweval "try{b1('$link','_self','$next','$tick')}catch(e){'ERR:'+e}" | Out-Null
    }
    else { Write-Output '... waiting for maze state' }
  }
  if (-not $final) { throw 'no directDl=1 before timeout' }

  Write-Output '[3/5] downloading with session cookies (single connection)...'
  if ([string]::IsNullOrWhiteSpace($fname)) { throw 'maze never returned a filename; refusing to guess' }
  $ProgressPreference = 'SilentlyContinue'
  $dest = Join-Path $OutDir $fname
  # playwright-cli routes in-page downloads to Temp\playwright-artifacts-* (GUID name,
  # wiped on close-all) instead of the pinned dir, and OutDir polling false-positives
  # on unrelated new files. so: fetch the single-use /dl with the live session
  # cookies directly (same IP + session, one connection, no ranges).
  $cj = pw @('cookie-list') | Out-String
  $pairs = @()
  foreach ($line in ($cj -split "`r?`n")) {
    $m = [regex]::Match($line, '^\s*([^=\s]+)=(\S+?)\s+\(domain:\s*([^,]+),')
    if (-not $m.Success) { continue }
    $dom = $m.Groups[3].Value.Trim()
    if ($dom -match 'hotdebrid\.com|premiumlinkgen\.com') { $pairs += ($m.Groups[1].Value + '=' + $m.Groups[2].Value) }
  }
  if (-not $pairs) { throw 'no hotdebrid session cookies found; refusing blind download' }
  $headers = @{
    'Cookie'     = ($pairs -join '; ')
    'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0'
    'Referer'    = 'https://www.hotdebrid.com/premium-link-generator/rapidgator'
  }
  Invoke-WebRequest -Uri $final -Headers $headers -MaximumRedirection 10 -OutFile $dest
  $got = Get-Item $dest
  if ($expectedSize) {
    Write-Output "size: got $($got.Length), expected $expectedSize"
    if ($got.Length -ne [long]$expectedSize) { throw ("size mismatch: got {0}, expected {1}" -f $got.Length, $expectedSize) }
  }
  $magic = [IO.File]::ReadAllBytes($got.FullName)[0..3]
  $hex = ($magic | ForEach-Object { $_.ToString('X2') }) -join ' '
  if (-not (($magic[0] -eq 0x52) -and ($magic[1] -eq 0x61) -and ($magic[2] -eq 0x72) -and ($magic[3] -eq 0x21))) { throw "not a rar (magic $hex); kept at $($got.FullName)" }
  Write-Output "[4/5] DONE: $($got.FullName)"
  $got.FullName
}
finally { pw @('close-all') | Out-Null }
