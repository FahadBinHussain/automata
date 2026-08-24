# ditto-fork-build.ps1 - build Ditto from your fork via GitHub Actions, download, and patch the scoop install
#
# WHY: Your Ditto PRs (#1098 starred clips filter, #1107 starred clips shortcut) are
# merged into upstream master but never released (latest release 3.25.113.0 is from
# Sept 2025, before your merges). Your fork (FahadBinHussain/Ditto) has the build
# workflow with a workflow_dispatch trigger. The CI builds master (which includes
# your PRs) and uploads an unsigned-exe artifact. This script triggers that build,
# downloads the artifact, and replaces the official scoop-installed Ditto.exe.
#
# USAGE:
#   powershell -ExecutionPolicy Bypass -File .\ditto-fork-build.ps1
#   powershell -ExecutionPolicy Bypass -File .\ditto-fork-build.ps1 -SkipBuild
#
# ARGS:
#   -SkipBuild      reuse the last downloaded artifact at $env:TEMP\ditto-build if present
#   -NoRestart      do not (re)start Ditto after patching
#   -ForkOwner      default FahadBinHussain
#   -RetentionMins  artifact retention window (build.yml sets retention-days: 1)
#
# PREREQS: gh CLI authed as the fork owner (github.com/FahadBinHussain), scoop ditto installed.

param(
    [switch]$SkipBuild,
    [switch]$NoRestart,
    [string]$ForkOwner = 'FahadBinHussain',
    [int]$BuildWaitSec = 900
)

$ErrorActionPreference = 'Stop'
$env:Path = "$env:USERPROFILE\scoop\shims;$env:Path"

function Log($msg) { Write-Host "[ditto-build] $msg" }

$repo = "$ForkOwner/Ditto"
$official = "$env:USERPROFILE\scoop\apps\ditto\current\Ditto.exe"
if (-not (Test-Path $official)) { throw "official Ditto not found (scoop install ditto): $official" }
Log "official binary: $official (v$((Get-Item $official).VersionInfo.FileVersion))"

# 0. verify gh auth
gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'gh not authenticated - run: gh auth login' }

$buildDir = "$env:TEMP\ditto-build"
$zipPath = "$env:TEMP\ditto-unsigned-exe.zip"

$hasBuild = (Test-Path (Join-Path $buildDir 'Ditto.exe'))
if ($SkipBuild) {
    if (-not $hasBuild) { throw "-SkipBuild requested but no build at $buildDir" }
    Log "reusing existing build at $buildDir"
}

if (-not $hasBuild) {
    # 1. trigger a fresh build via workflow_dispatch
    Log "dispatching build on $repo (master)..."
    gh workflow run build.yml --repo $repo --ref master 2>&1 | Out-Null
    Start-Sleep -Seconds 8

    # 2. wait for the newest run to finish
    $runId = $null
    $deadline = (Get-Date).AddSeconds($BuildWaitSec)
    while ((Get-Date) -lt $deadline) {
        $run = gh api "repos/$repo/actions/runs?per_page=1" --jq '.workflow_runs[0] | {id, status, conclusion, event}' 2>$null | ConvertFrom-Json
        if ($run -and $run.event -eq 'workflow_dispatch' -and $run.status -eq 'completed') {
            $runId = $run.id
            Log "run $runId completed: $($run.conclusion)"
            break
        }
        Start-Sleep -Seconds 20
    }
    if (-not $runId) { throw "build did not finish within ${BuildWaitSec}s" }
    if ($run.conclusion -ne 'success') {
        # the exe artifact is uploaded BEFORE the sign step, so a sign failure is fine
        Log "run conclusion: $($run.conclusion) (sign step may have failed - unsigned-exe still available)"
    }

    # 3. find + download the unsigned-exe artifact
    $artifact = gh api "repos/$repo/actions/runs/$runId/artifacts" --jq '.artifacts[] | select(.name=="unsigned-exe") | .id' 2>$null | Select-Object -First 1
    if (-not $artifact) { throw "no unsigned-exe artifact on run $runId" }
    Log "downloading artifact $artifact..."
    gh api "repos/$repo/actions/artifacts/$artifact/zip" > $zipPath 2>$null
    if (-not (Test-Path $zipPath)) { throw 'artifact download failed' }

    if (Test-Path $buildDir) { Remove-Item $buildDir -Recurse -Force -EA SilentlyContinue }
    Expand-Archive $zipPath -DestinationPath $buildDir -Force
    if (-not (Test-Path (Join-Path $buildDir 'Ditto.exe'))) { throw 'artifact did not contain Ditto.exe' }
    Log "build ready: $buildDir"
}

# 4. patch the official scoop install (backup first)
$backup = "$official.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $official $backup -Force
Log "backed up official binary to $backup"

Get-Process Ditto -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

Copy-Item (Join-Path $buildDir 'Ditto.exe') $official -Force
# ICU_Loader.dll + Addins\DittoUtil.dll may also be newer - copy if present
foreach ($extra in @('ICU_Loader.dll', 'Addins\DittoUtil.dll')) {
    $src = Join-Path $buildDir $extra
    $dst = Join-Path (Split-Path $official) $extra
    if (Test-Path $src) {
        New-Item -ItemType Directory -Path (Split-Path $dst) -Force | Out-Null
        Copy-Item $src $dst -Force
        Log "updated $extra"
    }
}
Log "patched Ditto.exe -> $((Get-Item $official).VersionInfo.FileVersion)"

# 5. restart
if (-not $NoRestart) {
    Log 'starting Ditto...'
    Start-Process $official
}

Log 'done.'
