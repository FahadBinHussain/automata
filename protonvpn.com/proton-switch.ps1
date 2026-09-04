# proton-switch.ps1 - Proton free VPN server switcher (openvpn userspace, tailscale-safe)
# usage:
#   proton-switch.ps1 list              # free servers by country (load, up count)
#   proton-switch.ps1 <cc|name>         # connect, e.g: nl  us  jp  ro  or "NL-FREE#79"
#   proton-switch.ps1 best              # lowest-load free server
#   proton-switch.ps1 status            # current exit ip, lan, tailscale
#   proton-switch.ps1 off               # kill tunnel
# requires: openvpn (scoop), C:\tmp\sbx\wg\auth-ovpn.txt (openvpn/IKEv2 creds)
$ErrorActionPreference = 'Stop'
$wg = 'C:\tmp\sbx\wg'
$auth = "$wg\auth-ovpn.txt"
$session = "$env:USERPROFILE\.protonvpn-session.json"
$ovpnPath = "$wg\current.ovpn"

# personal values from <folder>\.env.local (gitignored)
foreach ($line in Get-Content "$PSScriptRoot\.env.local" -ErrorAction SilentlyContinue) {
  if ($line -match '^([A-Z_]+)=(.+)$') { Set-Variable -Name $Matches[1] -Value $Matches[2].Trim() }
}
$LAN_GW = if ($LAN_GW) { $LAN_GW } else { '<lan-gw>' }
$LAN_DESKTOP_IP = if ($LAN_DESKTOP_IP) { $LAN_DESKTOP_IP } else { '<lan-desktop-ip>' }
$TS_DESKTOP_IP = if ($TS_DESKTOP_IP) { $TS_DESKTOP_IP } else { '<ts-desktop-ip>' }

function Get-Session {
  $base = Get-Content $session -Raw | ConvertFrom-Json
  $uid, $rt = $base.session.UID, $base.session.RefreshToken
  $body = @{ GrantType = 'refresh_token'; RefreshToken = $rt; UID = $uid; RedirectURI = 'protonvpn://proton.me' } | ConvertTo-Json -Compress
  $r = Invoke-RestMethod -Uri 'https://account.proton.me/api/auth/v4/refresh' -Method Post -ContentType 'application/json' -Body $body -Headers @{ 'x-pm-appversion' = 'Other' } -TimeoutSec 20
  if ($r.Code -ne 1000) { throw "proton refresh failed: $($r.Code) $($r.Error)" }
  $base.session.AccessToken = $r.AccessToken
  $base.session.RefreshToken = $r.RefreshToken
  $base | ConvertTo-Json -Depth 10 | Set-Content $session -Encoding UTF8
  @{ Tok = $r.AccessToken; Uid = $uid }
}

function Get-Logicals {
  $s = Get-Session
  $h = @{ Authorization = "Bearer $($s.Tok)"; 'x-pm-appversion' = 'Other'; 'x-pm-uid' = $s.Uid }
  (Invoke-RestMethod -Uri 'https://vpn-api.proton.me/vpn/logicals?Logicals=1' -Headers $h -TimeoutSec 20).LogicalServers | Where-Object Tier -eq 0
}

function Get-Ovpn {
  param($logicalId, $proto = 'tcp')
  $s = Get-Session
  $h = @{ Authorization = "Bearer $($s.Tok)"; 'x-pm-appversion' = 'Other'; 'x-pm-uid' = $s.Uid }
  $body = @{ Platform = 'Windows'; Protocol = $proto; LogicalID = $logicalId } | ConvertTo-Json -Compress
  $cfg = Invoke-RestMethod -Uri 'https://vpn-api.proton.me/vpn/config' -Method Post -Headers $h -ContentType 'application/json' -Body $body -TimeoutSec 20
  $cfg.OpenVPNConfig -replace '(?m)^proto ', "proto `ndisable-dco`nproto "
}

function Stop-Tunnel {
  Get-Process openvpn -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 2
}

function Test-Coexistence {
  $lan = Test-Connection $LAN_DESKTOP_IP -Count 1 -Quiet
  $ts = Test-NetConnection $TS_DESKTOP_IP -Port 22 -WarningAction SilentlyContinue -InformationLevel Quiet
  @{ Lan = $lan; Ts = $ts }
}

