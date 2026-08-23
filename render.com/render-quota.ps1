# render resource usage checker (reverse-engineered 2026-08-23)
# checks CPU, memory, and bandwidth usage for a Render web service via
# the dashboard GraphQL API (not the REST API key, which cannot access
# metrics). uses the email+password login mutation (signIn) to get a fresh
# idToken EVERY time - no 8-day expiry problem, no browser needed.
#
# flow:
#   1. read the password from the mainframe vault item "dashboard.render.com"
#      (the login item for <user>@example.com)
#   2. call signIn GraphQL mutation on api.render.com/graphql ->
#      fresh idToken (never stale)
#   3. query metrics for CPU, MEMORY_RSS, MEMORY_LIMIT, CPU_LIMIT, etc.
#   4. print usage vs free-tier limits (CPU 0.1, RAM 512 MB)
#
# usage:
#   .\render-quota.ps1
#   .\render-quota.ps1 -ServiceId <id>   # check another service
#   .\render-quota.ps1 -RawJson           # dump full metric json
#
# vault: uses the mainframe vault-secret.psm1 (Bitwarden) - must be unlocked.
# email default <user>@example.com (lumen service owner), override with -Email.
# the password is stored in the vault item "dashboard.render.com" (login item).
# no session token needs to be stored or refreshed - the script logs in fresh
# every run.

