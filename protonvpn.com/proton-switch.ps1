# proton-switch.ps1 - Proton free VPN server switcher (openvpn userspace, tailscale-safe)
# usage:
#   proton-switch.ps1 list              # free servers by country (load, up count)
#   proton-switch.ps1 <cc|name>         # connect, e.g: nl  us  jp  ro  or "NL-FREE#79"
#   proton-switch.ps1 static <ovpn>     # connect from saved .ovpn, no api needed
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
  try {
    $r = Invoke-RestMethod -Uri 'https://account.proton.me/api/auth/v4/refresh' -Method Post -ContentType 'application/json' -Body $body -Headers @{ 'x-pm-appversion' = 'Other' } -TimeoutSec 20
  } catch {
    throw "proton session refresh failed (account may be rate-limited or logged out): $($_.Exception.Message)"
  }
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

function Connect-Ovpn {
  param($endpoint, $ovpn, $label)
  try { $directIp = (Invoke-RestMethod -Uri 'https://ifconfig.me/ip' -TimeoutSec 10).Trim() } catch { $directIp = $null }
  "connecting: $label ($endpoint)"
  Stop-Tunnel
  # pin endpoint to the actual physical server (config may use domain)
  $ovpn = $ovpn -replace '(?m)^remote \S+', "remote $endpoint"
  if ($ovpn -notmatch '(?m)^disable-dco') { $ovpn = "disable-dco`n" + $ovpn }
  Set-Content $ovpnPath $ovpn -Encoding ASCII

  # pre-pin endpoint route via lan gateway so tunnel traffic never enters tailscale
  route delete $endpoint mask 255.255.255.255 2>$null | Out-Null
  route add $endpoint mask 255.255.255.255 $LAN_GW metric 1 | Out-Null

  Remove-Item "$wg\current.log" -ErrorAction SilentlyContinue
  Start-Process -FilePath 'C:\Program Files\OpenVPN\bin\openvpn.exe' -ArgumentList '--config', $ovpnPath, '--auth-user-pass', $auth, '--log', "$wg\current.log", '--verb', '3' -WindowStyle Hidden

  # watchdog: a real tunnel ip must appear AND the exit ip must differ from
  # pre-connect direct (checking ifconfig.me alone races redirect-gateway and
  # "verifies" over direct). 60s max or kill, never stay offline silently.
  $ok = $false; $ip = $null
  foreach ($i in 1..12) {
    Start-Sleep -Seconds 5
    if (-not (Get-Process openvpn -ErrorAction SilentlyContinue)) { break }
    $tunNow = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { ($_.InterfaceAlias -like '*OpenVPN*' -or $_.InterfaceAlias -like '*TAP*') -and $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' }
    if (-not $tunNow) { continue }
    try { $ip = (Invoke-RestMethod -Uri 'https://ifconfig.me/ip' -TimeoutSec 6).Trim() } catch { continue }
    if ($null -eq $directIp -or $ip -ne $directIp) { $ok = $true; break }
  }
  if (-not $ok -or -not (Get-Process openvpn -ErrorAction SilentlyContinue)) {
    Stop-Tunnel
    Get-Content "$wg\current.log" -Tail 5 -ErrorAction SilentlyContinue | ForEach-Object { "  | $_" }
    throw "connection failed - killed openvpn, you are back on direct. try another server."
  }
  $c = Test-Coexistence
  "vpn exit: $ip"
  "server: $label"
  "lan: $($c.Lan)  tailscale-ssh: $($c.Ts)"
  if (-not $c.Ts) { "WARNING: tailscale blocked on this server!" }
  Set-Content "$wg\state.txt" $label -Encoding UTF8
}

switch ($args[0]) {
  $null { throw "usage: list | best | <cc|name> | static <ovpn> | status | off" }
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
    # ON only when a real tunnel exists: openvpn running + non-link-local tunnel ip.
    # (ifconfig.me alone can't distinguish vpn from direct - that false positive
    # painted the gui green on direct connections.)
    $tunUp = $null -ne (Get-Process openvpn -ErrorAction SilentlyContinue)
    $tunIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { ($_.InterfaceAlias -like '*OpenVPN*' -or $_.InterfaceAlias -like '*TAP*') -and $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' } | Select-Object -ExpandProperty IPAddress
    if ($tunUp -and $tunIp) {
      try { $ip = (Invoke-RestMethod -Uri 'https://ifconfig.me/ip' -TimeoutSec 12).Trim(); "vpn exit: $ip" } catch { "vpn exit: (tunnel up, exit check failed)" }
      if (Test-Path "$wg\state.txt") { "server: $(Get-Content "$wg\state.txt" -Raw)" }
    } else {
      try { $ip = (Invoke-RestMethod -Uri 'https://ifconfig.me/ip' -TimeoutSec 12).Trim(); "direct exit: $ip (vpn OFF)" } catch { "direct exit: (offline?)" }
      if (Test-Path "$wg\state.txt") { "stale state: $((Get-Content "$wg\state.txt" -Raw).Trim()) (no tunnel!)" }
      if ($tunUp) { "note: openvpn running but no tunnel ip yet (connecting?)" }
    }
    $c = Test-Coexistence
    "lan: $($c.Lan)  tailscale-ssh: $($c.Ts)"
    foreach ($t in $tunIp) { "tunnel ip: $t" }
  }
  'off' {
    Stop-Tunnel
    Remove-Item "$wg\state.txt" -ErrorAction SilentlyContinue
    "tunnel down (direct)"
  }
  'static' {
    # no-API connect from a saved .ovpn (account limited? api dead? this still works)
    $src = $args[1]
    if (-not $src -or -not (Test-Path $src)) { throw "usage: static <path-to-ovpn>" }
    $raw = Get-Content $src -Raw
    $m = [regex]::Match($raw, '(?m)^remote\s+(\S+)')
    if (-not $m.Success) { throw "no remote line in $src" }
    $endpoint = $m.Groups[1].Value
    if ($endpoint -notmatch '^\d+\.\d+\.\d+\.\d+$') {
      $endpoint = (Resolve-DnsName $endpoint -Type A -ErrorAction Stop | Select-Object -First 1).IPAddress.ToString()
      "resolved endpoint -> $endpoint"
    }
    Connect-Ovpn $endpoint $raw "static:$(Split-Path $src -Leaf)"
  }
  default {
    $want = $args[0]
    try { $all = Get-Logicals } catch {
      Write-Output "proton API unreachable: $($_.Exception.Message)"
      throw
    }
    $pick = $all | Where-Object { $_.Name -eq $want } | Select-Object -First 1
    if (-not $pick) { $pick = $all | Where-Object { $_.ExitCountry -eq $want -and $_.Name -notmatch 'TOR|Secure' } | Sort-Object Load | Select-Object -First 1 }
    if (-not $pick) { $pick = $all | Where-Object { $_.Name -like "*$want*" } | Sort-Object Load | Select-Object -First 1 }
    if (-not $pick) { throw "no free server matches '$want'. try 'list'." }
    $upServers = @($pick.Servers | Where-Object Status -eq 1)
    if (-not $upServers) { throw "$($pick.Name) has 0 online servers, pick another" }
    $endpoint = ($upServers | Get-Random).EntryIp
    $label = "$($pick.Name) (load $($pick.Load)%)"

    Stop-Tunnel
    try {
      $ovpn = Get-Ovpn $pick.ID 'tcp'
    } catch {
      Stop-Tunnel
      Write-Output "proton config fetch failed: $($_.Exception.Message)"
      throw
    }
    Connect-Ovpn $endpoint $ovpn $label
  }
}
