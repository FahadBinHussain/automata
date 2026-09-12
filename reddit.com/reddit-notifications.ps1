<#
.SYNOPSIS
  Reddit notification reader for agents — compact JSON of your inbox activity.
.DESCRIPTION
  Wraps reddit-account.ps1 (OAuth, token refresh, email-keyed profiles) and pulls
  /message/* listings from the Reddit Data API, trimmed to agent-friendly fields.
  Requires the privatemessages scope on the profile.
.PARAMETER Kind
  unread    - every unread item (default)
  messages  - private messages
  comments  - replies and @-mentions on your comments/posts
  posts     - posts to your profile
  inbox     - everything, read included
  all       - unread merged from messages + comments + posts
.PARAMETER Email
  Profile email; defaults to the active reddit-account.ps1 profile.
.PARAMETER Limit
  Max items per folder (default 25).
.EXAMPLE
  .\reddit-notifications.ps1
  .\reddit-notifications.ps1 -Kind comments -Limit 10
  .\reddit-notifications.ps1 -Kind all -Email you@example.com
#>
param(
    [ValidateSet('unread','messages','comments','posts','inbox','all')]
    [string]$Kind = 'unread',
    [string]$Email,
    [int]$Limit = 25
)
$ErrorActionPreference = 'Stop'

$helper = Join-Path $PSScriptRoot 'reddit-account.ps1'
if (-not (Test-Path $helper)) { throw "helper not found: $helper" }

$storeRoot = Join-Path $env:APPDATA 'mainframe\accounts\reddit'
if (-not (Test-Path $storeRoot)) {
    throw @"
No reddit account store found ($storeRoot).
Login first, in your OWN terminal (opens a browser OAuth flow):
  & "$helper" login <email> -ClientId <client_id> -Scopes identity,read,privatemessages
Create the client id at reddit.com/prefs/apps -> 'install app', redirect uri http://127.0.0.1:8585/callback/
"@
}

function Get-RedditListing {
    param([string]$Folder, [string]$ProfileEmail)

    $runArgs = @('run')
    if ($ProfileEmail) { $runArgs += $ProfileEmail }
    $runArgs += @('GET', "/message/$Folder")

    try {
        $raw = & $helper @runArgs 2>&1
    } catch {
        throw "reddit-account.ps1 run GET /message/$Folder failed: $_"
    }
    if ($LASTEXITCODE -ne 0) { throw "reddit-account.ps1 exited $LASTEXITCODE for /message/$Folder : $raw" }

    $text = ($raw | Out-String).Trim()
    if (-not $text) { throw "empty response from /message/$Folder (check -Scopes includes privatemessages)" }

    try { $parsed = $text | ConvertFrom-Json } catch {
        throw "could not parse /message/$Folder output: $text"
    }

    # already a listing object, or nested under a data run wrapper
    $children = if ($parsed.data -and $parsed.data.children) { $parsed.data.children }
                elseif ($parsed.children) { $parsed.children }
                else { throw "unexpected shape from /message/$Folder (no data.children)" }

    @($children | ForEach-Object { $_.data })
}

function ConvertTo-Notification {
    param($Item)

    $body = if ($Item.body) { [string]$Item.body } elseif ($Item.message) { [string]$Item.message } else { '' }
    if ($body.Length -gt 280) { $body = $body.Substring(0, 277) + '...' }

    [pscustomobject]@{
        id         = [string]$Item.id
        folder     = [string]$Item.folder
        unread     = [bool]$Item.unread
        from       = [string]$Item.author
        to         = [string]$Item.dest_name
        context    = [string]$Item.context
        title      = [string]$Item.title
        subject    = [string]$Item.subject
        body       = $body
        permalink  = [string]$Item.permalink
        created_utc = [DateTimeOffset]::FromUnixTimeSeconds([double]$Item.created_utc).ToString('o')
    }
}

$folders = switch ($Kind) {
    'unread'   { @('unread') }
    'inbox'    { @('inbox') }
    'all'      { @('messages','comments','posts') }
    default    { @($Kind) }
}

$items = foreach ($folder in $folders) {
    Get-RedditListing -Folder $folder -ProfileEmail $Email | Select-Object -First $Limit
}

$result = @($items | ForEach-Object { ConvertTo-Notification -Item $_ } | Sort-Object created_utc -Descending)

[pscustomobject]@{
    kind    = $Kind
    count   = $result.Count
    fetched = [DateTimeOffset]::Now.ToString('o')
    items   = $result
} | ConvertTo-Json -Depth 6 -Compress
