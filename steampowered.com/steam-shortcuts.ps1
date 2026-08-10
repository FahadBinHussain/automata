# steam non-steam game shortcut manager (shortcuts.vdf binary format)
# manages "add non-steam game" entries in Steam's binary shortcuts.vdf
# (steam install dir\userdata\<userid>\config\shortcuts.vdf)
#
# usage:
#   .\steam-shortcuts.ps1 list                      # show current shortcuts
#   .\steam-shortcuts.ps1 add -Name "Game" -Exe "C:\path\game.exe" [-StartDir "C:\path"]
#   .\steam-shortcuts.ps1 remove -Name "Game"
#   .\steam-shortcuts.ps1 path                      # print shortcuts.vdf path
#
# notes:
# - steam must be closed before writing, or it will overwrite the file on exit
# - appid is generated randomly (4-byte int) like the steam client does
# - renumbering keeps indexes sequential; steam sanitizes extra fields anyway

param(
    [Parameter(Position = 0)][ValidateSet('list', 'add', 'remove', 'path')][string]$Command = 'list',
    [string]$Name,
    [string]$Exe,
    [string]$StartDir,
    [string]$SteamRoot
)

$ErrorActionPreference = 'Stop'

function Get-SteamRoot {
    param([string]$Hint)
    if ($Hint -and (Test-Path $Hint)) { return $Hint }
    $reg = @(
        (Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam' -Name InstallPath -ErrorAction SilentlyContinue).InstallPath,
        (Get-ItemProperty 'HKCU:\SOFTWARE\Valve\Steam' -Name SteamPath -ErrorAction SilentlyContinue).SteamPath
    ) | Where-Object { $_ } | Select-Object -First 1
    if ($reg) { return $reg }
    $scoop = "$env:USERPROFILE\scoop\apps\steam\current"
    if (Test-Path $scoop) { return $scoop }
    throw 'steam root not found - pass -SteamRoot'
}

function Read-VdfString {
    param([byte[]]$Bytes, [ref]$Pos)
    $sb = New-Object System.Text.StringBuilder
    while ($Bytes[$Pos.Value] -ne 0) {
        [void]$sb.Append([char]$Bytes[$Pos.Value])
        $Pos.Value++
    }
    $Pos.Value++  # skip null
    $sb.ToString()
}

function Read-VdfInt {
    param([byte[]]$Bytes, [ref]$Pos)
    $v = [BitConverter]::ToInt32($Bytes, $Pos.Value)
    $Pos.Value += 4
    $v
}

function Read-VdfSet {
    param([byte[]]$Bytes, [ref]$Pos)
    $obj = [ordered]@{}
    while ($true) {
        if ($Pos.Value -ge $Bytes.Length) { break }   # tolerate missing final 0x08 (some writers omit it)
        $type = $Bytes[$Pos.Value]
        $Pos.Value++
        if ($type -eq 0x08) { break }                 # end of set
        elseif ($type -eq 0x00) {                     # nested set
            $key = Read-VdfString $Bytes $Pos
            $obj[$key] = Read-VdfSet $Bytes $Pos
        }
        elseif ($type -eq 0x01) {                     # string
            $key = Read-VdfString $Bytes $Pos
            $val = Read-VdfString $Bytes $Pos
            $obj[$key] = @{ Type = 'string'; Value = $val }
        }
        elseif ($type -eq 0x02) {                     # int
            $key = Read-VdfString $Bytes $Pos
            $val = Read-VdfInt $Bytes $Pos
            $obj[$key] = @{ Type = 'int'; Value = $val }
        }
        else { throw "unknown vdf type 0x$($type.ToString('X2')) at offset $($Pos.Value)" }
    }
    $obj
}

function Write-VdfString {
    param([System.IO.MemoryStream]$Stream, [string]$Value)
    $b = [System.Text.Encoding]::UTF8.GetBytes($Value)
    $Stream.Write($b, 0, $b.Length)
    $Stream.WriteByte(0)
}

function Write-VdfEntry {
    param([System.IO.MemoryStream]$Stream, [hashtable]$Entry)
    $keyOrder = @('appid', 'AppName', 'Exe', 'StartDir', 'icon', 'ShortcutPath', 'LaunchOptions', 'IsHidden',
        'AllowDesktopConfig', 'AllowOverlay', 'OpenVR', 'Devkit', 'DevkitGameID', 'DevkitOverrideAppID',
        'LastPlayTime', 'FlatpakAppID', 'sortas', 'tags')
    foreach ($key in $keyOrder) {
        if (-not $Entry.Contains($key)) { continue }
        $item = $Entry[$key]
        if ($item -is [System.Collections.IDictionary] -and $item.Contains('Type')) {
            if ($item.Type -eq 'string') {
                $Stream.WriteByte(0x01)
                Write-VdfString $Stream $key
                Write-VdfString $Stream $item.Value
            } else {
                $Stream.WriteByte(0x02)
                Write-VdfString $Stream $key
                $Stream.Write([BitConverter]::GetBytes([int]$item.Value), 0, 4)
            }
        } elseif ($item -is [System.Collections.IDictionary]) {
            # tags-style nested set (empty in practice)
            $Stream.WriteByte(0x00)
            Write-VdfString $Stream $key
            $Stream.WriteByte(0x08)
        }
    }
    $Stream.WriteByte(0x08)
}

function Write-VdfFile {
    param([string]$Path, [System.Collections.ArrayList]$Entries)
    $ms = New-Object System.IO.MemoryStream
    $ms.WriteByte(0x00)
    Write-VdfString $ms 'shortcuts'
    foreach ($entry in $Entries) {
        $idx = [string]$Entries.IndexOf($entry)
        $ms.WriteByte(0x00)
        Write-VdfString $ms $idx
        Write-VdfEntry $ms $entry
    }
    $ms.WriteByte(0x08)
    $ms.WriteByte(0x08)
    [System.IO.File]::WriteAllBytes($Path, $ms.ToArray())
}

$root = Get-SteamRoot -Hint $SteamRoot
$userdataDir = Join-Path $root 'userdata'
$shortcutFiles = @()
if (Test-Path $userdataDir) {
    $shortcutFiles = Get-ChildItem $userdataDir -Recurse -Filter 'shortcuts.vdf' -ErrorAction SilentlyContinue
}
if ($shortcutFiles.Count -eq 0) {
    Write-Host 'no shortcuts.vdf found (no non-steam shortcuts yet - steam creates the file when you add one manually)'
    if ($Command -eq 'path') { exit 1 }
    exit 0
}

foreach ($vdfFile in $shortcutFiles) {
    $bytes = [System.IO.File]::ReadAllBytes($vdfFile.FullName)
    $pos = [ref]0
    # the whole file is a single set (no outer wrapper): 0x00 + name + contents + 0x08
    if ($bytes[$pos.Value] -ne 0x00) { throw "invalid vdf file: $($vdfFile.FullName)" }
    $pos.Value++
    $rootName = Read-VdfString $bytes $pos
    $rootContents = Read-VdfSet $bytes $pos
    $entries = New-Object System.Collections.ArrayList
    foreach ($key in @($rootContents.Keys)) {
        if ($key -match '^\d+$' -and $rootContents[$key] -is [System.Collections.IDictionary] -and -not $rootContents[$key].Contains('Type')) {
            [void]$entries.Add($rootContents[$key])
        }
    }

    switch ($Command) {
        'path' { Write-Host $vdfFile.FullName }
        'list' {
            Write-Host "== shortcuts.vdf: $($vdfFile.FullName) =="
            if ($entries.Count -eq 0) { Write-Host '(empty)' }
            for ($i = 0; $i -lt $entries.Count; $i++) {
                $e = $entries[$i]
                $appid = if ($e.Contains('appid')) { ('{0:X8}' -f $e['appid'].Value) } else { '--------' }
                $exe = if ($e.Contains('Exe')) { $e['Exe'].Value } else { '' }
                "[$i] $appid  $($e['AppName'].Value)  ->  $exe"
            }
        }
        'add' {
            if (-not $Name -or -not $Exe) { throw 'add requires -Name and -Exe' }
            $exists = $entries | Where-Object { $_['AppName'].Value -eq $Name }
            if ($exists) { Write-Host "already exists: $Name - skipping"; break }
            $exeQuoted = if ($Exe -like '"*"') { $Exe } else { "`"$Exe`"" }
            $startDir = if ($StartDir) { $StartDir.Trim('"') } else { "$(Split-Path ($Exe.Trim('"')))\" }
            $newEntry = [ordered]@{
                appid = @{ Type = 'int'; Value = [int](0x80000000 -bor (Get-Random -Minimum 0 -Maximum 0x7FFFFFFF)) }
                AppName = @{ Type = 'string'; Value = $Name }
                Exe = @{ Type = 'string'; Value = $exeQuoted }
                StartDir = @{ Type = 'string'; Value = $startDir }
                icon = @{ Type = 'string'; Value = '' }
                ShortcutPath = @{ Type = 'string'; Value = '' }
                LaunchOptions = @{ Type = 'string'; Value = '' }
                IsHidden = @{ Type = 'int'; Value = 0 }
                AllowDesktopConfig = @{ Type = 'int'; Value = 1 }
                AllowOverlay = @{ Type = 'int'; Value = 1 }
                OpenVR = @{ Type = 'int'; Value = 0 }
                Devkit = @{ Type = 'int'; Value = 0 }
                DevkitGameID = @{ Type = 'string'; Value = '' }
                DevkitOverrideAppID = @{ Type = 'int'; Value = 0 }
                LastPlayTime = @{ Type = 'int'; Value = 0 }
                FlatpakAppID = @{ Type = 'string'; Value = '' }
                sortas = @{ Type = 'string'; Value = '' }
                tags = @{}
            }
            if (Get-Process steam -ErrorAction SilentlyContinue) { Write-Warning 'steam is running - close it or it will overwrite shortcuts.vdf on exit!' }
            $backup = "$($vdfFile.FullName).bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
            Copy-Item $vdfFile.FullName $backup
            [void]$entries.Add($newEntry)
            Write-VdfFile -Path $vdfFile.FullName -Entries $entries
            Write-Host "added: $Name -> $Exe (backup: $backup)"
        }
        'remove' {
            if (-not $Name) { throw 'remove requires -Name' }
            $match = $entries | Where-Object { $_['AppName'].Value -eq $Name } | Select-Object -First 1
            if (-not $match) { Write-Host "not found: $Name"; break }
            if (Get-Process steam -ErrorAction SilentlyContinue) { Write-Warning 'steam is running - close it or it will overwrite shortcuts.vdf on exit!' }
            $backup = "$($vdfFile.FullName).bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
            Copy-Item $vdfFile.FullName $backup
            $entries.Remove($match)
            Write-VdfFile -Path $vdfFile.FullName -Entries $entries
            Write-Host "removed: $Name (backup: $backup)"
        }
    }
}
