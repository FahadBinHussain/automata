#!/usr/bin/env pwsh
# neon-export-bnp.ps1 - auto-export dailyBNP's Neon database when the free-tier
# compute quota resets. Reads a point-in-time branch snapshot, dumps via pg_dump.
#
# Context (2026-08-23): Daily-BNP (project PROJECT_ID_REDACTED, org
# ORG_ID_REDACTED, account ACCOUNT_EMAIL_REDACTED) burned 110/100 CU-h
# this period (08/01 -> 09/01) and the compute is SUSPENDED with 402. Storage is
# intact (44.8 MB). A storage-level branch snapshot was created at
# SNAPSHOT_BRANCH_REDACTED (LSN 0/81E8578) - branch creation is a storage-layer
# operation that works even when compute quota is exhausted.
#
# Once the period resets (consumption period_end 09/01/2026), this script:
#   1. waits for the compute quota gate to lift (consumption < limit)
#   2. creates an endpoint on the frozen branch (or reuses main)
#   3. pg_dumps the database to a timestamped .sql file
#   4. deletes the temp endpoint so it stops burning quota
#   5. prints the output path + size
#
# Exit codes: 0 = exported, 1 = not yet (quota still frozen, checked again later),
# 2 = auth/API failure, 3 = dump failed.
#
# Env overrides:
#   NEON_ACCOUNT (default ACCOUNT_EMAIL_REDACTED)
#   NEON_PROJECT_ID (default PROJECT_ID_REDACTED)
#   NEON_BRANCH_ID (default SNAPSHOT_BRANCH_REDACTED - the frozen snapshot branch;
#                   set to the main branch id to dump live instead)
#   NEON_ORG_ID (default ORG_ID_REDACTED)
#   NEON_DATABASE (default neondb)
#   NEON_ROLE (default neondb_owner)
#   NEON_OUT_DIR (default $env:USERPROFILE\Downloads\neon-exports)
#   NEON_QUOTA_THRESHOLD_CU_H (default 98 - export only once under this)
#
# Reads the Neon API key from the mainframe vault via vault-secret.psm1 (unlock
# the vault first, or set NEON_API_KEY).

[CmdletBinding()]
param(
    [switch]$Force       # skip the quota gate check and try anyway
)

$ErrorActionPreference = 'Stop'
$account     = if ($env:NEON_ACCOUNT)     { $env:NEON_ACCOUNT }     else { 'ACCOUNT_EMAIL_REDACTED' }
$projectId   = if ($env:NEON_PROJECT_ID)  { $env:NEON_PROJECT_ID }  else { 'PROJECT_ID_REDACTED' }
$branchId    = if ($env:NEON_BRANCH_ID)   { $env:NEON_BRANCH_ID }   else { 'SNAPSHOT_BRANCH_REDACTED' }
$orgId       = if ($env:NEON_ORG_ID)      { $env:NEON_ORG_ID }      else { 'ORG_ID_REDACTED' }
$database    = if ($env:NEON_DATABASE)    { $env:NEON_DATABASE }    else { 'neondb' }
$role        = if ($env:NEON_ROLE)        { $env:NEON_ROLE }        else { 'neondb_owner' }
$outDir      = if ($env:NEON_OUT_DIR)     { $env:NEON_OUT_DIR }     else { Join-Path $env:USERPROFILE 'Downloads\neon-exports' }
$threshold   = if ($env:NEON_QUOTA_THRESHOLD_CU_H) { [double]$env:NEON_QUOTA_THRESHOLD_CU_H } else { 98.0 }
$apiBase     = 'https://console.neon.tech/api/v2'

function Get-NeonApiKey {
    if ($env:NEON_API_KEY) { return $env:NEON_API_KEY.Trim() }
    $module = Join-Path '<user-home>\Downloads\mainframe' 'vault-secret.psm1'
    Import-Module $module -Force
    $k = Read-VaultSecret -Email $account -NamePattern 'console.neon.tech*' -ValueRegex 'napi_[A-Za-z0-9]+'
    if (-not $k) { throw "Neon API key not found for $account (vault locked?)" }
    return $k.Trim()
}

function Get-CurrentComputeSec {
    param([string]$ApiKey)
    $headers = @{ 'Authorization' = "Bearer $ApiKey"; 'Accept' = 'application/json' }
    $c = Invoke-RestMethod -Uri "$apiBase/organizations/$orgId/consumption" -Headers $headers
    $p = $c.periods | Select-Object -Last 1
    if (-not $p) { return @{ sec = 0; end = $null } }
    return @{ sec = [double]$p.compute_time; end = $p.period_end }
}

