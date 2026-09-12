#requires -Version 7
<#
to-mega.ps1 — push the local git bundles to a MEGA folder (transport: RCLONE mega: backend).

why rclone and NOT megatools: mega-account.ps1 shells megatools 1.11.5 (2019), which cannot
         log in to freshly-created (v3-account) MEGA accounts — it fails the 'us' handshake
         with a misleading "Server returned error ENOENT" even with correct credentials.
         rclone's maintained mega: backend authenticates these accounts fine. This script
         therefore uses rclone directly; the vault still holds the credential.
         ENGINE: rclone mega (not megatools).

purpose: uploads bundles + lfs tars from <script-dir>\mirror\bundles to MEGA, diffing by
         name+size against `rclone lsjson` (skips what matches), verifies quota via
         `rclone about` BEFORE uploading, verifies each upload by re-list, final full pass.
inputs : MEGA account stored in the vault (item with login.username == the email, password in
         login.password). then set in <script-dir>\.env.local :  MEGA_EMAIL=<email>
         (stateless: password read at runtime, never written to rclone.conf or logged)
run    : .\to-mega.ps1                     # MEGA_EMAIL from .env.local
         .\to-mega.ps1 -Email <email>
         .\to-mega.ps1 -LimitSpeedMBps 4   # throttle (protects your work session upstream)
         .\to-mega.ps1 -Force              # re-upload even if name+size already on remote
