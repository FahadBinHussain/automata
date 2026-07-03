# Upload WhatsApp session to Murmur's Neon database
# Usage:
#   .\upload-session.ps1                              # uses default store path
#   .\upload-session.ps1 -StorePath "C:\custom\path"  # custom store path
# Requires: DATABASE_URL env var (Neon connection string)

param(
    [string]$StorePath = "$env:APPDATA\mainframe\accounts\whatsapp\<your-phone-number>\store"
)

$ErrorActionPreference = "Stop"

if (-not $env:DATABASE_URL) {
    Write-Host "ERROR: set DATABASE_URL env var with your Neon connection string" -ForegroundColor Red
    exit 1
}

$sessionPath = Join-Path $StorePath "session.db"
$wacliPath = Join-Path $StorePath "wacli.db"

if (-not (Test-Path $sessionPath)) {
    Write-Host "ERROR: session.db not found at $sessionPath" -ForegroundColor Red
    exit 1
}

$sessionBytes = [System.IO.File]::ReadAllBytes($sessionPath)
Write-Host "session.db: $($sessionBytes.Length) bytes" -ForegroundColor Cyan

$wacliBytes = @()
if (Test-Path $wacliPath) {
    $wacliBytes = [System.IO.File]::ReadAllBytes($wacliPath)
    Write-Host "wacli.db:   $($wacliBytes.Length) bytes" -ForegroundColor Cyan
} else {
    Write-Host "wacli.db:   not found (skipping)" -ForegroundColor Yellow
}

$sessionHex = ($sessionBytes | ForEach-Object { $_.ToString("x2") }) -join ""
$wacliHex = if ($wacliBytes.Length -gt 0) { ($wacliBytes | ForEach-Object { $_.ToString("x2") }) -join "" } else { "" }

$sql = @"
INSERT INTO whatsapp_sessions (id, session_data, wacli_data, updated_at)
VALUES ('default', decode('$sessionHex', 'hex'), $(if ($wacliHex) { "decode('$wacliHex', 'hex')" } else { "NULL" }), NOW())
ON CONFLICT (id) DO UPDATE SET
    session_data = decode('$sessionHex', 'hex'),
    wacli_data = $(if ($wacliHex) { "decode('$wacliHex', 'hex')" } else { "NULL" }),
    updated_at = NOW();
"@

Write-Host "`nUploading to Neon..." -ForegroundColor Green
$sql | psql $env:DATABASE_URL 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "Done! Session uploaded to Neon." -ForegroundColor Green
    Write-Host "Restart the HF Space to pick up the new session:" -ForegroundColor Yellow
    Write-Host "  hf spaces restart <hf-username>/murmur" -ForegroundColor White
} else {
    Write-Host "Upload failed (exit code $LASTEXITCODE)" -ForegroundColor Red
}
