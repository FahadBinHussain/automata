<#
.SYNOPSIS
  Reddit notification reader for agents — compact JSON of your inbox activity.
.DESCRIPTION
  Engine: web-session cookie — pure HTTP to old.reddit.com/message/*.json using
  the session exported by reddit-cookie-sync.ps1. No browser launch, no OAuth
  client (Reddit app creation is policy-gated; browser session is the auth).

  Requires up-to-date .reddit-session.json next to this script:
    .\reddit-cookie-sync.ps1        # opens nothing you must touch; ~20s
.PARAMETER Kind
  unread    - every unread item (default)
  messages  - private messages
  comments  - replies and @-mentions on your comments/posts
  posts     - posts to your profile
  inbox     - everything, read included
  all       - unread merged from messages + comments + posts
.PARAMETER Limit
  Max items per folder (default 25).
.EXAMPLE
  .\reddit-notifications.ps1
  .\reddit-notifications.ps1 -Kind comments -Limit 10
  .\reddit-notifications.ps1 -Kind all
#>
param(
    [ValidateSet('unread','messages','comments','posts','inbox','all')]
    [string]$Kind = 'unread',
    [int]$Limit = 25
)
$ErrorActionPreference = 'Stop'

$cookieFile = Join-Path $PSScriptRoot '.reddit-session.json'
if (-not (Test-Path $cookieFile)) {
    throw "no session file at $cookieFile - run: & '$PSScriptRoot\reddit-cookie-sync.ps1'"
}

$session = Get-Content $cookieFile -Raw | ConvertFrom-Json
if (-not $session.cookies) { throw "session file is empty/corrupt: $cookieFile - re-run reddit-cookie-sync.ps1" }

$cookieHeader = ($session.cookies | ForEach-Object { "$($_.name)=$($_.value)" }) -join '; '
$userAgent = if ($session.user_agent) { $session.user_agent } else { 'fahad-agent:reddit-notifications/1.0 (personal notification poller)' }

function Get-RedditListing {
    param([string]$Folder)

    $uri = "https://old.reddit.com/message/$Folder/.json?limit=$Limit"
    try {
        $resp = Invoke-WebRequest -Uri $uri -Headers @{ Cookie = $cookieHeader; 'User-Agent' = $userAgent } -MaximumRedirection 0 -ErrorAction Stop
    } catch {
        throw "GET $uri failed: $($_.Exception.Message) - if 302/403, session expired: re-run reddit-cookie-sync.ps1"
    }
    if ($resp.StatusCode -ne 200) { throw "GET $uri -> HTTP $($resp.StatusCode)" }
    if ($resp.Headers['Content-Type'] -notmatch 'json') {
        throw "GET $uri returned $($resp.Headers['Content-Type']) not JSON - reddit login wall hit; session expired: re-run reddit-cookie-sync.ps1"
    }

    try { $parsed = $resp.Content | ConvertFrom-Json } catch { throw "GET $uri -> unparseable JSON: $($_.Exception.Message)" }

    if ($parsed.errors) { throw "reddit API errors: $($parsed.errors | ConvertTo-Json -Compress)" }
    if (-not $parsed.data.children) { throw "GET $uri -> no data.children (unexpected shape or login redirect body)" }

    @($parsed.data.children | ForEach-Object { $_.data })
}

function ConvertTo-Notification {
    param($Item)

    $body = if ($Item.body) { [string]$Item.body } elseif ($Item.message) { [string]$Item.message } else { '' }
    if ($body.Length -gt 280) { $body = $body.Substring(0, 277) + '...' }

    [pscustomobject]@{
        id          = [string]$Item.id
        folder      = [string]$Item.folder
        unread      = [bool]$Item.unread
        from        = [string]$Item.author
        to          = [string]$Item.dest_name
        context     = [string]$Item.context
        title       = [string]$Item.title
        subject     = [string]$Item.subject
        body        = $body
        permalink   = [string]$Item.permalink
        created_utc = [DateTimeOffset]::FromUnixTimeSeconds([double]$Item.created_utc).ToString('o')
    }
}

$folders = switch ($Kind) {
    'unread' { @('unread') }
    'inbox'  { @('inbox') }
    'all'    { @('messages','comments','posts') }
    default  { @($Kind) }
}

$items = foreach ($folder in $folders) { Get-RedditListing -Folder $folder }

$result = @($items | ForEach-Object { ConvertTo-Notification -Item $_ } | Sort-Object created_utc -Descending)

[pscustomobject]@{
    engine  = 'web-session cookie'
    kind    = $Kind
    count   = $result.Count
    fetched = [DateTimeOffset]::Now.ToString('o')
    items   = $result
} | ConvertTo-Json -Depth 6 -Compress
