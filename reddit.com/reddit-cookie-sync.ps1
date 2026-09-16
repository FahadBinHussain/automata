<#
.SYNOPSIS
  Export reddit.com session cookies from the mainframe agent-browser profile
  into a local cookie file that reddit-notifications.ps1 calls over pure HTTP.
.DESCRIPTION
  Engine: web-session cookie (browser session as auth - no Reddit OAuth client
  exists; platform-wide app creation is gated by the Responsible Builder Policy
  with no working agree UI as of 2026-09-13).

  WHY NO edge-cdp-profile-sync HERE (gotcha, 2026-09-13): reddit's auth cookie
  'reddit-session' is a session cookie - Edge keeps it in memory, NOT on disk,
  so a VSS file-copy of the Edge profile never carries the login. Refreshing
  the mainframe profile from Edge also WIPES any reddit login this profile
  earned itself. So the agent-browser profile keeps its own reddit login:
  first run pops a browser window for one manual sign-in (~1 min); every later
  run is silent (profile is already logged in).

  Flow: detached worker opens old.reddit.com/message/unread.json; if logged
  out, reddit bounces to login and you sign in in that window; worker detects
  arrival at the JSON page, dumps cookies; parent validates + writes
  $PSScriptRoot\.reddit-session.json (gitignored) and closes the browser.
  If reddit-session ever expires (~2 months with 'stay signed in'), re-run.
#>
param(
    [string]$Email,
    [int]$TimeoutSeconds = 600
)
$ErrorActionPreference = 'Stop'

$helper = 'C:\Users\Admin\Downloads\mainframe\agent-browser-account.ps1'
$cookieFile = Join-Path $PSScriptRoot '.reddit-session.json'

if (-not $Email) {
    $currentJson = Join-Path $env:APPDATA 'mainframe\accounts\agent-browser\current.json'
    if (-not (Test-Path $currentJson)) { throw "no -Email given and no agent-browser current profile at $currentJson" }
    $Email = (Get-Content $currentJson -Raw | ConvertFrom-Json).email
    if (-not $Email) { throw 'current.json has no email field' }
}
Write-Host "account: $Email (engine: web-session cookie export)"

$profilePath = Join-Path $env:APPDATA "mainframe\accounts\agent-browser\$Email"
if (-not (Test-Path $profilePath)) { throw "agent-browser profile dir not found: $profilePath (run: & '$helper' use $Email first)" }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outFile = Join-Path $env:TEMP "reddit-cookies-$stamp.json"
if (Test-Path $outFile) { Remove-Item $outFile -Force }

$workerCmd = @"
`$env:AGENT_BROWSER_PROFILE = '$profilePath'
agent-browser close --all 2>`$null | Out-Null
agent-browser open 'https://old.reddit.com/message/unread.json?limit=1' | Out-Null
for (`$i = 0; `$i -lt [Math]::Ceiling($TimeoutSeconds / 5); `$i++) {
    Start-Sleep -Seconds 5
    `$u = agent-browser get url 2>`$null
    if (`$u -match '/message/unread') {
        agent-browser cookies get --json | Out-File -FilePath '$outFile' -Encoding utf8
        break
    }
}
"@
$null = Start-Process pwsh -ArgumentList @('-NoProfile', '-NonInteractive', '-Command', $workerCmd) -WindowStyle Hidden

Write-Host 'waiting for cookies... if a reddit LOGIN page opened, sign in there - the script detects it automatically.'

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while (-not (Test-Path $outFile) -or (Get-Item $outFile).Length -lt 10) {
    if ((Get-Date) -gt $deadline) {
        agent-browser close --all 2>$null | Out-Null
        throw "timeout after ${TimeoutSeconds}s: no cookies captured (login not completed? profile dir: $profilePath)"
    }
    Start-Sleep -Seconds 2
}
Start-Sleep -Seconds 2  # let worker finish writing

$all = Get-Content $outFile -Raw
try { $cookies = $all | ConvertFrom-Json } catch { throw "cookies output is not JSON: first 200 chars: $($all.Substring(0, [Math]::Min(200, $all.Length)))" }

$redditCookies = @($cookies | Where-Object { $_.domain -like '*reddit.com' })
if ($redditCookies.Count -eq 0) { throw 'no reddit.com cookies in export - unexpected (login state?)' }
if (-not ($redditCookies | Where-Object { $_.name -eq 'reddit-session' })) {
    throw 'reddit-session cookie MISSING after login - sign-in did not complete properly; re-run and finish login in the opened window.'
}

$payload = [pscustomobject]@{
    engine     = 'web-session cookie (old.reddit.com /message JSON)'
    account    = $Email
    exported   = [DateTimeOffset]::Now.ToString('o')
    user_agent = 'fahad-agent:reddit-notifications/1.0 (personal notification poller)'
    cookies    = @($redditCookies | ForEach-Object {
        [pscustomobject]@{ name = $_.name; value = $_.value; domain = $_.domain; path = $_.path; expires = $_.expires }
    })
}
$payload | ConvertTo-Json -Depth 5 | Set-Content -Path $cookieFile -Encoding utf8
Remove-Item $outFile -Force
agent-browser close --all 2>$null | Out-Null

Write-Host "OK: $($redditCookies.Count) reddit cookies saved -> $cookieFile"
Write-Host "reddit-session expires: $(($redditCookies | Where-Object { $_.name -eq 'reddit-session' }).expires)"
