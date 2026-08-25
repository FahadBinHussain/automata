# search f95zone.to threads with a logged-in session
# usage: .\search.ps1 -Query "some game" [-Pages 3] [-SearchId 6019586]
# prints thread title + URL per result. uses .session\cookies.json if valid else login.ps1.
#
# the search page URL pattern is /search/<searchid>/?q=<query>&o=relevance
# (the <searchid> number is a per-site constant, e.g. 6019586; change it if search breaks.)

param(
    [Parameter(Mandatory)][string]$Query,
    [int]$Pages = 1,
    [string]$SearchId = '6019586'
)

$ErrorActionPreference = 'Stop'
$scriptDir = $PSScriptRoot
$userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

$loginScript = Join-Path $scriptDir "login.ps1"
$session = & $loginScript

$q = [uri]::EscapeDataString($Query)
$seen = @{}
for ($p = 1; $p -le $Pages; $p++) {
    $pg = if ($p -eq 1) { "https://f95zone.to/search/$SearchId/?q=$q&o=relevance" } else { "https://f95zone.to/search/$SearchId/page-$p/?q=$q&o=relevance" }
    try {
        $resp = Invoke-WebRequest $pg -UseBasicParsing -TimeoutSec 25 -Headers @{'User-Agent'=$userAgent} -WebSession $session
        $hits = [regex]::Matches($resp.Content, 'href="(/threads/[^"]+)"', 'IgnoreCase') | ForEach-Object { $_.Groups[1].Value }
        foreach ($h in ($hits | Select-Object -Unique)) {
            if ($seen.ContainsKey($h)) { continue }
            $seen[$h] = $true
            "https://f95zone.to$h"
        }
    } catch { "page $p ERR: $($_.Exception.Message)" }
}
