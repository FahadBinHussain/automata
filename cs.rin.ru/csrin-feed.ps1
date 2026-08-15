# csrin-feed.ps1 - pull cs.rin.ru phpBB Atom feeds
# purpose: track game threads / forum sections without hitting HTML pages (feed.php is whitelisted - no cookie, no challenge)
# inputs: -Topic <t=> id, -Forum <f=> id, or no flag = global feed
# run: & csrin-feed.ps1 -Topic 67450
# output: objects {published, author, title, link, text, versions}
param([int]$Topic, [int]$Forum)

$u = 'https://cs.rin.ru/forum/feed.php'
if ($Topic) { $u += "?t=$Topic" } elseif ($Forum) { $u += "?f=$Forum" }

$r = Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 25
[xml]$x = $r.Content
$ns = New-Object Xml.XmlNamespaceManager($x.NameTable)
$ns.AddNamespace('a', 'http://www.w3.org/2005/Atom')

foreach ($e in $x.SelectNodes('//a:entry', $ns)) {
    $clean = [System.Net.WebUtility]::HtmlDecode(($e.SelectSingleNode('a:content', $ns).InnerText -replace '<[^>]+>', ' ')) -replace '\s+', ' '
    [pscustomobject]@{
        published = $e.SelectSingleNode('a:published', $ns).InnerText
        author    = $e.SelectSingleNode('a:author/a:name', $ns).InnerText
        title     = $e.SelectSingleNode('a:title', $ns).InnerText
        link      = $e.SelectSingleNode('a:link', $ns).GetAttribute('href')
        text      = $clean
        versions  = (([regex]::Matches($clean, '\b[vV]?\d+\.\d+(\.\d+)*\b') | ForEach-Object { $_.Value } | Select-Object -Unique) -join ',')
    }
}