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

  # try notes-first (Read-VaultSecret looks for [password] header in notes)
  $pw = $null
  try {
    $pw = Read-VaultSecret -Email $normalized -NamePattern "mega.nz" -ValueRegex '.+'
  } catch {}

  if ([string]::IsNullOrWhiteSpace($pw)) {
    # fallback: read login.password from the vault item directly
    $sf = "$env:APPDATA\mainframe\accounts\bitwarden\session.key"
    if (Test-Path $sf) {
      $env:BW_SESSION = Get-Content $sf -Raw
    }
    if (-not $env:BW_SESSION) {
      throw "No vault session. Run unlock.ps1 first."
    }
    $items = bw list items --search "mega.nz" --session $env:BW_SESSION 2>&1 | ConvertFrom-Json
    $item = $items | Where-Object {
      $_.name -like "mega.nz*" -and
      $_.login.username -and
      $_.login.username.Trim().ToLowerInvariant() -eq $normalized
    }
    if (-not $item) {
      throw "No vault item found for $normalized. Run 'login $normalized' first."
    }
    $pw = $item.login.password
    if ([string]::IsNullOrWhiteSpace($pw)) {
      throw "Vault item has no password for $normalized. Run 'login $normalized' to set one."
    }
  }
  return $pw
}

function Run-Megatools {
  param([string] $Email, [string] $Subcommand, [string[]] $Args)
  $normalized = Normalize-Email $Email
  $pw = Read-MegaPassword $normalized
  $escSub = $Subcommand
  $escArgs = $Args | ForEach-Object { "'$_'" }
  $cmd = "megatools $escSub -u '$normalized' -p '$pw' " + ($escArgs -join " ")
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
  try {
    $pw = Read-MegaPassword $normalized
    Write-Host "profile : $normalized"
    Write-Host "status  : vault creds present"
  } catch {
    Write-Host "profile : $normalized"
    Write-Host "status  : $($_.Exception.Message)"
  }
}

function Show-Usage {
  @(
    "MEGA account helper (megatools + vault)",
    "",
    "Credentials stored in Bitwarden vault (item mega.nz - <email>).",
    "Password read from either notes ([password] header) or login.password field.",
    "Stateless: email is always explicit, nothing stored locally.",
    "",
    "Usage:",
    "  .\mega-account.ps1 login <email>",
    "  .\mega-account.ps1 status <email>",
    "  .\mega-account.ps1 run <email> <megatools subcommand> <args...>",
    "  .\mega-account.ps1 upload <email> <local file> <remote folder>",
    "",
    "Examples:",
    "  .\mega-account.ps1 login ahmedtouhid88@gmail.com",
    "  .\mega-account.ps1 status ahmedtouhid88@gmail.com",
    "  .\mega-account.ps1 run ahmedtouhid88@gmail.com df",
    "  .\mega-account.ps1 run ahmedtouhid88@gmail.com ls /Root",
    "  .\mega-account.ps1 upload ahmedtouhid88@gmail.com book.pdf /Root"
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
    if ($Remaining.Count -lt 2) { throw "run requires <email> <subcommand> [args...], e.g. 'run <email> df'" }
    Run-Megatools -Email $Remaining[0] -Subcommand $Remaining[1] -Args ($Remaining[2..($Remaining.Count - 1)])
  }
  "upload" {
    if ($Remaining.Count -lt 3) { throw "upload requires <email> <local file> <remote folder>" }
    Run-Megatools -Email $Remaining[0] -Subcommand "put" -Args @("--no-progress", "--path", $Remaining[2], $Remaining[1])
  }
  default { Show-Usage }
}