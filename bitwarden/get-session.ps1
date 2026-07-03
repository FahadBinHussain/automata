# Get Bitwarden session key for agent use
# Returns session key if valid, exits 1 if expired/missing
# Usage: $session = .\get-session.ps1

$sessionFile = "$env:APPDATA\mainframe\accounts\bitwarden\session.key"

if (!(Test-Path $sessionFile)) {
    Write-Host "NO_SESSION"
    exit 1
}

$sessionKey = Get-Content $sessionFile -Raw

# Test if session is still valid
$env:BW_SESSION = $sessionKey
$status = bw status 2>&1 | ConvertFrom-Json

if ($status.status -eq "unlocked") {
    Write-Output $sessionKey
    exit 0
} else {
    Remove-Item $sessionFile -Force -ErrorAction SilentlyContinue
    Write-Host "SESSION_EXPIRED"
    exit 1
}
