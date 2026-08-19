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
# Neon usage watcher (murmur.ps1 parity, added 2026-08-18): the same check
# murmur's loop ran hourly — neon-hours-table.ps1 -Json -> warn once per org
# per quota period at 90 of 100 CU-h via the lumen bridge notifications
# endpoint. env: NEON_USAGE_TABLE_SCRIPT, NEON_USAGE_CHECK_INTERVAL_SECONDS
# (default 3600), NEON_USAGE_WARNING_HOURS (default 90),
# NEON_USAGE_WARNING_PLATFORM (default whatsapp),
# NEON_USAGE_WARNING_THREAD_ID (default <whatsapp-jid> — the
# lumen test contact; messenger is not live on lumen), HF_EMAIL (default
# <email> — token must match the lumen bridge secret).
# dedup state: %APPDATA%\mainframe\state\lumen-neon-usage-warnings.json.
# Scheduled task: runs via lumen-cookie-health-watch.ps1 (visible window,
# task "lumen-cookie-health-watch" at logon, InteractiveToken) every 30 min;
# the old silent "lumen-cookie-health" task was deleted 2026-08-17.
#   schtasks /query /tn "lumen-cookie-health-watch" /xml   # current definition
#   schtasks /run /tn "lumen-cookie-health-watch"          # manual run
# The watch window embeds MURMUR_HF_SPACE_URL=https://<lumen-url>
# in its env; run manually without env to test the local bridge default.
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

# ── Neon usage watcher config (murmur.ps1 Check-NeonUsage parity) ──────────
# hourly check of all mainframe Neon orgs via neon-hours-table.ps1 -Json; one
# warning per org per quota period at NEON_USAGE_WARNING_HOURS (default 90 of
# 100 CU-h), deduped by the period key in a state file. sent to the lumen
# bridge notifications endpoint (whatsapp test jid by default — messenger is
# not live on lumen yet; override with NEON_USAGE_WARNING_THREAD_ID +
# NEON_USAGE_WARNING_PLATFORM).
$NeonUsageScript        = if ($env:NEON_USAGE_TABLE_SCRIPT) { $env:NEON_USAGE_TABLE_SCRIPT } else { "C:\Users\<user>\Downloads\mainframe\neon-hours-table.ps1" }
$NeonCheckIntervalS     = if ($env:NEON_USAGE_CHECK_INTERVAL_SECONDS) { [int]$env:NEON_USAGE_CHECK_INTERVAL_SECONDS } else { 3600 }
$NeonWarningHours       = if ($env:NEON_USAGE_WARNING_HOURS) { [double]$env:NEON_USAGE_WARNING_HOURS } else { 90 }
$NeonWarningPlatform    = if ($env:NEON_USAGE_WARNING_PLATFORM) { $env:NEON_USAGE_WARNING_PLATFORM.Trim() } else { "whatsapp" }
$NeonWarningThreadId    = if ($env:NEON_USAGE_WARNING_THREAD_ID) { $env:NEON_USAGE_WARNING_THREAD_ID.Trim() } else { "<whatsapp-jid>" }
$NeonWarningStatePath   = if ($env:NEON_USAGE_WARNING_STATE_PATH) { $env:NEON_USAGE_WARNING_STATE_PATH } else { "$env:APPDATA\mainframe\state\lumen-neon-usage-warnings.json" }
$NeonLastCheckPath      = "$env:APPDATA\mainframe\state\lumen-neon-usage-last-check.txt"

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
        # -NoProxy: the health check must never depend on the machine's system
        # proxy state. long-lived watch windows cache WebRequest.DefaultWebProxy
        # at boot, so a proxy enabled at logon keeps being used even after it's
        # disabled (2026-08-18: stale 127.0.0.1:7890 proxy refused every check
        # while fresh pwsh processes worked fine).
        $null = Invoke-RestMethod -Uri "$BridgeUrl/api/health" -TimeoutSec 10 -NoProxy
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

# ── Neon usage watcher (port of murmur.ps1 Check-NeonUsage, 2026-08-18) ────
# lumen's watch window originally only had the BNP outbox watcher; murmur had
# a second Neon watcher that warns at 90/100 CU-h per org per quota period.
# same query script (neon-hours-table.ps1 -Json, period-bounded
# /organizations/{org_id}/consumption), same dedup semantics (one warning per
# org per period, state file keyed on the canonical yyyy-MM-dd reset date).

function Get-HfToken {
    $email = if ($env:HF_EMAIL) { $env:HF_EMAIL.Trim() } else { "<email>" }
    foreach ($p in @("$env:APPDATA\mainframe\accounts\hf\$email\token.txt", "$env:APPDATA\mainframe\accounts\hf\$email\token")) {
        if (Test-Path $p) { return (Get-Content $p -Raw).Trim() }
    }
    return ""
}