outputs: <RemoteFolder>/<repo>.bundle on the MEGA account
exit   : 1 if any upload or verification failed
#>
param(
  [string]$Email,
  [string]$Root = (Join-Path $PSScriptRoot 'mirror'),
  [string]$RemoteFolder = '/github-mirror',
  [int]$LimitSpeedMBps = 0,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

if (-not (Get-Command rclone -ErrorAction SilentlyContinue)) { throw 'rclone not on PATH (scoop install rclone)' }

if (-not $Email) {
  $envFile = Join-Path $PSScriptRoot '.env.local'
  if (Test-Path -LiteralPath $envFile) {
    $line = (Get-Content $envFile | Where-Object { $_ -match '^\s*MEGA_EMAIL\s*=' } | Select-Object -First 1)
    if ($line) { $Email = ($line -split '=', 2)[1].Trim() }
  }
}
if (-not $Email) { throw "no MEGA email: pass -Email or set MEGA_EMAIL in $PSScriptRoot\.env.local" }
$norm = $Email.Trim().ToLowerInvariant()

$bundles = Join-Path $Root 'bundles'
if (-not (Test-Path -LiteralPath $bundles)) { throw "missing $bundles — run mirror-all.ps1 first" }
$local = @(Get-ChildItem $bundles -File | Where-Object { $_.Name -match '\.(bundle|lfs\.tar\.gz)$' })
if (-not $local) { throw "no bundles in $bundles — run mirror-all.ps1 first" }

# --- vault password (login.password, fallback to [password] notes header) ---
Import-Module (Join-Path $env:USERPROFILE 'Downloads\mainframe\vault-secret.psm1') -Force -EA SilentlyContinue
$sf = Join-Path $env:APPDATA 'mainframe\accounts\bitwarden\session.key'
if (-not $env:BW_SESSION -and (Test-Path $sf)) { $env:BW_SESSION = (Get-Content $sf -Raw).Trim() }
if (-not $env:BW_SESSION) { throw 'no vault session — unlock bw first (mainframe/unlock.ps1)' }
$item = @(bw list items --search 'mega.nz' --session $env:BW_SESSION | ConvertFrom-Json) |
  Where-Object { $_.name -like 'mega.nz*' -and $_.login.username -and $_.login.username.Trim().ToLowerInvariant() -eq $norm } |
  Select-Object -First 1
if (-not $item) { throw "no vault item for $norm (searched mega.nz*)" }
$pw = $null
try { $pw = Get-SecretFromNotes -Item $item -Header '[password]' } catch {}
if ([string]::IsNullOrWhiteSpace($pw)) { $pw = $item.login.password }
if ([string]::IsNullOrWhiteSpace($pw)) { throw "vault item for $norm has no password" }
$obs = & rclone obscure $pw
if ($LASTEXITCODE -ne 0 -or -not $obs) { throw 'rclone obscure failed' }

# --- configure the mega remote from env only (never persisted to rclone.conf) ---
$env:RCLONE_CONFIG_MEGA_TYPE = 'mega'
$env:RCLONE_CONFIG_MEGA_USER = $norm
$env:RCLONE_CONFIG_MEGA_PASS = $obs
if ($LimitSpeedMBps -gt 0) { $env:RCLONE_TRANSFER_LIMIT = "$($LimitSpeedMBps)M" }
try {
  $null = & rclone lsd 'mega:/' 2>&1
  if ($LASTEXITCODE -ne 0) { throw "rclone login failed for $norm" }
} catch {
  Remove-Item Env:RCLONE_CONFIG_MEGA_TYPE, Env:RCLONE_CONFIG_MEGA_USER, Env:RCLONE_CONFIG_MEGA_PASS, Env:RCLONE_TRANSFER_LIMIT -EA SilentlyContinue
  throw
}

function Get-RemoteFiles([string]$path) {
  $json = & rclone lsjson $path --files-only -R 2>$null | ConvertFrom-Json
  @($json | ForEach-Object { [pscustomobject]@{ Name = ($_.Path -replace '/', '\'); Bytes = [long]$_.Size } })
}

$totalBytes = ($local | Measure-Object Length -Sum).Sum
Write-Host ("[engine: rclone mega] {0} files, {1:N2} GB local -> {2}@{3}" -f $local.Count, ($totalBytes / 1GB), $RemoteFolder, $norm)

# --- quota gate BEFORE any transfer ---
$about = & rclone about 'mega:/' --json 2>$null | ConvertFrom-Json
if ($about) {
  if (([long]$about.free) -lt $totalBytes) { throw "not enough room: $([math]::Round($about.free/1GB,2)) GB free on $norm, need $([math]::Round($totalBytes/1GB,2)) GB" }
  Write-Host ("quota ok: {0:N2} GB free / {1:N2} GB total on $norm" -f ($about.free / 1GB), ($about.total / 1GB))
}

$remotePath = "mega:$RemoteFolder"
$null = & rclone mkdir $remotePath 2>$null
$remote = Get-RemoteFiles $remotePath
$remoteByName = @{}
foreach ($rf in $remote) { $remoteByName[$rf.Name] = $rf.Bytes }
Write-Host "$($remote.Count) file(s) already in $RemoteFolder"

$up = @(); $err = @(); $sk = 0; $skippedBytes = 0
$sw = [Diagnostics.Stopwatch]::StartNew()
foreach ($f in $local) {
  if (-not $Force -and $remoteByName.ContainsKey($f.Name) -and $remoteByName[$f.Name] -eq $f.Length) {
    $sk++; $skippedBytes += $f.Length
    continue
  }
  $mb = [math]::Round($f.Length / 1MB, 1)
  $dest = "$remotePath/$($f.Name)"
  $okFile = $false
  foreach ($attempt in 1, 2) {
    $null = & rclone copyto $f.FullName $dest --no-check-certificate --stats-one-line --stats 30s 2>&1
    if ($LASTEXITCODE -eq 0) { $okFile = $true; break }
    Write-Warning "$($f.Name): attempt $attempt failed (exit $LASTEXITCODE)"
    Start-Sleep -Seconds (3 * $attempt)
  }
  if (-not $okFile) { Write-Error "$($f.Name): UPLOAD FAILED"; $err += $f.Name; continue }
  $rf2 = Get-RemoteFiles $dest | Where-Object { $_.Name -replace '/', '\' -eq $f.Name }
  if ($rf2 -and $rf2.Bytes -eq $f.Length) {
    $up += $f.Name
    Write-Host ("[{0:hh\:mm\:ss}] up {1} ({2} MB, {3:N1} MB/s avg)" -f $sw.Elapsed, $f.Name, $mb, ($f.Length / 1MB / [math]::Max($sw.Elapsed.TotalSeconds, 1)))
  } else {
    Write-Error "$($f.Name): uploaded but remote size mismatch/missing"; $err += $f.Name
  }
}

$upBytes = ($local | Where-Object { $_.Name -in $up } | Measure-Object Length -Sum).Sum
Write-Host ''
Write-Host ("MEGA PUSH (rclone) in {0:hh\:mm\:ss}: uploaded={1} ({2:N2} GB) skipped-unchanged={3} ({4:N2} GB) failed={5}" -f $sw.Elapsed, $up.Count, ($upBytes / 1GB), $sk, ($skippedBytes / 1GB), $err.Count)

Remove-Item Env:RCLONE_CONFIG_MEGA_TYPE, Env:RCLONE_CONFIG_MEGA_USER, Env:RCLONE_CONFIG_MEGA_PASS, Env:RCLONE_TRANSFER_LIMIT -EA SilentlyContinue
if ($err) { Write-Error "FAILED uploads: $($err -join ', ')"; exit 1 }
