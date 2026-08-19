<#
.SYNOPSIS
    set default application for file extensions per-user (Win 10/11) by writing a valid
    UserChoice hash (classic algorithm used since 1803, incl. Win11 24H2 that has not
    enabled the UserChoiceLatest protection). based on the MIT-licensed PS-SFTA
    (DanysysTeam/PS-SFTA 1.2.0) + Mozilla WindowsUserChoice.cpp reference.

.DESCRIPTION
    registers a user-space ProgID (HKCU\Software\Classes\<progid>) pointing at an exe,
    then for each extension:
      - sets HKCU\Software\Classes\.ext default = progid
      - adds the progid to FileExts\.ext\OpenWithProgids (shows in "Open with")
      - replaces FileExts\.ext\UserChoice with a correctly hashed ProgId (no admin needed)
      - silences the "how do you want to open this file?" toast via ApplicationAssociationToasts
    hash input = ext + userSID + progid + FILETIME(now rounded down to the minute) + the
    hardcoded "User Choice set via Windows User Experience {D18B6DD5-...}" string, lowercased;
    hash = MD5-seeded DWORD scramble, base64 of two XOR'd DWORDs (8 bytes).
    write order matters: delete UserChoice, write Hash, write ProgId last so the key's
    last-write-time lands in the same minute used for the hash; retried if a minute
    boundary was crossed. verified afterwards by recomputing from the live last-write-time.

.PARAMETER Mpv
    preset: sets mpv (scoop mpv-git current path) as default for a video extension list.

.PARAMETER ExePath
    full path to the exe (used to build the open command and icon).

.PARAMETER ProgId
    progid to register / use as default (defaults to "<exebasename>-file").

.PARAMETER Extensions
    one or more extensions, with or without leading dot.

.PARAMETER Icon
    optional icon string for the progid DefaultIcon (default "<exe>,0").

.PARAMETER VerifyOnly
    do not write anything; recompute and compare existing UserChoice hashes for the given
    extensions and report OK/BROKEN for each.

.EXAMPLE
    pwsh .\set-file-assoc.ps1 -Mpv

.EXAMPLE
    pwsh .\set-file-assoc.ps1 -ExePath "C:\tools\myplayer\myplayer.exe" -Extensions .mp4,.mkv -ProgId myplayer-file

.EXAMPLE
    pwsh .\set-file-assoc.ps1 -Mpv -VerifyOnly

.NOTES
    based on PS-SFTA 1.2.0 (c) 2022 Danysys <danysys.com> (MIT) - https://github.com/DanysysTeam/PS-SFTA
    and Mozilla WindowsUserChoice.cpp - https://github.com/mozilla/gecko-dev
#>
[CmdletBinding()]
param(
    [switch]$Mpv,
    [string]$ExePath,
    [string]$ProgId,
    [string[]]$Extensions,
    [string]$Icon,
    [switch]$VerifyOnly,
    [switch]$SkipToast
)

Set-StrictMode -Version Latest

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# hash primitives (ported from PS-SFTA 1.2.0)
# ---------------------------------------------------------------------------

function Convert-ToInt32 {
    param([long]$Value)
    [byte[]] $b = [BitConverter]::GetBytes($Value)
    return [BitConverter]::ToInt32($b, 0)
}

function Get-ShiftRight {
    param([long]$Value, [int]$Count)
    if ($Value -band 0x80000000) { (($Value -shr $Count) -bxor 0xFFFF0000) } else { ($Value -shr $Count) }
}

function Get-Long {
    param([byte[]]$Bytes, [int]$Index = 0)
    return [BitConverter]::ToInt32($Bytes, $Index)
}

