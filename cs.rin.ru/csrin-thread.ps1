# csrin-thread.ps1 - extract posts from a cs.rin.ru topic page
# purpose: fetch a viewtopic page (pagination by start=) and return posts as objects (author, date, subject, body)
# inputs: -Topic <t=>, -Start <n> (0 = first page; use -LastPage to autodetect the final page)
# run: & csrin-thread.ps1 -Topic 67450 -LastPage
# output: posts {author, date, subject, body, link}
# gotchas: viewtopic needs the cookie session (feed.php does not). No flood control on viewtopic, pace ~1 req/2s.
#          links inside bodies are login-gated for guests ("[Please login to see this link.]").
param(
    [Parameter(Mandatory = $true)][int]$Topic,
    [int]$Start = 0,
    [switch]$LastPage
)

$script:CsSession = & (Join-Path $PSScriptRoot 'csrin-session.ps1')

if ($LastPage) {
    $r = Invoke-WebRequest "https://cs.rin.ru/forum/viewtopic.php?t=$Topic" -UseBasicParsing -WebSession $CsSession -SkipHttpErrorCheck -TimeoutSec 30
    $pg = $null
    if ($r.Content -match 'Page\s*<strong>1</strong>\s*of\s*<strong>(\d+)</strong>') { $pg = $Matches[1] }
    elseif ($r.Content -match 'Page 1 of (\d+)') { $pg = $Matches[1] }
    if (-not $pg) { throw 'could not detect page count' }
    $Start = ([int]$Matches[1] - 1) * 15
}

$html = (Invoke-WebRequest "https://cs.rin.ru/forum/viewtopic.php?t=$Topic&start=$Start" -UseBasicParsing -WebSession $CsSession -SkipHttpErrorCheck -TimeoutSec 30).Content

$obj = [regex]::Match($html, '^([^<]+).*?(?=<a href="\./viewtopic|$)', [System.Text.RegularExpressions.RegexOptions]::Singleline)
[regex]::Matches($html, '(?s)<a name="p(\d+)"></a>.*?<b class="postauthor">([^<]*)</b>.*?<b>Posted:</b>\s*([^<]*)<') |
    ForEach-Object {
        [pscustomobject]@{
            postId = $_.Groups[1].Value
            author = $_.Groups[2].Value
            date   = ([System.Net.WebUtility]::HtmlDecode($_.Groups[3].Value)).Trim()
            link   = "https://cs.rin.ru/forum/viewtopic.php?t=$Topic&p=$($_.Groups[1].Value)#p$($_.Groups[1].Value)"
        }
    }