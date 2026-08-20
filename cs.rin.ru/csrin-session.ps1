# csrin-session.ps1 - cs.rin.ru security-check bootstrap
# purpose: create a reusable web session for cs.rin.ru forum (bypasses the custom nginx JS-cookie gate without a browser)
# inputs: none ($Fresh re-forces bootstrap even if session file exists)
# run: $s = & $env:USERPROFILE\Downloads\automata\cs.rin.ru\csrin-session.ps1
# behavior: GET /forum/ (401) -> extract securitytoken + securitytoken_expiration from inline JS -> add cookies ->
#           GET /securitycheck/forum/ (302) -> session is ready; cookies valid ~24h (re-run when 401 returns)
# gotchas: token lives in the page's JS (document.cookie = "..."), NOT a Set-Cookie header - plain IWR won't carry it.
#          feed.php is whitelisted (no cookie needed); everything else needs this session.
param([switch]$Fresh)

$cacheFile = "$env:TEMP\csrin.session.json"
$base = 'https://cs.rin.ru'

if (-not $Fresh -and (Test-Path $cacheFile)) {
    try {
        $cached = Get-Content $cacheFile -Raw | ConvertFrom-Json
        if ($cached.expiration -gt [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - 3600) {
            $s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
            $s.Cookies.Add((New-Object System.Net.Cookie('securitytoken', $cached.token, '/', 'cs.rin.ru')))
            $s.Cookies.Add((New-Object System.Net.Cookie('securitytoken_expiration', $cached.expiration.ToString(), '/', 'cs.rin.ru')))
            Write-Output $s
            exit
        }
    } catch { }
}

$h = Invoke-WebRequest "$base/forum/" -UseBasicParsing -TimeoutSec 20 -SkipHttpErrorCheck -MaximumRedirection 0
if ($h.Content -notmatch 'securitytoken=([A-Za-z0-9_-]+)') { throw 'securitytoken not found in challenge page - site changed?' }
$tok = $Matches[1]
$exp = if ($h.Content -match 'securitytoken_expiration=(\d+)') { $Matches[1] } else { ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + 86400).ToString() }
$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$s.Cookies.Add((New-Object System.Net.Cookie('securitytoken', $tok, '/', 'cs.rin.ru')))
$s.Cookies.Add((New-Object System.Net.Cookie('securitytoken_expiration', $exp, '/', 'cs.rin.ru')))
try { Invoke-WebRequest "$base/securitycheck/forum/" -UseBasicParsing -WebSession $s -SkipHttpErrorCheck -MaximumRedirection 5 -TimeoutSec 20 | Out-Null } catch { }
@{ token = $tok; expiration = [long]$exp } | ConvertTo-Json | Set-Content $cacheFile
Write-Output $s