param(
    [string]$ServiceId = "<service-id>",
    [string]$Email = "<user>@example.com",
    [int]$Hours = 6,
    [switch]$RawJson
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$vaultModule = "<user-home>\Downloads\mainframe\vault-secret.psm1"
if (-not (Test-Path $vaultModule)) { throw "vault module not found at $vaultModule" }
Import-Module $vaultModule -Force

# 1. read the password from the vault login item
$items = Get-VaultItems | Where-Object { $_.name -eq "dashboard.render.com" -and $_.login.username -eq $Email }
if (-not $items) { throw "no vault item 'dashboard.render.com' with email $Email - add it first" }
$password = $items.login.password
if (-not $password) { throw "no password in the vault item - check the login credentials" }

# 2. call signIn mutation to get a fresh idToken
$signInQuery = 'mutation signIn($email: String!, $password: String!) { signIn(email: $email, password: $password) { idToken expiresAt user { id email } } }'
$signInBody = @{ operationName = 'signIn'; variables = @{ email = $Email; password = $password }; query = $signInQuery } | ConvertTo-Json -Depth 6

try {
    $r = Invoke-WebRequest -Uri 'https://api.render.com/graphql' -Method Post -Body $signInBody -Headers @{ 'Content-Type' = 'application/json' } -UseBasicParsing -SkipHttpErrorCheck -TimeoutSec 20
    $txt = if ($r.Content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($r.Content) } else { [string]$r.Content }
    $parsed = $txt | ConvertFrom-Json
    if ($parsed.errors) { throw "signIn failed: $($parsed.errors[0].message)" }
    $idToken = $parsed.data.signIn.idToken
    $expiresAt = $parsed.data.signIn.expiresAt
} catch {
    throw "signIn mutation failed: $($_.Exception.Message)"
}

$end = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$start = (Get-Date).AddHours(-$Hours).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")

$queryGql = 'query metrics($query: MetricsQueryInput!) { metrics(query: $query) { series { unit labels { field value } values { time value } } } }'

$metricNames = @('CPU', 'MEMORY_RSS', 'MEMORY', 'CPU_LIMIT', 'MEMORY_LIMIT', 'ENRICHED_BANDWIDTH')

$results = @{}
foreach ($name in $metricNames) {
    $body = @{
        operationName = 'metrics'
        variables = @{
            query = @{
                filters = @(@{ field = 'RESOURCE'; values = @($ServiceId) })
                start = $start; end = $end; name = $name
                resolution = 3600; parameters = @(); aggregateBy = @()
                aggregationMethod = 'NONE'
            }
        }
        query = $queryGql
    } | ConvertTo-Json -Depth 10

    try {
        $r = Invoke-WebRequest -Uri 'https://api.render.com/graphql' -Method Post -Body $body -Headers @{ Authorization = "Bearer $idToken"; 'Content-Type' = 'application/json' } -UseBasicParsing -SkipHttpErrorCheck -TimeoutSec 20
        $txt = if ($r.Content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($r.Content) } else { [string]$r.Content }
        $parsed = $txt | ConvertFrom-Json
        if ($parsed.errors) {
            $results[$name] = @{ error = $parsed.errors[0].message }
        } else {
            $results[$name] = $parsed.data.metrics
        }
    } catch {
        $results[$name] = @{ error = $_.Exception.Message }
    }
    Start-Sleep -Milliseconds 300
}

if ($RawJson) {
    $results | ConvertTo-Json -Depth 6
    exit 0
}

"render resource usage - service $ServiceId (last ${Hours}h)"
"--------------------------------------------------------"
$freeMemMB = 512
$freeCpu = 0.1

$cpu = $results['CPU']
$cpuRss = if ($cpu -and $cpu.series -and $cpu.series[0] -and $cpu.series[0].values -and $cpu.series[0].values[0]) { $cpu.series[0].values[0].value } else { $null }
$cpuLimit = $results['CPU_LIMIT']
$cpuLim = if ($cpuLimit -and $cpuLimit.series -and $cpuLimit.series[0] -and $cpuLimit.series[0].values -and $cpuLimit.series[0].values[0]) { $cpuLimit.series[0].values[0].value } else { $null }

$mem = $results['MEMORY_RSS']
$memRss = if ($mem -and $mem.series -and $mem.series[0] -and $mem.series[0].values -and $mem.series[0].values[0]) { $mem.series[0].values[0].value } else { $null }
$memLimit = $results['MEMORY_LIMIT']
$memLim = if ($memLimit -and $memLimit.series -and $memLimit.series[0] -and $memLimit.series[0].values -and $memLimit.series[0].values[0]) { $memLimit.series[0].values[0].value } else { $null }

$bw = $results['ENRICHED_BANDWIDTH']
$bwEgress = 0; $bwIngress = 0
if ($bw -and $bw.series) {
    foreach ($s in $bw.series) {
        $dir = ($s.labels | Where-Object { $_.field -eq 'TRAFFIC_DIRECTION' } | Select-Object -First 1).value
        $total = ($s.values | Measure-Object -Property value -Sum).Sum
        if ($dir -eq 'egress') { $bwEgress += $total }
        elseif ($dir -eq 'ingress') { $bwIngress += $total }
    }
}

if ($cpuRss -ne $null) {
    $pct = [Math]::Round($cpuRss / $freeCpu * 100, 1)
    "  CPU usage:                {0,8} ({1}%)" -f [Math]::Round($cpuRss, 4), $pct
} else { "  CPU usage:                n/a" }
if ($cpuLim -ne $null) {
    "  CPU limit (free):         {0,8}" -f $cpuLim
} else { "  CPU limit:                n/a" }

if ($memRss -ne $null) {
    $mb = [Math]::Round($memRss / 1MB, 1)
    $pctMem = [Math]::Round($mb / $freeMemMB * 100, 1)
    "  Memory RSS:               {0,8} MB ({1}%)" -f $mb, $pctMem
} else { "  Memory RSS:               n/a" }
if ($memLim -ne $null) {
    "  Memory limit (free):      {0,8} MB" -f [Math]::Round($memLim / 1MB, 0)
} else { "  Memory limit:             n/a" }

"  Bandwidth egress:         {0,8} MB" -f [Math]::Round($bwEgress, 1)
"  Bandwidth ingress:        {0,8} MB" -f [Math]::Round($bwIngress, 1)
"  (free Render has no bandwidth cap for web services)"