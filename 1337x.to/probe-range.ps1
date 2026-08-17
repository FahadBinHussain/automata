# find a torrent by probing an ID window on the 1337xx.to mirror (search is honeypotted, detail pages are real)
# usage: .\probe-range.ps1 -StartId 345000 -EndId 351000 -Pattern 'thor' -MinSeeders 100
param(
    [int]$StartId,
    [int]$EndId,
    [string]$Pattern,
    [int]$MinSeeders = 0
)

$domain = "https://www.1337xx.to"
$hits = [System.Collections.Concurrent.ConcurrentBag[object]]::new()
$outFile = "$env:TEMP\1337x-probe-hits.txt"

1..($EndId - $StartId + 1) | ForEach-Object -Parallel {
    $id = $using:StartId + $_ - 1
    $url = "$using:domain/torrent/$id/x/"
    try {
        $r = Invoke-WebRequest -Uri $url -TimeoutSec 10 -UseBasicParsing
        $c = $r.Content
        if ($c -match 'Error 404') { return }
        $title = ""
        $t = [regex]::Match($c, '<h1[^>]*>([^<]*)</h1>')
        if ($t.Success) { $title = $t.Groups[1].Value.Trim() }
        if ($title -notmatch $using:Pattern) { return }
        $seeders = ""
        $s = [regex]::Match($c, 'class="seeds">(\d+)')
        if ($s.Success) { $seeders = $s.Groups[1].Value }
        if ([int]$seeders -lt $using:MinSeeders) { return }
        $bag = $using:hits
        $bag.Add([pscustomobject]@{ id = $id; title = $title; seeders = $seeders }) | Out-Null
        Add-Content -Path $using:outFile -Value "$id`t$title`t$seeders" -EA SilentlyContinue
    } catch { }
} -ThrottleLimit 24

$hits | Sort-Object id | ConvertTo-Json