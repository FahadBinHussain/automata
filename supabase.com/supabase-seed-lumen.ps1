# supabase-lumen seed (2026-08-23) - bootstrap lumen's app_state table from the
# local vault.
#
# lumen's supabase watcher reads per-account refresh tokens from its OWN Neon
# app_state table (NOT vaultwarden - vaultwarden items are encrypted and can't
# be decrypted by a machine without the master password). this script does the
# one-time bootstrap: reads the supabase refresh token from the local vault and
# writes it into lumen's Neon app_state table. after this, lumen owns the row
# and rotates the token itself; no further sync needed.
#
# new accounts: add their login to the vault, re-run this script with
# -ProjectRef, it writes the new row.
#
# usage:
#   .\supabase-seed-lumen.ps1                               # seed the default ref
#   .\supabase-seed-lumen.ps1 -ProjectRef <new-ref>         # seed another account
#   .\supabase-seed-lumen.ps1 -DatabaseUrl <dsn>            # explicit lumen DSN
#   .\supabase-seed-lumen.ps1 -List                         # list what's in app_state
#
# database url: read from lumen's Render env (the persistence Neon DB) - supply
# via -DatabaseUrl, or set LUMEN_DATABASE_URL / supabase.com/.env.local. never
# commit it.

param(
    [string]$ProjectRef = "<project-ref>",
    [string]$Email = "<user>@example.com",
    [string]$DatabaseUrl = "",
    [switch]$List
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$vaultModule = "<user-home>\Downloads\mainframe\vault-secret.psm1"
if (-not (Test-Path $vaultModule)) { throw "vault module not found at $vaultModule" }
Import-Module $vaultModule -Force

# database url resolution: -DatabaseUrl > LUMEN_DATABASE_URL > .env.local
if (-not $DatabaseUrl) { $DatabaseUrl = $env:LUMEN_DATABASE_URL }
if (-not $DatabaseUrl) {
    $envLocal = Join-Path $PSScriptRoot ".env.local"
    if (Test-Path $envLocal) {
        foreach ($line in Get-Content $envLocal) {
            if ($line -match '^\s*LUMEN_DATABASE_URL=(.*)$') {
                $DatabaseUrl = $Matches[1].Trim().Trim('"', "'")
            }
        }
    }
}
if (-not $DatabaseUrl) { throw "no lumen database url - pass -DatabaseUrl or set LUMEN_DATABASE_URL" }

function Invoke-Sql([string]$sql) {
    $uri = [uri]$DatabaseUrl
    $env:PGPASSWORD = ($uri.UserInfo -split ':', 2)[1]
    $port = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
    $db = $uri.AbsolutePath.TrimStart('/')
    $user = ($uri.UserInfo -split ':', 2)[0]
    $pg = Get-Command psql -ErrorAction SilentlyContinue
    if (-not $pg) { throw "psql not found (scoop postgresql)" }
    & $pg.Source -h $uri.Host -p $port -U $user -d $db -v ON_ERROR_STOP=1 -c $sql 2>&1
    if ($LASTEXITCODE -ne 0) { throw "psql failed: $sql" }
}

if ($List) {
    Invoke-Sql "CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());" | Out-Null
    "app_state contents:"
    Invoke-Sql "SELECT key, substring(value, 1, 12) AS value_prefix, updated_at FROM app_state ORDER BY key;" | Out-String
    exit 0
}

# read the supabase refresh token from the vault
$vaultSession = Read-VaultSecret -Email $Email -NamePattern 'supabase.com' -ValueRegex 'alt\.supabase\.io\|\S+'
if (-not $vaultSession) { throw "no Dashboard Session (refresh token) in the supabase.com vault item - run the agent-browser login flow first" }
$parts = $vaultSession -split '\|', 2
$issuer = $parts[0]
$refreshToken = $parts[1]

# ensure the app_state table exists, then upsert the account rows
"seeding supabase ref '$ProjectRef' into lumen app_state..."
Invoke-Sql "CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());" | Out-Null
Invoke-Sql "INSERT INTO app_state (key, value, updated_at) VALUES ('supabase.$ProjectRef.issuer', '$issuer', NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();" | Out-Null
Invoke-Sql "INSERT INTO app_state (key, value, updated_at) VALUES ('supabase.$ProjectRef.refresh_token', '$refreshToken', NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();" | Out-Null

"seeded. rows:"
Invoke-Sql "SELECT key, substring(value, 1, 12) AS value_prefix, updated_at FROM app_state WHERE key LIKE 'supabase.$ProjectRef.%' ORDER BY key;" | Out-String