<#
.SYNOPSIS
    set default application for file extensions per-user on Win11 24H2+/25H2 when
    UCPD.sys (UserChoice Protection Driver) blocks direct UserChoice registry writes.

.DESCRIPTION
    UCPD.sys blocks UserChoice writes from a deny-list of executable names
    (pwsh.exe, reg.exe, rundll32.exe, cmd.exe, WmiPrvSE.exe, ...) and protects
    existing UserChoice keys with a Deny-SetValue ACE for the owning user.

    this bypass works without reboot and without touching the driver:
      1. copy the current PowerShell install to a temp dir and rename pwsh.exe
         to pwsh2.exe  ->  Microsoft-signed binary whose name is not on the deny-list
      2. run a worker script as SYSTEM via a scheduled task  ->  SYSTEM is not
         covered by the user's Deny-SetValue ACE (FullControl Allow)
      3. worker writes valid hashed UserChoice keys under HKEY_USERS\<sid>
         (same hash algorithm as set-file-assoc.ps1; verified OK on 25H2
         build 26200, UCPD 4.5.0.626647)
    the task and temp files are removed afterwards. no UI, no reboot.

    NOTE: the [string] type constraint on a param() variable persists for the
    whole script - assigning an array to it silently space-joins it into one
    string. the worker uses a bare literal list for exactly this reason.

.PARAMETER Mpv
    preset: mpv (scoop mpv-git current path) + the 50-extension video list.

.PARAMETER ExePath
    exe the ProgId should launch (required unless -Mpv).

.PARAMETER ProgId
    progid to use as default (default "<exebasename>-file").

.PARAMETER Extensions
    extensions, with or without leading dot (default: mpv video list).

.PARAMETER Icon
    icon for the progid DefaultIcon (default "<exe>,0").

.PARAMETER KeepTemp
    keep the temp pwsh copy and worker script after the run (debugging).

.EXAMPLE
    pwsh .\ucpd-bypass.ps1 -Mpv

.NOTES
    hash algorithm identical to set-file-assoc.ps1 (PS-SFTA 1.2.0 MIT +
    Mozilla WindowsUserChoice.cpp). use set-file-assoc.ps1 directly when no
    UCPD protection is present (faster, no SYSTEM task needed); use this
    script when UserChoice writes get ACCESS_DENIED.
#>
[CmdletBinding()]
param(
    [switch]$Mpv,
    [string]$ExePath,
    [string]$ProgId,
    [string[]]$Extensions,
    [string]$Icon,
    [switch]$KeepTemp
)

$ErrorActionPreference = 'Stop'

$mpvVideoExtensions = @(
    "3g2","3gp","3gp2","3gpp","amv","asf","avi","divx","drc","dv","f4v","flv",
    "gvi","gxf","h264","hevc","m1v","m2p","m2t","m2ts","m2v","m4v","mkv","mov",
    "mp2","mp2v","mp4","mp4v","mpe","mpeg","mpg","mpv","mpv2","mts","mxf","nsv",
    "ogm","ogv","qt","rm","rmvb","ts","tsp","vob","webm","wmv","wtv","xesc","y4m"
)

if ($Mpv) {
    $candidates = @(
        "$env:USERPROFILE\scoop\apps\mpv-git\current\mpv.exe",
        "$env:USERPROFILE\scoop\apps\mpv\current\mpv.exe",
        "$env:USERPROFILE\scoop\shims\mpv.exe"
    )
    $ExePath = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $ExePath) { throw "mpv preset: could not locate mpv.exe. pass -ExePath." }
    if (-not $ProgId) { $ProgId = "mpv-file" }
    if (-not $Extensions) { $Extensions = $mpvVideoExtensions }
    if (-not $Icon) { $Icon = "$ExePath,0" }
}

if (-not $ExePath) { throw "missing -ExePath (or use -Mpv)" }
if (-not $ProgId) { $ProgId = ([System.IO.Path]::GetFileNameWithoutExtension($ExePath)) + "-file" }
if (-not $Extensions) { $Extensions = $mpvVideoExtensions }
if (-not (Test-Path -LiteralPath $ExePath)) { throw "exe not found: $ExePath" }
if (-not $Icon) { $Icon = "$ExePath,0" }

