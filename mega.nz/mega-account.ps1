param(
  [Parameter(Position = 0)]
  [string] $Command = "help",

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $Remaining
)

$ErrorActionPreference = "Stop"

$VaultModule = "<user-home>\Downloads\mainframe\vault-secret.psm1"

# --- helpers ---

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
  $normalized = Normalize-Email $Email
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
  Write-Host "MEGA credentials saved to vault: $normalized"
}

function Get-Status {
  param([string] $Email)
  $normalized = Normalize-Email $Email
  Import-Module $VaultModule -Force
  $pw = Read-VaultSecret -Email $normalized -NamePattern "mega.nz" -ValueRegex '.+'
  if ($pw) {
    Write-Host "profile : $normalized"
    Write-Host "status  : vault creds present"
  } else {
    Write-Host "profile : $normalized"
    Write-Host "status  : no vault creds"
  }
}

function Show-Usage {
  @(
    "MEGA account helper (megatools + vault)",
    "",
    "Credentials stored in Bitwarden vault (item mega.nz - <email>).",
    "Stateless: email is always explicit, nothing stored locally.",
    "",
    "Usage:",
    "  .\mega-account.ps1 login <email>",
    "  .\mega-account.ps1 status <email>",
    "  .\mega-account.ps1 run <email> <megatools args...>",
    "  .\mega-account.ps1 upload <email> <local file> <remote folder>",
    "",
    "Examples:",
    "  .\mega-account.ps1 login ahmedtouhid8@example.com",
    "  .\mega-account.ps1 status ahmedtouhid8@example.com",
    "  .\mega-account.ps1 run ahmedtouhid8@example.com df",
    "  .\mega-account.ps1 run ahmedtouhid8@example.com ls /",
    "  .\mega-account.ps1 upload ahmedtouhid8@example.com book.pdf /Books"
  ) -join [Environment]::NewLine | Write-Host
}

# --- dispatch ---

switch ($Command.ToLowerInvariant()) {
  "login" {
    if (-not ($Remaining -and $Remaining.Count -ge 1)) { throw "login requires <email>" }
    Invoke-Login -Email $Remaining[0]
  }
  "status" {
    if (-not ($Remaining -and $Remaining.Count -ge 1)) { throw "status requires <email>" }
    Get-Status -Email $Remaining[0]
  }
  "run" {
    if ($Remaining.Count -lt 2) { throw "run requires <email> and megatools args, e.g. 'run <email> df'" }
    Run-Megatools -Email $Remaining[0] -Args ($Remaining[1..($Remaining.Count - 1)])
  }
  "upload" {
    if ($Remaining.Count -lt 3) { throw "upload requires <email> <local file> <remote folder>" }
    Run-Megatools -Email $Remaining[0] -Args @("put", "--no-progress", "--path", $Remaining[2], $Remaining[1])
  }
  default { Show-Usage }
}