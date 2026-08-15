#!/usr/bin/env pwsh
# cookie-health.ps1 — FB cookie health watchdog for the lumen bridge.
#
# Port of murmur/scripts/murmur.ps1's Check-CookieHealth + Invoke-CookieRefresh
# + Reset-FailedBnpOutbox, but standalone: it does NOT run the wacli pipeline,
# it only watches the dailyBNP outbox for the stale-cookie failure signature
# ("send returned empty message ID" in BnpMessengerNotification.lastError),
# and when the failure count crosses a threshold inside a window it:
#   1. health-gates on the lumen bridge /api/health
#   2. runs the browserless cookie refresher (agent-browser cookie vault ->
#      lumen /api/cookies/upload, bridge reload)
#   3. resets the failed outbox rows to pending so the BNP worker retries
#
# Why local: the cookie vault (agent-browser) lives on this machine, so the
# refresh step cannot happen on Render. The outbox DB is dailyBNP's Neon, so
# detection works from anywhere with BNP_DATABASE_URL.
#
# Usage:
#   pwsh cookie-health.ps1                 # single check, one log line
#   pwsh cookie-health.ps1 -Loop           # check every interval forever
#
# Env (same names as murmur's .env so it can be pointed at murmur/.env):
#   BNP_DATABASE_URL                       - dailyBNP Neon DSN (else murmur/.env)
#   BNP_COOKIE_REFRESH_FAILURE_WINDOW_MINUTES (default 30)
#   BNP_COOKIE_REFRESH_FAILURE_THRESHOLD       (default 2)
#   BNP_COOKIE_REFRESH_INTERVAL_SECONDS        (default 600; -Loop only)
#   MURMUR_HF_SPACE_URL                    - lumen bridge base URL (default
#                                            http://127.0.0.1:8791 local lumen;
#                                            use https://<lumen-url>
#                                            to hit the deployed service)
#   AGENT_BROWSER_EMAIL                    - FB account email for the cookie
#                                            vault (refresher)
#   HF_EMAIL                               - mainframe hf profile whose token
#                                            the refresher sends as Bearer
#                                            (must equal the lumen bridge secret
#                                            when bridge.secret is set)
#   MURMUR_COOKIE_REFRESHER_SCRIPT         - override refresher path
#   BNP_DB_SCRIPT                          - override bnp-db.mjs path
#   COOKIE_HEALTH_LOG                      - log file (default $env:TEMP\lumen-cookie-health.log)
#
# Scheduled task (registered 2026-08-14, cloned from the murmur task's proven
# pattern: at logon + PT30M repetition + MultipleInstancesPolicy=IgnoreNew +
# InteractiveToken, so it survives sleep/hibernate):
#   schtasks /query /tn "lumen-cookie-health" /xml   # current definition
#   schtasks /run /tn "lumen-cookie-health"          # manual run
# The task embeds MURMUR_HF_SPACE_URL=https://<lumen-url> in its
# pwsh -Command line; run manually without env to test the local bridge default.
# Exit code 0 = healthy, 2 = refresh triggered, 3 = bridge down, 4 = DB error.

[CmdletBinding()]
param(
    [switch]$Loop
)

$ErrorActionPreference = "Stop"
$LogFile = if ($env:COOKIE_HEALTH_LOG) { $env:COOKIE_HEALTH_LOG } else { Join-Path $env:TEMP "lumen-cookie-health.log" }
$BridgeUrl = if ($env:MURMUR_HF_SPACE_URL) { $env:MURMUR_HF_SPACE_URL.Trim().TrimEnd("/") } else { "http://127.0.0.1:8791" }
$WindowM = if ($env:BNP_COOKIE_REFRESH_FAILURE_WINDOW_MINUTES) { [int]$env:BNP_COOKIE_REFRESH_FAILURE_WINDOW_MINUTES } else { 30 }
$Threshold = if ($env:BNP_COOKIE_REFRESH_FAILURE_THRESHOLD) { [int]$env:BNP_COOKIE_REFRESH_FAILURE_THRESHOLD } else { 2 }
$IntervalS = if ($env:BNP_COOKIE_REFRESH_INTERVAL_SECONDS) { [int]$env:BNP_COOKIE_REFRESH_INTERVAL_SECONDS } else { 600 }

$Refresher = if ($env:MURMUR_COOKIE_REFRESHER_SCRIPT) { $env:MURMUR_COOKIE_REFRESHER_SCRIPT } else { "C:\Users\<user>\Downloads\murmur\scripts\murmur-cookie-refresher.mjs" }
$BnpDb = if ($env:BNP_DB_SCRIPT) { $env:BNP_DB_SCRIPT } else { "C:\Users\<user>\Downloads\murmur\scripts\bnp-db.mjs" }

