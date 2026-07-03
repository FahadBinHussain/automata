<#
.SYNOPSIS
    Backup and restore PEAK (OnlineFix crack) game data.
.DESCRIPTION
    Backs up and restores:
      - Game configs (BepInEx, plugins, OnlineFix.ini, doorstop_config.ini)
      - Achievements/stats from C:\Users\Public\Documents\OnlineFix\3527290\
      - Registry (HKCU:\Software\LandCrab\PEAK)
    Usage:
      .\peak-backup-restore.ps1 backup
      .\peak-backup-restore.ps1 restore -ZipPath "C:\path\to\peak-backup.zip"
      .\peak-backup-restore.ps1 restore -ZipPath "C:\path\to\peak-backup.zip" -GameDir "C:\custom\path"
#>

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("backup", "restore")]
    [string]$Action,

    [string]$ZipPath,

    [string]$GameDir = "C:\Users\<user>\Downloads\games\peak\PEAK.v1.61.a-OFME",

    [string]$OnlineFixDir = "C:\Users\Public\Documents\OnlineFix\3527290",

    [string]$RegistryKey = "HKCU:\Software\LandCrab\PEAK"
)

$ErrorActionPreference = "Stop"

function Backup-Peak {
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $tempDir = "C:\tmp\peak-backup-$timestamp"
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

    Write-Host "=== Backing up PEAK ===" -ForegroundColor Cyan

    # Game configs
    $configDir = "$tempDir\game-config"
    New-Item -ItemType Directory -Force -Path "$configDir\BepInEx" | Out-Null

    $gameFiles = @(
        "doorstop_config.ini",
        "OnlineFix.ini"
    )
    foreach ($f in $gameFiles) {
        $src = Join-Path $GameDir $f
        if (Test-Path $src) {
            Copy-Item $src "$configDir\" -Force
            Write-Host "  [OK] $f" -ForegroundColor Green
        } else {
            Write-Host "  [--] $f (not found)" -ForegroundColor DarkGray
        }
    }

    # BepInEx config
    $bepCfgSrc = "$GameDir\BepInEx\config"
    if (Test-Path $bepCfgSrc) {
        Copy-Item $bepCfgSrc "$configDir\BepInEx\config" -Recurse -Force
        $count = (Get-ChildItem "$configDir\BepInEx\config" -File).Count
        Write-Host "  [OK] BepInEx\config ($count files)" -ForegroundColor Green
    }

    # BepInEx plugins
    $bepPlugSrc = "$GameDir\BepInEx\plugins"
    if (Test-Path $bepPlugSrc) {
        Copy-Item $bepPlugSrc "$configDir\BepInEx\plugins" -Recurse -Force
        $count = (Get-ChildItem "$configDir\BepInEx\plugins" -Recurse -File).Count
        Write-Host "  [OK] BepInEx\plugins ($count files)" -ForegroundColor Green
    }

    # OnlineFix achievements/stats
    $achDir = "$tempDir\onlinefix"
    if (Test-Path $OnlineFixDir) {
        Copy-Item $OnlineFixDir $achDir -Recurse -Force
        $files = Get-ChildItem $achDir -Recurse -File
        Write-Host "  [OK] OnlineFix data ($($files.Count) files)" -ForegroundColor Green
    } else {
        Write-Host "  [--] OnlineFix dir not found" -ForegroundColor DarkGray
    }

    # Registry
    $regFile = "$tempDir\peak-registry.reg"
    reg export "HKCU\Software\LandCrab\PEAK" $regFile /y 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  [OK] Registry exported" -ForegroundColor Green
    } else {
        Write-Host "  [--] Registry export failed" -ForegroundColor Red
    }

    # Include restore script inside zip
    $restoreScript = @'
<#
.SYNOPSIS
    Restore PEAK from this backup. Run from inside the extracted zip folder.
.USAGE
    .\restore.ps1
    .\restore.ps1 -GameDir "C:\custom\path"
#>
param(
    [string]$GameDir = "C:\Users\<user>\Downloads\games\peak\PEAK.v1.61.a-OFME",
    [string]$OnlineFixDir = "C:\Users\Public\Documents\OnlineFix\3527290",
    [string]$RegistryKey = "HKCU:\Software\LandCrab\PEAK"
)
$ErrorActionPreference = "Stop"
$BackupDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "=== Restoring PEAK from backup ===" -ForegroundColor Cyan
Write-Host "Backup: $BackupDir" -ForegroundColor DarkGray
Write-Host "Game:   $GameDir" -ForegroundColor DarkGray

# Ensure game dir exists
if (-not (Test-Path $GameDir)) {
    New-Item -ItemType Directory -Force -Path $GameDir | Out-Null
    Write-Host "  [OK] Created game dir: $GameDir" -ForegroundColor Green
}

