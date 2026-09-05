#requires -Version 7.0
<#
.SYNOPSIS
medium.com-profile-scrape.ps1 — anonymous Medium profile + stories scraper, no login.

.DESCRIPTION
Medium serves the full profile JSON to logged-out visitors via the
`?format=json` endpoint (strip the `])}while(1);</x>` anti-JSON-hijack prefix),
plus an RSS feed for stories. Verified working anonymously 2026-09-05.

.USAGE
pwsh medium.com-profile-scrape.ps1 -Handle fahadbinhussain

.OUTPUT
exit 0 + JSON profile object (stats + stories); exit 1 loud on failure.
#>
param(
    [Parameter(Mandatory)][string]$Handle
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

# ---- profile json -----------------------------------------------------------
$json = $null
for ($i = 1; $i -le 3; $i++) {
    $tmp = New-TemporaryFile
    try {
        $code = & curl.exe -s --compressed -A $UA --max-time 30 -o $tmp.FullName -w '%{http_code}' -L --max-redirs 5 "https://medium.com/@$Handle`?format=json"
        if ($code -eq '200') { $json = Get-Content $tmp.FullName -Raw -Encoding utf8; break }
        if ($i -lt 3) { Start-Sleep -Seconds (2 * ($i + 1)) }
    } finally {
        Remove-Item $tmp.FullName -Force -ErrorAction SilentlyContinue
    }
}

if (-not $json) {
    Write-Error "medium returned HTTP $code for profile json - anonymous scrape failed. Loud failure, no fallback."
    exit 1
}

$json = $json -replace '^\]\)\}while\(1\);</x>', ''
try { $data = $json | ConvertFrom-Json } catch {
    Write-Error "medium json parse failed for $Handle - endpoint shape changed: $($_.Exception.Message)"
    exit 1
}
if (-not $data.success -or -not $data.payload.user) {
    Write-Error "medium payload has no user for '$Handle' - profile deleted or renamed"
    exit 1
}

$u = $data.payload.user
$stats = $data.payload.references.SocialStats.$($u.userId)

# ---- stories rss --------------------------------------------------------------
$stories = @()
$rssTmp = New-TemporaryFile
try {
    $rssCode = & curl.exe -s --compressed -A $UA --max-time 30 -o $rssTmp.FullName -w '%{http_code}' -L --max-redirs 5 "https://medium.com/feed/@$Handle"
    if ($rssCode -eq '200') {
        $rssRaw = Get-Content $rssTmp.FullName -Raw -Encoding utf8
        # ps xml adapter fabricates a phantom item when the feed has zero <item> - check raw first
        if ($rssRaw.Contains('<item>')) {
            try {
                [xml]$feed = $rssRaw
                # ps xml adapter returns string for simple nodes, XmlElement for CDATA - normalize both
                function Node-Text { param($Node) if ($null -eq $Node) { $null } elseif ($Node -is [string]) { $Node.Trim() } else { $Node.get_InnerText().Trim() } }
                $stories = @($feed.rss.channel.item | ForEach-Object {
                    [ordered]@{ title = Node-Text $_.title; published = Node-Text $_.pubDate; link = Node-Text $_.link }
                })
            } catch {
                Write-Host "   note: rss feed parse failed - profile stats still returned" 
            }
        }
    } else {
        Write-Host "   note: rss feed HTTP $rssCode - profile stats still returned"
    }
} finally {
    Remove-Item $rssTmp.FullName -Force -ErrorAction SilentlyContinue
}

[pscustomobject]@{
    name          = $u.name
    handle        = $u.username
    bio           = if ($u.bio) { $u.bio } else { $null }
    createdAt     = (Get-Date '1970-01-01').AddMilliseconds($u.createdAt).ToString('yyyy-MM-dd')
    usersFollowed = if ($stats) { $stats.usersFollowedCount } else { $null }
    followers     = if ($stats) { $stats.usersFollowedByCount } else { $null }
    isSuspended   = $u.isSuspended
    stories       = $stories
    url           = "https://medium.com/@$Handle"
    fetchedAt     = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
} | ConvertTo-Json -Depth 5
