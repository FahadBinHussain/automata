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

  $final = ''; $fname = ''
  while ((Get-Date) -lt $deadline) {
    Start-Sleep 12
    $body = apiLast
    if (-not $body) { Write-Output '... waiting for /api'; continue }
    $next = ([regex]::Match($body, '"next"\s*:\s*"([^"]+)"')).Groups[1].Value
    $link = ([regex]::Match($body, '"link"\s*:\s*"([^"]+)"')).Groups[1].Value
    $tick = ([regex]::Match($body, '"ticket"\s*:\s*"([^"]+)"')).Groups[1].Value
    $nm = ([regex]::Match($body, '"name"\s*:\s*"([^"]+)"')).Groups[1].Value
    if ($nm) { $fname = $nm }
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

  Write-Output '[3/5] downloading via Edge...'
  $before = @{}
  Get-ChildItem $OutDir -File -ErrorAction SilentlyContinue | ForEach-Object { $before[$_.Name] = 1 }
  pweval "location.href='$final';" | Out-Null
  $got = ''
  while ((Get-Date) -lt $deadline) {
    Start-Sleep 15
    $new = Get-ChildItem $OutDir -File -ErrorAction SilentlyContinue | Where-Object { -not $before.ContainsKey($_.Name) } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($new -and $new.Extension -ne '.crdownload') { $got = $new.FullName; break }
    $dl = Get-ChildItem $OutDir -Filter '*.crdownload' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($dl) { Write-Output ("... {0:N0} MB" -f ($dl.Length / 1MB)) }
  }
  if (-not $got) { throw 'download incomplete; URL was: ' + $final }
  Write-Output "[4/5] DONE: $got"
  $got
}
finally { pw @('close-all') | Out-Null }
