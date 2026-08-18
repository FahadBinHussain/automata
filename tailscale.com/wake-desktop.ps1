<#
.SYNOPSIS
Wakes a machine via Wake-on-LAN magic packet.

.DESCRIPTION
Sends a WoL magic packet (UDP broadcast port 9) to the given MAC.
Works only on the same LAN as the target.
Defaults target the home desktop (desktop-main); MAC + LAN broadcast for the
MiWiFi router network (<lan-cidr>). MAC inventory lives in
%APPDATA%\mainframe\accounts\tailscale\<email>\machines.json.

Usage:
  .\wake-desktop.ps1                      # wake desktop-main (defaults)
  .\wake-desktop.ps1 -Mac "AA-BB-CC-DD-EE-FF" -Broadcast "192.168.1.255"
#>

param(
    [string]$Mac = "<mac>",
    [string]$Broadcast = "<broadcast-ip>",
    [int]$Port = 9
)

$hex = $Mac -replace "[:-]", ""
if ($hex.Length -ne 12) { throw "invalid MAC: $Mac" }

$bytes = New-Object byte[] 102
for ($i = 0; $i -lt 6; $i++) { $bytes[$i] = 0xFF }
$macBytes = New-Object byte[] 6
for ($i = 0; $i -lt 6; $i++) { $macBytes[$i] = [Convert]::ToByte($hex.Substring($i * 2, 2), 16) }
for ($i = 6; $i -lt 102; $i += 6) { [Array]::Copy($macBytes, 0, $bytes, $i, 6) }

$udp = New-Object System.Net.Sockets.UdpClient
$udp.Connect($Broadcast, $Port)
$udp.Send($bytes, $bytes.Length) | Out-Null
$udp.Close()

"Magic packet sent to $Mac via $Broadcast`:$Port"
