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
#      (old token is immediately invalid; crash before step 3 orphans it)
#   3. write the ROTATED refresh token back to the vault (keeps the cycle alive)
#   4. GET /platform/projects/{ref}/daily-stats?attribute=<attr>&startDate&endDate
#      with the access token
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
# gotrue invalidates the old token immediately; if this process dies before
# step 3 (vault save) the stored token is dead and the next run gets
# 400 refresh_token_already_used. keep the error actionable.
$body = @{ grant_type = "refresh_token"; refresh_token = $refreshToken } | ConvertTo-Json
$h = @{ "Content-Type" = "application/json" }
$r = Invoke-WebRequest -Uri "https://$issuer/auth/v1/token?grant_type=refresh_token" -Method Post -Body $body -Headers $h -UseBasicParsing -SkipHttpErrorCheck -TimeoutSec 30
if ($r.StatusCode -ne 200) {
    $body_text = $r.Content.ToString()
    if ($body_text -match 'refresh_token_already_used') {
        throw "dashboard session expired (refresh_token_already_used) - the stored refresh token was already consumed (previous run crashed between refresh and vault save). re-login: agent-browser open https://supabase.com/dashboard/sign-in, sign in as $Email, then run: agent-browser eval ""localStorage.getItem('supabase.dashboard.auth.token')"" and save the refresh_token as Dashboard Session ($issuer|<refresh_token>) in the supabase.com vault item. details: HTTP $($r.StatusCode): $($body_text.Substring(0, [Math]::Min(200, $body_text.Length)))"
    }
    throw "refresh failed HTTP $($r.StatusCode): $($body_text.Substring(0, [Math]::Min(200, $body_text.Length)))"
}
$sess = $r.Content | ConvertFrom-Json

# 3. persist the ROTATED refresh token (write the new one back, keep issuer)
# save BEFORE querying daily-stats so a later failure doesn't orphan the rotation
$newVal = "$issuer|$($sess.refresh_token)"
Write-VaultSecretToExisting -Email $Email -NamePattern 'supabase.com' -Header 'Dashboard Session' -Value $newVal -ItemName "supabase.com" -Username $Email -Uri 'https://supabase.com/dashboard' | Out-Null

# 4. query the daily-stats endpoints
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
# free egress: total_egress has been 0 every day since project creation
# (2026-08-20); actual DB egress is in total_supavisor_egress_bytes (pooler).
# use the max of the two so neither path under-reports. 5 GB free = 5120 MB.
$egTotal = 0
foreach ($k in @('total_egress', 'total_supavisor_egress_bytes')) {
    $v = $results[$k]
    if ($v -and ($v.total -is [double] -or $v.total -is [int64] -or $v.total -is [int])) {
        if ($v.total -gt $egTotal) { $egTotal = $v.total }
    }
}
$eg = [Math]::Round($egTotal / 1MB, 1)
$pct = [Math]::Round($eg / 5120 * 100, 1)
"  {0,-34} {1} %" -f 'free egress used (of 5 GB)', $pct
if ($results['total_supavisor_egress_bytes'].total -gt $results['total_egress'].total) {
    "  (source: supavisor/pooler egress; total_egress was 0 - dashboard counts pooler toward the 5 GB cap)"
}
"  refresh token rotated + saved back to vault"
