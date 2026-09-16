# pure-official-update.ps1 - official auto-update for all skills
# Covers: 54 lockfile skills via npx skills update -g + 3 local git skills + vendor i-have-adhd
# Official per INSTALL.md:421 and npx skills --help

$ErrorActionPreference = "Continue"
$log = "C:\Users\Admin\Downloads\automata\skills\auto-update.log"
function L($m){ $ts=Get-Date -Format "yyyy-MM-dd HH:mm:ss"; $line="[$ts] $m"; Write-Host $line; Add-Content $log $line }
L "=== pure official update start ==="

# 1. official lockfile - covers 54 skills (32 remotes) - saves 17 MB vs full clones (27.49 -> 10.45 MB)
L "RUN npx skills update -g -y"
& npx skills update -g -y 2>&1 | ForEach-Object { L "  $_" }
if ($LASTEXITCODE -ne 0) { L "WARN npx skills update exit=$LASTEXITCODE" }

# 2. vendor i-have-adhd - official per INSTALL.md:421
$vendor="C:\Users\Admin\.config\opencode\vendor\i-have-adhd"
if (Test-Path $vendor) {
  L "PULL vendor i-have-adhd"
  & git -C $vendor pull --ff-only 2>&1 | ForEach-Object { L "  $_" }
  # sync thin copy
  Copy-Item "$vendor\skills\i-have-adhd\SKILL.md" "C:\Users\Admin\.agents\skills\i-have-adhd\SKILL.md" -Force -ErrorAction SilentlyContinue
  L "  synced SKILL.md"
}

# 3. 3 local git skills that have no matching skill name in remote (remain Source: local)
foreach ($s in @("frontend-skill","google-sheets","web-research")) {
  $p="C:\Users\Admin\.agents\skills\$s"
  if (Test-Path "$p\.git") {
    L "PULL $s"
    & git -C $p pull --ff-only 2>&1 | ForEach-Object { L "  $_" }
  } else { L "SKIP $s no .git" }
}

# rule1 and hermes skills are custom local with no remote - skip

L "=== pure official update end ==="

# Register daily 09:00:
# $a=New-ScheduledTaskAction -Execute "pwsh.exe" -Argument "-NoProfile -File C:\Users\Admin\Downloads\automata\skills\pure-official-update.ps1"
# $t=New-ScheduledTaskTrigger -Daily -At 09:00
# $pr=New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Highest
# Register-ScheduledTask -TaskName "skills-pure-official-update" -Action $a -Trigger $t -Principal $pr -Description "pure official: npx skills update -g + vendor + 3 locals" -Force
