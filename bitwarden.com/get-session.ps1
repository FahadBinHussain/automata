# Get Bitwarden session key for agent use
# Returns session key if valid, exits 1 if expired/missing
# Usage: $session = .\get-session.ps1

# force UTF-8 stdout - bw status parsing must not go through the OEM codepage
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$sessionFile = "$env:APPDATA\mainframe\accounts\bitwarden\session.key"

if (!(Test-Path $sessionFile)) {
    Write-Host "NO_SESSION"
    exit 1
}

$fileInfo = Get-Item -LiteralPath $sessionFile
$age = (Get-Date) - $fileInfo.LastWriteTime
if ($age.TotalMinutes -ge 60) {
    Remove-Item $sessionFile -Force -ErrorAction SilentlyContinue
    bw lock 2>$null | Out-Null
    Write-Host "SESSION_EXPIRED"
    exit 1
}

$sessionKey = (Get-Content $sessionFile -Raw).Trim()

# Test if session is still valid
$env:BW_SESSION = $sessionKey
try {
    $rawStatus = bw status --session $sessionKey 2>$null
    if ($rawStatus) {
        $status = $rawStatus | ConvertFrom-Json
        if ($status.status -eq "unlocked") {
            Write-Output $sessionKey
            exit 0
        } elseif ($status.status -in @("locked", "unauthenticated")) {
            Remove-Item $sessionFile -Force -ErrorAction SilentlyContinue
            Write-Host "SESSION_EXPIRED"
            exit 1
        }
    }
} catch {}

# If status check had a transient error (e.g. concurrent lock on data.json)
# and the session file is well within its 60m TTL, preserve it
if ($age.TotalMinutes -lt 60) {
    Write-Output $sessionKey
    exit 0
} else {
    Remove-Item $sessionFile -Force -ErrorAction SilentlyContinue
    Write-Host "SESSION_EXPIRED"
    exit 1
}
