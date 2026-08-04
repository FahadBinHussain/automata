# Bitwarden unlock helper
# Launches outer shell for password input, saves session to %APPDATA%\mainframe\accounts\bitwarden\session.key
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
        if ($env:BW_SESSION) {
            Set-Content -Path $sessionFile -Value $env:BW_SESSION -NoNewline
        }
        if (Test-Path $sessionFile) {
            Write-Host "Bitwarden already unlocked."
            exit 0
        }
    }
} catch {}

# Launch outer shell for interactive password entry
$scriptBlock = {
    $sessionDir = "$env:APPDATA\mainframe\accounts\bitwarden"
    $sessionFile = "$sessionDir\session.key"

    Write-Host ""
    Write-Host "=== Bitwarden Unlock ===" -ForegroundColor Cyan
    Write-Host ""

    $securePassword = Read-Host "Enter master password" -AsSecureString
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $plainPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)

    $env:BW_PASSWORD = $plainPassword
    $result = bw unlock --passwordenv BW_PASSWORD --raw 2>&1

    if ($LASTEXITCODE -eq 0 -and $result -match "^[A-Za-z0-9+/=]+$") {
        Set-Content -Path $sessionFile -Value $result -NoNewline
        $env:BW_SESSION = $result
        bw sync | Out-Null
        Write-Host ""
        Write-Host "Unlocked and synced." -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "Unlock failed." -ForegroundColor Red
    }

    Start-Sleep -Seconds 2
}

$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($scriptBlock.ToString()))
Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded"

# Wait for session file (up to 60s)
$timeout = 60
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
