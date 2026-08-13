# Bitwarden unlock helper
# Spawns unlock-inner.ps1 in its own window for interactive password entry,
# saves session to %APPDATA%\mainframe\accounts\bitwarden\session.key
# Master password is entered manually every time (no stored copy on disk).
#
# Handles all CLI states:
#   - locked          -> bw unlock (password)
#   - unauthenticated -> bw login (password) first, then capture session
#   - unlocked        -> reuse existing session
#
# NOTE: never run `bw sync` in the unlock window - if the stored session
# tokens are stale, sync's token refresh triggers a CLI logout that
# overwrites the state file (symptom: data.json shrinks to ~13KB with
# global_clearEvent_logout, status flips locked -> unauthenticated).
# The vault cache is already on disk; agents sync themselves after
# validating BW_SESSION.
#
# Usage: .\unlock.ps1

$sessionDir = "$env:APPDATA\mainframe\accounts\bitwarden"
$sessionFile = "$sessionDir\session.key"

if (!(Test-Path $sessionDir)) {
    New-Item -ItemType Directory -Path $sessionDir -Force | Out-Null
}

# Check if already unlocked
try {
    $status = bw status 2>&1 | ConvertFrom-Json
    if ($status.status -eq "unlocked") {
        $currentSession = $null
        if (Test-Path $sessionFile) { $currentSession = Get-Content $sessionFile -Raw }
        if (-not $currentSession -and $env:BW_SESSION) {
            Set-Content -Path $sessionFile -Value $env:BW_SESSION -NoNewline
        }
        if (Test-Path $sessionFile) {
            Write-Host "Bitwarden already unlocked."
            exit 0
        }
    }
} catch {}

$innerPath = Join-Path $PSScriptRoot 'unlock-inner.ps1'
if (-not (Test-Path $innerPath)) {
    Write-Host "Missing unlock-inner.ps1 next to unlock.ps1" -ForegroundColor Red
    exit 1
}

Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$innerPath`""

# Wait for session file (up to 180s - inner worker allows 3 password attempts)
$timeout = 180
$elapsed = 0
Write-Host "Waiting for unlock..." -NoNewline
while (!(Test-Path $sessionFile) -and $elapsed -lt $timeout) {
    Start-Sleep -Seconds 1
    $elapsed++
    Write-Host "." -NoNewline
}

if (Test-Path $sessionFile) {
    Write-Host " Done."
    exit 0
} else {
    Write-Host " Timed out."
    exit 1
}