# Game configs
$configDir = "$BackupDir\game-config"
if (Test-Path $configDir) {
    foreach ($f in @("doorstop_config.ini", "OnlineFix.ini")) {
        $src = Join-Path $configDir $f
        if (Test-Path $src) { Copy-Item $src "$GameDir\" -Force; Write-Host "  [OK] $f" -ForegroundColor Green }
    }
    if (Test-Path "$configDir\BepInEx\config") {
        New-Item -ItemType Directory -Force -Path "$GameDir\BepInEx\config" | Out-Null
        Copy-Item "$configDir\BepInEx\config\*" "$GameDir\BepInEx\config\" -Recurse -Force
        Write-Host "  [OK] BepInEx\config" -ForegroundColor Green
    }
    if (Test-Path "$configDir\BepInEx\plugins") {
        New-Item -ItemType Directory -Force -Path "$GameDir\BepInEx\plugins" | Out-Null
        Copy-Item "$configDir\BepInEx\plugins\*" "$GameDir\BepInEx\plugins\" -Recurse -Force
        Write-Host "  [OK] BepInEx\plugins" -ForegroundColor Green
    }
}

# OnlineFix achievements/stats
$achDir = "$BackupDir\onlinefix"
if (Test-Path $achDir -PathType Container) {
    New-Item -ItemType Directory -Force -Path $OnlineFixDir | Out-Null
    Copy-Item "$achDir\*" "$OnlineFixDir\" -Recurse -Force
    Write-Host "  [OK] OnlineFix achievements/stats" -ForegroundColor Green
}

# Registry
$regFile = "$BackupDir\peak-registry.reg"
if (Test-Path $regFile) {
    reg import $regFile 2>$null
    if ($LASTEXITCODE -eq 0) { Write-Host "  [OK] Registry imported" -ForegroundColor Green }
    else { Write-Host "  [!] Registry import had issues" -ForegroundColor Yellow }

    # Fix hex(4) binary values that reg import misses
    $regContent = Get-Content $regFile -Raw
    $hexPattern = '"(\w+)"=hex\(4\):([0-9a-fA-F,]+)'
    foreach ($m in [regex]::Matches($regContent, $hexPattern)) {
        $name = $m.Groups[1].Value
        $hexStr = $m.Groups[2].Value -replace ',', ''
        $bytes = [byte[]]::new($hexStr.Length / 2)
        for ($i = 0; $i -lt $hexStr.Length; $i += 2) {
            $bytes[$i / 2] = [Convert]::ToByte($hexStr.Substring($i, 2), 16)
        }
        try {
            Set-ItemProperty -Path $RegistryKey -Name $name -Value $bytes -Type Binary -ErrorAction Stop
            Write-Host "  [OK] $name (binary)" -ForegroundColor Green
        } catch {
            Write-Host "  [!] $name (binary failed)" -ForegroundColor Yellow
        }
    }
}

Write-Host "`nRestore complete." -ForegroundColor Green
'@
    $restoreScript | Set-Content "$tempDir\restore.ps1" -Encoding UTF8 -Force

    # Include one-click restore.cmd wrapper
    $restoreCmd = @'
@echo off
REM One-click restore for PEAK backup
REM Runs restore.ps1 from the same folder

echo ========================================
echo  PEAK Game Restore
echo ========================================
echo.

REM Get the directory where this .cmd file is located
set "SCRIPTDIR=%~dp0"

REM Default game path
set "GAMEDIR=C:\Users\<user>\Downloads\games\peak\PEAK.v1.61.a-OFME"

REM Check if game exists at default path
if not exist "%GAMEDIR%\PEAK.exe" (
    echo Game not found at default location:
    echo   %GAMEDIR%
    echo.
    set /p GAMEDIR="Enter your PEAK game folder path: "
)

REM Validate game path
if not exist "%GAMEDIR%\PEAK.exe" (
    echo ERROR: PEAK.exe not found in %GAMEDIR%
    pause
    exit /b 1
)

echo.
echo Game: %GAMEDIR%
echo.

REM Run the PowerShell restore script with game path
powershell -ExecutionPolicy Bypass -File "%SCRIPTDIR%restore.ps1" -GameDir "%GAMEDIR%"

echo.
echo ========================================
pause
'@
    $restoreCmd | Set-Content "$tempDir\restore.cmd" -Encoding ASCII -Force

    # README
    $readme = @"
PEAK Backup - $timestamp
========================
Extract this zip and restore with either:

  1. Double-click restore.cmd  (auto-detects game path or prompts)
  2. PowerShell: .\restore.ps1 -GameDir "C:\path\to\PEAK"

Includes:
  - Game configs (BepInEx, MorePeak, PeakVersionBypass)
  - OnlineFix achievements/stats
  - Registry (resolution, volume, FOV, sensitivity, etc.)
"@
    $readme | Set-Content "$tempDir\README.txt" -Encoding UTF8 -Force

    # Create zip
    if (-not $ZipPath) {
        $ZipPath = "C:\tmp\peak-backup-$timestamp.zip"
    }
    Compress-Archive -Path "$tempDir\*" -DestinationPath $ZipPath -Force
    Remove-Item $tempDir -Recurse -Force

    $size = [math]::Round((Get-Item $ZipPath).Length / 1KB, 1)
    Write-Host "`nBackup saved: $ZipPath ($size KB)" -ForegroundColor Green
    Write-Host "To restore: extract zip, run .\restore.ps1" -ForegroundColor Cyan
}

