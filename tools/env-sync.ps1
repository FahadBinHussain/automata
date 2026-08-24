# env-sync: restore .env + secret key files from vault into repo clones.
# vault items are named "github.com/<owner>/<repo> / <relative/path>" - the slug
# after github.com/ is the real GitHub repo, and the name after " / " is the
# path the file restores to (env variants carry "(development)"/"(production)").
#
# repos are matched by their git remote URL, NOT by the local folder name
# (some folders and GitHub slugs differ, e.g. underscores vs hyphens).
# env files and keys restore to their vault relative path, so they don't
# have to live at the repo root.
#
# usage:
#   .\env-sync.ps1                              # all repos found under Downloads
#   .\env-sync.ps1 -Repo daily-bnp              # single repo (folder name or slug)
#   .\env-sync.ps1 -Env prod                    # prefer production variant
#   .\env-sync.ps1 -Roots "C:\repos"            # scan extra locations
#   .\env-sync.ps1 -ListRepos                   # show repo -> slug -> vault mapping
#   .\env-sync.ps1 -DryRun                      # print what would be written
#
# vault: unlocked via automata\bitwarden.com\unlock.ps1 (or $env:BW_SESSION).

param(
    [string]$Repo,
    [ValidateSet('dev','prod')]
    [string]$Env = 'dev',
    [string[]]$Roots = @("$env:USERPROFILE\Downloads"),
    [switch]$ListRepos,
    [switch]$DryRun
)

$ErrorActionPreference = 'Continue'

Import-Module "<user-home>\Downloads\mainframe\vault-secret.psm1" -Force
if (-not (Test-VaultSession)) { throw 'Bitwarden vault is locked. Run automata\bitwarden.com\unlock.ps1 first.' }

$items = Get-VaultItems

# "github.com/<owner>/<repo> / <relname>" -> (slug, relname)
function Parse-VaultName($name) {
    if ($name -match '^github\.com/([^/]+)/([^/ ]+?) / (.+)$') {
        return @{ slug = "$($Matches[1])/$($Matches[2])"; rel = $Matches[3].Trim() }
    }
    return $null
}

function Get-RepoSlug($dir) {
    $remote = git -C $dir remote get-url origin 2>$null
    if ($remote -match 'github\.com[:/]([^/]+)/([^/.]+)(\.git)?') {
        return "$($Matches[1])/$($Matches[2])"
    }
    return $null
}

function Is-EnvName($rel) {
    return $rel -match '\.env(\s+\((development|production)\))?$'
}

# env items: ".env (development)" -> relative ".env", then written as .env.local
function Env-RelPath($rel) {
    $base = $rel -replace '\s+\((development|production)\)\s*$', ''
    if ($base -match '\.env$') { return "$base.local" }
    return $base
}

# key-file items: relname or any field name ends with a key extension
function Is-KeyName($rel) {
    return $rel -match '\.(pem|pfx|p12|key)$'
}

function Write-EnvFile($path, $content) {
    $dir = Split-Path $path -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    Set-Content -Path $path -Value $content -Encoding utf8 -NoNewline
}

function Restore-KeyFields($repoItem, $repoDir, $fallbackRel) {
    foreach ($field in $repoItem.fields) {
        if ($field.type -ne 1) { continue }
        $rel = $field.name
        if (-not (Is-KeyName $rel)) { $rel = $fallbackRel }
        if (-not (Is-KeyName $rel)) { continue }
        $outPath = Join-Path $repoDir $rel
        try {
            $bytes = [System.Convert]::FromBase64String($field.value)
            if (-not $DryRun) {
                $dir = Split-Path $outPath -Parent
                if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
                [System.IO.File]::WriteAllBytes($outPath, $bytes)
            }
            Write-Host "  key file: $rel -> $outPath"
        } catch {
            Write-Host "  SKIP key file $rel (bad base64): $($_.Exception.Message)"
        }
    }
}

