# qBittorrent-via-Proton: keep BitTorrent egress working while Proton VPN is on
# purpose: resurrect/verify the mihomo socks relay that qBittorrent's SOCKS5 proxy
#          depends on, and report relay + qBittorrent health in one shot.
# usage:
#   .\relay-up.ps1            # resurrect if needed, verify, report
#   .\relay-up.ps1 -CheckOnly # just verify, don't touch anything
# notes:
#   - Proton's WFP driver blocks direct sockets; mihomo's socks port (7891) is
#     the allowed egress path qBittorrent is configured to use (see AGENTS.md)
#   - run this before/after adding torrents; a dead relay shows up as
#     "torrent stuck in metaDL / trackers status=4 timed out"

param(
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$coreExe = "$env:USERPROFILE\scoop\apps\v2rayn\current\bin\mihomo\mihomo.exe"
$cfgDir  = "$env:USERPROFILE\scoop\apps\v2rayn\current\binConfigs"
$cfgFile = Join-Path $cfgDir "config.json"
$socksPort = 7891
$ctrlPort  = 10813
$qbitPort  = 8080

function Test-Port($port) {
    return [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

Write-Host "=== qBittorrent-via-Proton relay check ==="

if (-not (Test-Path $coreExe)) { Write-Error "mihomo core not found at $coreExe"; exit 1 }
if (-not (Test-Path $cfgFile)) { Write-Error "mihomo config not found at $cfgFile"; exit 1 }

# 1. read the ACTUAL socks/controller ports from config (v2rayN regenerates it on restart)
$raw = Get-Content $cfgFile -Raw
$socksMatch = [regex]::Match($raw, 'socks-port:\s*(\d+)')
$ctrlMatch  = [regex]::Match($raw, 'external-controller:\s*127\.0\.0\.1:(\d+)')
if ($socksMatch.Success) { $socksPort = [int]$socksMatch.Groups[1].Value }
if ($ctrlMatch.Success)  { $ctrlPort  = [int]$ctrlMatch.Groups[1].Value }
Write-Host "config: socks=$socksPort controller=$ctrlPort"

$coreAlive = [bool](Get-Process mihomo -ErrorAction SilentlyContinue)
$socksUp   = Test-Port $socksPort
$ctrlUp    = Test-Port $ctrlPort
Write-Host "core process: $coreAlive | socks listener: $socksUp | controller: $ctrlUp"

if (-not ($coreAlive -and $socksUp -and $ctrlUp)) {
    if ($CheckOnly) { Write-Warning "relay DOWN (check only) - run without -CheckOnly to resurrect"; exit 1 }
    Write-Host "resurrecting mihomo core..."
    Get-Process mihomo -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force }
    Start-Sleep 2
    Start-Process -FilePath $coreExe -ArgumentList "-d", $cfgDir, "-f", $cfgFile -WindowStyle Hidden
    Start-Sleep -Seconds 8
}

# 2. force GLOBAL -> PROXY so torrent traffic egresses through a node, not DIRECT
if (Test-Port $ctrlPort) {
    try {
        Invoke-WebRequest -Uri "http://127.0.0.1:$ctrlPort/proxies/GLOBAL" -Method PUT `
            -ContentType "application/json" -Body '{"name":"PROXY"}' -TimeoutSec 10 -UseBasicParsing | Out-Null
        $now = (Invoke-RestMethod "http://127.0.0.1:$ctrlPort/proxies/GLOBAL" -TimeoutSec 10).now
        Write-Host "GLOBAL -> $now"
    } catch { Write-Warning "could not set GLOBAL selector: $($_.Exception.Message)" }
} else {
    Write-Warning "controller $ctrlPort not listening - GLOBAL selector not set"
}

# 3. egress probe through the socks port (real HTTPS request, not telnet)
try {
    $probe = Invoke-WebRequest -Uri "http://example.com" -Proxy "socks5://127.0.0.1:$socksPort" `
        -TimeoutSec 15 -UseBasicParsing -SkipHttpErrorCheck
    Write-Host "socks egress: HTTP $($probe.StatusCode)"
} catch { Write-Warning "socks egress FAILED: $($_.Exception.Message)"; exit 1 }

# 4. qBittorrent WebUI alive?
try {
    $v = (Invoke-WebRequest -Uri "http://127.0.0.1:$qbitPort/api/v2/app/version" -UseBasicParsing -TimeoutSec 8).Content
    Write-Host "qBittorrent WebUI: v$v"
} catch { Write-Warning "qBittorrent WebUI unreachable: $($_.Exception.Message)" }

Write-Host "=== relay OK ==="