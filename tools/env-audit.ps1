# env-audit: manual .env vs vault health check. run on demand, never scheduled.
#
# reports (values never printed, key names only):
#   LEAK     - non-example .env file tracked by git (+ repo visibility)
#   UNVAULTED - on-disk .env with no vault item
#   DRIFT    - vault notes differ from disk content
#   TOKEN    - plaintext token embedded in a git remote url
#   STALE?   - vault slug with no clone on disk (can't verify, listed only)
#
# vault naming: "github.com/<owner>/<repo> / <rel>" (see env-sync.ps1).
# ".env (development)" restores to ".env.local"; ".env (exact)" restores literally.
#
# usage:
#   .\env-audit.ps1                    # all clones under Downloads
#   .\env-audit.ps1 -Repo lore         # single repo (folder or slug)
#   .\env-audit.ps1 -SkipContent       # skip vault-vs-disk content compare (faster)
#
# vault: unlocked via automata\bitwarden.com\unlock.ps1 (or valid session.key).

param(
    [string]$Repo,
    [string[]]$Roots = @("$env:USERPROFILE\Downloads"),
    [switch]$SkipContent
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'

$log = Join-Path $env:TEMP 'env-audit.log'
'ENV-AUDIT ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') | Out-File $log

# ---- vault session (fail loud) ----
$sess = & "$env:USERPROFILE\Downloads\automata\bitwarden.com\get-session.ps1" 2>$null | Select-Object -Last 1
if ($sess -match 'NO_SESSION|SESSION_EXPIRED') {
    Write-Host 'FAIL: bitwarden vault is locked. run automata\bitwarden.com\unlock.ps1 first, then re-run this audit.'
    'FAIL: vault locked' | Out-File $log -Append
    exit 2
}
$env:BW_SESSION = $sess.Trim()

$vaultItems = bw list items --session $env:BW_SESSION 2>$null | ConvertFrom-Json
$vaultByName = @{}
foreach ($it in $vaultItems) { $vaultByName[$it.name] = $it }

# ---- repo visibility in one gh call ----
$visMap = @{}
$visDiag = 'vis: init'
try {
    $rawVis = gh repo list --limit 200 --json 'nameWithOwner,visibility' 2>&1
    $rl = $rawVis | ConvertFrom-Json
    $visDiag = 'vis: raw=' + @($rl).Count
    foreach ($r in $rl) { $visMap[$r.nameWithOwner.ToLower()] = $r.visibility }
    $visDiag += ' map=' + $visMap.Count
} catch { $visDiag = 'vis FAIL: ' + $_.Exception.Message }
$visDiag | Out-File $log -Append

function Get-Slug($dir) {
    $remote = git -C $dir remote get-url origin 2>$null
    if ($remote -match 'github\.com[:/]([^/]+)/([^/.]+)') { return "$($Matches[1])/$($Matches[2])" }
    return $null
}

# disk path -> expected vault rel. .env.local files map to the (development)
# variant (env-sync restores those exactly); any other .env-ish name maps to
# (exact) so env-sync restores the literal path.
function Vault-Rel($file) {
    $unix = $file -replace '\\', '/'
    if ($file -match '\.env\.local$') { return ($unix -replace '\.env\.local$', '.env (development)') }
    return "$unix (exact)"
}

# tracked-but-benign: upstream build flags, no secrets (verified by content).
$benignTracked = @(
    'FahadBinHussain/koodo-reader/.env',
    'FahadBinHussain/koodo-reader/electron-builder.env'
)