function Send-NeonUsageWarning($project) {
    $token = Get-HfToken
    if (-not $token) {
        Log "  Neon warning not sent: HF token missing" Yellow
        return $false
    }

    $used = [double]$project.CU_Hours_Used
    $left = [double]$project.CU_Hours_Left
    $resetDate = 'unknown'
    if ($project.Quota_Reset -and $project.Quota_Reset -ne '-') {
        try {
            $dt = [DateTimeOffset]::Parse($project.Quota_Reset, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::RoundtripKind)
            $resetDate = $dt.UtcDateTime.ToString('yyyy-MM-dd')
        } catch { $resetDate = [string]$project.Quota_Reset }
    }
    $body = @{
        source = 'neon-usage'
        platform = $NeonWarningPlatform
        threadId = $NeonWarningThreadId
        title = 'Neon usage warning'
        message = "$($project.Project) ($($project.Account)) has used $used of 100 CU-hours. $left CU-hours remain. Quota reset: $resetDate UTC."
        dedupeKey = "neon-$NeonWarningHours`:$($project.ProjectId):$resetDate"
    } | ConvertTo-Json -Compress

    try {
        $null = Invoke-RestMethod -Uri "$BridgeUrl/api/automation/notifications" -Method POST -Headers @{
            Authorization = "Bearer $token"
            'X-HF-Authorization' = "Bearer $token"
            'Content-Type' = 'application/json'
        } -Body $body -TimeoutSec 30
        return $true
    } catch {
        Log "  Neon warning send failed: $($_.Exception.Message)" Yellow
        return $false
    }
}

function Check-NeonUsage {
    Log "--- NEON USAGE CHECK (warning at ${NeonWarningHours} CU-h) ---" Cyan
    if (-not (Test-Path $NeonUsageScript)) {
        Log "  Neon usage script missing: $NeonUsageScript" Yellow
        return
    }

    try {
        $json = & $NeonUsageScript -Json 2>&1
        if ($LASTEXITCODE -ne 0) { throw "usage script exited $LASTEXITCODE`: $($json -join ' ')" }
        $projects = @($json | ConvertFrom-Json -ErrorAction Stop)
    } catch {
        Log "  Neon usage query failed: $($_.Exception.Message)" Yellow
        return
    }

    $state = @{}
    if (Test-Path $NeonWarningStatePath) {
        try {
            $saved = Get-Content $NeonWarningStatePath -Raw | ConvertFrom-Json -ErrorAction Stop
            $saved.PSObject.Properties | ForEach-Object { $state[$_.Name] = [string]$_.Value }
        } catch {
            Log "  Neon warning state unreadable; rebuilding it" Yellow
        }
    }

    $overThreshold = @($projects | Where-Object {
        $_.ProjectId -and $_.ProjectId -ne '-' -and
        $_.Status -notmatch 'ERR' -and
        [double]$_.CU_Hours_Used -ge $NeonWarningHours
    })
    foreach ($project in $overThreshold) {
        $period = 'unknown'
        if ($project.Quota_Reset -and $project.Quota_Reset -ne '-') {
            try {
                $dt = [DateTimeOffset]::Parse($project.Quota_Reset, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::RoundtripKind)
                $period = $dt.UtcDateTime.ToString('yyyy-MM-dd')
            } catch { $period = [string]$project.Quota_Reset }
        }
        if ($state[[string]$project.ProjectId] -eq $period) {
            Log "  already warned: $($project.Project) ($($project.CU_Hours_Used) CU-h)" DarkGray
            continue
        }

        Log "  threshold reached: $($project.Project) ($($project.CU_Hours_Used) CU-h used)" Yellow
        if (Send-NeonUsageWarning $project) {
            $state[[string]$project.ProjectId] = $period
            $stateDir = Split-Path -Parent $NeonWarningStatePath
            if (-not (Test-Path $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }
            $state | ConvertTo-Json | Set-Content $NeonWarningStatePath -Force
            Log "  Neon usage warning sent" Green
        }
    }

    if ($overThreshold.Count -eq 0) {
        $highest = $projects | Where-Object { $_.ProjectId -and $_.ProjectId -ne '-' } | Sort-Object CU_Hours_Used -Descending | Select-Object -First 1
        if ($highest) {
            Log "  no project at threshold; highest is $($highest.Project) at $($highest.CU_Hours_Used) CU-h" Green
        } else {
            Log "  no Neon projects returned" Yellow
        }
    }
}

do {
    $code = Check-CookieHealth
    # Neon usage check on a coarse cadence (default hourly), tracked by a
    # marker file so standalone invocations stay in sync with the watch loop.
    $now = Get-Date
    $due = $false
    if (Test-Path $NeonLastCheckPath) {
        try {
            $last = [DateTime]::ParseExact((Get-Content $NeonLastCheckPath -Raw).Trim(), "yyyy-MM-dd HH:mm:ss", [Globalization.CultureInfo]::InvariantCulture)
            $due = ([int64]($now - $last).TotalSeconds -ge $NeonCheckIntervalS)
        } catch { $due = $true }
    } else {
        $due = $true
    }
    if ($due) {
        Check-NeonUsage
        try { $now.ToString("yyyy-MM-dd HH:mm:ss") | Set-Content $NeonLastCheckPath -Force } catch {}
    } else {
        # keep the hourly visible in the watch window even when it's not due:
        # a manual run can suppress the check for up to an hour via the
        # shared marker, which used to look like the watcher was gone.
        try {
            $last = [DateTime]::ParseExact((Get-Content $NeonLastCheckPath -Raw).Trim(), "yyyy-MM-dd HH:mm:ss", [Globalization.CultureInfo]::InvariantCulture)
            Log "  NEON USAGE: last check $($last.ToString('HH:mm:ss')), next ~$($last.AddSeconds($NeonCheckIntervalS).ToString('HH:mm:ss'))" DarkGray
        } catch {
            Log "  NEON USAGE: next check due (marker unreadable)" DarkGray
        }
    }
    if ($Loop) { Start-Sleep -Seconds $IntervalS }
} while ($Loop)
exit $code
