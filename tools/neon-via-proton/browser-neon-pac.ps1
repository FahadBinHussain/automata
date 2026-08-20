# browser-neon-pac.ps1 - route ONLY *.neon.tech browser traffic (extension SW,
# websockets, https) through mihomo's socks port so neon works while proton vpn
# is on; everything else stays DIRECT. sets the Windows WinINET PAC, which
# Edge/Chrome (and their MV3 service workers) honor.
#
# usage:
#   pwsh browser-neon-pac.ps1 -Status        # show current wininet proxy state
#   pwsh browser-neon-pac.ps1 -Enable        # ensure PAC server up, set PAC
#   pwsh browser-neon-pac.ps1 -Disable       # clear PAC, ProxyEnable=0
#
# gotchas:
# - socks port comes from v2rayn binConfigs/config.json - it's YAML with a
#   UTF-8 BOM (as of 2026-08-19), NOT json, so regex it.
# - the PAC MUST be served over http://127.0.0.1 - a file:// AutoConfigURL is
#   loaded by headless chrome but NOT by normal browser mode: the PAC fetch
#   fails, the browser falls back to the stale ProxyServer value
#   (127.0.0.1:7890, dead) and EVERYTHING dies ("no internet"). -Enable clears
#   ProxyServer too so there is no fallback to a dead proxy.
# - PAC answers SOCKS5 127.0.0.1:7891 only for *.neon.tech; fallback DIRECT.
# - WinINET needs InternetSetOption refresh or running browsers may keep the
#   old settings cached for a while; the P/Invoke refresh below handles it.
# - if mihomo's url-test group sits on a dead node, neon requests hang until
#   the group re-picks a live one - same flakiness as socks5-fwd.ps1, retry.

param(
    [switch]$Enable,
    [switch]$Disable,
    [switch]$Status
)

$scriptDir = $PSScriptRoot
$pacFile = Join-Path $scriptDir "neon-pac.js"
$pacUrl = "http://127.0.0.1:8000/neon-pac.js"
$pacServerPort = 8000
$inetKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
$python = "$env:USERPROFILE\scoop\apps\python312\current\python.exe"

# read current socks port from v2rayn's generated config (source of truth)
# note: this file is YAML (with BOM), NOT json, as of 2026-08-19 - regex it.
$configPath = "$env:USERPROFILE\scoop\apps\v2rayn\current\binConfigs\config.json"
$socksPort = '7891'
if (Test-Path $configPath) {
    $cfgRaw = Get-Content $configPath -Raw
    if ($cfgRaw -match '^\s*socks-port:\s*(\d+)') {
        $socksPort = $Matches[1]
    }
}

function Ensure-PacServer {
    try {
        $r = Invoke-WebRequest -Uri $pacUrl -UseBasicParsing -TimeoutSec 3
        if ($r.StatusCode -eq 200) { return $true }
    } catch { }
    if (-not (Test-Path $python)) { return $false }
    Start-Process -FilePath $python -ArgumentList '-m','http.server',"$pacServerPort",'--bind','127.0.0.1','--directory',$scriptDir -WindowStyle Hidden
    Start-Sleep -Seconds 2
    try {
        $r = Invoke-WebRequest -Uri $pacUrl -UseBasicParsing -TimeoutSec 3
        return ($r.StatusCode -eq 200)
    } catch { return $false }
}

function Show-Status {
    $s = Get-ItemProperty $inetKey
    $socks = Get-NetTCPConnection -State Listen -LocalPort ([int]$socksPort) -ErrorAction SilentlyContinue
    $pacUp = $false
    try {
        $r = Invoke-WebRequest -Uri $pacUrl -UseBasicParsing -TimeoutSec 3
        $pacUp = ($r.StatusCode -eq 200)
    } catch { }
    [PSCustomObject]@{
        ProxyEnable   = $s.ProxyEnable
        ProxyServer   = $s.ProxyServer
        AutoConfigURL = $s.AutoConfigURL
        SocksAlive    = [bool]$socks
        SocksPort     = $socksPort
        PacServerUp   = $pacUp
    } | Format-List
}

function Set-WinInetRefresh {
    Add-Type -Namespace WinInet -Name Refresh -MemberDefinition @'
[DllImport("wininet.dll", SetLastError = true)]
public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
'@
    $null = [WinInet.Refresh]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) # SETTINGS_CHANGED
    $null = [WinInet.Refresh]::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) # REFRESH
}

if ($Status -or (-not $Enable -and -not $Disable)) {
    Show-Status
    exit 0
}

if ($Disable) {
    Set-ItemProperty $inetKey -Name ProxyEnable -Value 0
    Remove-ItemProperty $inetKey -Name AutoConfigURL -ErrorAction SilentlyContinue
    Set-WinInetRefresh
    Write-Output "pac: disabled (proxy off, autoconfig cleared)"
    Show-Status
    exit 0
}

if ($Enable) {
    if (-not (Test-Path $pacFile)) {
        Write-Output "pac: ERROR $pacFile missing"
        exit 1
    }
    $socks = Get-NetTCPConnection -State Listen -LocalPort ([int]$socksPort) -ErrorAction SilentlyContinue
    if (-not $socks) {
        Write-Output "pac: ERROR socks ${socksPort} not listening - mihomo core dead, resurrect it first (see neon-via-proton AGENTS.md), exiting."
        exit 1
    }
    if (-not (Ensure-PacServer)) {
        Write-Output "pac: ERROR could not serve $pacUrl (python http.server failed?) - exiting without changing proxy settings."
        exit 1
    }
    Set-ItemProperty $inetKey -Name ProxyEnable -Value 1
    Set-ItemProperty $inetKey -Name AutoConfigURL -Value $pacUrl
    Set-ItemProperty $inetKey -Name ProxyServer -Value ''   # no fallback to a stale dead proxy
    Set-WinInetRefresh
    Write-Output "pac: enabled $pacUrl (neon.tech -> SOCKS5 127.0.0.1:$socksPort, rest DIRECT)"
    Show-Status
    exit 0
}