function Log([string]$msg, [string]$color = "Gray") {
    $line = "$(Get-Date -Format "yyyy-MM-dd HH:mm:ss") $msg"
    try { Write-Host $line -ForegroundColor $color } catch {}
    Add-Content -Path $LogFile -Value $line -Encoding utf8
}

function Get-BnpDatabaseUrl {
    if ($env:BNP_DATABASE_URL) { return $env:BNP_DATABASE_URL.Trim() }
    $dotenv = "C:\Users\<user>\Downloads\murmur\.env"
    if (Test-Path $dotenv) {
        $line = Get-Content $dotenv | Where-Object { $_ -match "^BNP_DATABASE_URL=" } | Select-Object -First 1
        if ($line) { return $line.Substring("BNP_DATABASE_URL=".Length).Trim().Trim('"', "'") }
    }
    return ""
}

function Invoke-BnpDb([string]$cmd) {
    $db = Get-BnpDatabaseUrl
    if (-not $db) { Log "BNP_DATABASE_URL not set (env or murmur/.env)" Yellow; return -1 }
    if (-not (Test-Path $BnpDb)) { Log "bnp-db.mjs missing: $BnpDb" Yellow; return -1 }
    $env:BNP_DATABASE_URL = $db
    $env:BNP_WINDOW_MINUTES = "$WindowM"
    try {
        $out = & node $BnpDb $cmd 2>&1
        $rc = $LASTEXITCODE
        if ($rc -ne 0) {
            Log "bnp-db.mjs $cmd failed (rc=$rc): $out" Yellow
            return -1
        }
        if ($cmd -eq "count") {
            $n = 0
            $raw = ($out -join "").Trim()
            if ([int]::TryParse($raw, [ref]$n)) { return $n }
            Log "bnp-db.mjs count unparseable: $out" Yellow
            return -1
        }
        return 0
    } finally {
        Remove-Item Env:\BNP_DATABASE_URL, Env:\BNP_WINDOW_MINUTES -ErrorAction SilentlyContinue
    }
}

function Reset-FailedBnpOutbox {
    Log "reset failed outbox rows: $(if ((Invoke-BnpDb "reset") -ge 0) { "ok" } else { "FAILED" })"
}

function Invoke-CookieRefresh {
    Log "=== COOKIE REFRESH TRIGGERED ===" Cyan
    if (-not (Test-Path $Refresher)) {
        Log "cookie refresher missing: $Refresher" Red
        return
    }
    $env:MURMUR_HF_SPACE_URL = $BridgeUrl
    try {
        $proc = Start-Process -FilePath "node" -ArgumentList $Refresher -PassThru -NoNewWindow
        $proc.WaitForExit()
        if ($proc.ExitCode -eq 0) {
            Log "cookie refresher ok (exit 0)" Green
        } else {
            Log "cookie refresher failed (exit $($proc.ExitCode))" Yellow
            return
        }
    } finally {
        Remove-Item Env:\MURMUR_HF_SPACE_URL -ErrorAction SilentlyContinue
    }
    # give the bridge a moment to settle the async MQTT reconnect after ReloadCookies
    Start-Sleep -Seconds 15
    Reset-FailedBnpOutbox
    Log "=== COOKIE REFRESH CYCLE DONE ===" Cyan
}

function Check-CookieHealth {
    Log "--- COOKIE HEALTH CHECK ---" Cyan
    try {
        $null = Invoke-RestMethod -Uri "$BridgeUrl/api/health" -TimeoutSec 10
        Log "  bridge $BridgeUrl/api/health: ok" Green
    } catch {
        Log "  bridge $BridgeUrl/api/health: UNREACHABLE ($($_.Exception.Message))" Red
        Log "  cookie-check skipped — bridge down" Yellow
        return 3
    }

    $failed = Invoke-BnpDb "count"
    if ($failed -lt 0) {
        Log "  BNP outbox query: error (skipping refresh)" Yellow
        return 4
    }
    if ($failed -ge $Threshold) {
        Log "  BNP outbox: $failed failed sends in last ${WindowM}m (threshold $Threshold)" Red
        Log "  >>> TRIGGERING COOKIE REFRESH <<<" Yellow
        Invoke-CookieRefresh
        return 2
    }
    Log "  BNP outbox: $failed recent failures (healthy)" Green
    Log "--- COOKIE HEALTH: OK ---" DarkCyan
    return 0
}

do {
    $code = Check-CookieHealth
    if ($Loop) { Start-Sleep -Seconds $IntervalS }
} while ($Loop)
exit $code
