# Murmur Cookie Monitor
# Checks murmur health every 30 min, refreshes facebook cookies if unhealthy.
# Runs on logon as interactive task (shows window like other tasks).

$ErrorActionPreference = "Continue"

$MurmurUrl      = if ($env:MURMUR_REFRESH_URL -and $env:MURMUR_REFRESH_URL -match '^https?://') { $env:MURMUR_REFRESH_URL } else { "https://<murmur-space>" }
$HfTokenFile    = if ($env:MURMUR_REFRESH_HF_TOKEN_FILE -and (Test-Path $env:MURMUR_REFRESH_HF_TOKEN_FILE)) { $env:MURMUR_REFRESH_HF_TOKEN_FILE } else { (Join-Path $env:APPDATA "mainframe\accounts\hf\<your-email>\token") }
$RefreshScript  = Join-Path $PSScriptRoot "..\facebook.com\murmur-cookie-refresher.mjs"
$CheckInterval  = 300  # 5 minutes in seconds

function Now { Get-Date -Format 'HH:mm:ss' }

function Get-HfToken {
    if (-not (Test-Path $HfTokenFile)) {
        Write-Host "[$(Now)] HF token not found at $HfTokenFile" -ForegroundColor Red
        return $null
    }
    return (Get-Content $HfTokenFile -Raw).Trim()
}

function Test-MurmurHealth {
    param([string]$Token)
    try {
        $headers = @{ Authorization = "Bearer $Token" }
        $r = Invoke-RestMethod -Uri "$MurmurUrl/api/health" -Headers $headers -TimeoutSec 10 -ErrorAction Stop
        return @{ ok = ($r -eq "ok"); response = $r }
    } catch {
        return @{ ok = $false; response = $_.Exception.Message }
    }
}

function Invoke-CookieRefresh {
    Write-Host "[$(Now)] launching cookie refresher..." -ForegroundColor Cyan
    if (-not (Test-Path $RefreshScript)) {
        Write-Host "[$(Now)] cookie refresher not found: $RefreshScript" -ForegroundColor Red
        return
    }
    $proc = Start-Process -FilePath "node" -ArgumentList $RefreshScript -PassThru -NoNewWindow
    $proc.WaitForExit()
    Write-Host "[$(Now)] cookie refresher finished (exit: $($proc.ExitCode))" -ForegroundColor $(if ($proc.ExitCode -eq 0) { "Green" } else { "Yellow" })
}

Write-Host "=== Murmur Cookie Monitor ===" -ForegroundColor Cyan
Write-Host "Murmur:    $MurmurUrl"
Write-Host "Interval:  $($CheckInterval / 60) min"
Write-Host ""

$token = Get-HfToken
if (-not $token) {
    Write-Host "Cannot start without HF token. Exiting." -ForegroundColor Red
    Start-Sleep -Seconds 10
    exit 1
}

while ($true) {
    Write-Host "[$(Now)] checking murmur health..."
    $health = Test-MurmurHealth -Token $token
    
    if ($health.ok) {
        Write-Host "[$(Now)] murmur healthy: $($health.response)" -ForegroundColor Green
    } else {
        Write-Host "[$(Now)] murmur unhealthy: $($health.response)" -ForegroundColor Red
        Invoke-CookieRefresh
    }
    
    Write-Host "[$(Now)] sleeping $($CheckInterval / 60) min..." -ForegroundColor DarkGray
    Start-Sleep -Seconds $CheckInterval
}
