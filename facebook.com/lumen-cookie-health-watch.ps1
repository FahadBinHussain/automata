# lumen-cookie-health-watch.ps1 - VISIBLE watchdog window for the lumen bridge.
#
# Spawned by the "lumen-cookie-health-watch" scheduled task at logon as a
# normal console window (murmur-task style, InteractiveToken). Runs
# cookie-health.ps1 once every 30 minutes forever in the foreground, so the
# user can glance at the desktop and see the lumen cookie watchdog working
# (bridge health + BNP outbox failure count, color-coded output).
#
# The per-check details still land in $env:TEMP\lumen-cookie-health.log.
#
# Usage (manual):
#   pwsh -NoExit -File lumen-cookie-health-watch.ps1
#   .\lumen-cookie-health-watch.ps1 -IntervalMinutes 10   # for testing

param(
    [int]$IntervalMinutes = 30
)

$ErrorActionPreference = "Continue"

$Host.UI.RawUI.WindowTitle = "lumen cookie-health watch"
$env:MURMUR_HF_SPACE_URL = "https://<lumen-url>"
$health = "C:\Users\<user>\Downloads\automata\facebook.com\cookie-health.ps1"

Write-Host ""
Write-Host "=== lumen cookie-health watch ===" -ForegroundColor Cyan
Write-Host "bridge : $env:MURMUR_HF_SPACE_URL" -ForegroundColor Gray
Write-Host "check  : every ${IntervalMinutes} min (task: lumen-cookie-health-watch @ logon)" -ForegroundColor Gray
Write-Host "log    : $env:TEMP\lumen-cookie-health.log" -ForegroundColor Gray
Write-Host ""

while ($true) {
    $started = Get-Date
    $next = $started.AddMinutes($IntervalMinutes)
    Write-Host ""
    Write-Host ("[{0}] check started -- next check ~{1:HH:mm:ss}" -f $started.ToString("HH:mm:ss"), $next) -ForegroundColor DarkCyan
    try {
        & $health
        Write-Host ("[{0}] check done (exit {1})" -f (Get-Date).ToString("HH:mm:ss"), $LASTEXITCODE) -ForegroundColor DarkCyan
    } catch {
        Write-Host ("[{0}] watch error: {1}" -f (Get-Date).ToString("HH:mm:ss"), $_.Exception.Message) -ForegroundColor Red
    }
    Start-Sleep -Seconds (60 * $IntervalMinutes)
}
