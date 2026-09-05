#requires -Version 7.0
<#
.SYNOPSIS
x.com-profile-scrape.ps1 — anonymous X (Twitter) profile scraper, no login, no API key.

.DESCRIPTION
X serves real profile metadata to logged-out visitors in the page title +
og:description meta (followers, following, join date). This script fetches the
profile URL anonymously and parses those. It cannot read tweets - profile
metadata only. This is the ONLY anonymous channel; /i/api GraphQL and
cdn.syndication.twimg.com/widgets/followbutton/info.json are login-gated or
dead (verified 2026-09-05).

.USAGE
pwsh x.com-profile-scrape.ps1 -Handle fahad072001

.OUTPUT
exit 0 + parsed profile object; exit 1 with loud error on bot wall or missing og tags.
#>
param(
    [Parameter(Mandatory)][string]$Handle
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
$url = "https://x.com/$Handle"

# 403/429 blips get 3 same-method attempts (no fallbacks)
$html = $null
for ($i = 1; $i -le 3; $i++) {
    $tmp = New-TemporaryFile
    try {
        $code = & curl.exe -s --compressed -A $UA --max-time 30 -o $tmp.FullName -w '%{http_code}' -L --max-redirs 5 $url
        if ($code -match '^(200|301|302)$') { $html = Get-Content $tmp.FullName -Raw -Encoding utf8; break }
        if ($i -lt 3) { Start-Sleep -Seconds (2 * ($i + 1)) }
    } finally {
        Remove-Item $tmp.FullName -Force -ErrorAction SilentlyContinue
    }
}

if (-not $html) {
    Write-Error "X returned HTTP $code for $url - bot wall is up, anonymous scrape failed. Loud failure, no fallback."
    exit 1
}

# ownership check: handle must appear in the served page
if ($html -notmatch [regex]::Escape($Handle)) {
    Write-Error "ownership check failed: '$Handle' not found in response for $url - page may not belong to this account"
    exit 1
}

$title = if ($html -match '<title>([^<]+)</title>') { $matches[1].Trim() } else { $null }
$ogDesc = if ($html -match 'property="og:description" content="([^"]+)"') { $matches[1].Trim() } else { $null }

if (-not $ogDesc) {
    Write-Error "og:description missing for $url - X changed the logged-out page shape; scraper needs updating"
    exit 1
}

$followers = if ($ogDesc -match '([\d.,]+[KM]?) followers') { $matches[1] } else { $null }
$following = if ($ogDesc -match '([\d.,]+[KM]?) following') { $matches[1] } else { $null }
$joined    = if ($ogDesc -match 'Joined (\w+ \d{4})')      { $matches[1] } else { $null }
$displayName = if ($title -match '^(.*?)\s*\(@') { $matches[1].Trim() } else { $null }

[pscustomobject]@{
    displayName = $displayName
    handle      = $Handle
    followers   = $followers
    following   = $following
    joined      = $joined
    ogDescription = $ogDesc
    url         = $url
    fetchedAt   = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
} | ConvertTo-Json
