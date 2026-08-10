# purpose: download browser extension CRX packages from the Microsoft Edge Add-ons store and
#   the Chrome Web Store, using the same official endpoints the browsers themselves use.
#   works for any listed extension; gracefully reports "listed but not servable" for
#   unpublished/removed packages (e.g. Plucky Lite id mbiehjpcjnckjbpegnahbjgeddpmeigj).
# inputs:
#   -Url  <store detail url>  (edge or chromewebstore; store detected from host)
#   -Id   <extension id>      (store detected: edge metadata API first, else chrome)
#   -OutDir <dir>             (default: current dir)
#   -Extract                  (also unzip the crx into <name>-<version>/)
#   -MetaOnly                 (save metadata + manifest only, skip crx)
# run:
#   pwsh .\extension-crx-downloader.ps1 -Url "https://microsoftedge.microsoft.com/addons/detail/plucky/mbiehjpcjnckjbpegnahbjgeddpmeigj"
#   pwsh .\extension-crx-downloader.ps1 -Id cjpalhdlnbpafiamejdnhcphjbkeiagm -OutDir C:\tmp
# notes:
#   - edge crx endpoint: https://edge.microsoft.com/extensionwebstorebase/v1/crx?response=redirect&x=id%3D<ID>%26installsource%3Dondemand%26uc
#       302 -> msedgeextensions CDN (signed, time-limited link; download immediately; serves http ONLY, not https)
#       404/500/400 -> package not served to anonymous clients right now; the edge backend is FLAKY
#       and load-balances per request, so the same id can 404 on one try and 302 on the next -
#       this script retries (metadata 3x, crx 5x with backoff) and usually succeeds
#   - chrome crx endpoint: https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx2,crx3&prodversion=130.0&x=id%3D<ID>%26installsource%3Dondemand%26uc
#   - edge metadata api: https://microsoftedge.microsoft.com/addons/getproductdetailsbycrxid/<ID>
#       returns JSON incl. full manifest; sometimes 301-redirects to the store homepage (also flaky)
#   - powershell quirk: Invoke-WebRequest -MaximumRedirection 0 throws on 302s; use HttpClient
#     with AllowAutoRedirect=$false instead (this script does)
#   - crx3 magic: "Cr24" + version + header len + protobuf header, then a zip; crx2 has
#     pubkey/sig blobs before the zip; -Extract strips the header and unzips
#   - version checksum note: verify downloaded crx by comparing version with store metadata
#     (use 7z/Expand-Archive on the zip portion if needed)

param(
    [string]$Id,
    [string]$Url,
    [string]$OutDir = (Get-Location).Path,
    [switch]$Extract,
    [switch]$MetaOnly
)

$ErrorActionPreference = 'Stop'
$UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0"

function New-ApiClient {
    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $client = [System.Net.Http.HttpClient]::new($handler)
    $client.DefaultRequestHeaders.UserAgent.ParseAdd($UA)
    $client.Timeout = [TimeSpan]::FromSeconds(90)
    return $client
}

function Get-WithRetry($client, $uri, $attempts, $acceptRedirect) {
    for ($i = 1; $i -le $attempts; $i++) {
        try {
            $resp = $client.GetAsync($uri).Result
            if ($acceptRedirect -or $resp.StatusCode -ne [System.Net.HttpStatusCode]::Redirect) {
                return $resp
            }
        } catch { }
        if ($i -lt $attempts) { Start-Sleep -Seconds (2 * $i) }
    }
    return $null
}

if (-not $Id) {
    if (-not $Url) { throw "need -Id or -Url" }
    if ($Url -match 'microsoftedge\.microsoft\.com/addons/detail/[^/]+/([a-z0-9]{26})') { $Id = $Matches[1] }
    elseif ($Url -match 'chromewebstore\.google\.com/detail/[^/]+/([a-z0-9]{32})') { $Id = $Matches[1]; $Store = 'chrome' }
    else { throw "could not parse extension id from url" }
}

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$client = New-ApiClient

$meta = $null
$edgeMeta = Get-WithRetry $client "https://microsoftedge.microsoft.com/addons/getproductdetailsbycrxid/$Id" 3 $false
if ($edgeMeta -and $edgeMeta.StatusCode -eq [System.Net.HttpStatusCode]::OK) {
    $Store = 'edge'
    $json = $edgeMeta.Content.ReadAsStringAsync().Result
    $meta = $json | ConvertFrom-Json
    $meta | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $OutDir "$Id.metadata.json") -Encoding utf8
    if ($meta.manifest) { $meta.manifest | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $OutDir "$Id.manifest.json") -Encoding utf8 }
} elseif (-not $Store) {
    $Store = 'chrome'
}

