# opencode-patcher.ps1 - build patched opencode from fork and patch scoop install
#
# WHY: scoop's opencode (v1.18.25) is hit by bash pipe hang #32504 - the bash tool
# waits for stdout pipe EOF, not just exit, so daemons (vite, http.server,
# agent-browser open) hang to timeout and leave session busy. upstream PR
# #44601 (fix: settle shell completion on process exit instead of pipe EOF)
# is still OPEN, not in a release. this patcher builds the fork
# FahadBinHussain/opencode (dev + cherry-picked #44601) and overwrites the
# scoop binary, so `opencode run` stops hanging.
# run this after every `scoop update opencode` (which overwrites the binary).
#
# USAGE:
#   powershell -ExecutionPolicy Bypass -File .\opencode-patcher.ps1
#   powershell -ExecutionPolicy Bypass -File .\opencode-patcher.ps1 -SkipBuild
#   powershell -ExecutionPolicy Bypass -File .\opencode-patcher.ps1 -Branch dev -ForkOwner FahadBinHussain
#
# PREREQS: scoop, git, bun (1.3.x), gh (optional for fork verification)
#
# BUILD: bun run script/build.ts --single  -> dist/opencode-windows-x64/bin/opencode.exe
# INSTALL: backup scoop\apps\opencode\current\opencode.exe -> replace

param(
    [string]$ForkOwner = "FahadBinHussain",
    [string]$Branch = "dev",
    [switch]$SkipBuild,
    [switch]$NoRestart
)

$ErrorActionPreference = "Stop"

function Log($msg) { Write-Host "[opencode-patcher] $msg" -ForegroundColor Cyan }

$scoopOpencode = "$env:USERPROFILE\scoop\apps\opencode\current\opencode.exe"
if (-not (Test-Path $scoopOpencode)) { throw "scoop opencode not found: $scoopOpencode (scoop install opencode)" }
Log "target: $scoopOpencode (v$((Get-Item $scoopOpencode).VersionInfo.FileVersion))"

$srcDir = "<user-home>\AppData\Local\Temp\opencode-patcher-src"
$builtExe = $null

# resolve fork URL
$forkUrl = "https://github.com/$ForkOwner/opencode.git"
Log "fork: $forkUrl branch $Branch"

# 1. get source (clone or update)
if ($SkipBuild) {
    if (-not (Test-Path "$srcDir\package.json")) { throw "-SkipBuild but no source at $srcDir" }
    Log "reusing source at $srcDir (-SkipBuild)"
} else {
    $oldEA = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    if (Test-Path $srcDir) {
        Log "updating existing clone at $srcDir"
        Set-Location $srcDir
        git fetch origin $Branch --depth 1 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = $oldEA; throw "git fetch failed" }
        git reset --hard "origin/$Branch" 2>&1 | Out-Null
    } else {
        Log "cloning $forkUrl (branch $Branch) -> $srcDir"
        git clone --depth 1 --branch $Branch $forkUrl $srcDir 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path "$srcDir\package.json")) { $ErrorActionPreference = $oldEA; throw "clone failed" }
    }
    $ErrorActionPreference = $oldEA
    Set-Location $srcDir

    # verify the fix is present
    $hasFix = Select-String -Path "packages\core\src\process.ts" -Pattern "grace|collectStreamGraceful" -Quiet -ErrorAction SilentlyContinue
    if (-not $hasFix) {
        $hasFix2 = Select-String -Path "packages\core\src\cross-spawn-spawner.ts" -Pattern "settled" -Quiet -ErrorAction SilentlyContinue
        if (-not $hasFix2) { Write-Warning "fix not detected in source - did cherry-pick #44601 land on $Branch?" }
        else { Log "fix detected (cross-spawn-spawner settled)" }
    } else { Log "fix detected (process.ts grace)" }

    # 2. build single platform binary
    Log "building patched opencode (--single, this takes ~2-3 minutes)..."
    $env:OPENCODE_CHANNEL = "patch"
    # ensure bun is on PATH (scoop shims)
    $env:Path = "$env:USERPROFILE\scoop\shims;$env:Path"
    bun --version 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "bun not found - scoop install bun" }

    # bun install is handled by build script's --skip-install logic, but we run it once
    # to ensure deps are present for the fix files
    $oldEA2 = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    bun install 2>&1 | Out-Null
    $ErrorActionPreference = $oldEA2

    # build --single for current platform (windows-x64)
    # the build script lives in packages/opencode/script/build.ts
    Set-Location "$srcDir\packages\opencode"
    $oldEA2 = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    bun run script/build.ts --single 2>&1 | Tee-Object -FilePath "$env:TEMP\opencode-build.log" | Out-String | Select-Object -Last 30 | ForEach-Object { Write-Host $_ }
    $buildExit = $LASTEXITCODE
    $ErrorActionPreference = $oldEA2
    Set-Location $srcDir
    if ($buildExit -ne 0) { throw "build failed - see $env:TEMP\opencode-build.log" }

    $builtExe = Get-ChildItem "$srcDir\packages\opencode\dist\*\bin\opencode*" -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "opencode*" } | Select-Object -First 1
    if (-not $builtExe) {
        $builtExe = Get-ChildItem "$srcDir\dist\*\bin\opencode*" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    }
    if (-not $builtExe) { throw "built binary not found under dist/" }
    Log "built: $($builtExe.FullName) ($([math]::Round($builtExe.Length/1MB,1)) MB)"
}

if (-not $builtExe) {
    # find built exe from previous build
    $builtExe = Get-ChildItem "$srcDir\packages\opencode\dist\*\bin\opencode*" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $builtExe) { $builtExe = Get-ChildItem "$srcDir\dist\*\bin\opencode*" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 }
    if (-not $builtExe) { throw "no built binary found - run without -SkipBuild" }
}

# 3. backup and install
$backup = "$scoopOpencode.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $scoopOpencode $backup -Force
Log "backed up to $backup"

# stop running opencode before overwrite (it may hold the exe)
$running = Get-Process opencode -ErrorAction SilentlyContinue
if ($running) {
    Log "stopping running opencode ($($running.Id))..."
    Stop-Process -Name opencode -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# copy built binary over scoop binary (handle .exe extension)
$srcBin = $builtExe.FullName
if ($srcBin -notlike "*.exe" -and (Test-Path "$srcBin.exe")) { $srcBin = "$srcBin.exe" }
Copy-Item $srcBin $scoopOpencode -Force
Log "installed patched binary -> $scoopOpencode"

# verify version still reports
try {
    $ver = & $scoopOpencode --version 2>&1 | Out-String
    Log "patched opencode --version: $($ver.Trim())"
} catch { Write-Warning "version check failed: $_" }

Log "done. run with: opencode --version ; opencode run `"test`""
Log "after next `scoop update opencode`, re-run this patcher."
