# Bitwarden auto-unlock setup
# Run ONCE to store your master password encrypted (DPAPI)
# After that, unlock.ps1 and any agent can unlock automatically

$credDir = "$env:APPDATA\mainframe\accounts\bitwarden"
$credFile = "$credDir\master.enc"

if (!(Test-Path $credDir)) {
    New-Item -ItemType Directory -Path $credDir -Force | Out-Null
}

Write-Host "Enter your Bitwarden master password (will be encrypted with DPAPI, stored locally only):"
$secure = Read-Host -AsSecureString

# Export using DPAPI — tied to this Windows user account
$secure | Export-Clixml -Path $credFile

Write-Host "Saved. Future unlocks are automatic."
Write-Host "File: $credFile"