function Restore-Peak {
    if (-not $ZipPath) {
        Write-Host "ERROR: -ZipPath required for restore" -ForegroundColor Red
        exit 1
    }
    if (-not (Test-Path $ZipPath)) {
        Write-Host "ERROR: File not found: $ZipPath" -ForegroundColor Red
        exit 1
    }

    $tempDir = "C:\tmp\peak-restore-temp"
    if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
    Expand-Archive -Path $ZipPath -DestinationPath $tempDir -Force

    Write-Host "=== Restoring PEAK ===" -ForegroundColor Cyan

    # Ensure game dir exists
    if (-not (Test-Path $GameDir)) {
        New-Item -ItemType Directory -Force -Path $GameDir | Out-Null
        Write-Host "  [OK] Created game dir: $GameDir" -ForegroundColor Green
    }

    # Game configs
    $configDir = "$tempDir\game-config"
    if (Test-Path $configDir) {
        $gameFiles = @("doorstop_config.ini", "OnlineFix.ini")
        foreach ($f in $gameFiles) {
            $src = Join-Path $configDir $f
            if (Test-Path $src) {
                Copy-Item $src "$GameDir\" -Force
                Write-Host "  [OK] $f" -ForegroundColor Green
            }
        }

        # BepInEx config
        $bepCfgSrc = "$configDir\BepInEx\config"
        if (Test-Path $bepCfgSrc) {
            New-Item -ItemType Directory -Force -Path "$GameDir\BepInEx\config" | Out-Null
            Copy-Item "$bepCfgSrc\*" "$GameDir\BepInEx\config\" -Recurse -Force
            Write-Host "  [OK] BepInEx\config" -ForegroundColor Green
        }

        # BepInEx plugins
        $bepPlugSrc = "$configDir\BepInEx\plugins"
        if (Test-Path $bepPlugSrc) {
            New-Item -ItemType Directory -Force -Path "$GameDir\BepInEx\plugins" | Out-Null
            Copy-Item "$bepPlugSrc\*" "$GameDir\BepInEx\plugins\" -Recurse -Force
            Write-Host "  [OK] BepInEx\plugins" -ForegroundColor Green
        }
    }

    # OnlineFix achievements/stats
    $achDir = "$tempDir\onlinefix"
    if (Test-Path $achDir -PathType Container) {
        New-Item -ItemType Directory -Force -Path $OnlineFixDir | Out-Null
        Copy-Item "$achDir\*" "$OnlineFixDir\" -Recurse -Force
        Write-Host "  [OK] OnlineFix achievements/stats" -ForegroundColor Green
    }

    # Registry
    $regFile = "$tempDir\peak-registry.reg"
    if (Test-Path $regFile) {
        reg import $regFile 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  [OK] Registry imported" -ForegroundColor Green
        } else {
            Write-Host "  [!] Registry import had issues" -ForegroundColor Yellow
        }
    }

    # Also restore hex(4) binary values that reg import may miss
    if (Test-Path $regFile) {
        $regContent = Get-Content $regFile -Raw
        $binarySettings = @{
            "MouseSensitivitySetting_h1121609471" = [byte[]]@(0x00,0x00,0x00,0x60,0x08,0x17,0x08,0x40)
            "MasterVolumeSetting_h101303303"      = [byte[]]@(0x00,0x00,0x00,0x20,0x78,0x9e,0xe4,0x3f)
            "MusicVolumeSetting_h507672026"       = [byte[]]@(0x00,0x00,0x00,0x60,0xcd,0x21,0xe3,0x3f)
            "FovSetting_h2102208684"             = [byte[]]@(0x00,0x00,0x00,0x80,0xc2,0x75,0x51,0x40)
            "SFXVolumeSetting_h997898198"        = [byte[]]@(0x00,0x00,0x00,0x00,0x00,0x00,0xf0,0x3f)
        }

        # Parse hex values from reg file
        $hexPattern = '"(\w+)"=hex\(4\):([0-9a-fA-F,]+)'
        $matches_found = [regex]::Matches($regContent, $hexPattern)
        foreach ($m in $matches_found) {
            $name = $m.Groups[1].Value
            $hexStr = $m.Groups[2].Value -replace ',', ''
            $bytes = [byte[]]::new($hexStr.Length / 2)
            for ($i = 0; $i -lt $hexStr.Length; $i += 2) {
                $bytes[$i / 2] = [Convert]::ToByte($hexStr.Substring($i, 2), 16)
            }
            try {
                Set-ItemProperty -Path $RegistryKey -Name $name -Value $bytes -Type Binary -ErrorAction Stop
                Write-Host "  [OK] $name (binary)" -ForegroundColor Green
            } catch {
                Write-Host "  [!] $name (binary restore failed)" -ForegroundColor Yellow
            }
        }
    }

    Remove-Item $tempDir -Recurse -Force
    Write-Host "`nRestore complete." -ForegroundColor Green
}

switch ($Action) {
    "backup"  { Backup-Peak }
    "restore" { Restore-Peak }
}
