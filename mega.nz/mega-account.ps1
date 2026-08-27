param(
  [Parameter(Position = 0)]
  [string] $Command = "help",

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $Remaining
)

$ErrorActionPreference = "Stop"

$VaultModule = "<user-home>\Downloads\mainframe\vault-secret.psm1"
$DataRoot = Join-Path $env:APPDATA "automata\mega"
$CurrentFile = Join-Path $DataRoot "current.txt"

# --- helpers ---

function Ensure-DataRoot {
  New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null
}

function Normalize-Email {
  param([string] $Email)
  if ([string]::IsNullOrWhiteSpace($Email)) {
    throw "Email is required. MEGA profiles are keyed by account email."
  }
  $n = $Email.Trim().ToLowerInvariant()
  if ($n -notmatch "^[^@\s]+@[^@\s]+\.[^@\s]+$") {
    throw "Invalid email: $Email"
  }
  return $n
}

function Get-ActiveEmail {
  if (-not (Test-Path -LiteralPath $CurrentFile)) { return $null }
  return (Get-Content -LiteralPath $CurrentFile -Raw).Trim()
}

function Resolve-Email {
  param([string] $Email)
  if ([string]::IsNullOrWhiteSpace($Email)) {
    $a = Get-ActiveEmail
    if (-not $a) { throw "No active MEGA profile. Use 'use <email>' or pass an email." }
    return $a
  }
  return Normalize-Email $Email
}

function Read-MegaPassword {
  param([string] $Email)
  $normalized = Normalize-Email $Email
  Import-Module $VaultModule -Force
  $pw = Read-VaultSecret -Email $normalized -NamePattern "mega.nz" -ValueRegex '.+'
  if ([string]::IsNullOrWhiteSpace($pw)) {
    throw "No MEGA password in vault for $normalized. Run 'login $normalized' first."
  }
  return $pw
}

function Run-Megatools {
  param([string] $Email, [string[]] $Args)
  $normalized = Resolve-Email $Email
  $pw = Read-MegaPassword $normalized
  $escArgs = $Args | ForEach-Object { "'$_'" }
  $cmd = "megatools -u '$normalized' -p '$pw' " + ($escArgs -join " ")
  Invoke-Expression $cmd
}

# --- commands ---

function Invoke-Login {
  param([string] $Email)
  $normalized = Normalize-Email $Email
  Import-Module $VaultModule -Force
  $user = Read-Host "MEGA username (email) for $normalized"
  if ([string]::IsNullOrWhiteSpace($user)) { throw "Username is required." }
  Write-Host "Enter MEGA password for $normalized (hidden):" -NoNewline
  $pw = Read-Host -AsSecureString
  if ($pw.Length -eq 0) { throw "Password is required." }
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw)
  try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  $itemName = "mega.nz - $($normalized -split '@')[0]"
  Write-VaultSecretToExisting -Email $normalized -NamePattern "mega.nz" -Header "[password]" -Value $plain.Trim() -ItemName $itemName -Username $user -Uri "https://mega.nz"
  Set-ActiveProfile $normalized
  Write-Host "MEGA credentials saved to vault. Profile active: $normalized"
}

function Set-ActiveProfile {
  param([string] $Email)
  $normalized = Normalize-Email $Email
  Ensure-DataRoot
  Set-Content -LiteralPath $CurrentFile -Value $normalized -Encoding ASCII
}

function Get-Current {
  $a = Get-ActiveEmail
  if (-not $a) { Write-Host "No active MEGA profile."; return }
  Write-Host $a
}

function Get-List {
  # list profiles from vault items matching mega.nz
  Import-Module $VaultModule -Force
  $active = Get-ActiveEmail
  # we can't list all mega items from vault easily without bw export
  # just show the current + note
  if ($active) {
    Write-Host "* $active (active)"
    Write-Host "  (run 'login <email>' to add more)"
  } else {
    Write-Host "No MEGA profiles yet. Run 'login <email>'"
  }
}

