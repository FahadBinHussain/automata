<#
.SYNOPSIS
scp a script to a remote tailscale peer, run it via ssh, and return the output.

.DESCRIPTION
Wraps the scp + ssh + Start-Job/Wait-Job pattern that an agent bash tool
needs when calling a remote machine.  The agent bash tool hangs when ssh
polls for a long-running command; wrapping in a background job with a
timeout avoids that.

Default target is the home desktop (desktop-main; see tailscale.com/.env.local for
host/user).  Set these in tailscale.com/.env.local:
  TAILSCALE_SSH_KEY_NAME=<fleet key name>  (default: id_ed25519_dolby)
  REMOTE_USER=<remote username>             (default: admin)
  REMOTE_HOST=<LAN IP or tailscale IP>      (default: see .env.local)
  REMOTE_PORT=<ssh port>                    (default: 22)

Usage:
  .\remote-run.ps1 C:\path\to\script.ps1                 # run on desktop
  .\remote-run.ps1 C:\path\to\script.ps1 -Timeout 120     # override default 120s
  .\remote-run.ps1 C:\path\to\script.ps1 -Host <ip> -User <user> -KeyName <key-name>
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$ScriptPath,

    [int]$TimeoutSeconds = 120,

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
if (-not $RemoteHost) { throw "REMOTE_HOST not set - add it to tailscale.com/.env.local or pass -Host" }

$sshKey = Join-Path $env:USERPROFILE ".ssh\$KeyName"
if (-not (Test-Path -LiteralPath $sshKey)) {
    throw "SSH key not found at $sshKey - set TAILSCALE_SSH_KEY_NAME in .env.local or pass -KeyName"
}

$remoteScriptName = Split-Path -Leaf $ScriptPath
# Fixed remote name (no spaces) so the remote `powershell -File` never chokes
# on spaces in the source filename; scp handles spaces fine, -File does not.
$remoteScriptAbs = "C:\Users\$RemoteUser\AppData\Local\Temp\remote-run-script.ps1"
# Windows scp parses "user@host:path" as ONE argument; a separate path string is
# misread as a hostname. Build the full target in a single string.
$scpTarget = "${RemoteUser}@${RemoteHost}:${remoteScriptAbs}"
if (-not $Quiet) { Write-Host "scp $ScriptPath -> $scpTarget" }
$result = scp -i $sshKey -o StrictHostKeyChecking=accept-new -P $Port "$ScriptPath" "$scpTarget" 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "scp failed (exit $LASTEXITCODE): $result"
}

# ssh via background job so the caller never hangs
# Remote cmd.exe strips the inner backslash-escaped quotes, so pass the path
# unquoted (no spaces in the temp path) to avoid \C:\ corruption.
$job = Start-Job -ScriptBlock {
    param($k, $u, $h, $p, $s)
    & ssh -i $k -o StrictHostKeyChecking=accept-new -p $p "$u@$h" "powershell -ExecutionPolicy Bypass -File $s"
} -ArgumentList $sshKey, $RemoteUser, $RemoteHost, $Port, $remoteScriptAbs

$waitResult = Wait-Job $job -Timeout $TimeoutSeconds
if (-not $waitResult) {
    # Stop-Job leaves the ssh child process running; kill it so a stuck remote
    # command doesn't linger on the target.
    $job | Stop-Job -PassThru | Out-Null
    Get-Process -Name ssh -ErrorAction SilentlyContinue | Where-Object {
        $_.StartTime -gt (Get-Date).AddSeconds(-$TimeoutSeconds - 10)
    } | Stop-Process -Force -ErrorAction SilentlyContinue
    Remove-Job $job -Force
    throw "remote execution timed out after ${TimeoutSeconds}s"
}

$output = Receive-Job $job
Remove-Job $job -Force

if (-not $Quiet) { Write-Host "--- remote output ---" }
$output