function Get-UserChoiceHash {
    param([string]$BaseInfo)

    [Byte[]] $bytes = [System.Text.Encoding]::Unicode.GetBytes($BaseInfo)
    $bytes += [byte]0x00, [byte]0x00

    $md5 = [System.Security.Cryptography.MD5]::Create()
    [Byte[]] $bytesMD5 = $md5.ComputeHash($bytes)

    $lengthBase = ($BaseInfo.Length * 2) + 2
    $length = (($lengthBase -band 4) -le 1) + (Get-ShiftRight $lengthBase 2) - 1
    $base64Hash = ""

    if ($length -gt 1) {
        # pass 1
        $cache = 0L
        $outhash1 = 0L
        $pdata = 0
        $md51 = [long]((Get-Long $bytesMD5) -bor 1) + 0x69FB0000L
        $md52 = [long]((Get-Long $bytesMD5 4) -bor 1) + 0x13DB0000L
        $index = Get-ShiftRight ($length - 2) 1
        $counter = $index + 1

        while ($counter) {
            $r0 = Convert-ToInt32 ((Get-Long $bytes $pdata) + $outhash1)
            $r1 = Convert-ToInt32 (Get-Long $bytes ($pdata + 4))
            $pdata = $pdata + 8
            $r2a = Convert-ToInt32 (($r0 * $md51) - (0x10FA9605L * (Get-ShiftRight $r0 16)))
            $r2b = Convert-ToInt32 ((0x79F8A395L * $r2a) + (0x689B6B9FL * (Get-ShiftRight $r2a 16)))
            $r3 = Convert-ToInt32 ((0xEA970001L * $r2b) - (0x3C101569L * (Get-ShiftRight $r2b 16)))
            $r4a = Convert-ToInt32 ($r3 + $r1)
            $r5a = Convert-ToInt32 ($cache + $r3)
            $r6a = Convert-ToInt32 (($r4a * $md52) - (0x3CE8EC25L * (Get-ShiftRight $r4a 16)))
            $r6b = Convert-ToInt32 ((0x59C3AF2DL * $r6a) - (0x2232E0F1L * (Get-ShiftRight $r6a 16)))
            $outhash1 = Convert-ToInt32 ((0x1EC90001L * $r6b) + (0x35BD1EC9L * (Get-ShiftRight $r6b 16)))
            $outhash2 = Convert-ToInt32 ($r5a + $outhash1)
            $cache = $outhash2
            $counter = $counter - 1
        }

        [Byte[]] $outHash = New-Object byte[] 16
        [byte[]] $buffer = [BitConverter]::GetBytes([int]$outhash1)
        $buffer.CopyTo($outHash, 0)
        $buffer = [BitConverter]::GetBytes([int]$outhash2)
        $buffer.CopyTo($outHash, 4)

        # pass 2
        $cache = 0L
        $outhash1 = 0L
        $pdata = 0
        $md51 = [long]((Get-Long $bytesMD5) -bor 1)
        $md52 = [long]((Get-Long $bytesMD5 4) -bor 1)
        $counter = $index + 1

        while ($counter) {
            $r0 = Convert-ToInt32 ((Get-Long $bytes $pdata) + $outhash1)
            $pdata = $pdata + 8
            $r1a = Convert-ToInt32 ($r0 * $md51)
            $r1b = Convert-ToInt32 ((0xB1110000L * $r1a) - (0x30674EEFL * (Get-ShiftRight $r1a 16)))
            $r2a = Convert-ToInt32 ((0x5B9F0000L * $r1b) - (0x78F7A461L * (Get-ShiftRight $r1b 16)))
            $r2b = Convert-ToInt32 ((0x12CEB96DL * (Get-ShiftRight $r2a 16)) - (0x46930000L * $r2a))
            $r3 = Convert-ToInt32 ((0x1D830000L * $r2b) + (0x257E1D83L * (Get-ShiftRight $r2b 16)))
            $r4a = Convert-ToInt32 ($md52 * ($r3 + (Get-Long $bytes ($pdata - 4))))
            $r4b = Convert-ToInt32 ((0x16F50000L * $r4a) - (0x5D8BE90BL * (Get-ShiftRight $r4a 16)))
            $r5a = Convert-ToInt32 ((0x96FF0000L * $r4b) - (0x2C7C6901L * (Get-ShiftRight $r4b 16)))
            $r5b = Convert-ToInt32 ((0x2B890000L * $r5a) + (0x7C932B89L * (Get-ShiftRight $r5a 16)))
            $outhash1 = Convert-ToInt32 ((0x9F690000L * $r5b) - (0x405B6097L * (Get-ShiftRight $r5b 16)))
            $outhash2 = Convert-ToInt32 ($outhash1 + $cache + $r3)
            $cache = $outhash2
            $counter = $counter - 1
        }

        $buffer = [BitConverter]::GetBytes([int]$outhash1)
        $buffer.CopyTo($outHash, 8)
        $buffer = [BitConverter]::GetBytes([int]$outhash2)
        $buffer.CopyTo($outHash, 12)

        [Byte[]] $outHashBase = New-Object byte[] 8
        $hashValue1 = (Get-Long $outHash 8) -bxor (Get-Long $outHash)
        $hashValue2 = (Get-Long $outHash 12) -bxor (Get-Long $outHash 4)

        $buffer = [BitConverter]::GetBytes($hashValue1)
        $buffer.CopyTo($outHashBase, 0)
        $buffer = [BitConverter]::GetBytes($hashValue2)
        $buffer.CopyTo($outHashBase, 4)
        $base64Hash = [Convert]::ToBase64String($outHashBase)
    }

    return $base64Hash
}

