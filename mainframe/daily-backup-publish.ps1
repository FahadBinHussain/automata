# daily-backup-publish.ps1 - daily machine-state backup + release publish
# meant to run from an S4U scheduled task (no UAC). skips loudly if a recent
# backup already ran today (idempotent for task retriggers).
$log = 'C:\tmp\daily-backup.log'
function Log($m) { "$(Get-Date -Format s) $m" | Add-Content -LiteralPath $log }
try {
    Log 'daily backup+publish starting'
    Set-Location 'C:\Users\Admin\Downloads\mainframe'
    $marker = 'C:\tmp\daily-backup-lastdate.txt'
    $today = Get-Date -Format 'yyyy-MM-dd'
    if (Test-Path $marker) {
        if ((Get-Content $marker -Raw).Trim() -eq $today) { Log 'already published today - skip'; exit 0 }
    }
    # vault must be unlocked for publish (session.key travels via backup)
    if (-not (Test-Path "$env:APPDATA\mainframe\accounts\bitwarden\session.key")) { throw 'vault locked (no session.key) - unlock needed for publish' }
    & .\backup.ps1 -ExcludeSecrets -Publish 2>&1 | ForEach-Object { Log "  $_" }
    if ($LASTEXITCODE -ne 0) { throw "backup.ps1 -Publish failed (exit $LASTEXITCODE)" }
    Set-Content -LiteralPath $marker -Value $today -Encoding UTF8
    Log 'daily backup+publish DONE'
} catch {
    Log "FATAL: $($_.Exception.Message)"
    exit 1
}