if ($Store -eq 'edge' -and -not $meta) {
    Write-Host "edge metadata: 404 - extension not listed (unpublished/removed?)" -ForegroundColor Yellow
    if ($MetaOnly) { exit 2 }
}
if ($Store -eq 'chrome') {
    Write-Host "chrome store: no edge listing, trying chrome web store" -ForegroundColor DarkGray
}

$name = $meta ? ($meta.name -replace '[^\w.-]+', '-').Trim('-') : $Id
$ver  = $meta ? $meta.version : 'unknown'
$slug = "$name-$ver"

if ($Store -eq 'edge') {
    $crxUrl = "https://edge.microsoft.com/extensionwebstorebase/v1/crx?response=redirect&x=id%3D$Id%26installsource%3Dondemand%26uc"
} else {
    $crxUrl = "https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx2,crx3&prodversion=130.0&x=id%3D$Id%26installsource%3Dondemand%26uc"
}

$dest = Join-Path $OutDir "$slug.crx"
if (-not $MetaOnly) {
    $resp = $null
    for ($i = 1; $i -le 5 -and -not $resp; $i++) {
        $r = $client.GetAsync($crxUrl).Result
        if ($r.StatusCode -eq [System.Net.HttpStatusCode]::Redirect -and $r.Headers.Location) {
            $resp = $r
        } else {
            Write-Host "crx attempt ${i}: $([int]$r.StatusCode) - retrying" -ForegroundColor DarkGray
            $r.Dispose()
            if ($i -lt 5) { Start-Sleep -Seconds (2 * $i) }
        }
    }
    if ($resp) {
        $cdn = $resp.Headers.Location.ToString()
        Write-Host "crx: 302 -> $cdn"
        $bytes = $client.GetByteArrayAsync($cdn).Result
        [System.IO.File]::WriteAllBytes($dest, $bytes)
        $sig = if ($bytes.Length -ge 4 -and [System.Text.Encoding]::ASCII.GetString($bytes, 0, 4) -eq 'Cr24') { 'crx3' } else { 'zip' }
        Write-Host "saved $dest ($($bytes.Length) bytes, $sig)" -ForegroundColor Green
        if ($Extract) {
            $zipOffset = 0
            if ($sig -eq 'crx3') {
                $verCode = [System.BitConverter]::ToInt32($bytes, 4)
                $hdrLen = [System.BitConverter]::ToInt32($bytes, 8)
                $zipOffset = 12 + $hdrLen
            } elseif ($bytes.Length -gt 16) {
                $pubLen = [System.BitConverter]::ToInt32($bytes, 8)
                $sigLen = [System.BitConverter]::ToInt32($bytes, 12)
                $zipOffset = 16 + $pubLen + $sigLen
            }
            $outDir2 = Join-Path $OutDir $slug
            New-Item -ItemType Directory -Path $outDir2 -Force | Out-Null
            $ms = [System.IO.MemoryStream]::new($bytes, $zipOffset, $bytes.Length - $zipOffset)
            $zip = [System.IO.Compression.ZipArchive]::new($ms, 'Read')
            $n = 0
            foreach ($entry in $zip.Entries) {
                $target = Join-Path $outDir2 ($entry.FullName -replace '/', '\')
                $parent = Split-Path $target -Parent
                if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
                if ($entry.Name) {
                    $in = $entry.Open()
                    $fs = [System.IO.File]::Create($target)
                    $in.CopyTo($fs)
                    $fs.Close(); $in.Close()
                    $n++
                }
            }
            $zip.Dispose(); $ms.Dispose()
            Write-Host "extracted $n files -> $outDir2" -ForegroundColor Green
        }
    } else {
        Write-Host "crx download FAILED after 5 attempts - edge backend refusing to serve this id right now (unpublished/removed, or region-gated)" -ForegroundColor Red
        Write-Host "   url tried: $crxUrl"
        exit 1
    }
}

if ($meta) {
    Write-Host "== $($meta.name) v$($meta.version) (crxId: $Id, storeProductId: $($meta.storeProductId), developer: $($meta.developer), installs: $($meta.activeInstallCount))"
} else {
    Write-Host "== $Id (no store metadata; $Store store)"
}