$exts = $Extensions | ForEach-Object {
    $e = $_.Trim()
    if (-not $e.StartsWith(".")) { $e = ".$e" }
    $e.ToLower()
} | Sort-Object -Unique

$sid = ([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value).ToLower()
$taskName = "ucpd-bypass-file-assoc"
$workDir = Join-Path $env:TEMP "ucpd-bypass"
$psDir = Join-Path $workDir "ps7"
$workerPath = Join-Path $workDir "worker.ps1"
$logPath = Join-Path $workDir "out.txt"
$pwshSource = (Get-Command pwsh).Source

# register the progid first (plain user-space registry, not protected)
$basePath = "Software\Classes\$ProgId"
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($basePath, $true)
$key.SetValue("", "mpv media file")
$key.Close()
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("$basePath\DefaultIcon", $true)
$key.SetValue("", $Icon)
$key.Close()
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("$basePath\shell\open\command", $true)
$key.SetValue("", "`"$ExePath`" `"%1`"")
$key.Close()
foreach ($ext in $exts) {
    $owKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Software\Classes\$ext\OpenWithProgids", $true)
    $owKey.SetValue($ProgId, [byte[]]@(), [Microsoft.Win32.RegistryValueKind]::None)
    $owKey.Close()
    $clsKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Software\Classes\$ext", $true)
    $clsKey.SetValue("", $ProgId)
    $clsKey.Close()
}

# staged worker script (self-contained, runs as SYSTEM; no [string]-typed params!)
$extLiteral = ($exts | ForEach-Object { "'$_'" }) -join ","
$worker = @"
`$ErrorActionPreference = 'Stop'
`$sid = '$sid'
`$progid = '$ProgId'
`$log = '$logPath'
`$res = @()

function Convert-ToInt32 { param([long]`$Value) [byte[]] `$b = [BitConverter]::GetBytes(`$Value); return [BitConverter]::ToInt32(`$b, 0) }
function Get-ShiftRight { param([long]`$Value, [int]`$Count) if (`$Value -band 0x80000000) { ((`$Value -shr `$Count) -bxor 0xFFFF0000) } else { (`$Value -shr `$Count) } }
function Get-Long { param([byte[]]`$Bytes, [int]`$Index = 0) return [BitConverter]::ToInt32(`$Bytes, `$Index) }

