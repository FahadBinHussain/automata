# launch a non-steam shortcut through the steam client, the same way the library UI does
# route (learned 2026-08-11, nightly client 1785799196):
#   UI calls the CEF bridge:  SteamClient.Apps.RunGame(overview.gameid, "", -1, 0)
#   shortcut gameid comes from window.appStore.GetAppOverviewByAppID(<appid>).gameid
#   (steam://rungameid/<x> URLs DON'T work for shortcuts in this client - steamid.cpp rejects them)
# externally we reach the bridge via the CEF remote-debugging port that is only open when
# steam.exe is started with -cef-enable-debugging (steamwebhelper then listens on 127.0.0.1:8080)
#
# usage:
#   .\steam-launch.ps1 -Game "PEAK"                # launch by shortcut display name
#   .\steam-launch.ps1 -Game "gta-vc"
#   .\steam-launch.ps1 -List                       # show names + appids the launcher knows
#   .\steam-launch.ps1 -Game "PEAK" -Restart       # allow auto-restarting steam with the debug flag
#
# notes:
# - if steam is running WITHOUT -cef-enable-debugging, the script errors unless -Restart is passed
# - steam is started with the flag automatically when it is not running
# - first boot after enabling the flag can take several minutes (htmlcache rebuild); the script
#   polls until the UI bridge is ready (up to 10 minutes)

param(
    [Parameter(Position = 0)][ValidateSet('launch', 'list')][string]$Command = 'launch',
    [string]$Game,
    [switch]$Restart
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$CdpEval = Join-Path $ScriptDir 'steam-cdp-eval.mjs'
$ShortcutsScript = Join-Path $ScriptDir 'steam-shortcuts.ps1'
$SteamExe = 'C:\Users\<user>\scoop\apps\steam\current\steam.exe'
$CdpUrl = 'http://127.0.0.1:8080'

function Get-ShortcutTable {
    $out = & $ShortcutsScript list 2>&1 | Out-String
    $table = [System.Collections.ArrayList]@()
    foreach ($line in ($out -split "`r?`n")) {
        if ($line -match '\[(\d+)\] ([0-9A-F]{8})  (.+?)  ->  (.+)$') {
            $appidHex = $matches[2]
            $appidDec = [System.Convert]::ToInt64($appidHex, 16).ToString()
            [void]$table.Add([pscustomobject]@{ Name = $matches[3]; AppIdDec = $appidDec; AppIdHex = $appidHex; Exe = $matches[4].Trim('"') })
        }
    }
    $table
}

function Get-SteamWebHelperPort {
    $wh = Get-Process steamwebhelper -ErrorAction SilentlyContinue | Where-Object { -not $_.StartInfo }
    foreach ($p in (Get-Process steamwebhelper -ErrorAction SilentlyContinue)) {
        $conns = Get-NetTCPConnection -OwningProcess $p.Id -State Listen -ErrorAction SilentlyContinue
        foreach ($c in $conns) {
            if ($c.LocalAddress -in @('127.0.0.1', '0.0.0.0')) { return $c.LocalPort }
        }
    }
    $null
}

function Invoke-SteamCdp {
    param([string]$Expression)
    $targets = Invoke-RestMethod -Uri "$CdpUrl/json" -TimeoutSec 10
    $target = $targets | Where-Object { $_.title -eq 'SharedJSContext' -or ($_.url -match 'steamloopback\.host.*IN_CLIENT=true') } | Select-Object -First 1
    if (-not $target) { throw 'SharedJSContext target not found on CDP port - UI not fully loaded yet?' }
    $result = & node $CdpEval $target.webSocketDebuggerUrl $Expression 2>&1
    if ($LASTEXITCODE -ne 0) { throw "CDP eval failed: $result" }
    $result | Out-String
}

if ($Command -eq 'list') {
    Get-ShortcutTable | Format-Table -AutoSize
    exit 0
}

if (-not $Game) { throw '-Game <name> is required' }
$shortcuts = Get-ShortcutTable
$sc = $shortcuts | Where-Object { $_.Name -eq $Game } | Select-Object -First 1
if (-not $sc) { throw "shortcut '$Game' not found. available: $(( $shortcuts | ForEach-Object { $_.Name } ) -join ', ')" }
Write-Host "target: $($sc.Name) (appid $($sc.AppIdDec))"

$steam = Get-Process steam -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $steam) {
    Write-Host 'steam not running - starting with -cef-enable-debugging...'
    Start-Process $SteamExe -ArgumentList '-cef-enable-debugging'
} elseif (-not (Get-SteamWebHelperPort)) {
    if (-not $Restart) {
        # auto disable bold? plain message:
        Write-Host @"
steam IS running but WITHOUT -cef-enable-debugging (no CDP port) - the launch route needs it.
close steam and rerun, or pass -Restart to have this script restart steam for you
(-Restart is skipped automatically when a game process is running).
"@ -NoNewline
        throw 'steam must run with -cef-enable-debugging for the CDP launch route'
    }
    Write-Host 'restarting steam with -cef-enable-debugging...'
    foreach ($p in (Get-Process steam, steamwebhelper -ErrorAction SilentlyContinue)) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 4
    Start-Process $SteamExe -ArgumentList '-cef-enable-debugging'
}

$deadline = (Get-Date).AddMinutes(10)
$portReady = $false
while ((Get-Date) -lt $deadline) {
    if (Get-SteamWebHelperPort) { $portReady = $true; break }
    Start-Sleep -Seconds 5
}
if (-not $portReady) { throw 'CDP port never came up (10 min timeout) - check steam log' }

Write-Host 'waiting for UI bridge (appStore/SteamClient)...'
$expr = @"
(async () => {
    const appid = $($sc.AppIdDec);
    const deadline = Date.now() + 8 * 60 * 1000;
    while (Date.now() < deadline) {
        try {
            if (window.appStore && window.SteamClient && window.SteamClient.Apps) {
                const ov = window.appStore.GetAppOverviewByAppID(appid);
                if (ov && ov.gameid) {
                    window.SteamClient.Apps.RunGame(ov.gameid, '', -1, 0);
                    return 'launched gameid=' + ov.gameid + ' name=' + ov.display_name;
                }
            }
        } catch (e) { }
        await new Promise(r => setTimeout(r, 5000));
    }
    return 'timeout waiting for appStore overview of appid ' + appid;
})()
"@
$res = Invoke-SteamCdp -Expression $expr
Write-Host "result: $res"
if ($res -match 'launched') { Write-Host "OK - $($sc.Name) launch requested through steam" }
else { Write-Host "WARNING: $res" }