# ---------------------------------------------------------------------------
# user context helpers
# ---------------------------------------------------------------------------

function Get-UserSid {
    return ([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value).ToLower()
}

function Get-UserExperience {
    $hardcoded = "User Choice set via Windows User Experience {D18B6DD5-6124-4341-9318-804003BAFA0B}"
    try {
        $shell32 = [Environment]::GetFolderPath([Environment+SpecialFolder]::SystemX86) + "\Shell32.dll"
        $stream = [System.IO.File]::Open($shell32, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $reader = [System.IO.BinaryReader]::new($stream)
        $bytes = $reader.ReadBytes(5MB)
        $stream.Close()
        $text = [Text.Encoding]::Unicode.GetString($bytes)
        $search = "User Choice set via Windows User Experience"
        $pos = $text.IndexOf($search)
        if ($pos -ge 0) {
            $end = $text.IndexOf("}", $pos)
            if ($end -gt $pos) { return $text.Substring($pos, $end - $pos + 1) }
        }
    }
    catch { }
    return $hardcoded
}

$regQueryInfoType = @'
using System;
using System.Runtime.InteropServices;
public static class RegInfo {
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
try { Add-Type -TypeDefinition $regQueryInfoType } catch { }

function Get-KeyLastWrite {
    # registry key last-write-time via RegQueryInfoKey (this .NET build has no RegistryKey.LastWriteTime)
    param([string]$Path)
    $h = [UIntPtr]::Zero
    $res = [RegInfo]::RegOpenKeyEx([UIntPtr]2147483649, $Path, 0, 0x20019, [ref]$h) # HKEY_CURRENT_USER = 0x80000001
    if ($res -ne 0 -or $h -eq [UIntPtr]::Zero) { return $null }
    try {
        $subKeys = 0
        $ft = 0L
        $res = [RegInfo]::RegQueryInfoKey($h, [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero,
            [ref]$subKeys, [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero,
            [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero, [ref]$ft)
        if ($res -ne 0) { return $null }
        return [DateTime]::FromFileTimeUtc($ft).ToLocalTime()
    }
    finally {
        [RegInfo]::RegCloseKey($h) | Out-Null
    }
}

function New-UserChoiceHash {
    param([string]$Ext, [string]$Sid, [string]$ProgId, [datetime]$Minute)
    $ft = $Minute.ToFileTime()
    $hi = ($ft -shr 32)
    $lo = ($ft -band 0xFFFFFFFFL)
    $dtHex = ($hi.ToString("X8") + $lo.ToString("X8")).ToLower()
    $userExp = Get-UserExperience
    $baseInfo = "$Ext$Sid$ProgId$dtHex$userExp".ToLower()
    return Get-UserChoiceHash $baseInfo
}

# ---------------------------------------------------------------------------
# registry helpers
# ---------------------------------------------------------------------------

function Set-RegValue {
    param([string]$Path, [string]$Name, $Value, [Microsoft.Win32.RegistryValueKind]$Kind = [Microsoft.Win32.RegistryValueKind]::String)
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($Path, $true)
    $key.SetValue($Name, $Value, $Kind)
    $key.Close()
}

function Remove-UserChoiceKey {
    param([string]$Ext)
    $path = "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$Ext\UserChoice"
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$Ext", $true)
    if ($key) {
        $key.DeleteSubKeyTree("UserChoice", $false)
        $key.Close()
    }
}

function Unlock-UserChoiceKey {
    # Win11 24H2 + UCPD.sys protect existing UserChoice keys with a Deny-SetValue ACE
    # for the owner; remove it so we can write a valid association, restore afterwards.
    param([string]$Ext)
    $regPath = "Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$Ext\UserChoice"
    if (-not (Test-Path $regPath)) { return $false }
    $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $acl = Get-Acl $regPath
    $denies = @($acl.Access | Where-Object {
        $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny -and
        $_.IdentityReference.Value -eq $me -and
        ($_.RegistryRights -band [System.Security.AccessControl.RegistryRights]::SetValue)
    })
    if ($denies.Count -gt 0) {
        foreach ($ace in $denies) { $acl.RemoveAccessRuleSpecific($ace) | Out-Null }
        Set-Acl -Path $regPath -AclObject $acl
    }
    return $denies.Count -gt 0
}

function Restore-UserChoiceKeyAcl {
    param([string]$Ext)
    $regPath = "Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$Ext\UserChoice"
    if (-not (Test-Path $regPath)) { return }
    $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $acl = Get-Acl $regPath
    $hasDeny = @($acl.Access | Where-Object {
        $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny -and
        $_.IdentityReference.Value -eq $me -and
        ($_.RegistryRights -band [System.Security.AccessControl.RegistryRights]::SetValue)
    }).Count -gt 0
    if (-not $hasDeny) {
        $rule = [System.Security.AccessControl.RegistryAccessRule]::new($me,
            [System.Security.AccessControl.RegistryRights]::SetValue,
            [System.Security.AccessControl.InheritanceFlags]::None,
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Deny)
        $acl.AddAccessRule($rule)
        Set-Acl -Path $regPath -AclObject $acl
    }
}

function Get-KeyMinute {
    param([string]$Ext)
    $path = "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$Ext\UserChoice"
    $lwt = Get-KeyLastWrite -Path $path
    if (-not $lwt) { return $null }
    return [datetime]::new($lwt.Year, $lwt.Month, $lwt.Day, $lwt.Hour, $lwt.Minute, 0)
}

function Test-UserChoiceHash {
    # mozilla-style check: recompute from the live last-write-time and compare with stored hash
    param([string]$Ext, [string]$Sid)
    $path = "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$Ext\UserChoice"
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($path)
    if (-not $key) { return "NO-USERCHOICE" }
    $progId = $key.GetValue("ProgId")
    $stored = $key.GetValue("Hash")
    $key.Close()
    $lwt = Get-KeyLastWrite -Path $path
    if (-not $progId -or -not $stored -or -not $lwt) { return "INCOMPLETE" }
    $minute = [datetime]::new($lwt.Year, $lwt.Month, $lwt.Day, $lwt.Hour, $lwt.Minute, 0)
    $computed = New-UserChoiceHash -Ext $Ext -Sid $Sid -ProgId $progId -Minute $minute
    if ($computed -eq $stored) { return "OK" } else { return "BROKEN" }
}

function Update-Shell {
    $code = '[System.Runtime.InteropServices.DllImport("Shell32.dll")] private static extern int SHChangeNotify(int eventId, int flags, IntPtr item1, IntPtr item2); public static void Refresh() { SHChangeNotify(0x8000000, 0, [IntPtr]::Zero, [IntPtr]::Zero); }'
    try {
        Add-Type -MemberDefinition $code -Namespace ShellNotify -Name Refresh
        [ShellNotify.Refresh]::Refresh()
    }
    catch { }
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

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
    if (-not $ExePath) { throw "mpv preset: could not locate mpv.exe (tried scoop mpv-git/mpv current + shims). pass -ExePath." }
    if (-not $ProgId) { $ProgId = "mpv-file" }
    if (-not $Extensions) { $Extensions = $mpvVideoExtensions }
    if (-not $Icon) { $Icon = "$ExePath,0" }
}

if (-not $ExePath) { throw "missing -ExePath (or use -Mpv)" }
if (-not $ProgId) { $ProgId = ([System.IO.Path]::GetFileNameWithoutExtension($ExePath)) + "-file" }
if (-not $Extensions) { throw "missing -Extensions (or use -Mpv)" }
if (-not (Test-Path -LiteralPath $ExePath)) { throw "exe not found: $ExePath" }
if (-not $Icon) { $Icon = "$ExePath,0" }

$exts = $Extensions | ForEach-Object {
    $e = $_.Trim()
    if (-not $e.StartsWith(".")) { $e = ".$e" }
    $e.ToLower()
} | Sort-Object -Unique

$sid = Get-UserSid
$openCommand = "`"$ExePath`" `"%1`""

Write-Host "progid    : $ProgId"
Write-Host "exe       : $ExePath"
Write-Host "command   : $openCommand"
Write-Host "extensions: $($exts -join ' ')"
Write-Host "sid       : $sid"
Write-Host ""

if ($VerifyOnly) {
    Write-Host "verify-only - checking existing UserChoice hashes:" -ForegroundColor Yellow
    foreach ($ext in $exts) {
        $status = Test-UserChoiceHash -Ext $ext -Sid $sid
        $color = switch ($status) { "OK" { "Green" } "BROKEN" { "Red" } "NO-USERCHOICE" { "DarkYellow" } default { "Yellow" } }
        Write-Host ("{0,-10} {1}" -f $ext, $status) -ForegroundColor $color
    }
    exit 0
}

# register the progid (once)
$basePath = "Software\Classes\$ProgId"
Set-RegValue -Path "$basePath" -Name "" -Value "mpv media file"
Set-RegValue -Path "$basePath\DefaultIcon" -Name "" -Value $Icon
Set-RegValue -Path "$basePath\shell\open\command" -Name "" -Value $openCommand
Write-Host "registered progid $ProgId" -ForegroundColor Green

foreach ($ext in $exts) {
    # OpenWithProgids entry (empty value)
    $owKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Software\Classes\$ext\OpenWithProgids", $true)
    $owKey.SetValue($ProgId, [byte[]]@(), [Microsoft.Win32.RegistryValueKind]::None)
    $owKey.Close()

    # base class default = progid
    Set-RegValue -Path "Software\Classes\$ext" -Name "" -Value $ProgId

    # UserChoice with valid hash (write Hash first, then ProgId, so the key's
    # last-write-time lands in the minute the hash was computed for). existing
    # UserChoice keys on Win11 24H2 carry a Deny-SetValue ACE (UCPD.sys) ->
    # temporarily unlock, write, then restore the ACE.
    $ucPath = "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$ext\UserChoice"
    $wasUnlocked = Unlock-UserChoiceKey -Ext $ext
    $success = $false
    for ($attempt = 0; $attempt -lt 5 -and -not $success; $attempt++) {
        $minute = [DateTime]::Now
        $minute = [datetime]::new($minute.Year, $minute.Month, $minute.Day, $minute.Hour, $minute.Minute, 0)
        $hash = New-UserChoiceHash -Ext $ext -Sid $sid -ProgId $ProgId -Minute $minute
        Set-RegValue -Path $ucPath -Name "Hash" -Value $hash
        Set-RegValue -Path $ucPath -Name "ProgId" -Value $ProgId
        $lwtMinute = Get-KeyMinute -Ext $ext
        if ($lwtMinute -eq $minute) { $success = $true }
    }
    if (-not $success) {
        Write-Host ("{0,-10} FAILED to settle hash after 5 tries (minute-boundary race)" -f $ext) -ForegroundColor Red
        continue
    }

    # verify like windows would
    $status = Test-UserChoiceHash -Ext $ext -Sid $sid
    $color = if ($status -eq "OK") { "Green" } else { "Red" }
    Write-Host ("{0,-10} set -> {1}" -f $ext, $status) -ForegroundColor $color

    if ($wasUnlocked) { Restore-UserChoiceKeyAcl -Ext $ext }

    # silence "how do you want to open this file?" toast
    if (-not $SkipToast) {
        try {
            Set-RegValue -Path "Software\Microsoft\Windows\CurrentVersion\ApplicationAssociationToasts" -Name "${ProgId}_$ext" -Value 0 -Kind DWord
        }
        catch { }
    }
}

Update-Shell
Write-Host ""
Write-Host "done. shell refreshed." -ForegroundColor Green