try {
    $apiKey = Get-NeonApiKey
} catch {
    Write-Host "AUTH ERR: $($_.Exception.Message)" -ForegroundColor Red
    exit 2
}

if (-not $Force) {
    $usage = Get-CurrentComputeSec -ApiKey $apiKey
    $cuUsed = [math]::Round($usage.sec / 3600, 2)
    Write-Host "current period compute: $cuUsed CU-h (limit 100, gate clears under $threshold); resets $($usage.end)" -ForegroundColor Gray
    if ($usage.sec -ge ($threshold * 3600)) {
        Write-Host "NOT EXPORTING - compute quota still frozen. Exiting (retry later)." -ForegroundColor Yellow
        exit 1
    }
}

$headers = @{ 'Authorization' = "Bearer $apiKey"; 'Accept' = 'application/json'; 'Content-Type' = 'application/json' }

# 1. ensure an endpoint exists on the target branch
$eps = (Invoke-RestMethod -Uri "$apiBase/projects/$projectId/endpoints" -Headers $headers).endpoints
$ep = $eps | Where-Object { $_.branch_id -eq $branchId -and $_.type -eq 'read_write' } | Select-Object -First 1
$createdEp = $false
if (-not $ep) {
    Write-Host "no endpoint on branch $branchId - creating one..." -ForegroundColor Cyan
    $body = @{ endpoint = @{ type = 'read_write'; branch_id = $branchId; autoscaling_limit_min_cu = 0.25; autoscaling_limit_max_cu = 0.25 } } | ConvertTo-Json -Depth 5
    $r = Invoke-WebRequest -Uri "$apiBase/projects/$projectId/endpoints" -Method Post -Headers $headers -Body $body -ContentType 'application/json' -UseBasicParsing -SkipHttpErrorCheck
    if ($r.StatusCode -notin 200, 201) {
        Write-Host "endpoint create failed: $($r.Content)" -ForegroundColor Red
        exit 2
    }
    $created = ($r.Content | ConvertFrom-Json).endpoint
    $ep = $created
    $createdEp = $true
    Start-Sleep -Seconds 5
}

# 2. get the connection string for the branch endpoint (pooled)
$conn = (Invoke-RestMethod -Uri "$apiBase/projects/$projectId/connection_uri?database_name=$database&branch_id=$branchId&role_name=$role" -Headers $headers).uri

# 3. pg_dump
if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) {
    Write-Host "pg_dump not found (scoop postgresql missing)" -ForegroundColor Red
    if ($createdEp) { Invoke-WebRequest -Uri "$apiBase/projects/$projectId/endpoints/$($ep.id)" -Method Delete -Headers $headers -UseBasicParsing -SkipHttpErrorCheck | Out-Null }
    exit 3
}
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outFile = Join-Path $outDir "dailybnp-$stamp.sql"
Write-Host "pg_dump -> $outFile" -ForegroundColor Cyan
$env:PGPASSWORD = ([regex]::Match($conn, '://[^:]+:([^@]+)@').Groups[1].Value)
$hostPart = ([regex]::Match($conn, '@([^/]+)/').Groups[1].Value)
$userPart = ([regex]::Match($conn, '://([^:]+):').Groups[1].Value)
& pg_dump --host $hostPart --username $userPart --dbname $database --format plain --no-owner --no-privileges --file $outFile 2>&1
$dumpRc = $LASTEXITCODE
Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue

# 4. cleanup temp endpoint
if ($createdEp) {
    Write-Host "deleting temp endpoint $($ep.id)..." -ForegroundColor Gray
    Invoke-WebRequest -Uri "$apiBase/projects/$projectId/endpoints/$($ep.id)" -Method Delete -Headers $headers -UseBasicParsing -SkipHttpErrorCheck | Out-Null
}

if ($dumpRc -ne 0 -or -not (Test-Path $outFile) -or (Get-Item $outFile).Length -eq 0) {
    Write-Host "pg_dump FAILED (rc=$dumpRc)" -ForegroundColor Red
    exit 3
}
$size = [math]::Round((Get-Item $outFile).Length / 1MB, 2)
Write-Host "EXPORT OK: $outFile ($size MB)" -ForegroundColor Green
exit 0