function Get-Status {
  param([string] $Email)
  $e = Resolve-Email $Email
  Import-Module $VaultModule -Force
  $pw = Read-VaultSecret -Email $e -NamePattern "mega.nz" -ValueRegex '.+'
  if ($pw) {
    Write-Host "profile : $e"
    Write-Host "status  : vault creds present"
    Write-Host "active  : $(if ((Get-ActiveEmail) -eq $e) { 'yes' } else { 'no' })"
  } else {
    Write-Host "profile : $e"
    Write-Host "status  : no vault creds"
  }
}

function Get-StatusAll {
  Import-Module $VaultModule -Force
  $active = Get-ActiveEmail
  if ($active) {
    $pw = Read-VaultSecret -Email $active -NamePattern "mega.nz" -ValueRegex '.+'
    Write-Host "* $active  [$(if ($pw) { 'vault-creds' } else { 'no-creds' })]"
  } else {
    Write-Host "No active MEGA profile."
  }
}

function Show-Usage {
  @(
    "MEGA account helper (megatools + vault)",
    "",
    "Credentials stored in Bitwarden vault (item mega.nz - <email>).",
    "No config files or local state beyond %APPDATA%\\automata\\mega\\current.txt",
    "(which just holds the active email).",
    "",
    "Usage:",
    "  .\mega-account.ps1 login <email>",
    "  .\mega-account.ps1 use <email>",
    "  .\mega-account.ps1 current",
    "  .\mega-account.ps1 list",
    "  .\mega-account.ps1 status [email]",
    "  .\mega-account.ps1 status-all",
    "  .\mega-account.ps1 run [email] <megatools args...>",
    "  .\mega-account.ps1 upload [email] <local file> <remote folder>",
    "",
    "Examples:",
    "  .\mega-account.ps1 login ahmedtouhid8@example.com",
    "  .\mega-account.ps1 use ahmedtouhid8@example.com",
    "  .\mega-account.ps1 run df",
    "  .\mega-account.ps1 run ls /",
    "  .\mega-account.ps1 upload book.pdf /Books"
  ) -join [Environment]::NewLine | Write-Host
}

# --- dispatch ---

switch ($Command.ToLowerInvariant()) {
  "login" {
    if (-not ($Remaining -and $Remaining.Count -ge 1)) { throw "login requires <email>" }
    Invoke-Login -Email $Remaining[0]
  }
  "use" {
    if (-not ($Remaining -and $Remaining.Count -ge 1)) { throw "use requires <email>" }
    Set-ActiveProfile -Email $Remaining[0]
    Write-Host "Active MEGA profile: $(Normalize-Email $Remaining[0])"
  }
  "current" { Get-Current }
  "list" { Get-List }
  "status" { Get-Status -Email $(if ($Remaining -and $Remaining.Count -ge 1) { $Remaining[0] } else { $null }) }
  "status-all" { Get-StatusAll }
  "run" {
    if (-not $Remaining) { throw "run requires megatools arguments, e.g. 'run df' or 'run ls /'" }
    if ($Remaining[0] -match "^[^@\s]+@[^@\s]+\.[^@\s]+$") {
      Run-Megatools -Email $Remaining[0] -Args ($Remaining[1..($Remaining.Count - 1)])
    } else {
      Run-Megatools -Email $null -Args $Remaining
    }
  }
  "upload" {
    if ($Remaining.Count -ge 3 -and $Remaining[0] -match "^[^@\s]+@[^@\s]+\.[^@\s]+$") {
      Run-Megatools -Email $Remaining[0] -Args @("put", "--no-progress", "--path", $Remaining[2], $Remaining[1])
    } elseif ($Remaining.Count -ge 2) {
      Run-Megatools -Email $null -Args @("put", "--no-progress", "--path", $Remaining[1], $Remaining[0])
    } else {
      throw "upload requires <local file> <remote folder> (optional leading <email>)"
    }
  }
  default { Show-Usage }
}