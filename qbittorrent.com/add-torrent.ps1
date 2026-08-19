# qBittorrent torrent add helper
# purpose: add a magnet/.torrent URL to qBittorrent and start it, headless via the Web API
# inputs:  -Url  magnet: URI or http(s) .torrent URL (required)
#          -Paused  add paused instead of starting (default: false/start)
#          -WebUiPort  qBittorrent Web UI port (default 8080)
# run:     powershell -File add-torrent.ps1 -Url "magnet:?xt=urn:btih:..."
# deps:    qBittorrent installed via scoop (profile layout assumed) or standard %APPDATA%
# notes:   full workflow/gotchas in AGENTS.md in this folder

param(
    [Parameter(Mandatory = $true)][string]$Url,
    [switch]$Paused,
    [int]$WebUiPort = 8080
)

$ErrorActionPreference = 'Stop'
$baseUrl = "http://localhost:$WebUiPort"

$scoopProfile = "C:\Users\<user>\scoop\persist\qbittorrent\profile"
$scoopExe = "C:\Users\<user>\scoop\apps\qbittorrent\current\qbittorrent.exe"
$iniPath = Join-Path $scoopProfile "qBittorrent\config\qBittorrent.ini"

function Test-WebUi {
    try {
        $r = Invoke-WebRequest -Uri "$baseUrl/api/v2/app/version" -TimeoutSec 4 -UseBasicParsing
        return $true
    } catch {
        return $false
    }
}

function Ensure-QbitRunning {
    if (-not (Get-Process qbittorrent -ErrorAction SilentlyContinue)) {
        Write-Host "[add-torrent] qBittorrent not running - starting it"
        $args = @()
        if (Test-Path $scoopExe) { $args += "--profile=$scoopProfile" }
        Start-Process -FilePath $scoopExe -ArgumentList $args -WindowStyle Normal
        Start-Sleep -Seconds 10
    }
}

function Set-WebUiCreds {
    # qBittorrent 5.x refuses to start WebUI with "Credentials are not set".
    # generate a random password as PBKDF2-HMAC-SHA512 (iterations:base64salt:base64hash)
    $pw = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 16 | ForEach-Object { [char]$_ })
    $code = @"
import hashlib, base64
password = b"$pw"
salt = base64.b64decode("c2FsdHNhbHRzYWx0c2FsdA==")
dk = hashlib.pbkdf2_hmac("sha512", password, salt, 100000)
print(f"100000:{base64.b64encode(salt).decode()}:{base64.b64encode(dk).decode()}")
"@
    $tmp = Join-Path $env:TEMP "qbt-pbkdf.py"
    Set-Content -Path $tmp -Value $code -Encoding utf8
    $hash = (python $tmp).Trim()
    Remove-Item $tmp -Force

    $content = Get-Content $iniPath -Raw
    if ($content -notmatch 'WebUI\\Enabled') { $content += "`nWebUI\Enabled=true" }
    if ($content -notmatch 'WebUI\\LocalHostAuth') { $content += "`nWebUI\LocalHostAuth=false" }
    if ($content -notmatch 'WebUI\\Port') { $content += "`nWebUI\Port=$WebUiPort" }
    if ($content -notmatch 'WebUI\\Username') { $content += "`nWebUI\Username=admin" }
    if ($content -notmatch 'WebUI\\Password_PBKDF2') { $content += "`nWebUI\Password_PBKDF2=$hash" }
    Set-Content -Path $iniPath -Value $content -Encoding ascii -NoNewline
    Write-Host "[add-torrent] WebUI configured (user: admin, new random password written to qBittorrent.ini)"
}

function Restart-Qbit {
    Stop-Process -Name qbittorrent -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
    Ensure-QbitRunning
    Start-Sleep -Seconds 5
}

# 1. make sure qBittorrent is running
Ensure-QbitRunning

# 2. make sure WebUI is reachable; fix config and restart if not
$attempts = 0
while (-not (Test-WebUi) -and $attempts -lt 3) {
    if (-not (Test-Path $iniPath)) {
        Write-Error "qBittorrent config not found at $iniPath - cannot enable WebUI automatically"
    }
    Write-Host "[add-torrent] WebUI not reachable - enabling it in config"
    Set-WebUiCreds
    Restart-Qbit
    $attempts++
}
if (-not (Test-WebUi)) { Write-Error "WebUI still not reachable after 3 attempts" }

# 3. add the torrent
$body = @{ urls = $Url; paused = if ($Paused) { 'true' } else { 'false' } }
$add = Invoke-RestMethod -Uri "$baseUrl/api/v2/torrents/add" -Method Post -Body $body -ContentType 'application/x-www-form-urlencoded' -TimeoutSec 30
Write-Host "[add-torrent] add result: success=$($add.success_count) failures=$($add.failure_count)"

# 4. apply sequential + first/last-piece download (user default for all torrents)
#    note: ini SeqDL/FLPPieces defaults are NOT applied to WebAPI adds on 5.2.1,
#    so set explicitly after every add (2026-08-18)
if ($add.success_count -gt 0) {
    $hash = ($Url -replace '^magnet:\?xt=urn:btih:', '') -split '&' | Select-Object -First 1
    if ($hash) {
        $info = Invoke-RestMethod -Uri "$baseUrl/api/v2/torrents/info?hashes=$hash" -TimeoutSec 10
        if ($info -and $info[0].seq_dl -eq $false) {
            Invoke-RestMethod -Uri "$baseUrl/api/v2/torrents/toggleSequentialDownload" -Method Post -Body @{ hashes = $hash } -TimeoutSec 10 | Out-Null
        }
        if ($info -and $info[0].f_l_piece_prio -eq $false) {
            Invoke-RestMethod -Uri "$baseUrl/api/v2/torrents/toggleFirstLastPiecePrio" -Method Post -Body @{ hashes = $hash } -TimeoutSec 10 | Out-Null
        }
        Write-Host "[add-torrent] seq_dl + first_last_piece_prio ensured"
    }
}

# 5. report status
Start-Sleep -Seconds 4
$hash = ($Url -replace '^magnet:\?xt=urn:btih:', '') -split '&' | Select-Object -First 1
if ($add.success_count -gt 0 -and $hash) {
    $info = Invoke-RestMethod -Uri "$baseUrl/api/v2/torrents/info?hashes=$hash" -TimeoutSec 10
    if ($info) {
        $i = $info[0]
        Write-Host "[add-torrent] $($i.name) | state=$($i.state) | progress=$([math]::Round($i.progress * 100, 1))% | save=$($i.save_path)"
    }
}