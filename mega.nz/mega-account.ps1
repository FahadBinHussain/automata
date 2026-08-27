param(
  [Parameter(Position = 0)]
  [string] $Command = "help",

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $Remaining
)

$ErrorActionPreference = "Stop"

$Root = Join-Path $env:APPDATA "mainframe\accounts\mega"
$CurrentFile = Join-Path $Root "current.json"

# --- helpers ---

function Ensure-Root {
  New-Item -ItemType Directory -Force -Path $Root | Out-Null
}

function Normalize-Email {
  param([string] $Email)
  if ([string]::IsNullOrWhiteSpace($Email)) {
    throw "Email is required. MEGA profiles are keyed by account email only."
  }
  $Normalized = $Email.Trim().ToLowerInvariant()
  if ($Normalized -notmatch "^[^@\s]+@[^@\s]+\.[^@\s]+$") {
    throw "Invalid MEGA account email: $Email"
  }
  foreach ($c in [IO.Path]::GetInvalidFileNameChars()) {
    if ($Normalized.IndexOf([string]$c, [StringComparison]::Ordinal) -ge 0) {
      throw "Email contains a character that cannot be used in a Windows folder name: $Email"
    }
  }
  return $Normalized
}

function Get-ProfilePath {
  param([string] $Email)
  return Join-Path $Root (Normalize-Email $Email)
}

function Get-ConfigPath {
  param([string] $Email)
  return Join-Path (Get-ProfilePath $Email) "mega.ini"
}

function Get-ActiveEmail {
  if (-not (Test-Path -LiteralPath $CurrentFile)) { return $null }
  $j = Get-Content -LiteralPath $CurrentFile -Raw | ConvertFrom-Json
  return $j.profile
}

function Resolve-TargetEmail {
  param([string] $Email)
  if ([string]::IsNullOrWhiteSpace($Email)) {
    $active = Get-ActiveEmail
    if (-not $active) {
      throw "No active MEGA profile. Run .\mega-account.ps1 use <email> or pass <email>."
    }
    return $active
  }
  return Normalize-Email $Email
}

function Write-ProfileJson {
  param([string] $Email)
  $dir = Get-ProfilePath $Email
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  [ordered]@{
    tool = "mega"
    service = "MEGA"
    profile = (Normalize-Email $Email)
    configPath = (Get-ConfigPath $Email)
    updatedAt = (Get-Date).ToString("o")
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $dir "profile.json") -Encoding UTF8
}

function Show-Usage {
  @(
    "MEGA account profile helper (megatools)",
    "",
    "Profiles are keyed by account email only, stored in:",
    "  %APPDATA%\mainframe\accounts\mega\<email>",
    "",
    "MEGA is email+password auth (2FA optional). login prompts for username",
    "and password and writes a per-email mega.ini (in %APPDATA%\\mainframe\\accounts\\mega\\<email>\\),",
    "which is what megatools reads. That dir is personal state, never committed.",
    "",
    "Usage:",
    "  .\mega-account.ps1 login <email>",
    "  .\mega-account.ps1 use <email>",
    "  .\mega-account.ps1 current",
    "  .\mega-account.ps1 list",
    "  .\mega-account.ps1 status [email]",
    "  .\mega-account.ps1 status-all",
    "  .\mega-account.ps1 path [email]",
    "  .\mega-account.ps1 env [email]",
    "  .\mega-account.ps1 run [email] <megatools args...>",
    "  .\mega-account.ps1 upload [email] <local file> <remote folder>",
    "",
    "Examples:",
    "  .\mega-account.ps1 login ahmedtouhid8@example.com",
    "  .\mega-account.ps1 use ahmedtouhid8@example.com",
    "  .\mega-account.ps1 status-all",
    "  .\mega-account.ps1 run df",
    "  .\mega-account.ps1 run ls /",
    "  .\mega-account.ps1 upload book.pdf /Books"
  ) -join [Environment]::NewLine | Write-Host
}

# --- core commands ---

function Invoke-Login {
  param([string] $Email)
  $normalized = Normalize-Email $Email
  $dir = Get-ProfilePath $normalized
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $username = Read-Host "MEGA username (email) for $normalized"
  if ([string]::IsNullOrWhiteSpace($username)) { throw "Username is required." }
  Write-Host "Enter MEGA password for $normalized (hidden):" -NoNewline
  $pw = Read-Host -AsSecureString
  if ($pw.Length -eq 0) { throw "Password is required." }
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw)
  try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  # write mega.ini for megatools (username + password plaintext)
  $ini = @(
    "[Login]"
    "Username = $username"
    "Password = $plain"
  ) -join [Environment]::NewLine
  Set-Content -LiteralPath (Get-ConfigPath $normalized) -Value $ini -Encoding ASCII
  Write-ProfileJson $normalized
  Set-ActiveProfile $normalized
  Write-Host "MEGA profile configured: $normalized"
}

