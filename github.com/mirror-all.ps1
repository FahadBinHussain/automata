#requires -Version 7
<#
mirror-all.ps1 — full GitHub account backup as git bundles (no extra remote).

purpose: for every repo of the gh-authenticated account: clone --mirror (or incremental
         fetch on later runs) -> `git bundle create --all` -> verify -> replace.
         resume-safe and idempotent: a repo whose bundle already carries the same
         ref->hash set is skipped. LFS objects are NOT inside bundles; repos with LFS
         are tarred to <repo>.lfs.tar.gz, and any that can't be captured are listed LOUD.
inputs : gh CLI logged in to the target account; git + git-lfs + tar on PATH.
run    : .\mirror-all.ps1                        # every repo, smallest first
         .\mirror-all.ps1 -Only Decidr,Ctrl-Alt-C
outputs: <Root>\bundles\<repo>.bundle (+ <repo>.lfs.tar.gz), mirrors kept in <Root>\work
exit   : 1 if any repo failed
#>
param(
  [string]$Root = (Join-Path $env:USERPROFILE 'Downloads\github-mirror'),
  [string[]]$Only = @()
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$bundles = Join-Path $Root 'bundles'
$work = Join-Path $Root 'work'
New-Item -ItemType Directory -Force -Path $bundles, $work | Out-Null

$freeGB = [math]::Round((Get-PSDrive $Root.Substring(0, 1)).Free / 1GB, 1)
if ($freeGB -lt 15) { throw "only $freeGB GB free on $($Root.Substring(0,1)): — need >= 15 GB (bundles ~7 GB + mirrors ~7 GB)" }

Write-Host 'listing repos via gh...'
$repos = @(gh repo list --limit 2000 --json name,url,diskUsage | ConvertFrom-Json)
if (-not $repos) { throw 'gh repo list returned nothing — check: gh auth status' }
if ($Only) {
  $missing = $Only | Where-Object { $_ -notin $repos.name }
  if ($missing) { throw "repos not found in account: $($missing -join ', ')" }
  $repos = @($repos | Where-Object { $_.name -in $Only })
}
$repos = @($repos | Sort-Object diskUsage)

function Get-Mb([string]$path) { [math]::Round((Get-Item $path).Length / 1MB, 1) }

$total = $repos.Count
$i = 0
$ok = @(); $skipped = @(); $fresh = @(); $failed = @(); $lfsManual = @()
$sw = [Diagnostics.Stopwatch]::StartNew()

foreach ($r in $repos) {
  $i++
  $name = $r.name
  $bundle = Join-Path $bundles "$name.bundle"
  $mirror = Join-Path $work "$name.git"
  $prefix = "[$i/$total] $name"

  if (-not (Test-Path -LiteralPath $mirror)) {
    Write-Host "$prefix clone --mirror (gh reports $([math]::Round($r.diskUsage / 1MB, 1)) MB)..."
    git clone --mirror --quiet -- $r.url $mirror 2>$null
    if ($LASTEXITCODE -ne 0) { Write-Warning "$prefix CLONE FAILED"; $failed += $name; continue }
  } else {
    Write-Host "$prefix incremental fetch..."
    git -C $mirror remote update --prune 2>$null
    if ($LASTEXITCODE -ne 0) { Write-Warning "$prefix FETCH FAILED (using existing objects)"; $fresh += $name }
  }

  $null = git -C $mirror rev-parse --verify HEAD 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Host "$prefix empty repo — nothing to bundle"
    $skipped += $name
    continue
  }

  $bh = ''
  if (Test-Path -LiteralPath $bundle) {
    $heads = @(git bundle list-heads $bundle 2>$null)
    if ($heads) {
      $bh = @($heads | Where-Object { $_ -match 'refs/' -and $_ -notmatch '\^\{\}' } | ForEach-Object { ($_ -replace '\s+', ' ').Trim() } | Sort-Object) -join "`n"
    }
  }
  if ($bh) {
    $mh = @(git -C $mirror for-each-ref --format='%(objectname) %(refname)' refs/heads refs/tags 2>$null | ForEach-Object { $_.Trim() } | Sort-Object) -join "`n"
    if ($bh -eq $mh) {
      Write-Host "$prefix skip (bundle current, $(Get-Mb $bundle) MB)"
      $skipped += $name
      continue
    }
  }

  $isLfs = $false
  git -C $mirror cat-file -e 'HEAD:.gitattributes' 2>$null
  if ($LASTEXITCODE -eq 0) {
    if (git -C $mirror show 'HEAD:.gitattributes' 2>$null | Select-String 'filter\s*=\s*lfs' -Quiet) { $isLfs = $true }
  }
  if ($isLfs) {
    $null = git -C $mirror lfs fetch --all 2>&1
    $lfsObj = Join-Path $mirror 'lfs\objects'
    if (Test-Path -LiteralPath $lfsObj) {
      tar -czf (Join-Path $bundles "$name.lfs.tar.gz") -C $mirror 'lfs' 2>$null
      if ($LASTEXITCODE -ne 0) { $lfsManual += $name }
    } else {
      $lfsManual += $name
    }
  }

  $tmp = "$bundle.tmp"
  if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
  git -C $mirror bundle create $tmp --all --quiet 2>$null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $tmp)) { Write-Warning "$prefix BUNDLE CREATE FAILED"; $failed += $name; continue }
  $null = git -C $mirror bundle verify $tmp 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "$prefix BUNDLE VERIFY FAILED — discarded old bundle kept, repo marked failed"
    Remove-Item -LiteralPath $tmp -Force
    $failed += $name
    continue
  }
  Move-Item -LiteralPath $tmp -Destination $bundle -Force
  Write-Host ("$prefix OK — {0} MB [{1:hh\:mm\:ss}]" -f (Get-Mb $bundle), $sw.Elapsed)
  $ok += $name
}

$totalMB = [math]::Round(((Get-ChildItem $bundles -File | Measure-Object Length -Sum).Sum) / 1MB, 1)
Write-Host ''
Write-Host ("SUMMARY in {0:hh\:mm\:ss}: bundled={1} skipped/unchanged/empty={2} fetchFailed={3} failed={4} lfsManual={5} | {6} MB in {7}" -f $sw.Elapsed, $ok.Count, $skipped.Count, $fresh.Count, $failed.Count, $lfsManual.Count, $totalMB, $bundles)
foreach ($n in ($ok + $skipped)) {
  $b = Join-Path $bundles "$n.bundle"
  if (Test-Path -LiteralPath $b) { "{0,9:N1} MB  {1}" -f (Get-Mb $b), $n }
}
if ($fresh) { Write-Warning "repos where fetch failed (bundle may be stale): $($fresh -join ', ')" }
if ($lfsManual) { Write-Warning "LFS repos NOT fully captured: $($lfsManual -join ', ')" }
if ($failed) { Write-Error "FAILED repos: $($failed -join ', ')"; exit 1 }
