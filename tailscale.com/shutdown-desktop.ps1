<#
.SYNOPSIS
Shuts down a remote tailscale peer (defaults to the home desktop).

.DESCRIPTION
Runs `shutdown /s /f /t 0` on the remote machine via ssh. Uses the same
. env.local defaults as wake-desktop.ps1 (REMOTE_HOST / REMOTE_USER /
TAILSCALE_SSH_KEY_NAME) and the Start-Job pattern so the agent shell
doesn't hang when the ssh connection resets mid-shutdown.

Usage:
  .\shutdown-desktop.ps1                          # shutdown desktop-main
  .\shutdown-desktop.ps1 -Host <ip> -User admin
#>

param(
    [string]$KeyName = "",
    [string]$RemoteUser = "",
    [string]$RemoteHost = "",
    [int]$Port = 22,
    [switch]$Quiet
)

$envLocal = Join-Path $PSScriptRoot ".env.local"
if (Test-Path $envLocal) {
    foreach ($line in Get-Content $envLocal) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2].Trim().Trim('"', "'"), "Process")
        }
    }
}

if (-not $KeyName) { $KeyName = $env:TAILSCALE_SSH_KEY_NAME }
if (-not $RemoteUser) { $RemoteUser = $env:REMOTE_USER }
if (-not $RemoteHost) { $RemoteHost = $env:REMOTE_HOST }
if (-not $KeyName) { $KeyName = 'id_ed25519_dolby' }
if (-not $RemoteUser) { $RemoteUser = 'admin' }
if (-not $RemoteHost) { $RemoteHost = '<ip>' }

$sshKey = Join-Path $env:USERPROFILE ".ssh\$KeyName"
if (-not (Test-Path -LiteralPath $sshKey)) {
    throw "SSH key not found at $sshKey"
}

$job = Start-Job -ScriptBlock {
    param($k, $u, $h, $p)
    & ssh -i $k -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -p $p "$u@$h" "shutdown /s /f /t 0"
} -ArgumentList $sshKey, $RemoteUser, $RemoteHost, $Port

$waitResult = Wait-Job $job -Timeout 20
if ($waitResult) {
    $output = Receive-Job $job
    Remove-Job $job -Force
    if (-not $Quiet) { Write-Host "Shutdown command sent to $RemoteHost" }
    $output
} else {
    # Connection reset during shutdown is EXPECTED (machine goes down mid-command)
    $job | Stop-Job -Force -ErrorAction SilentlyContinue
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    if (-not $Quiet) { Write-Host "Shutdown command sent to $RemoteHost (connection dropped - expected during shutdown)" }
}