# ---- discover repo clones by git remote --------------------------------
$repos = @{}   # slug -> @{ dir = <path>; folder = <name> }
foreach ($root in $Roots) {
    if (-not (Test-Path $root)) { Write-Host "skip missing root: $root"; continue }
    foreach ($d in (Get-ChildItem $root -Directory -EA SilentlyContinue)) {
        $gitDir = Join-Path $d.FullName ".git"
        if (-not (Test-Path $gitDir)) { continue }
        $slug = Get-RepoSlug $d.FullName
        if ($slug) {
            $key = $slug.ToLower()
            if (-not $repos.ContainsKey($key)) {
                $repos[$key] = @{ dir = $d.FullName; folder = $d.Name; slug = $slug }
            }
        }
    }
}

# ---- vault items keyed by lowercased slug -------------------------------
$vaultBySlug = @{}
foreach ($it in $items) {
    $p = Parse-VaultName $it.name
    if (-not $p) { continue }
    $key = $p.slug.ToLower()
    if (-not $vaultBySlug.ContainsKey($key)) { $vaultBySlug[$key] = @()
    }
    $vaultBySlug[$key] += @{ item = $it; rel = $p.rel }
}

if ($ListRepos) {
    Write-Host "=== repo clones on disk ==="
    foreach ($key in ($repos.Keys | Sort-Object)) {
        $r = $repos[$key]
        $v = if ($vaultBySlug.ContainsKey($key)) { "vault items: $($vaultBySlug[$key].Count)" } else { "no vault item" }
        Write-Host ("{0,-40} {1,-38} {2}" -f $r.folder, $r.slug, $v)
    }
    Write-Host "=== vault slugs with no clone on disk ==="
    foreach ($key in ($vaultBySlug.Keys | Sort-Object)) {
        if (-not $repos.ContainsKey($key)) { Write-Host "  $key" }
    }
    exit 0
}

# ---- select targets ------------------------------------------------------
$targets = @()
if ($Repo) {
    # match by folder name first, then by slug
    $found = $null
    foreach ($key in $repos.Keys) {
        if ($repos[$key].folder -ieq $Repo -or $repos[$key].slug -ieq $Repo) { $found = $repos[$key]; break }
    }
    if (-not $found) {
        Write-Host "no repo on disk matches '$Repo' (checked git remotes under: $($Roots -join ', '))"
        if ($vaultBySlug.ContainsKey($Repo.ToLower())) {
            Write-Host "  (vault has items for $Repo but no clone is present - clone it first)"
        }
        exit 1
    }
    $targets += $found
} else {
    foreach ($key in $repos.Keys) {
        if ($vaultBySlug.ContainsKey($key)) { $targets += $repos[$key] }
    }
    if ($targets.Count -eq 0) { Write-Host "no repos with vault items found under: $($Roots -join ', ')"; exit 0 }
}

foreach ($t in ($targets | Sort-Object { $_.folder })) {
    $key = $t.slug.ToLower()
    $repoItems = $vaultBySlug[$key]
    Write-Host "=== $($t.folder)  ($($t.slug)) ==="
    foreach ($ri in $repoItems) {
        $rel = $ri.rel
        if (Is-EnvName $rel) {
            # pick dev or prod per -Env
            $isProd = $rel -match '\(production\)'
            $isDev  = $rel -match '\(development\)' -or -not ($rel -match '\(production\)')
            if ($Env -eq 'prod' -and -not $isProd) { continue }
            if ($Env -eq 'dev' -and -not $isDev) { continue }
            $envPath = Join-Path $t.dir (Env-RelPath $rel)
            Write-Host "  env -> $envPath"
            if (-not $DryRun) { Write-EnvFile $envPath $ri.item.notes }
            Restore-KeyFields $ri.item $t.dir $rel
        } elseif (Is-KeyName $rel) {
            Write-Host "  key item: $rel"
            Restore-KeyFields $ri.item $t.dir $rel
        } else {
            Write-Host "  (other item: $rel)"
        }
    }
}

if ($DryRun) { Write-Host "`n(dry run - nothing written)" }
