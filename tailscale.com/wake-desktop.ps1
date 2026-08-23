<#
.SYNOPSIS
Wakes a machine via Wake-on-LAN magic packet.

.DESCRIPTION
Sends WoL magic packets using multiple strategies so it works even when a
router filters broadcast from Wi-Fi to Ethernet or drops a single packet:
  - subnet broadcast (e.g. <lan-broadcast>)
  - directed broadcast of the target IP (<ip> -> <lan-broadcast>)
  - unicast to the target IP directly (works when the router knows the MAC)
  - on both common WoL ports (7 and 9)
  - repeated bursts for reliability
Works only on the same LAN as the target.

Defaults target the home desktop (desktop-main); MAC + LAN broadcast + target IP
set in tailscale.com/.env.local. MAC inventory lives in
%APPDATA%\mainframe\accounts\tailscale\<email>\machines.json.

Usage:
  .\wake-desktop.ps1                        # wake desktop-main (defaults)
  .\wake-desktop.ps1 -Mac "AA-BB-CC-DD-EE-FF" -Broadcast "192.168.1.255" -TargetIp "192.168.1.50"
#>

param(
    [string]$Mac = "",
    [string]$Broadcast = "",
    [string]$TargetIp = "",
    [int[]]$Ports = @(7, 9),
    [int]$Bursts = 3
)

$envLocal = Join-Path $PSScriptRoot ".env.local"
if (Test-Path $envLocal) {
    foreach ($line in Get-Content $envLocal) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2].Trim().Trim('"', "'"), "Process")
        }
    }
}

if (-not $Mac) { $Mac = $env:WAKE_MAC }
if (-not $Broadcast) { $Broadcast = $env:WAKE_BROADCAST }
if (-not $TargetIp) { $TargetIp = $env:WAKE_TARGET_IP }
if (-not $Mac -or -not $Broadcast) { throw "set WAKE_MAC/WAKE_BROADCAST in tailscale.com/.env.local (device MAC + LAN broadcast are personal)" }

$hex = $Mac -replace "[:-]", ""
if ($hex.Length -ne 12) { throw "invalid MAC: $Mac" }

# Magic packet: 6x 0xFF then 16x the MAC (102 bytes total)
$bytes = New-Object byte[] 102
for ($i = 0; $i -lt 6; $i++) { $bytes[$i] = 0xFF }
for ($i = 6; $i -lt 102; $i += 6) {
    for ($j = 0; $j -lt 6; $j++) { $bytes[$i + $j] = [Convert]::ToByte($hex.Substring($j * 2, 2), 16) }
}

$targets = @($Broadcast)
if ($TargetIp) {
    $targets += $TargetIp
    # directed broadcast: same network, host bits all 1s
    $parts = $TargetIp -split '\.'
    if ($parts.Count -eq 4) {
        $directed = "$($parts[0]).$($parts[1]).$($parts[2]).255"
        if ($directed -ne $Broadcast) { $targets += $directed }
    }
}
$targets = $targets | Sort-Object -Unique

$sent = 0
for ($b = 0; $b -lt $Bursts; $b++) {
    foreach ($dest in $targets) {
        foreach ($port in $Ports) {
            try {
                $udp = New-Object System.Net.Sockets.UdpClient
                $udp.EnableBroadcast = $true
                $udp.Connect($dest, $port)
                $n = $udp.Send($bytes, $bytes.Length)
                $udp.Close()
                $sent++
            } catch {
                Write-Warning "send to $dest`:$port failed: $($_.Exception.Message)"
            }
        }
    }
    if ($b -lt $Bursts - 1) { Start-Sleep -Milliseconds 300 }
}

"Sent $sent magic packets to $Mac -> $($targets -join ', ') (ports $($Ports -join '/'), bursts $Bursts)"