param(
    [string]$CookieFile = "$env:TEMP\terabox-cookie2.txt",
    [string]$BaseUrl = "https://dm.terabox.com",
    [string[]]$Names = @(),
    [string[]]$Prefixes = @(),
    [switch]$All,
    [switch]$KeepFiles,
    [switch]$DryRun
)

# Direct TeraBox API cleaner. bypasses the AList Terabox driver's broken delete
# (bug #8429: AList returns 200 but errno is non-zero, nothing gets deleted).
# This script calls the official /api/filemanager endpoint directly with the
# session cookie, checking errno==0 on both the envelope and per-item info.
#
# usage:
#   .\terabox-clean.ps1 -All                  # delete everything at root
#   .\terabox-clean.ps1 -All -KeepFiles       # delete all dirs, keep files
#   .\terabox-clean.ps1 -Names @("junkdir","file.txt")          # by exact name
#   .\terabox-clean.ps1 -Prefixes @("_202608","87j4e")          # by prefix
#   .\terabox-clean.ps1 -Prefixes @("_202608") -DryRun          # preview

$ErrorActionPreference = "Stop"

$cookie = (Get-Content $CookieFile -Raw -ErrorAction SilentlyContinue).Trim()
if (-not $cookie) { throw "no cookie in $CookieFile" }

$headers = @{
    "Cookie"           = $cookie
    "Accept"           = "application/json, text/plain, */*"
    "Referer"          = "$BaseUrl/"
    "User-Agent"       = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36"
    "X-Requested-With" = "XMLHttpRequest"
}

function Get-JsToken {
    $resp = Invoke-WebRequest -Uri "$BaseUrl/" -Headers $script:headers -UseBasicParsing -TimeoutSec 30
    $m = [regex]::Match($resp.Content, 'function%20fn%28a%29%7Bwindow.jsToken%20%3D%20a%7D%3Bfn%28%22([^%"]+)%22%29')
    if (-not $m.Success) { throw "jsToken not found in homepage" }
    return $m.Groups[1].Value
}

function Invoke-TeraboxApi {
    param([string]$Path, [hashtable]$Params, [string]$Body)
    $jsToken = Get-JsToken
    $qs = ($Params.GetEnumerator() | ForEach-Object { "$($_.Key)=$([Uri]::EscapeDataString($_.Value))" }) -join "&"
    $uri = "$BaseUrl$Path`?$qs`&app_id=250528&web=1&channel=dubox&clienttype=0&jsToken=$jsToken"
    $r = Invoke-WebRequest -Uri $uri -Method Post -Headers $script:headers -Body $Body -ContentType "application/x-www-form-urlencoded" -UseBasicParsing -TimeoutSec 60
    $json = $r.Content | ConvertFrom-Json
    if ($json.errno -eq -6) {
        $prefix = $r.Headers["Url-Domain-Prefix"]
        if ($prefix) {
            $script:BaseUrl = "https://$prefix.terabox.com"
            return Invoke-TeraboxApi -Path $Path -Params $Params -Body $Body
        }
        throw "errno -6 with no redirect header"
    }
    if ($json.errno -ne 0) { throw "api errno $($json.errno): $($r.Content)" }
    return $json
}

Write-Host "== listing root =="
$listParams = @{ dir = "/"; page = "1"; num = "100" }
$list = Invoke-TeraboxApi -Path "/api/list" -Params $listParams -Body ""

$strayFiles = @($list.list | Where-Object { $_.isdir -ne 1 })
Write-Host "root items: $($list.list.Count) total, dirs: $(@($list.list | Where-Object {$_.isdir -eq 1}).Count), files: $($strayFiles.Count)"

if ($list.list.Count -eq 0) { Write-Host "nothing to delete"; exit 0 }

if ($All) {
    $toDelete = @($list.list | Where-Object { $_.isdir -eq 1 -or (-not $KeepFiles) })
} elseif ($Names.Count -gt 0) {
    $toDelete = @($list.list | Where-Object { $_.server_filename -in $Names })
} elseif ($Prefixes.Count -gt 0) {
    $toDelete = @($list.list | Where-Object {
        $fn = $_.server_filename
        ($Prefixes | Where-Object { $fn -like "$_*" }).Count -gt 0
    })
} else {
    Write-Host "specify -All, -Names, or -Prefixes to select items"
    exit 0
}

if ($toDelete.Count -eq 0) { Write-Host "no matching items"; exit 0 }

Write-Host "== delete targets =="
$toDelete | ForEach-Object { Write-Host "  $($_.server_filename)`t($(if ($_.isdir -eq 1) {'dir'} else {'file'}))" }

if ($DryRun) {
    Write-Host "dry run - no deletes performed"
    exit 0
}

$filelist = ($toDelete | ForEach-Object { "`"$($_.path)`"" }) -join ","
$body = "async=0&filelist=$([Uri]::EscapeDataString("[$filelist]"))&ondup=newcopy"

Write-Host "== deleting $($toDelete.Count) items =="
$params = @{ onnest = "fail"; opera = "delete" }
$json = Invoke-TeraboxApi -Path "/api/filemanager" -Params $params -Body $body

$failures = @($json.info | Where-Object { $_.errno -ne 0 })
if ($failures.Count -gt 0) {
    Write-Host "WARNING: $($failures.Count) items failed:"
    $failures | ForEach-Object { Write-Host "  $($_.path) -> errno $($_.errno)" }
    exit 1
}
Write-Host "all $($toDelete.Count) items deleted (errno 0)"
exit 0