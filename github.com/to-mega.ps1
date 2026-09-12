#requires -Version 7
<#
to-mega.ps1 — push the local git bundles to a MEGA folder (no re-download needed to restore).

purpose: uploads bundles + lfs tars from <script-dir>\mirror\bundles to a MEGA account,
         diffing by name+size (skips what is already there), then verifies every local file
         exists remotely. state tracked in mega-state.json; a --reload ls is used for the
         final verification pass.
inputs : MEGA account stored in vault first:
           C:\Users\<user>\Downloads\automata\mega.nz\mega-account.ps1 login <email>
         then set in <script-dir>\.env.local :
           MEGA_EMAIL=<email>
run    : .\to-mega.ps1                 # uses MEGA_EMAIL from .env.local
         .\to-mega.ps1 -Email <email>  # explicit
         .\to-mega.ps1 -LimitSpeedKBs 4096   # throttle upload to 4 MiB/s
outputs: /github-mirror/<repo>.bundle on the MEGA account
exit   : 1 if any upload or verification failed
#>
param(
  [string]$Email,
  [string]$Root = (Join-Path $PSScriptRoot 'mirror'),
  [string]$RemoteFolder = '/github-mirror',
  [int]$LimitSpeedKBs = 0,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

if (-not $Email) {
  $envFile = Join-Path $PSScriptRoot '.env.local'
  if (Test-Path -LiteralPath $envFile) {
    $line = (Get-Content $envFile | Where-Object { $_ -match '^\s*MEGA_EMAIL\s*=' } | Select-Object -First 1)
    if ($line) { $Email = ($line -split '=', 2)[1].Trim() }
  }
}
if (-not $Email) { throw "no MEGA email: pass -Email or set MEGA_EMAIL in $PSScriptRoot\.env.local" }

$bundles = Join-Path $Root 'bundles'
if (-not (Test-Path -LiteralPath $bundles)) { throw "missing $bundles — run mirror-all.ps1 first" }
$local = @(Get-ChildItem $bundles -File | Where-Object { $_.Name -match '\.(bundle|lfs\.tar\.gz)$' })
if (-not $local) { throw "no bundles in $bundles — run mirror-all.ps1 first" }

$helper = Join-Path (Split-Path $PSScriptRoot -Parent) 'mega.nz\mega-account.ps1'
if (-not (Test-Path -LiteralPath $helper)) { throw "missing mega helper: $helper" }

$stateFile = Join-Path $Root 'mega-state.json'
$state = @{}
if (Test-Path -LiteralPath $stateFile) {
  foreach ($p in (Get-Content $stateFile -Raw | ConvertFrom-Json).PSObject.Properties) { $state[$p.Name] = $p.Value }
}

function Invoke-Mega([string[]]$MegaArgs) {
  $a = @('run', $Email) + $MegaArgs
  $out = & $helper @a 2>&1
  if ($LASTEXITCODE -ne 0) { throw "megatools failed (exit $LASTEXITCODE): $($out -join ' ')" }
  return @($out | ForEach-Object { [string]$_ })
}

$totalBytes = ($local | Measure-Object Length -Sum).Sum
Write-Host ("{0} files, {1:N2} GB local -> {2}@{3}" -f $local.Count, ($totalBytes / 1GB), $RemoteFolder, $Email)

$df = Invoke-Mega @('df')
$dfNum = ($df | Where-Object { $_ -match '^Used:' } | Select-Object -First 1)
if ($dfNum) {
  $used = [long](($dfNum -split '\s+')[1])
  $freeGB = [math]::Round(((21474836480 - $used) / 1GB), 2)
  if ((21474836480 - $used) -lt $totalBytes) { throw "not enough room: $freeGB GB free on $Email, need $($([math]::Round($totalBytes/1GB,2))) GB — pick a bigger/emptier account" }
}

try { $null = Invoke-Mega @('mkdir', $RemoteFolder) } catch { Write-Host "mkdir '${RemoteFolder}': $($_.Exception.Message) (ok if it already exists)" }
$remote = @(Invoke-Mega @('ls', '-n', $RemoteFolder) | ForEach-Object { Split-Path ([string]$_).Trim() -Leaf } | Where-Object { $_ })

$up = @(); $err = @(); $sk = 0
$skippedBytes = 0
$sw = [Diagnostics.Stopwatch]::StartNew()
foreach ($f in $local) {
  $sameOnRemote = ($remote -contains $f.Name) -and $state.ContainsKey($f.Name) -and ([long]$state[$f.Name].size -eq $f.Length)
  if ($sameOnRemote -and -not $Force) { $sk++; $skippedBytes += $f.Length; continue }
  $mb = [math]::Round($f.Length / 1MB, 1)
  $putArgs = @('put', '--no-progress', '--path', $RemoteFolder)
  if ($LimitSpeedKBs -gt 0) { $putArgs += "--limit-speed=$LimitSpeedKBs" }
  $putArgs += $f.FullName
  try {
    $null = Invoke-Mega $putArgs
  } catch {
    Write-Warning "$($f.Name): retrying after error: $($_.Exception.Message)"
    Start-Sleep -Seconds 3
    try { $null = Invoke-Mega $putArgs } catch { Write-Error "$($f.Name): UPLOAD FAILED — $($_.Exception.Message)"; $err += $f.Name; continue }
  }
  try {
    $null = Invoke-Mega @('ls', '-n', "$RemoteFolder/$($f.Name)")
  } catch { Write-Error "$($f.Name): uploaded but VERIFY MISSING on remote"; $err += $f.Name; continue }
  $state[$f.Name] = @{ size = $f.Length; sha = $null; uploadedUtc = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress | ConvertFrom-Json
  $up += $f.Name
  Write-Host ("[{0:hh\:mm\:ss}] up {1} ({2} MB, {3:N1} MB/s avg)" -f $sw.Elapsed, $f.Name, $mb, ($f.Length / 1MB / [math]::Max($sw.Elapsed.TotalSeconds, 1)))
}
$state | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $stateFile -Encoding utf8

$upBytes = ($local | Where-Object { $_.Name -in $up } | Measure-Object Length -Sum).Sum
Write-Host ''
Write-Host ("MEGA PUSH in {0:hh\:mm\:ss}: uploaded={1} ({2:N2} GB) skipped-unchanged={3} ({4:N2} GB) failed={5}" -f $sw.Elapsed, $up.Count, ($upBytes / 1GB), $sk, ($skippedBytes / 1GB), $err.Count)
if ($err) { Write-Error "FAILED uploads: $($err -join ', ')"; exit 1 }
