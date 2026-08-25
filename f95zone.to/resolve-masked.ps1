# resolve f95zone.to /masked/... links to the real host URL
# usage: .\resolve-masked.ps1 -Url "https://f95zone.to/masked/gofile.io/..." [-Url "..."] ...
# uses the session from .session\cookies.json (see login.ps1) - reuses it if valid, else logs in.
# prints "REAL: <url>" per masked link. needs the logged-in session.

param(
    [Parameter(Mandatory)][string[]]$Url
)

$ErrorActionPreference = 'Stop'
$scriptDir = $PSScriptRoot
$userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

# get a valid session
$loginScript = Join-Path $scriptDir "login.ps1"
$session = & $loginScript

foreach ($u in $Url) {
    if ($u -notmatch '/masked/') { "skip (not masked): $u"; continue }
    try {
        $resp = Invoke-WebRequest $u -Method Post -Body @{ xhr = '1'; download = '1' } -UseBasicParsing -TimeoutSec 25 -Headers @{'User-Agent'=$userAgent;'Accept'='application/json, text/javascript, */*; q=0.01';'X-Requested-With'='XMLHttpRequest'} -WebSession $session
        $j = $resp.Content | ConvertFrom-Json
        if ($j.status -eq 'ok') { "REAL: $($j.msg)" }
        else { "STATUS: $($j.status) msg=$($j.msg)" }
    } catch { "ERR: $u -> $($_.Exception.Message)" }
}