function Key-Names($text) {
    return @($text -split "`n" | ForEach-Object { ($_ -split '=')[0].Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') } | Sort-Object -Unique)
}

# ---- discover clones ----
$repos = @()
foreach ($root in $Roots) {
    foreach ($d in (Get-ChildItem $root -Directory -EA SilentlyContinue)) {
        if (-not (Test-Path (Join-Path $d.FullName '.git'))) { continue }
        $slug = Get-Slug $d.FullName
        if ($Repo -and $d.Name -ine $Repo -and $slug -ne $Repo) { continue }
        $repos += @{ dir = $d.FullName; folder = $d.Name; slug = $slug }
    }
}

$leaks = @(); $unvaulted = @(); $drifts = @(); $tokens = @(); $dups = @(); $benign = @()
$checked = 0

foreach ($r in ($repos | Sort-Object { $_.folder })) {
    if (-not $r.slug) { continue }
    $vis = if ($visMap.ContainsKey($r.slug.ToLower())) { $visMap[$r.slug.ToLower()] } else { 'UNKNOWN' }

    # plaintext token in remote?
    $remote = git -C $r.dir remote get-url origin 2>$null
    if ($remote -match '@github\.com|ghp_|gho_|github_pat_|x-access-token') {
        $tokens += "$($r.slug) (remote has embedded credential)"
    }

    # on-disk .env files (skip templates + vercel's pulled cache - regenerable)
    $disk = @(rg --files --hidden --no-ignore -g '.env*' -g '!.git/' -g '!node_modules/' -g '!.venv/' -g '!venv/' -g '!__pycache__/' -g '!.next/' -g '!dist/' -g '!build/' $r.dir 2>$null |
        ForEach-Object { $_.Substring($r.dir.Length + 1) } |
        Where-Object { $_ -notmatch 'example|sample|template' -and $_ -notmatch '\.vercel[\\/]' })

    # git-tracked .env files = leak risk (minus verified-benign upstream files)
    $tracked = @(git -C $r.dir ls-files 2>$null | Where-Object { $_ -match '\.env' -and $_ -notmatch 'example|sample|template' })
    foreach ($t in $tracked) {
        $unix = $t -replace '\\', '/'
        if ($benignTracked -contains "$($r.slug)/$unix") { $benign += "$($r.slug)/$unix"; continue }
        if ($vis -eq 'UNKNOWN') {
            try { $vis = (gh repo view $r.slug --json visibility 2>$null | ConvertFrom-Json).visibility } catch {}
            if (-not $vis) { $vis = 'UNKNOWN' }
        }
        $leaks += "[$vis] $($r.slug) / $t"
    }

    # byte-identical files in the same repo share one vault item; extras are DUP
    $byHash = @{}
    foreach ($f in $disk) {
        $h = (Get-FileHash -LiteralPath (Join-Path $r.dir $f) -Algorithm SHA256).Hash
        if (-not $byHash.ContainsKey($h)) { $byHash[$h] = @() }
        $byHash[$h] += $f
    }

    foreach ($group in $byHash.Values) {
        # prefer the group member that already has a vault item as representative
        $ordered = @($group | Sort-Object { $b = $_; if ($vaultByName.ContainsKey("github.com/$($r.slug) / $(Vault-Rel $b)")) { 0 } else { 1 } })
        $f = $ordered[0]
        foreach ($dup in $ordered[1..($ordered.Count)]) {
            if ($dup) { $dups += "$($r.slug) / $dup (same content as $f)" }
        }
        $unix = $f -replace '\\', '/'
        if (($benignTracked -contains "$($r.slug)/$unix") -and ($benign -notcontains "$($r.slug)/$unix")) { $benign += "$($r.slug)/$unix" }
        if ($benignTracked -contains "$($r.slug)/$unix") { continue }
        $vname = "github.com/$($r.slug) / $(Vault-Rel $f)"
        if (-not $vaultByName.ContainsKey($vname)) {
            $unvaulted += "$($r.slug) / $f"
            continue
        }
        if ($SkipContent) { continue }
        $checked++
        $id = $vaultByName[$vname].id
        $notes = (bw get item $id --session $env:BW_SESSION 2>$null | ConvertFrom-Json).notes
        $content = Get-Content -LiteralPath (Join-Path $r.dir $f) -Raw -Encoding utf8
        if ($notes -cne $content) {
            $vk = Key-Names $notes; $dk = Key-Names $content
            $onlyV = (Compare-Object $vk $dk | Where-Object { $_.SideIndicator -eq '<=' } | ForEach-Object { $_.InputObject }) -join ','
            $onlyD = (Compare-Object $vk $dk | Where-Object { $_.SideIndicator -eq '=>' } | ForEach-Object { $_.InputObject }) -join ','
            $drifts += "$($r.slug) / $f (only-vault: [$onlyV] only-disk: [$onlyD])"
        }
    }
}

# vault slugs with no clone on disk: env-ish ones need a clone to verify,
# the rest (ci secrets, key files noted elsewhere) are informational only
$diskSlugs = @($repos | Where-Object { $_.slug } | ForEach-Object { $_.slug.ToLower() })
$orphanEnv = @(); $orphanOther = @()
$vaultByName.Keys | Where-Object { $_ -match '^github\.com/([^/]+)/([^/ ]+?) / (.+)$' } | ForEach-Object {
    $slug = "$($Matches[1])/$($Matches[2])".ToLower()
    if ($diskSlugs -contains $slug) { return }
    $rel = $Matches[3]
    if ($rel -match '\.env|\(exact\)|\.(pem|pfx|p12|key)$') { $orphanEnv += "$slug / $rel" }
    else { $orphanOther += "$slug / $rel" }
}
$orphanEnv = @($orphanEnv | Sort-Object -Unique)
$orphanOther = @($orphanOther | Sort-Object -Unique)

Write-Host ''
Write-Host ("=== env audit: {0} repos, {1} vault-compared (vis map: {2}) ===" -f $repos.Count, $checked, $visMap.Count)
Write-Host ("LEAK (tracked .env): $($leaks.Count)")
$leaks | ForEach-Object { Write-Host "  LEAK $_" }
Write-Host ("UNVAULTED (disk, no vault): $($unvaulted.Count)")
$unvaulted | ForEach-Object { Write-Host "  UNVAULTED $_" }
Write-Host ("DRIFT (vault != disk): $($drifts.Count)")
$drifts | ForEach-Object { Write-Host "  DRIFT $_" }
Write-Host ("TOKEN (remote has credential): $($tokens.Count)")
$tokens | ForEach-Object { Write-Host "  TOKEN $_" }
Write-Host ("DUP (same content, shared vault item): $($dups.Count)")
$dups | ForEach-Object { Write-Host "  DUP $_" }
Write-Host ("BENIGN (tracked upstream, no secrets): $($benign.Count)")
$benign | ForEach-Object { Write-Host "  BENIGN $_" }
Write-Host ("ORPHAN-ENV (vaulted, no clone to verify): $($orphanEnv.Count)")
$orphanEnv | ForEach-Object { Write-Host "  ORPHAN-ENV $_" }
Write-Host ("ORPHAN-OTHER (ci secrets etc, no clone): $($orphanOther.Count)")
$orphanOther | ForEach-Object { Write-Host "  ORPHAN-OTHER $_" }

$report = @()
$report += "repos=$($repos.Count) checked=$checked vismap=$($visMap.Count)"
$leaks | ForEach-Object { $report += "LEAK $_" }
$unvaulted | ForEach-Object { $report += "UNVAULTED $_" }
$drifts | ForEach-Object { $report += "DRIFT $_" }
$tokens | ForEach-Object { $report += "TOKEN $_" }
$dups | ForEach-Object { $report += "DUP $_" }
$benign | ForEach-Object { $report += "BENIGN $_" }
$orphanEnv | ForEach-Object { $report += "ORPHAN-ENV $_" }
$orphanOther | ForEach-Object { $report += "ORPHAN-OTHER $_" }
$report | Out-File $log -Append
"full log: $log"

if ($leaks.Count -gt 0) { exit 1 } else { exit 0 }
