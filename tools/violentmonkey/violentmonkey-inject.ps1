# purpose: inject a userscript update straight into Violentmonkey's chrome.storage.local
#   LevelDB, without touching the browser UI. developed 2026-08-24 after the neon watch
#   progress tracker got its 0.7.7 fix and the update was applied this way.
# inputs:
#   -ScriptPath <file.user.js>   the source file to inject
#   -Name <string>               script display-name substring to match (default: derived
#                                from the file's @name header)
#   -CloseBrowser                close Edge first (LevelDB is locked while it runs)
#   -SkipClose                   require Edge closed, error if it is running
#   -Reopen                      reopen Edge after injecting (default: leave closed)
#   -UserDataDir <dir>           override Edge user data dir (default: detected)
#   -Profile <name>              profile folder, default "Default"
#   -BackupDir <dir>             backup destination (default: %TEMP%\opencode\vm-backups)
#   -DbPath <dir>                skip detection, use this exact "Local Extension Settings" dir
#   -List                        just list installed scripts (id/name/version) and exit
# run:
#   pwsh .\tools\violentmonkey\violentmonkey-inject.ps1 -ScriptPath "C:\...\script.user.js" -CloseBrowser -Reopen
# notes:
#   - extension id eeagobfjdenkkddmbclomhiblgggliao = Violentmonkey 2.x (Edge).
#   - storage is a real LevelDB; needs the classic-level npm package (auto-installed to
#     %TEMP%\opencode\vm-edit\node_modules on first run).
#   - scripts live as keys code:<id> (JSON-encoded source string - writing RAW text here
#     breaks Violentmonkey's options page, it hangs forever), scr:<id> (metadata JSON),
#     mod:<id> (timestamp), val:<id> (GM_* values, never touched).
#   - a full backup of the storage dir is taken before every write.
#   - Edge's LevelDB gets rewritten on exit, so we MUST close the browser before injecting,
#     then (optionally) reopen. `mod` and `lastModified` are bumped so update checks see it.
#   - verify step re-reads the stored value and round-trips it back to the source before
#     reporting success; exit code is non-zero on any failure.

param(
    [string]$ScriptPath,
    [string]$Name,
    [switch]$CloseBrowser,
    [switch]$SkipClose,
    [switch]$Reopen,
    [string]$UserDataDir,
    [string]$Profile = "Default",
    [string]$BackupDir,
    [string]$DbPath,
    [switch]$List
)

$ErrorActionPreference = 'Stop'

$VM_EXT_ID = "eeagobfjdenkkddmbclomhiblgggliao"
$toolDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $DbPath) {
    if (-not $UserDataDir) {
        $UserDataDir = "$env:LOCALAPPDATA\Microsoft\Edge\User Data"
    }
    if (-not (Test-Path $UserDataDir)) {
        throw "edge user data dir not found: $UserDataDir (pass -UserDataDir)"
    }
    $DbPath = Join-Path $UserDataDir (Join-Path $Profile "Local Extension Settings\$VM_EXT_ID")
}
if (-not (Test-Path $DbPath)) {
    throw "violentmonkey storage not found at: $DbPath"
}

# --- node helper + classic-level ---
$nodeModules = "$env:TEMP\opencode\vm-edit\node_modules"
$env:VM_NODE_MODULES = $nodeModules
$helper = Join-Path $toolDir "vm-leveldb.mjs"
if (-not (Test-Path (Join-Path $nodeModules "classic-level"))) {
    Write-Host "installing classic-level to $nodeModules ..."
    npm install classic-level --prefix "$env:TEMP\opencode\vm-edit" --no-audit --no-fund | Out-Null
}

if ($List) {
    node $helper list "$DbPath"
    exit $LASTEXITCODE
}
if (-not $ScriptPath) { throw "need -ScriptPath (or -List)" }
if (-not (Test-Path $ScriptPath)) { throw "script not found: $ScriptPath" }

# --- resolve script id by name ---
if (-not $Name) {
    $head = Get-Content -Path $ScriptPath -TotalCount 30 -Encoding utf8
    $m = $head | Where-Object { $_ -match '^\s*//\s*@name\s+(.+?)\s*$' } | Select-Object -First 1
    if ($m) { $Name = ($m -replace '^\s*//\s*@name\s+', '').Trim() }
}
if (-not $Name) { throw "could not derive script name (pass -Name)" }

$found = node $helper find "$DbPath" "$Name" 2>&1
if ($LASTEXITCODE -ne 0) { Write-Host $found; exit $LASTEXITCODE }
$scriptId = ($found -split "\s+")[0]
Write-Host "matched script id $scriptId : $Name"

# --- backup ---
if (-not $BackupDir) { $BackupDir = "$env:TEMP\opencode\vm-backups" }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = Join-Path $BackupDir "vm-storage-$stamp"
New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
Copy-Item -Path $DbPath -Destination $backupPath -Recurse -Force
Write-Host "backup -> $backupPath"

# --- browser lock ---
$edge = Get-Process msedge -ErrorAction SilentlyContinue | Measure-Object
if ($edge.Count -gt 0) {
    if ($SkipClose) { throw "edge is running (needed for LevelDB write) - close it or use -CloseBrowser" }
    if (-not $CloseBrowser) {
        throw "edge is running - pass -CloseBrowser to close it first, or -SkipClose if you've closed it"
    }
    Write-Host "closing edge..."
    Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 3
}

# --- inject ---
node $helper inject "$DbPath" "$scriptId" "$ScriptPath"
$code = $LASTEXITCODE
if ($code -ne 0) { Write-Host "inject FAILED" -ForegroundColor Red; exit $code }
Write-Host "inject OK" -ForegroundColor Green

# --- reopen ---
if ($Reopen) {
    Write-Host "reopening edge..."
    Start-Process msedge "https://www.youtube.com"
}
exit 0
