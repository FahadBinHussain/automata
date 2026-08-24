<#
.SYNOPSIS
Per-game save backup/restore engine. Each game gets a config file in games/<game>.json
encoding the durable knowledge (save dirs, registry keys, expected files, restore steps)
so agents never have to re-investigate per-game save locations.

.USAGE
  .\game-save.ps1 backup -Game campwithmom [-NoUpload] [-OutDir C:\tmp]
  .\game-save.ps1 restore -Game campwithmom -Zip C:\path\campwithmom-save-backup.zip
  .\game-save.ps1 list

.DESCRIPTION
  backup: copies each saveDirs[].path (env-expanded) into a staging dir, exports each
  registry key to a .reg, verifies expectedFiles exist, zips everything, computes SHA256,
  and (unless -NoUpload) uploads the zip to the game's Notion page and appends a SHA256
  note. Requires 7z on PATH.
  restore: extracts the zip and copies saves back + imports the .reg.
  list: prints all known game configs.
#>
param(
    [Parameter(Position = 0)][ValidateSet('backup', 'restore', 'list')][string]$Command = 'list',
    [string]$Game,
    [string]$Zip,
    [switch]$NoUpload,
    [string]$OutDir
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$gamesDir  = Join-Path $scriptDir 'games'

# --- env.local (never committed) ---
$envLocal = Join-Path $scriptDir '.env.local'
if (Test-Path -LiteralPath $envLocal) {
    foreach ($line in Get-Content -LiteralPath $envLocal) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2].Trim().Trim('"', "'"), 'Process')
        }
    }
}

function Get-GameConfig {
    param([string]$Name)
    $path = Join-Path $gamesDir "$Name.json"
    if (-not (Test-Path -LiteralPath $path)) { throw "no game config found: $path" }
    Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
}

function Expand-TemplatePath {
    param([string]$Path)
    [Environment]::ExpandEnvironmentVariables($Path)
}

function Test-ExpectedFiles {
    param([string]$Dir, [string[]]$Patterns)
    if (-not (Test-Path -LiteralPath $Dir)) {
        Write-Warning "save dir missing: $Dir"
        return $false
    }
    $ok = $true
    foreach ($p in $Patterns) {
        $hits = Get-ChildItem -LiteralPath $Dir -Filter $p -ErrorAction SilentlyContinue
        if (-not $hits) {
            Write-Warning "expected file not found: $Dir\$p"
            $ok = $false
        } else {
            Write-Host "  ok: $($hits.Count) match(es) of $p"
        }
    }
    return $ok
}

if ($Command -eq 'list') {
    Get-ChildItem -LiteralPath $gamesDir -Filter '*.json' | ForEach-Object {
        $cfg = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
        "  {0,-14} {1}" -f $cfg.name, $cfg.displayName
    }
    exit 0
}

if (-not $Game) { throw 'no game specified' }
$cfg = Get-GameConfig -Name $Game
Write-Host "== $($cfg.displayName) ($($cfg.name)) =="