function Set-ActiveProfile {
  param([string] $Email)
  $normalized = Normalize-Email $Email
  Ensure-Root
  [ordered]@{
    tool = "mega"
    service = "MEGA"
    profile = $normalized
    updatedAt = (Get-Date).ToString("o")
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $CurrentFile -Encoding UTF8
}

function Get-Current {
  $active = Get-ActiveEmail
  if (-not $active) {
    Write-Host "No active MEGA profile."
    return
  }
  Write-Host $active
}

function Get-List {
  if (-not (Test-Path -LiteralPath $Root)) {
    Write-Host "No MEGA profiles yet."
    return
  }
  $active = Get-ActiveEmail
  foreach ($dir in (Get-ChildItem -LiteralPath $Root -Directory | Sort-Object Name)) {
    $marker = if ($dir.Name -eq $active) { "*" } else { " " }
    "{0} {1}" -f $marker, $dir.Name
  }
}

function Get-Status {
  param([string] $Email)
  $target = Resolve-TargetEmail $Email
  $dir = Get-ProfilePath $target
  $cfg = Get-ConfigPath $target
  if (-not (Test-Path -LiteralPath $cfg)) {
    Write-Host "MEGA profile not logged in: $target (no mega.ini)"
    return
  }
  $json = Get-Content -LiteralPath (Join-Path $dir "profile.json") -Raw | ConvertFrom-Json
  Write-Host "profile : $target"
  Write-Host "config  : $($json.configPath)"
  Write-Host "updated : $($json.updatedAt)"
  Write-Host "status  : configured (megatools mega.ini present)"
}

function Get-StatusAll {
  if (-not (Test-Path -LiteralPath $Root)) {
    Write-Host "No MEGA profiles yet."
    return
  }
  $active = Get-ActiveEmail
  foreach ($dir in (Get-ChildItem -LiteralPath $Root -Directory | Sort-Object Name)) {
    $cfg = Join-Path $dir.FullName "mega.ini"
    $state = if (Test-Path -LiteralPath $cfg) { "configured" } else { "no-config" }
    $marker = if ($dir.Name -eq $active) { "*" } else { " " }
    "{0} {1}  [{2}]" -f $marker, $dir.Name, $state
  }
}

function Get-Path {
  param([string] $Email)
  $target = Resolve-TargetEmail $Email
  Write-Host (Get-ProfilePath $target)
}

function Get-Env {
  param([string] $Email)
  $target = Resolve-TargetEmail $Email
  $cfg = Get-ConfigPath $target
  Write-Host "MEGA_EMAIL=$target"
  Write-Host "MEGA_CONFIG=$cfg"
}

function Invoke-Run {
  param([string] $Email, [string[]] $MegatoolsArgs)
  $target = Resolve-TargetEmail $Email
  $cfg = Get-ConfigPath $target
  if (-not (Test-Path -LiteralPath $cfg)) {
    throw "MEGA profile not logged in: $target. Run .\mega-account.ps1 login $target first."
  }
  if ($MegatoolsArgs.Count -eq 0) {
    throw "megatools arguments are required, e.g. 'run df' or 'run ls /'."
  }
  $cmd = "megatools --config $cfg " + ($MegatoolsArgs | ForEach-Object { "'$_'" }) -join " "
  Invoke-Expression $cmd
}

function Invoke-Upload {
  param([string] $Email, [string] $LocalPath, [string] $RemoteFolder)
  if ([string]::IsNullOrWhiteSpace($LocalPath)) { throw "Local file path is required." }
  if ([string]::IsNullOrWhiteSpace($RemoteFolder)) { throw "Remote folder is required, e.g. /Books" }
  if (-not (Test-Path -LiteralPath $LocalPath)) { throw "Local file not found: $LocalPath" }
  $target = Resolve-TargetEmail $Email
  $cfg = Get-ConfigPath $target
  if (-not (Test-Path -LiteralPath $cfg)) {
    throw "MEGA profile not logged in: $target. Run .\mega-account.ps1 login $target first."
  }
  $quotedLocal = "'$($LocalPath -replace "'", "''")'"
  $quotedRemote = "'$($RemoteFolder -replace "'", "''")'"
  Invoke-Expression "megatools --config $cfg put --no-progress --path $quotedRemote $quotedLocal"
}

# --- dispatch ---

switch ($Command.ToLowerInvariant()) {
  "login" {
    if (-not $Remaining -or $Remaining.Count -lt 1) { throw "login requires <email>" }
    Invoke-Login -Email $Remaining[0]
  }
  "use" {
    if (-not $Remaining -or $Remaining.Count -lt 1) { throw "use requires <email>" }
    Set-ActiveProfile -Email $Remaining[0]
    Write-Host "Active MEGA profile: $(Normalize-Email $Remaining[0])"
  }
  "current" { Get-Current }
  "list" { Get-List }
  "status" {
    if ($Remaining -and $Remaining.Count -ge 1) { Get-Status -Email $Remaining[0] }
    else { Get-Status -Email $null }
  }
  "status-all" { Get-StatusAll }
  "path" {
    if ($Remaining -and $Remaining.Count -ge 1) { Get-Path -Email $Remaining[0] }
    else { Get-Path -Email $null }
  }
  "env" {
    if ($Remaining -and $Remaining.Count -ge 1) { Get-Env -Email $Remaining[0] }
    else { Get-Env -Email $null }
  }
  "run" {
    if (-not $Remaining) { throw "run requires megatools arguments, e.g. 'run df' or 'run ls /'" }
    if ($Remaining[0] -match "^[^@\s]+@[^@\s]+\.[^@\s]+$") {
      Invoke-Run -Email $Remaining[0] -MegatoolsArgs ($Remaining[1..($Remaining.Count - 1)])
    } else {
      Invoke-Run -Email $null -MegatoolsArgs $Remaining
    }
  }
  "upload" {
    # upload [email] <local> <remote>  OR  upload <local> <remote>
    if ($Remaining.Count -ge 3 -and $Remaining[0] -match "^[^@\s]+@[^@\s]+\.[^@\s]+$") {
      Invoke-Upload -Email $Remaining[0] -LocalPath $Remaining[1] -RemoteFolder $Remaining[2]
    } elseif ($Remaining.Count -ge 2) {
      Invoke-Upload -Email $null -LocalPath $Remaining[0] -RemoteFolder $Remaining[1]
    } else {
      throw "upload requires <local file> <remote folder> (optional leading <email>)"
    }
  }
  default { Show-Usage }
}
