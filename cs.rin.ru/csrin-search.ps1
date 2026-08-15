# csrin-search.ps1 - search cs.rin.ru forum (with flood-control retry)
# purpose: keyword search - topics or within a topic - same inputs the forum web UI accepts
# inputs: -Keywords "text", optional -Topic <t=> to search only that thread, -MaxPages <n> (starts at 15/page)
# run: & csrin-search.ps1 -Keywords "Grand Theft Auto V Legacy"
# output: matched posts {topicId, title, postId, link}
# gotcha: phpBB flood control returns "Sorry but you cannot use search at this time" - retries with 35s sleeps.
#         result links are `./viewtopic.php?f=..&t=..` relative with `&amp;` entities.
param(
    [Parameter(Mandatory = $true)][string]$Keywords,
    [int]$Topic,
    [switch]$Victim
)

$script:CsSession = & (Join-Path $PSScriptRoot 'csrin-session.ps1')

$url = 'https://cs.rin.ru/forum/search.php?keywords=' + [uri]::EscapeDataString($Keywords)
if ($Topic) { $url += "&t=$Topic" }
if ($Victim) { $url += '&sr=topics' }

$html = $null
foreach ($try in 1..3) {
    $r = Invoke-WebRequest $url -UseBasicParsing -WebSession $CsSession -SkipHttpErrorCheck -TimeoutSec 30
    if ($r.Content -notmatch 'cannot use search') { $html = $r.Content; break }
    Start-Sleep -Seconds 35
}
if (-not $html) { throw 'search flood-limited after 3 tries' }

[regex]::Matches($html, '<a href="(\./viewtopic\.php\?f=\d+&amp;t=(\d+)[^"]*)" class="topictitle">(.*?)</a>', [System.Text.RegularExpressions.RegexOptions]::Singleline) |
    ForEach-Object {
        $t = [System.Net.WebUtility]::HtmlDecode(($_.Groups[3].Value -replace '<[^>]+>', '' -replace '\s+', ' ')).Trim()
        [pscustomobject]@{ topicId = $_.Groups[2].Value; title = $t; link = "https://cs.rin.ru/forum/viewtopic.php?t=$($_.Groups[2].Value)" }
    } | Select-Object -Unique

# note: within-topic searches (with -Topic) return POST links instead - parse those with:
# [regex]::Matches($html, 'href="(\./viewtopic\.php\?f=\d+&amp;t=\d+&amp;p=(\d+)[^"]*)"')