function Get-UserChoiceHash {
    param([string]`$BaseInfo)
    [Byte[]] `$bytes = [System.Text.Encoding]::Unicode.GetBytes(`$BaseInfo)
    `$bytes += [byte]0x00, [byte]0x00
    `$md5 = [System.Security.Cryptography.MD5]::Create()
    [Byte[]] `$bytesMD5 = `$md5.ComputeHash(`$bytes)
    `$lengthBase = (`$BaseInfo.Length * 2) + 2
    `$length = ((`$lengthBase -band 4) -le 1) + (Get-ShiftRight `$lengthBase 2) - 1
    `$base64Hash = ""
    if (`$length -gt 1) {
        `$cache = 0L; `$outhash1 = 0L; `$pdata = 0
        `$md51 = [long]((Get-Long `$bytesMD5) -bor 1) + 0x69FB0000L
        `$md52 = [long]((Get-Long `$bytesMD5 4) -bor 1) + 0x13DB0000L
        `$index = Get-ShiftRight (`$length - 2) 1
        `$counter = `$index + 1
        while (`$counter) {
            `$r0 = Convert-ToInt32 ((Get-Long `$bytes `$pdata) + `$outhash1)
            `$r1 = Convert-ToInt32 (Get-Long `$bytes (`$pdata + 4))
            `$pdata = `$pdata + 8
            `$r2a = Convert-ToInt32 ((`$r0 * `$md51) - (0x10FA9605L * (Get-ShiftRight `$r0 16)))
            `$r2b = Convert-ToInt32 ((0x79F8A395L * `$r2a) + (0x689B6B9FL * (Get-ShiftRight `$r2a 16)))
            `$r3 = Convert-ToInt32 ((0xEA970001L * `$r2b) - (0x3C101569L * (Get-ShiftRight `$r2b 16)))
            `$r4a = Convert-ToInt32 (`$r3 + `$r1)
            `$r5a = Convert-ToInt32 (`$cache + `$r3)
            `$r6a = Convert-ToInt32 ((`$r4a * `$md52) - (0x3CE8EC25L * (Get-ShiftRight `$r4a 16)))
            `$r6b = Convert-ToInt32 ((0x59C3AF2DL * `$r6a) - (0x2232E0F1L * (Get-ShiftRight `$r6a 16)))
            `$outhash1 = Convert-ToInt32 ((0x1EC90001L * `$r6b) + (0x35BD1EC9L * (Get-ShiftRight `$r6b 16)))
            `$outhash2 = Convert-ToInt32 (`$r5a + `$outhash1)
            `$cache = `$outhash2
            `$counter = `$counter - 1
        }
        [Byte[]] `$outHash = New-Object byte[] 16
        [byte[]] `$buffer = [BitConverter]::GetBytes([int]`$outhash1); `$buffer.CopyTo(`$outHash, 0)
        `$buffer = [BitConverter]::GetBytes([int]`$outhash2); `$buffer.CopyTo(`$outHash, 4)
        `$cache = 0L; `$outhash1 = 0L; `$pdata = 0
        `$md51 = [long]((Get-Long `$bytesMD5) -bor 1)
        `$md52 = [long]((Get-Long `$bytesMD5 4) -bor 1)
        `$counter = `$index + 1
        while (`$counter) {
            `$r0 = Convert-ToInt32 ((Get-Long `$bytes `$pdata) + `$outhash1)
            `$pdata = `$pdata + 8
            `$r1a = Convert-ToInt32 (`$r0 * `$md51)
            `$r1b = Convert-ToInt32 ((0xB1110000L * `$r1a) - (0x30674EEFL * (Get-ShiftRight `$r1a 16)))
            `$r2a = Convert-ToInt32 ((0x5B9F0000L * `$r1b) - (0x78F7A461L * (Get-ShiftRight `$r1b 16)))
            `$r2b = Convert-ToInt32 ((0x12CEB96DL * (Get-ShiftRight `$r2a 16)) - (0x46930000L * `$r2a))
            `$r3 = Convert-ToInt32 ((0x1D830000L * `$r2b) + (0x257E1D83L * (Get-ShiftRight `$r2b 16)))
            `$r4a = Convert-ToInt32 (`$md52 * (`$r3 + (Get-Long `$bytes (`$pdata - 4))))
            `$r4b = Convert-ToInt32 ((0x16F50000L * `$r4a) - (0x5D8BE90BL * (Get-ShiftRight `$r4a 16)))
            `$r5a = Convert-ToInt32 ((0x96FF0000L * `$r4b) - (0x2C7C6901L * (Get-ShiftRight `$r4b 16)))
            `$r5b = Convert-ToInt32 ((0x2B890000L * `$r5a) + (0x7C932B89L * (Get-ShiftRight `$r5a 16)))
            `$outhash1 = Convert-ToInt32 ((0x9F690000L * `$r5b) - (0x405B6097L * (Get-ShiftRight `$r5b 16)))
            `$outhash2 = Convert-ToInt32 (`$outhash1 + `$cache + `$r3)
            `$cache = `$outhash2
            `$counter = `$counter - 1
        }
        `$buffer = [BitConverter]::GetBytes([int]`$outhash1); `$buffer.CopyTo(`$outHash, 8)
        `$buffer = [BitConverter]::GetBytes([int]`$outhash2); `$buffer.CopyTo(`$outHash, 12)
        [Byte[]] `$outHashBase = New-Object byte[] 8
        `$hashValue1 = (Get-Long `$outHash 8) -bxor (Get-Long `$outHash)
        `$hashValue2 = (Get-Long `$outHash 12) -bxor (Get-Long `$outHash 4)
        `$buffer = [BitConverter]::GetBytes(`$hashValue1); `$buffer.CopyTo(`$outHashBase, 0)
        `$buffer = [BitConverter]::GetBytes(`$hashValue2); `$buffer.CopyTo(`$outHashBase, 4)
        `$base64Hash = [Convert]::ToBase64String(`$outHashBase)
    }
    return `$base64Hash
}

function Get-UserExperience {
    `$hardcoded = "User Choice set via Windows User Experience {D18B6DD5-6124-4341-9318-804003BAFA0B}"
    try {
        `$shell32 = [Environment]::GetFolderPath([Environment+SpecialFolder]::SystemX86) + "\Shell32.dll"
        `$stream = [System.IO.File]::Open(`$shell32, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        `$reader = [System.IO.BinaryReader]::new(`$stream)
        `$bytes = `$reader.ReadBytes(5MB)
        `$stream.Close()
        `$text = [Text.Encoding]::Unicode.GetString(`$bytes)
        `$search = "User Choice set via Windows User Experience"
        `$pos = `$text.IndexOf(`$search)
        if (`$pos -ge 0) {
            `$end = `$text.IndexOf("}", `$pos)
            if (`$end -gt `$pos) { return `$text.Substring(`$pos, `$end - `$pos + 1) }
        }
    }
    catch { }
    return `$hardcoded
}

function New-UserChoiceHash {
    param([string]`$Ext, [string]`$Sid, [string]`$ProgId, [datetime]`$Minute)
    `$ft = `$Minute.ToFileTime()
    `$hi = (`$ft -shr 32)
    `$lo = (`$ft -band 0xFFFFFFFFL)
    `$dtHex = (`$hi.ToString("X8") + `$lo.ToString("X8")).ToLower()
    `$userExp = Get-UserExperience
    `$baseInfo = "`$Ext`$Sid`$ProgId`$dtHex`$userExp".ToLower()
    return Get-UserChoiceHash `$baseInfo
}

`$regInfoType = @'
using System;
using System.Runtime.InteropServices;
public static class RegInfoU {
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    public static extern int RegOpenKeyEx(UIntPtr hKey, string lpSubKey, int ulOptions, int samDesired, out UIntPtr phkResult);
    [DllImport("advapi32.dll")]
    public static extern int RegQueryInfoKey(UIntPtr hKey, IntPtr lpClass, IntPtr lpcClass, IntPtr lpReserved,
        out int lpcSubKeys, IntPtr lpcMaxSubKeyLen, IntPtr lpcMaxClassLen, IntPtr lpcValues,
        IntPtr lpcMaxValueNameLen, IntPtr lpcMaxValueLen, IntPtr lpcbSecurityDescriptor, out long lpftLastWriteTime);
    [DllImport("advapi32.dll")]
    public static extern int RegCloseKey(UIntPtr hKey);
}
'@
try { Add-Type -TypeDefinition `$regInfoType } catch { }

function Get-KeyLastWrite {
    param([string]`$Path)
    `$h = [UIntPtr]::Zero
    `$res = [RegInfoU]::RegOpenKeyEx([UIntPtr]2147483651, `$Path, 0, 0x20019, [ref]`$h)
    if (`$res -ne 0 -or `$h -eq [UIntPtr]::Zero) { return `$null }
    try {
        `$subKeys = 0; `$ft = 0L
        `$res = [RegInfoU]::RegQueryInfoKey(`$h, [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero,
            [ref]`$subKeys, [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero,
            [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero, [ref]`$ft)
        if (`$res -ne 0) { return `$null }
        return [DateTime]::FromFileTimeUtc(`$ft).ToLocalTime()
    }
    finally { [RegInfoU]::RegCloseKey(`$h) | Out-Null }
}

try {
    `$Exts = @($extLiteral)
    foreach (`$ext in `$Exts) {
        `$e = `$ext.Trim(); if (-not `$e.StartsWith('.')) { `$e = ".`$e" }
        `$path = "`$sid\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\`$e\UserChoice"
        `$ucReg = "Registry::HKEY_USERS\`$path"
        `$ok = `$false
        for (`$a = 0; `$a -lt 5 -and -not `$ok; `$a++) {
            `$minute = [DateTime]::Now
            `$minute = [datetime]::new(`$minute.Year, `$minute.Month, `$minute.Day, `$minute.Hour, `$minute.Minute, 0)
            `$hash = New-UserChoiceHash -Ext `$e -Sid `$sid -ProgId `$progid -Minute `$minute
            Remove-Item `$ucReg -Force -Recurse -ErrorAction SilentlyContinue
            New-Item `$ucReg -Force | Out-Null
            Set-ItemProperty `$ucReg -Name "Hash" -Value `$hash -Type String
            Set-ItemProperty `$ucReg -Name "ProgId" -Value `$progid -Type String
            `$lwt = Get-KeyLastWrite -Path `$path
            if (`$lwt) {
                `$lwtMinute = [datetime]::new(`$lwt.Year, `$lwt.Month, `$lwt.Day, `$lwt.Hour, `$lwt.Minute, 0)
                if (`$lwtMinute -eq `$minute) { `$ok = `$true }
            }
        }
        if (`$ok) {
            `$lwt = Get-KeyLastWrite -Path `$path
            `$m = [datetime]::new(`$lwt.Year, `$lwt.Month, `$lwt.Day, `$lwt.Hour, `$lwt.Minute, 0)
            `$chk = New-UserChoiceHash -Ext `$e -Sid `$sid -ProgId `$progid -Minute `$m
            `$stored = (Get-ItemProperty `$ucReg -Name Hash -ErrorAction SilentlyContinue).Hash
            `$res += "`$e -> written, stored=`$stored computed=`$chk match=`$(`$stored -eq `$chk)"
        } else {
            `$res += "`$e -> FAILED to settle minute"
        }
    }
    `$res | Out-File `$log -Encoding utf8
}
catch {
    "FAIL: `$(`$_.Exception.Message)" | Out-File `$log -Encoding utf8
}
"@

# stage the temp pwsh copy (renamed exe) and the worker
Remove-Item $workDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $workDir -Force | Out-Null
Copy-Item -Path (Split-Path $pwshSource) -Destination $psDir -Recurse -Force
Rename-Item (Join-Path $psDir (Split-Path $pwshSource -Leaf)) "pwsh2.exe" -Force
Set-Content -Path $workerPath -Value $worker -Encoding utf8

Write-Host "staged: $psDir\pwsh2.exe + $workerPath"
Write-Host "running worker as SYSTEM (task $taskName)... "

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
$action = New-ScheduledTaskAction -Execute (Join-Path $psDir "pwsh2.exe") -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$workerPath`""
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

$deadline = (Get-Date).AddMinutes(3)
do {
    Start-Sleep -Seconds 3
    $info = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction SilentlyContinue
    $done = $info -and $info.LastTaskResult -eq 0 -and (Get-ScheduledTask -TaskName $taskName).State -eq 'Ready'
    if (-not $done -and (Get-Date) -gt $deadline) { break }
} while (-not $done)

Start-Sleep -Seconds 2
$workerLog = Get-Content $logPath -Raw -ErrorAction SilentlyContinue
Write-Host "--- worker output ---"
Write-Host $workerLog

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
if (-not $KeepTemp) { Remove-Item $workDir -Recurse -Force -ErrorAction SilentlyContinue }

$fail = @($workerLog -split "`n" | Where-Object { $_ -match 'FAILED|FAIL:' })
if ($fail.Count -gt 0) {
    Write-Host "some extensions failed - see worker output above." -ForegroundColor Red
    exit 1
}

# verify from the user hive
$bad = @()
foreach ($ext in $exts) {
    $v = (Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$ext\UserChoice" -ErrorAction SilentlyContinue).ProgId
    if ($v -ne $ProgId) { $bad += $ext }
}
if ($bad.Count -gt 0) {
    Write-Host "verify: NOT set -> $($bad -join ' ')" -ForegroundColor Red
    exit 1
}
Write-Host "verify: all $($exts.Count) extensions -> $ProgId" -ForegroundColor Green