switch ($args[0]) {
  $null { throw "usage: list | best | <cc|name> | status | off" }
  'list' {
    $l = Get-Logicals | Sort-Object ExitCountry, Name
    $groups = $l | Group-Object ExitCountry
    foreach ($g in $groups) {
      $best = $g.Group | Sort-Object Load | Select-Object -First 1
      $up = ($best.Servers | Where-Object Status -eq 1).Count
      "{0}: {1} logicals | best: {2} load {3}% up {4}/{5}" -f $g.Name, $g.Count, $best.Name, $best.Load, $up, $best.Servers.Count
    }
  }
  'best' {
    $pick = Get-Logicals | Sort-Object Load | Select-Object -First 1
    & $PSCommandPath $pick.Name
  }
  'status' {
    try { $ip = (Invoke-RestMethod -Uri 'https://ifconfig.me/ip' -TimeoutSec 12).Trim(); "vpn exit: $ip" } catch { "vpn: not connected (direct)" }
    if (Test-Path "$wg\state.txt") { "server: $(Get-Content "$wg\state.txt" -Raw)" }
    $c = Test-Coexistence
    "lan: $($c.Lan)  tailscale-ssh: $($c.Ts)"
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceAlias -like '*OpenVPN*' } | ForEach-Object { "tunnel ip: $($_.IPAddress)" }
  }
  'off' {
    Stop-Tunnel
    Remove-Item "$wg\state.txt" -ErrorAction SilentlyContinue
    "tunnel down (direct)"
  }
  default {
    $want = $args[0]
    $all = Get-Logicals
    $pick = $all | Where-Object { $_.Name -eq $want } | Select-Object -First 1
    if (-not $pick) { $pick = $all | Where-Object { $_.ExitCountry -eq $want -and $_.Name -notmatch 'TOR|Secure' } | Sort-Object Load | Select-Object -First 1 }
    if (-not $pick) { $pick = $all | Where-Object { $_.Name -like "*$want*" } | Sort-Object Load | Select-Object -First 1 }
    if (-not $pick) { throw "no free server matches '$want'. try 'list'." }
    $upServers = @($pick.Servers | Where-Object Status -eq 1)
    if (-not $upServers) { throw "$($pick.Name) has 0 online servers, pick another" }
    $endpoint = ($upServers | Get-Random).EntryIp
    "connecting: $($pick.Name) ($endpoint, load $($pick.Load)%)"

    Stop-Tunnel
    $ovpn = Get-Ovpn $pick.ID 'tcp'
    # pin endpoint to the actual physical server (config may use domain)
    $ovpn = $ovpn -replace '(?m)^remote \S+', "remote $endpoint"
    Set-Content $ovpnPath $ovpn -Encoding ASCII

    # pre-pin endpoint route via lan gateway so tunnel traffic never enters tailscale
    route delete $endpoint mask 255.255.255.255 2>$null | Out-Null
    route add $endpoint mask 255.255.255.255 $LAN_GW metric 1 | Out-Null

    Remove-Item "$wg\current.log" -ErrorAction SilentlyContinue
    Start-Process -FilePath 'C:\Program Files\OpenVPN\bin\openvpn.exe' -ArgumentList '--config', $ovpnPath, '--auth-user-pass', $auth, '--log', "$wg\current.log", '--verb', '3' -WindowStyle Hidden

    # watchdog: internet must come back in 50s or kill tunnel
    $ok = $false
    foreach ($i in 1..10) {
      Start-Sleep -Seconds 5
      try { $ip = (Invoke-RestMethod -Uri 'https://ifconfig.me/ip' -TimeoutSec 6).Trim(); $ok = $true; break } catch { }
      if (-not (Get-Process openvpn -ErrorAction SilentlyContinue)) { break }
    }
    if (-not $ok) {
      Stop-Tunnel
      Get-Content "$wg\current.log" -Tail 5 -ErrorAction SilentlyContinue | ForEach-Object { "  | $_" }
      throw "connection failed - killed openvpn, you are back on direct. try another server."
    }
    $c = Test-Coexistence
    "vpn exit: $ip"
    "server: $($pick.Name)"
    "lan: $($c.Lan)  tailscale-ssh: $($c.Ts)"
    if (-not $c.Ts) { "WARNING: tailscale blocked on this server!" }
    Set-Content "$wg\state.txt" $pick.Name -Encoding UTF8
  }
}
