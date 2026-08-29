param(
    [Parameter(Mandatory=$true)][string]$File,
    [int]$Copies = 1,
    [string]$LocalUser = '',
    [string]$Password = '',
    [string]$Printer = 'Campus.Printer',
    [switch]$NoElevate
)

# print a file to the campus SafeQ printer AS a local account named like a student id.
# SafeQ attributes jobs by the windows session, so the print must run under that
# account's context via Start-Process -Credential (elevation required).

$ErrorActionPreference = 'Continue'

$envFile = "$PSScriptRoot\.env.local"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#=]+)=(.+)$') {
            $k = $Matches[1].Trim(); $v = $Matches[2].Trim()
            if (-not $LocalUser -and $k -eq 'STUDENT_ID') { $LocalUser = $v }
            if (-not $Password -and $k -eq 'ACCOUNT_PASSWORD') { $Password = $v }
            if ($k -eq 'PRINTER_NAME') { $Printer = $v }
        }
    }
}

if (-not (Test-Path $File)) { Write-Error "file not found: $File"; exit 1 }
if (-not $LocalUser -or -not $Password) {
    Write-Error "STUDENT_ID and ACCOUNT_PASSWORD must be set in .env.local or passed as params"
    exit 1
}
if (-not $Printer) { Write-Error "PRINTER_NAME missing"; exit 1 }

$log = Join-Path $env:TEMP 'safeq-print.log'
Remove-Item $log -ErrorAction SilentlyContinue

# relaunch elevated if not already
if (-not $NoElevate) {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        $args = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -File `"$File`" -Copies $Copies -LocalUser $LocalUser -Password $Password -Printer `"$Printer`" -NoElevate"
        Start-Process pwsh -Verb RunAs -ArgumentList $args -Wait
        exit $LASTEXITCODE
    }
}

$pwd = ConvertTo-SecureString $Password -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential("$env:COMPUTERNAME\$LocalUser", $pwd)

# inner powershell prints the file N times under the student account.
# note: Out-Printer sends text content; for pdfs that render nothing, print the pdf
# from the interactive id session instead (see README gotchas).
$escapedFile = $File.Replace("'", "''")
$escapedPrinter = $Printer.Replace("'", "''")
$innerLog = Join-Path $env:TEMP 'safeq-print-inner.log'
Remove-Item $innerLog -ErrorAction SilentlyContinue
$inner = "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command `"`$log='$innerLog'; Get-Date -Format o | Out-File `$log -Append; whoami | Out-File `$log -Append; `$n=$Copies; for (`$i=1; `$i -le `$n; `$i++) { Get-Content '$escapedFile' -ErrorAction SilentlyContinue | Out-Printer -Name '$escapedPrinter' -ErrorAction SilentlyContinue }; 'printed' | Out-File `$log -Append`""

for ($i = 1; $i -le $Copies; $i++) {
    "copy $i/$Copies ..." | Out-File $log -Append
    $p = Start-Process -FilePath 'cmd.exe' -Credential $cred -ArgumentList '/c', $inner -WindowStyle Hidden -PassThru -ErrorAction SilentlyContinue
    if ($p) { $p.WaitForExit(120000) }
    Start-Sleep -Seconds 2
}

Start-Sleep -Seconds 3
if (Test-Path $innerLog) { Get-Content $innerLog | Out-File $log -Append }
Get-Content $log -ErrorAction SilentlyContinue | Out-String
