param(
    [string]$LocalUser = '',
    [string]$Password = '',
    [string]$Printer = 'Campus.Printer'
)

$ErrorActionPreference = 'Continue'

# try reading .env.local
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

if (-not $LocalUser -or -not $Password) {
    Write-Error "STUDENT_ID and ACCOUNT_PASSWORD must be set in .env.local or passed as params"
    exit 1
}

# create account
$sid = $null
try {
    $pwd = ConvertTo-SecureString $Password -AsPlainText -Force
    New-LocalUser -Name $LocalUser -Password $pwd -AccountNeverExpires -PasswordNeverExpires -ErrorAction Stop
    Add-LocalGroupMember -Group "Users" -Member $LocalUser -ErrorAction SilentlyContinue
    "created local account $LocalUser"
} catch {
    if ($_.Exception.Message -match 'already exists') {
        "account $LocalUser already exists"
    } else {
        Write-Error "account creation: $($_.Exception.Message)"
        exit 1
    }
}