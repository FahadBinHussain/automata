<#
.SYNOPSIS
Wakes a machine via Wake-on-LAN magic packet.

.DESCRIPTION
Sends a WoL magic packet (UDP broadcast port 9) to the given MAC.
Works only on the same LAN as the target.

Usage:
  .\wake-desktop.ps1 -Mac "AA-BB-CC-DD-EE-FF" -Broadcast "192.168.1.255"
#>

param(
    [Parameter(Mandatory = $true)][string]$Mac,
    [Parameter(Mandatory = $true)][string]$Broadcast,
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