if ($Command -eq 'backup') {
    $staging = Join-Path $env:TEMP "game-backup-$($cfg.name)-$(Get-Date -Format yyyyMMdd-HHmmss)"
    New-Item -ItemType Directory -Force -Path $staging | Out-Null
    $allOk = $true

    foreach ($dir in @($cfg.saveDirs)) {
        $src = Expand-TemplatePath -Path $dir.path
        $dest = Join-Path $staging $dir.archivePath
        if (-not (Test-Path -LiteralPath $src)) {
            Write-Warning "save dir not found, skipping: $src"
            $allOk = $false
            continue
        }
        New-Item -ItemType Directory -Force -Path $dest | Out-Null
        & robocopy $src $dest /E /R:1 /W:1 /NP /NDL /NFL | Out-Null
        if ($LASTEXITCODE -ge 8) { Write-Warning "robocopy exit $LASTEXITCODE for $src"; $allOk = $false }
        Write-Host "  copied saves: $src -> $dest"
        if (-not (Test-ExpectedFiles -Dir $dest -Patterns @($dir.expectedFiles))) { $allOk = $false }
    }

    foreach ($rk in @($cfg.registryKeys)) {
        & reg.exe export $rk.key (Join-Path $staging $rk.file) /y *> $null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  exported registry: $($rk.key) -> $($rk.file)"
        } else {
            Write-Warning "registry key missing: $($rk.key)"
            $allOk = $false
        }
    }

    if (-not $allOk) {
        Write-Warning 'backup gathered with warnings - review before trusting it'
    }

    $zipName = "$($cfg.name)-save-backup.zip"
    $outDirFinal = if ($OutDir) { $OutDir } else { Join-Path $env:TEMP 'opencode' }
    New-Item -ItemType Directory -Force -Path $outDirFinal | Out-Null
    $zipPath = Join-Path $outDirFinal $zipName
    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
    Push-Location $staging
    & 7z a -tzip -mx=5 $zipPath '*' | Out-Null
    Pop-Location
    if ($LASTEXITCODE -gt 1) { throw "7z failed: $LASTEXITCODE" }

    $hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
    Write-Host "Wrote $zipPath"
    Write-Host "SHA256: $hash"
    Write-Host "size: $([Math]::Round((Get-Item $zipPath).Length / 1KB, 1)) KB"

    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue

    if (-not $NoUpload) {
        $pageId = [Environment]::GetEnvironmentVariable("$($cfg.name.ToUpper())_PAGE_ID", 'Process')
        if (-not $pageId) {
            Write-Warning "no $($cfg.name.ToUpper())_PAGE_ID in .env.local - zip kept locally, upload skipped"
            exit 0
        }
        $upload = Join-Path $scriptDir '..\..\notion.com\notion-upload-file.ps1'
        if (-not (Test-Path -LiteralPath $upload)) { $upload = Join-Path $scriptDir 'notion-upload-file.ps1' }
        if (Test-Path -LiteralPath $upload) {
            & $upload -PageId $pageId -FilePath $zipPath
        } else {
            Write-Warning "notion-upload-file.ps1 not found - upload skipped"
        }
    }

    exit 0
}

if ($Command -eq 'restore') {
    if (-not $Zip -or -not (Test-Path -LiteralPath $Zip)) { throw 'restore requires -Zip <path>' }
    $extract = Join-Path $env:TEMP "game-restore-$($cfg.name)-$(Get-Random)"
    New-Item -ItemType Directory -Force -Path $extract | Out-Null
    & 7z x $Zip -o"$extract" -y | Out-Null
    if ($LASTEXITCODE -gt 1) { throw "7z extract failed: $LASTEXITCODE" }

    foreach ($dir in @($cfg.saveDirs)) {
        $src = Join-Path $extract $dir.archivePath
        if (-not (Test-Path -LiteralPath $src)) { Write-Warning "zip missing archive dir: $($dir.archivePath)"; continue }
        $dest = Expand-TemplatePath -Path $dir.path
        New-Item -ItemType Directory -Force -Path $dest | Out-Null
        & robocopy $src $dest /E /R:1 /W:1 /NP /NDL /NFL | Out-Null
        Write-Host "  restored saves: -> $dest"
    }

    foreach ($rk in @($cfg.registryKeys)) {
        $regFile = Join-Path $extract $rk.file
        if (Test-Path -LiteralPath $regFile) {
            & reg.exe import $regFile 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) { Write-Host "  imported: $($rk.file)" } else { Write-Warning "reg import failed: $($rk.file)" }
        } else {
            Write-Warning "zip missing reg file: $($rk.file)"
        }
    }

    Write-Host ''
    Write-Host 'restore instructions:'
    foreach ($i in @($cfg.restoreInstructions)) { Write-Host "  - $i" }

    Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue
    exit 0
}
