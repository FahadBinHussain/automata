# Search Bitwarden secure notes by title
# Usage: .\find-note.ps1 <search-term>
# Requires unlocked session (run unlock.ps1 first or set BW_SESSION)

param(
    [Parameter(Mandatory=$true)]
    [string]$Search
)

$sessionFile = "$env:APPDATA\mainframe\accounts\bitwarden\session.key"
if (Test-Path $sessionFile) {
    $env:BW_SESSION = Get-Content $sessionFile -Raw
}

if (-not $env:BW_SESSION) {
    Write-Host "No session. Run unlock.ps1 first."
    exit 1
}

$items = bw list items --search $Search --session $env:BW_SESSION 2>&1 | ConvertFrom-Json

if (-not $items -or $items.Count -eq 0) {
    Write-Host "No matches for '$Search'"
    exit 1
}

foreach ($item in $items) {
    Write-Host "=== $($item.name) ==="
    Write-Host "ID: $($item.id)"
    Write-Host "Type: $($item.type)"
    if ($item.notes) {
        Write-Host "Notes:"
        Write-Host $item.notes
    }
    if ($item.login) {
        Write-Host "Login: $($item.login.username)"
        Write-Host "Password: $($item.login.password)"
    }
    Write-Host ""
}
