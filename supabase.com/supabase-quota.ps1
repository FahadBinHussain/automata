# supabase quota checker (dashboard JWT path - reverse-engineered 2026-08-22)
# the Management API (PAT) exposes only DB disk/util + analytics/endpoints;
# egress/storage/MAU daily stats live behind /platform/* which requires a
# DASHBOARD session JWT. this script gets that JWT permanently via the gotrue
# refresh-token flow instead of a browser login every time.
#
# flow:
#   1. read the refresh token from the mainframe vault item "supabase.com"
#      ("Dashboard Session" section, format: <issuer>|<refresh_token>)
#   2. POST https://<issuer>/auth/v1/token?grant_type=refresh_token to get a
#      fresh access_token (30 min) - the response ROTATES the refresh token
#   3. GET /platform/projects/{ref}/daily-stats?attribute=<attr>&startDate&endDate
#      with the access token
#   4. write the ROTATED refresh token back to the vault (keeps the cycle alive)
#
# usage:
#   .\supabase-quota.ps1                        # egress table for the default ref
#   .\supabase-quota.ps1 -ProjectRef <ref>      # another project
#   .\supabase-quota.ps1 -Days 7                # lookback window
#   .\supabase-quota.ps1 -Raw                   # dump full attribute json
#
# vault: uses the mainframe vault-secret.psm1 (Bitwarden) - must be unlocked
# (automata\bitwarden.com\unlock.ps1 or BW_SESSION). email from .env.local (SUPABASE_EMAIL),
# never prints tokens.

param(
    [string]$ProjectRef = "",
    [int]$Days = 30,
    [string]$Email = "",
    [string]$OrgSlug = "",
    [switch]$RawJson,
    [switch]$AllProjectsFlag
)

# personal defaults from gitignored .env.local (see automata root AGENTS.md conventions)
$envLocal = Join-Path $PSScriptRoot '.env.local'
if (Test-Path -LiteralPath $envLocal) {
    Get-Content -LiteralPath $envLocal | ForEach-Object {
        if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
        }
    }
}
if (-not $ProjectRef) { $ProjectRef = $env:SUPABASE_PROJECT_REF }
if (-not $Email) { $Email = $env:SUPABASE_EMAIL }
if (-not $OrgSlug) { $OrgSlug = $env:SUPABASE_ORG_SLUG }

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$vaultModule = "<user-home>\Downloads\mainframe\vault-secret.psm1"
if (-not (Test-Path $vaultModule)) { throw "vault module not found at $vaultModule - is mainframe cloned?" }
Import-Module $vaultModule -Force

# 1. read refresh token + issuer from the vault
$vaultSession = Read-VaultSecret -Email $Email -NamePattern 'supabase.com' -ValueRegex 'alt\.supabase\.io\|\S+'
if (-not $vaultSession) { throw "no Dashboard Session (refresh token) in the supabase.com vault item - set it up via the agent-browser login flow first" }
$parts = $vaultSession -split '\|', 2
$issuer = $parts[0]
$refreshToken = $parts[1]

# 2. refresh -> access token (rotates refresh token)
$body = @{ grant_type = "refresh_token"; refresh_token = $refreshToken } | ConvertTo-Json
$h = @{ "Content-Type" = "application/json" }
$r = Invoke-WebRequest -Uri "https://$issuer/auth/v1/token?grant_type=refresh_token" -Method Post -Body $body -Headers $h -UseBasicParsing -SkipHttpErrorCheck -TimeoutSec 30
if ($r.StatusCode -ne 200) { throw "refresh failed HTTP $($r.StatusCode): $($r.Content.Substring(0, [Math]::Min(200, $r.Content.Length)))" }
$sess = $r.Content | ConvertFrom-Json

# 4. persist the ROTATED refresh token (write the new one back, keep issuer)
$newVal = "$issuer|$($sess.refresh_token)"
Write-VaultSecretToExisting -Email $Email -NamePattern 'supabase.com' -Header 'Dashboard Session' -Value $newVal -ItemName "supabase.com" -Username $Email -Uri 'https://supabase.com/dashboard' | Out-Null

# 3. query the daily-stats endpoints
$authH = @{ Authorization = "Bearer $($sess.access_token)"; Accept = "application/json" }
$end = (Get-Date).ToString('yyyy-MM-dd')
$start = (Get-Date).AddDays(-$Days).ToString('yyyy-MM-dd')

$attrs = @(
    'total_egress', 'total_rest_egress', 'total_storage_egress',
    'total_realtime_egress', 'total_auth_egress', 'total_cached_egress',
    'total_supavisor_egress_bytes', 'total_auth_billing_period_mau'
)

function Get-Attr([string]$attr) {
    $u = "https://api.supabase.com/platform/projects/$ProjectRef/daily-stats?attribute=$attr&startDate=$start&endDate=$end"
    try {
        $resp = Invoke-RestMethod -Uri $u -Headers $authH -TimeoutSec 30
        return $resp
    } catch {
        return @{ error = $_.Exception.Message }
    }
}

$results = @{}
foreach ($a in $attrs) { $results[$a] = Get-Attr $a; Start-Sleep -Milliseconds 250 }

if ($RawJson) {
    $results | ConvertTo-Json -Depth 5
    exit 0
}

"supabase egress check - project $ProjectRef ($start .. $end)"
"--------------------------------------------------------"
foreach ($a in $attrs) {
    $v = $results[$a]
    $total = if ($v.total -is [double] -or $v.total -is [int64] -or $v.total -is [int]) { $v.total } else { 0 }
    $fmt = [string]$v.format
    if ($fmt -eq "bytes") {
        $mb = [Math]::Round($total / 1MB, 1)
        "  {0,-34} {1,10} MB" -f $a, $mb
    } else {
        "  {0,-34} {1}" -f $a, $total
    }
}
$eg = [Math]::Round($results['total_egress'].total / 1MB, 1)
$pct = [Math]::Round($eg / 5120 * 100, 1)   # 5 GB free = 5120 MB
"  {0,-34} {1} %" -f 'free egress used (of 5 GB)', $pct
"  refresh token rotated + saved back to vault"
