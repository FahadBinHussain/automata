# alist-terabox-patcher.ps1 - apply the terabox dm-domain patch to the official AList binary
#
# WHY: AList's official release still points the Terabox driver at the old
# www.terabox.com API. TeraBox migrated to dm.terabox.com, and the official
# binary's list call sends an empty `dir` param that the new API rejects
# (errno: 2) -> root listing returns 0 files -> WebDAV upload fails on
# parent lookup. We keep the official scoop build but rebuild it with a
# one-line patch (upstream PR: https://github.com/AlistGo/alist/pull/9630).
# Run this after every `scoop update alist` (which overwrites the binary).
#
# USAGE:
#   powershell -ExecutionPolicy Bypass -File .\alist-terabox-patcher.ps1
#   powershell -ExecutionPolicy Bypass -File .\alist-terabox-patcher.ps1 -PatchDir <dir> -DataDir <dir> -SkipBuild
#
# ARGS:
#   -PatchDir   directory containing terabox-empty-dir.patch (default: script dir)
#   -DataDir    AList data dir (default: $env:USERPROFILE\scoop\persist\alist\data)
#   -SkipBuild  reuse an existing patched binary at $env:TEMP\alist-patched.exe if present
#   -NoRestart  patch/build/install but do NOT restart the AList server
#
# PREREQS: scoop, git, go, and the AList frontend dist (public/dist).
# The build needs public/dist embedded - the script downloads alist-web's
# latest dist.tar.gz into the source tree if missing.

param(
    [string]$PatchDir = $PSScriptRoot,
    [string]$DataDir = "$env:USERPROFILE\scoop\persist\alist\data",
    [switch]$SkipBuild,
    [switch]$NoRestart
)

$ErrorActionPreference = 'Stop'

function Log($msg) { Write-Host "[alist-patcher] $msg" }

# resolve tools
$scoopShims = "$env:USERPROFILE\scoop\shims"
$env:Path = "$scoopShims;$env:Path"

$patchFile = Join-Path $PatchDir 'terabox-empty-dir.patch'
if (-not (Test-Path $patchFile)) { throw "patch not found: $patchFile" }
Log "using patch: $patchFile"

$alistExe = "$env:USERPROFILE\scoop\apps\alist\current\alist.exe"
if (-not (Test-Path $alistExe)) { throw "AList not installed via scoop: $alistExe" }
Log "target binary: $alistExe"

$srcDir = Join-Path $env:TEMP 'alist-patcher-src'
$patchedExe = "$env:TEMP\alist-patched.exe"

# 1. build the patched binary (unless -SkipBuild and it already exists)
if ($SkipBuild -and (Test-Path $patchedExe)) {
    Log "reusing existing patched binary: $patchedExe"
} else {
    # fresh clone of official upstream (shallow, pinned to the installed tag)
    $installedVer = (& "$alistExe" version 2>$null | Select-String 'Version:' | Select-Object -First 1) -replace '.*Version:\s*','' -replace '\s.*',''
    if (-not $installedVer) { $installedVer = 'v3.63.0' }
    Log "installed AList version: $installedVer"

    if (Test-Path $srcDir) { Remove-Item $srcDir -Recurse -Force -EA SilentlyContinue }
    git clone --depth 1 --branch $installedVer https://github.com/AlistGo/alist.git $srcDir 2>&1 | Out-Null
    if (-not (Test-Path (Join-Path $srcDir 'go.mod'))) { throw "clone failed: $srcDir" }

    # fetch frontend dist (needed for go:embed public/dist)
    $distDir = Join-Path $srcDir 'public\dist'
    if (-not (Test-Path (Join-Path $distDir 'index.html'))) {
        Log "fetching AList web frontend dist..."
        $tmpTar = "$env:TEMP\alist-dist.tar.gz"
        curl.exe -sL 'https://github.com/alist-org/alist-web/releases/latest/download/dist.tar.gz' -o $tmpTar
        tar -xzf $tmpTar -C $env:TEMP
        if (Test-Path $distDir) { Remove-Item $distDir -Recurse -Force -EA SilentlyContinue }
        Move-Item (Join-Path $env:TEMP 'dist') $distDir -Force
        Remove-Item $tmpTar -Force -EA SilentlyContinue
    }

    # apply the patch
    Set-Location $srcDir
    git apply --check $patchFile 2>$null
    if ($LASTEXITCODE -ne 0) {
        # maybe already applied -> verify
        $util = Join-Path $srcDir 'drivers\terabox\util.go'
        $hit = Select-String -Path $util -Pattern 'if dir == ""' -Quiet
        if ($hit) {
            Log 'patch already applied to source'
        } else {
            throw "git apply failed for $patchFile - patch is stale (AList changed upstream?). update the patch file."
        }
    } else {
        git apply $patchFile
        Log 'patch applied to source'
    }

    # build
    Log "building patched AList (this takes a few minutes)..."
    go build -o $patchedExe . 2>&1 | Out-Null
    if (-not (Test-Path $patchedExe)) { throw "build failed - no output binary" }
    Log "built: $patchedExe"
}

# 2. install over the scoop binary (backup first)
$backup = "$alistExe.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $alistExe $backup -Force
Log "backed up current binary to $backup"

# stop running AList before overwrite
$running = Get-Process alist -ErrorAction SilentlyContinue
if ($running) {
    Log 'stopping running AList...'
    Stop-Process -Name alist -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

Copy-Item $patchedExe $alistExe -Force
Log "installed patched binary"

# 3. restart
if (-not $NoRestart) {
    Log "starting AList (data: $DataDir)..."
    Start-Process pwsh -ArgumentList '-NoExit', '-Command', "& '$alistExe' server --data '$DataDir'" -WindowStyle Normal
    Start-Sleep -Seconds 6
    try {
        $r = Invoke-WebRequest 'http://localhost:5244' -UseBasicParsing -TimeoutSec 5
        Log "AList is up: HTTP $($r.StatusCode)"
    } catch {
        Log "WARNING: AList did not respond on :5244 - check $DataDir\log\log.log"
    }
}

Log 'done.'
