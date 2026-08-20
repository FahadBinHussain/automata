<#
.SYNOPSIS
Wakes a machine via Wake-on-LAN magic packet.

.DESCRIPTION
Sends a WoL magic packet (UDP broadcast port 9) to the given MAC.
Works only on the same LAN as the target.
Defaults target the home desktop (desktop-main); MAC + LAN broadcast for the
MiWiFi router network (set them in tailscale.com/.env.local). MAC inventory
lives in %APPDATA%\mainframe\accounts\tailscale\<email>\machines.json.

Usage:
  .\wake-desktop.ps1                      # wake desktop-main (defaults)
  .\wake-desktop.ps1 -Mac "AA-BB-CC-DD-EE-FF" -Broadcast "192.168.1.255"
#>

param(
    [string]$Mac = "",
    [string]$Broadcast = "",
    [int]$Port = 9
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
if (-not $Mac -or -not $Broadcast) { throw "set WAKE_MAC/WAKE_BROADCAST in tailscale.com/.env.local (device MAC + LAN broadcast are personal)" }

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
