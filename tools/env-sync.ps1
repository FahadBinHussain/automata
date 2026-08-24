# env-sync: restore .env + secret key files from vault into Downloads repos
# reads vault items named "github.com/FahadBinHussain/<repo> / <name>" and
# "github.com/mshll/..." and writes .env files + decodes base64 key files.
#
# usage:
#   .\env-sync.ps1                      # all repos in Downloads (default)
#   .\env-sync.ps1 -Repo kena           # single repo
#   .\env-sync.ps1 -Env prod            # prefer production variant
#   .\env-sync.ps1 -DryRun              # print what would be written
#
# vault: unlocked via automata\bitwarden.com\unlock.ps1 (or $env:BW_SESSION).

param(
    [string]$Repo,
    [ValidateSet('dev','prod')]
    [string]$Env = 'dev',
    [switch]$DryRun
)

Import-Module "<user-home>\Downloads\mainframe\vault-secret.psm1" -Force
if (-not (Test-VaultSession)) { throw 'Bitwarden vault is locked. Run automata\bitwarden.com\unlock.ps1 first.' }

$items = Get-VaultItems

function Get-RepoItems($repo) {
    return @($items | Where-Object { $_.name -like "github.com/FahadBinHussain/$repo /*" })
}

function Resolve-EnvItem($repoItems, $env) {
    if ($env -eq 'prod') {
        $prod = @($repoItems | Where-Object { $_.name -match '\(production\)' })
        if ($prod) { return $prod[0] }
    }
    $dev = @($repoItems | Where-Object { $_.name -match '\(development\)' -or $_.name -notmatch '\(production\)' })
    if ($dev) { return $dev[0] }
    return $null
}

function Write-EnvFile($path, $content) {
    $dir = Split-Path $path -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    Set-Content -Path $path -Value $content -Encoding utf8 -NoNewline
}

function Restore-KeyFiles($repoItem, $repoDir) {
    foreach ($field in $repoItem.fields) {
        if ($field.type -eq 1) {
            $rel = $field.name
            if ($rel -match '\.(pem|pfx|p12|key)$') {
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
    }
}

$targets = @()

if ($Repo) {
    $repoDir = "<user-home>\Downloads\$Repo"
    if (-not (Test-Path $repoDir)) { Write-Host "no Downloads repo dir: $repoDir"; exit 1 }
    $targets += @{ name = $Repo; dir = $repoDir }
} else {
    # all Downloads repos that have a matching vault item
    foreach ($dir in (Get-ChildItem "<user-home>\Downloads" -Directory -EA SilentlyContinue)) {
        $itemsForRepo = Get-RepoItems $dir.Name
        if ($itemsForRepo) { $targets += @{ name = $dir.Name; dir = $dir.FullName } }
    }
}

if ($targets.Count -eq 0) { Write-Host "no repos matched"; exit 0 }

foreach ($t in $targets) {
    $repoItems = Get-RepoItems $t.name
    $envItem = Resolve-EnvItem $repoItems $Env
    Write-Host "=== $($t.name) ==="
    if ($envItem) {
        $envPath = Join-Path $t.dir ".env.local"
        Write-Host "  env -> $envPath"
        if (-not $DryRun) { Write-EnvFile $envPath $envItem.notes }
        Restore-KeyFiles $envItem $t.dir
    } else {
        Write-Host "  (no env item)"
    }
    # also restore .pem-only items (no env notes)
    foreach ($it in $repoItems) {
        if ($it.name -match '\.pem$') {
            Write-Host "  pem item: $($it.name)"
            Restore-KeyFiles $it $t.dir
        }
    }
}

if ($DryRun) { Write-Host "`n(dry run - nothing written)" }
