# f95zone.to XenForo login flow
# reads creds from .env.local (F95ZONE_USER, F95ZONE_PASS) or -Username/-Password
# saves session cookies to .session\cookies.json (.gitignore'd)
# usage: .\login.ps1 [-Username u] [-Password p] [-Force]
# on success prints account menu username + csrf token

param(
    [string]$Username,
    [string]$Password,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$scriptDir = $PSScriptRoot
$sessionFile = Join-Path $scriptDir ".session" "cookies.json"
$userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

# read .env.local
$envLocal = Join-Path $scriptDir ".env.local"
if (Test-Path $envLocal) {
    foreach ($line in Get-Content $envLocal) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2].Trim().Trim('"', "'"), "Process")
        }
    }
}

if (-not $Username) { $Username = $env:F95ZONE_USER }
if (-not $Password) { $Password = $env:F95ZONE_PASS }

# try loaded session
if (-not $Force -and (Test-Path $sessionFile)) {
    try {
        $saved = Get-Content $sessionFile -Raw | ConvertFrom-Json
        $dummy = New-Object Microsoft.PowerShell.Commands.WebRequestSession
        foreach ($c in $saved.cookies) {
            $ck = New-Object System.Net.Cookie($c.name, $c.value, $c.path, $c.domain)
            $dummy.Cookies.Add($ck)
        }
        $verify = Invoke-WebRequest "https://f95zone.to/account/" -UseBasicParsing -TimeoutSec 15 -Headers @{'User-Agent'=$userAgent} -WebSession $dummy
        if ($verify.Content -match 'data-logged-in="true"') {
            Write-Host "session valid (from $sessionFile)"
            $dummy
            return
        }
    } catch { Write-Host "stored session expired, re-logging in" }
}

if (-not $Username -or -not $Password) { throw "no f95zone creds - set F95ZONE_USER/F95ZONE_PASS in .env.local or pass -Username/-Password" }

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$r = Invoke-WebRequest "https://f95zone.to/login" -UseBasicParsing -TimeoutSec 20 -Headers @{'User-Agent'=$userAgent} -WebSession $session
$c = $r.Content
$m = [regex]::Match($c, 'name="_xfToken"\s+value="([^"]+)"')
if (-not $m.Success) { throw "could not find _xfToken on login page" }
$token = $m.Groups[1].Value

$body = @{ login = $Username; password = $Password; remember = '1'; _xfToken = $token }
$loginResp = Invoke-WebRequest "https://f95zone.to/login/login" -Method Post -Body $body -UseBasicParsing -TimeoutSec 25 -Headers @{'User-Agent'=$userAgent;'Accept'='application/json, text/javascript, */*; q=0.01';'X-Requested-With'='XMLHttpRequest';'Referer'='https://f95zone.to/login'} -WebSession $session

if ($loginResp.Content -notmatch 'data-logged-in="true"') { throw "login failed - data-logged-in not true" }

# verify
$verify = Invoke-WebRequest "https://f95zone.to/account/" -UseBasicParsing -TimeoutSec 15 -Headers @{'User-Agent'=$userAgent} -WebSession $session
if ($verify.Content -notmatch 'data-logged-in="true"') { throw "login verification failed" }

# extract csrf from body
$csrf = [regex]::Match($verify.Content, 'data-csrf="([^"]+)"').Groups[1].Value

# save session cookies
$cookies = $session.Cookies.GetCookies('https://f95zone.to') | ForEach-Object { @{ name = $_.Name; value = $_.Value; path = $_.Path; domain = $_.Domain } }
$sessionDir = [System.IO.Path]::GetDirectoryName($sessionFile)
if (-not (Test-Path $sessionDir)) { New-Item -ItemType Directory -Path $sessionDir -Force | Out-Null }
@{ logged_in = $true; csrf = $csrf; cookies = $cookies } | ConvertTo-Json -Depth 10 | Set-Content $sessionFile -Encoding utf8

Write-Host "logged in (f95zone.to); csrf=$csrf"
$session | Write-Output