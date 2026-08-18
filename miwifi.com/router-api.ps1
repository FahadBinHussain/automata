# MiWiFi (Xiaomi) router admin API helper
# purpose: log into the MiWiFi web admin and query router APIs without a browser
#   (device list, status, neighbor wifi scan) - protocol reverse-engineered 2026-08-18
# router: <router-ip>, platform R4CM, firmware 3.0.23 (older LuCI-style web UI)
# password: bitwarden vault item "router pass" (mainframe bitwarden profile
#   <email>); web login username is always 'admin'
#
# login protocol (from /cgi-bin/luci/web page JS, Encrypt object):
#   1. GET https://<host>/cgi-bin/luci/web -> page embeds:
#        key   = Encrypt.key   (e.g. a2ffa5c9be07488bbb04a3a47d3c5f6a)
#        devId = Encrypt.nonceCreat() deviceId (the CONNECTING CLIENT's MAC,
#                e.g. <mac>) - server binds the nonce to it
#   2. nonce = "0_<clientMAC>_<unixSeconds>_<random0-9999>"
#   3. password = sha1(nonce + sha1(pwd + key))          (hex, lowercase)
#   4. POST /cgi-bin/luci/api/xqsystem/login
#      body (form-urlencoded): username=admin&password=<sha1>&logtype=2&nonce=<nonce>
#      header Referer: https://<host>/cgi-bin/luci/web, cookie: deviceID=<uuid from page>
#   5. success: {"code":0,"token":"<stok>",...};  wrong pwd: {"code":401,"msg":"not auth"}
#   gotchas:
#     - nonce is SINGLE-USE: fresh nonce per attempt (reusing one -> code 1582 Invalid nonce)
#     - HTTP (port 80) is fine for login but the web server IP-bans the source after
#       ~10 wrong logins; HTTPS (443) is not rate-limited - use https
#     - other vault entries named "<router-ip>" are OLD passwords for past ISPs
#       (citicom etc.); the CURRENT one is "router pass"
#
# authenticated API (path /cgi-bin/luci/;stok=<stok>/api/...):
#   api/misystem/status       -> router status + ONLINE devices (dev[] with mac/devname/ip)
#   api/misystem/devicelist   -> online devices with stats (list[])
#   api/xqnetwork/wifi_list   -> neighbor AP scan (ssid/bssid)
#   note: this firmware has NO dhcp-lease/devicelist-history endpoint; leases live in
#   /tmp and die with reboots, so offline devices are NOT recoverable from the router
#
# run: pwsh router-api.ps1 -Action login|status|devices|wifi [-Password <pwd>]
#   without -Password it reads the bitwarden vault item "router pass" via bw CLI
#   (session key: %APPDATA%\mainframe\accounts\bitwarden\session.key)

param(
    [ValidateSet("login", "status", "devices", "wifi")]
    [string]$Action = "login",
    [string]$RouterHost = "<router-ip>",
    [string]$Password
)

$ErrorActionPreference = "Stop"
$base = "https://${RouterHost}/cgi-bin/luci"

function Get-HexSha1([string]$s) {
    $sha1 = [System.Security.Cryptography.SHA1]::Create()
    return (($sha1.ComputeHash([Text.Encoding]::UTF8.GetBytes($s)) | ForEach-Object { $_.ToString("x2") }) -join "")
}

if (-not $Password) {
    $bwSession = Get-Content "$env:APPDATA\mainframe\accounts\bitwarden\session.key" -Raw -ErrorAction Stop
    $env:BW_SESSION = $bwSession.Trim()
    $items = bw list items --search "router pass" --session $env:BW_SESSION 2>$null | ConvertFrom-Json
    $Password = $items | Where-Object { $_.name -match "router pass" } | Select-Object -First 1 -ExpandProperty login | Select-Object -ExpandProperty password
    if (-not $Password) { throw "router password not found in vault item 'router pass'" }
}

$page = (curl.exe --noproxy "*" -s -k -m 15 "$base/web") -join "`n"
$key = [regex]::Match($page, "key:\s*'([0-9a-f]+)'").Groups[1].Value
$devId = [regex]::Match($page, "var deviceId\s*=\s*'([^']+)'").Groups[1].Value
$deviceIdCookie = [regex]::Match($page, "deviceId:\s*'([0-9a-f-]+)'").Groups[1].Value
if (-not $key -or -not $devId) { throw "could not parse login page (key=$key devId=$devId)" }

$now = [int][double]::Parse((Get-Date -UFormat %s))
$nonce = "0_${devId}_${now}_$(Get-Random -Maximum 10000)"
$outer = Get-HexSha1($nonce + (Get-HexSha1($Password + $key)))
$body = "username=admin&password=$outer&logtype=2&nonce=$nonce"
$resp = curl.exe --noproxy "*" -s -k -m 15 -b "deviceID=$deviceIdCookie" -e "$base/web" -d $body "$base/api/xqsystem/login"
$json = $resp -join "" | ConvertFrom-Json
if ($json.code -ne 0) { throw "login failed: $($json.msg) (code $($json.code))" }
$stok = $json.token

if ($Action -eq "login") {
    $json | ConvertTo-Json -Depth 4
    exit
}

$apiBase = "$base/;stok=$stok/api"
switch ($Action) {
    "status" { $ep = "$apiBase/misystem/status" }
    "devices" { $ep = "$apiBase/misystem/devicelist" }
    "wifi" { $ep = "$apiBase/xqnetwork/wifi_list" }
}
$out = curl.exe --noproxy "*" -s -k -m 15 "$ep"
$out -join "`n"
