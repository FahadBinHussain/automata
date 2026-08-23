$ErrorActionPreference = 'Stop'

# vault-secret module lives in mainframe for now; this helper is the first
# piece being relocated into automata as part of the slow mainframe -> automata
# merge. import from the mainframe path so there is a single source of truth
# until the module itself moves.
$vaultModule = Join-Path $env:USERPROFILE 'Downloads\mainframe\vault-secret.psm1'
if (-not (Test-Path -LiteralPath $vaultModule)) {
    throw "vault-secret.psm1 not found at $vaultModule - expected for now until the module moves into automata"
}
Import-Module $vaultModule -Force

$accountRoot = Join-Path $env:APPDATA 'mainframe\accounts\gitguardian'
$currentFile = Join-Path $accountRoot 'current.json'
$apiEndpoint = 'https://api.gitguardian.com/v1'

function Show-Usage {
    @(
        'GitGuardian API account profile helper',
        '',
        'Profiles are keyed by account email only. Tokens are vault-native:',
        'stored in the Bitwarden item "dashboard.gitguardian.com" notes under',
        'the "Personal access tokens" header (the PAT, gg_pat_...). Profile dir',
        'holds metadata only, never the token.',
        '',
        'Usage:',
        '  .\gitguardian-account.ps1 login <email>',
        '  .\gitguardian-account.ps1 token-add <email>',
        '  .\gitguardian-account.ps1 token-clear [email]',
        '  .\gitguardian-account.ps1 use <email>',
        '  .\gitguardian-account.ps1 run [email] <GET|POST|PATCH|DELETE> <api path> [json body]',
        '  .\gitguardian-account.ps1 health [email]',
        '  .\gitguardian-account.ps1 whoami [email]',
        '  .\gitguardian-account.ps1 scan [email] <text-or-file> <filename>',
        '  .\gitguardian-account.ps1 incidents [email]',
        '  .\gitguardian-account.ps1 sources [email]',
        '  .\gitguardian-account.ps1 status [email]',
        '  .\gitguardian-account.ps1 status-all',
        '  .\gitguardian-account.ps1 list',
        '  .\gitguardian-account.ps1 current',
        '  .\gitguardian-account.ps1 path [email]',
        '  .\gitguardian-account.ps1 env [email]',
        '  .\gitguardian-account.ps1 logout [email]',
        '',
        'Examples:',
        '  .\gitguardian-account.ps1 login <user>@example.com',
        '  .\gitguardian-account.ps1 health',
        '  .\gitguardian-account.ps1 whoami',
        '  .\gitguardian-account.ps1 scan "$(Get-Content secrets.txt -Raw)" secrets.txt',
        '  .\gitguardian-account.ps1 incidents'
    ) -join [Environment]::NewLine | Write-Host
}

function Normalize-ProfileName {
    param([string]$Profile)

    if ([string]::IsNullOrWhiteSpace($Profile)) {
        throw 'Email profile is required.'
    }

    $normalized = $Profile.Trim().ToLowerInvariant()
    if ($normalized -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') {
        throw "GitGuardian profile must be an account email, not a label or username: $Profile"
    }

    foreach ($char in [IO.Path]::GetInvalidFileNameChars()) {
        $invalidChar = [string]$char
        if ([string]::IsNullOrEmpty($invalidChar)) {
            continue
        }

        if ($normalized.IndexOf($invalidChar, [StringComparison]::Ordinal) -ge 0) {
            throw "Profile contains a character that cannot be used in a Windows folder name: $Profile"
        }
    }

    return $normalized
}

function Test-LooksLikeEmail {
    param([AllowNull()][string]$Value)

    return (-not [string]::IsNullOrWhiteSpace($Value)) -and ($Value -match '^[^\s@]+@[^\s@]+\.[^\s@]+$')
}

function Get-ProfilePath {
    param([string]$Profile)

    $normalized = Normalize-ProfileName -Profile $Profile
    return Join-Path $accountRoot $normalized
}

function Get-TokenFingerprint {
    param([AllowNull()][string]$Token)

    if ([string]::IsNullOrWhiteSpace($Token)) {
        return $null
    }

    $bytes = [Text.Encoding]::UTF8.GetBytes($Token)
    $hash = [Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
    return (($hash | ForEach-Object { $_.ToString('x2') }) -join '').Substring(0, 12)
}

function Write-ProfileMetadata {
    param(
        [string]$Profile,
        [string]$ProfilePath
    )

    New-Item -ItemType Directory -Force -Path $ProfilePath | Out-Null
    [ordered]@{
        tool = 'gitguardian'
        service = 'GitGuardian'
        profile = $Profile
        apiEndpoint = $apiEndpoint
        updatedAt = (Get-Date).ToString('o')
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $ProfilePath 'profile.json') -Encoding UTF8
}

function Write-ProfileToken {
    param(
        [string]$Profile,
        [Security.SecureString]$Token
    )

    $normalized = Normalize-ProfileName -Profile $Profile
    $profilePath = Get-ProfilePath -Profile $normalized
    Write-ProfileMetadata -Profile $normalized -ProfilePath $profilePath
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Token)
    try {
        $plainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
    Write-VaultSecretToExisting -Email $normalized -NamePattern 'dashboard.gitguardian.com' -Header 'Personal access tokens' -Value $plainToken.Trim() -ItemName 'dashboard.gitguardian.com' -Username $normalized -Uri 'https://dashboard.gitguardian.com'
    Set-ActiveProfile -Profile $normalized
}

function Read-ProfileToken {
    param([string]$Profile)

    $normalized = Normalize-ProfileName -Profile $Profile
    $token = Read-VaultSecret -Email $normalized -NamePattern 'dashboard.gitguardian.com' -ValueRegex 'gg_pat_[A-Za-z0-9]+'
    if ([string]::IsNullOrWhiteSpace($token)) {
        throw "No GitGuardian PAT found in vault for $normalized. Run .\gitguardian-account.ps1 login $normalized first."
    }

    return $token
}

function Set-ActiveProfile {
    param([string]$Profile)

    $normalized = Normalize-ProfileName -Profile $Profile
    New-Item -ItemType Directory -Force -Path $accountRoot | Out-Null
    [ordered]@{
        tool = 'gitguardian'
        service = 'GitGuardian'
        profile = $normalized
        updatedAt = (Get-Date).ToString('o')
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $currentFile -Encoding UTF8
}

function Get-ActiveProfile {
    if (-not (Test-Path -LiteralPath $currentFile)) {
        return $null
    }

    $current = Get-Content -LiteralPath $currentFile -Raw | ConvertFrom-Json
    try {
        return Normalize-ProfileName -Profile ([string]$current.profile)
    } catch {
        return $null
    }
}

function Get-ProfileOrActive {
    param([AllowNull()][string]$Profile)

    if (-not [string]::IsNullOrWhiteSpace($Profile)) {
        return Normalize-ProfileName -Profile $Profile
    }

    $active = Get-ActiveProfile
    if (-not $active) {
        throw 'No email was provided and no active GitGuardian email profile is set. Run .\gitguardian-account.ps1 use <email>.'
    }

    return Normalize-ProfileName -Profile $active
}

function Get-ProfileName {
    param([IO.DirectoryInfo]$Directory)

    $metadataPath = Join-Path $Directory.FullName 'profile.json'
    if (Test-Path -LiteralPath $metadataPath) {
        try {
            $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
            if ($metadata.profile) {
                return [string]$metadata.profile
            }
        } catch {
            Write-Warning "Could not read profile metadata: $metadataPath"
        }
    }

    return $Directory.Name
}

function Get-ProfileStatus {
    param([string]$Profile)

    $normalized = Normalize-ProfileName -Profile $Profile
    $profilePath = Get-ProfilePath -Profile $normalized
    $exists = Test-Path -LiteralPath $profilePath
    $token = Read-VaultSecret -Email $normalized -NamePattern 'dashboard.gitguardian.com' -ValueRegex 'gg_pat_[A-Za-z0-9]+'
    $hasToken = -not [string]::IsNullOrWhiteSpace($token)
    $active = Get-ActiveProfile

    [pscustomobject]@{
        Profile = $normalized
        Exists = $exists
        IsActive = ($active -eq $normalized)
        HasToken = $hasToken
        TokenFingerprint = Get-TokenFingerprint -Token $token
        ApiEndpoint = $apiEndpoint
        State = if (-not $exists) { 'missing-profile' } elseif (-not $hasToken) { 'missing-token' } elseif ($active -eq $normalized) { 'active' } else { 'configured' }
    }
}

function Get-ApiPath {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw 'API path is required.'
    }

    if ($Path -match '^https?://') {
        $uri = [uri]$Path
        if ($uri.Host -ne 'api.gitguardian.com') {
            throw 'Only https://api.gitguardian.com URLs are allowed.'
        }

        return $uri.PathAndQuery
    }

    if ($Path.StartsWith('/')) {
        return $Path
    }

    return "/$Path"
}

function Invoke-GitGuardianApi {
    param(
        [string]$Profile,
        [string]$Method,
        [string]$Path,
        [AllowNull()][string]$JsonBody
    )

    $normalized = Normalize-ProfileName -Profile $Profile
    $token = Read-ProfileToken -Profile $normalized
    $apiPath = Get-ApiPath -Path $Path
    $uri = "$apiEndpoint$apiPath"
    $headers = @{
        Authorization = "Token $token"
        Accept = 'application/json'
    }

    $methodUpper = $Method.ToUpperInvariant()
    if ($methodUpper -notin @('GET', 'POST', 'PATCH', 'DELETE', 'PUT')) {
        throw 'Method must be one of: GET, POST, PATCH, DELETE, PUT.'
    }

    try {
        if ([string]::IsNullOrWhiteSpace($JsonBody)) {
            return Invoke-RestMethod -Method $methodUpper -Uri $uri -Headers $headers -ContentType 'application/json'
        }

        $JsonBody | ConvertFrom-Json | Out-Null
        return Invoke-RestMethod -Method $methodUpper -Uri $uri -Headers $headers -ContentType 'application/json' -Body $JsonBody
    } catch {
        $response = $_.Exception.Response
        if ($response -and $response.StatusCode) {
            $statusCode = [int]$response.StatusCode
            $statusDescription = $response.StatusDescription
            throw "GitGuardian API $methodUpper $apiPath failed: HTTP $statusCode $statusDescription ($($_.ErrorDetails.Message))"
        }

        throw "GitGuardian API $methodUpper $apiPath failed: $($_.Exception.Message)"
    }
}

function ConvertTo-JsonOutput {
    param([AllowNull()]$Value)

    if ($null -eq $Value) {
        Write-Host '{}'
        return
    }

    $Value | ConvertTo-Json -Depth 16
}

function Remove-Profile {
    param([string]$Profile)

    $normalized = Normalize-ProfileName -Profile $Profile
    $profilePath = Get-ProfilePath -Profile $normalized
    if (-not (Test-Path -LiteralPath $profilePath)) {
        Write-Host "GitGuardian profile does not exist: $normalized"
        return
    }

    $backupPath = "$profilePath.logged-out-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Move-Item -LiteralPath $profilePath -Destination $backupPath
    Write-Host "GitGuardian profile moved to: $backupPath"

    $active = Get-ActiveProfile
    if ($active -eq $normalized -and (Test-Path -LiteralPath $currentFile)) {
        Remove-Item -LiteralPath $currentFile
        Write-Host 'Active GitGuardian profile cleared.'
    }
}

$command = if ($args.Count -gt 0) { $args[0].ToLowerInvariant() } else { 'help' }
$remaining = @($args | Select-Object -Skip 1)

switch ($command) {
    'help' {
        Show-Usage
    }

    { $_ -in @('login', 'token-add', 'add') } {
        if ($remaining.Count -lt 1) {
            throw 'Usage: .\gitguardian-account.ps1 login <email>'
        }

        $profile = Normalize-ProfileName -Profile $remaining[0]
        Write-Host "Paste a GitGuardian PAT (gg_pat_...) for $profile. Input is hidden; it will be stored in the Bitwarden vault (dashboard.gitguardian.com notes)."
        $token = Read-Host 'GitGuardian PAT' -AsSecureString
        Write-ProfileToken -Profile $profile -Token $token
        Write-Host "GitGuardian profile is ready and active: $profile"
    }

    'token-clear' {
        $profile = Get-ProfileOrActive -Profile $(if ($remaining.Count -ge 1) { $remaining[0] } else { $null })
        Write-Host "To revoke the vault token for $profile, edit the Bitwarden item dashboard.gitguardian.com notes and remove the PAT line."
    }

    'use' {
        if ($remaining.Count -ne 1) {
            throw 'Usage: .\gitguardian-account.ps1 use <email>'
        }

        $profile = Normalize-ProfileName -Profile $remaining[0]
        $token = Read-VaultSecret -Email $profile -NamePattern 'dashboard.gitguardian.com' -ValueRegex 'gg_pat_[A-Za-z0-9]+'
        if ([string]::IsNullOrWhiteSpace($token)) {
            throw "No GitGuardian PAT found in vault for $profile. Run .\gitguardian-account.ps1 login $profile first."
        }

        $profilePath = Get-ProfilePath -Profile $profile
        Write-ProfileMetadata -Profile $profile -ProfilePath $profilePath
        Set-ActiveProfile -Profile $profile
        Write-Host "Active GitGuardian profile: $profile"
    }

    'run' {
        if ($remaining.Count -lt 2) {
            throw 'Usage: .\gitguardian-account.ps1 run [email] <GET|POST|PATCH|DELETE> <api path> [json body]'
        }

        $argOffset = 0
        if (Test-LooksLikeEmail -Value $remaining[0]) {
            $argOffset = 1
        }

        $profile = Get-ProfileOrActive -Profile $(if ($argOffset -eq 1) { $remaining[0] } else { $null })
        $method = $remaining[$argOffset]
        $path = $remaining[$argOffset + 1]
        $body = if ($remaining.Count -gt ($argOffset + 2)) { ($remaining[($argOffset + 2)..($remaining.Count - 1)] -join ' ') } else { $null }
        ConvertTo-JsonOutput -Value (Invoke-GitGuardianApi -Profile $profile -Method $method -Path $path -JsonBody $body)
    }

    'health' {
        $profile = Get-ProfileOrActive -Profile $(if ($remaining.Count -ge 1) { $remaining[0] } else { $null })
        ConvertTo-JsonOutput -Value (Invoke-GitGuardianApi -Profile $profile -Method GET -Path '/health')
    }

    'whoami' {
        $profile = Get-ProfileOrActive -Profile $(if ($remaining.Count -ge 1) { $remaining[0] } else { $null })
        ConvertTo-JsonOutput -Value (Invoke-GitGuardianApi -Profile $profile -Method GET -Path '/token')
    }

    'scan' {
        if ($remaining.Count -lt 2) {
            throw 'Usage: .\gitguardian-account.ps1 scan [email] <text-or-file> <filename>'
        }

        $argOffset = 0
        if (Test-LooksLikeEmail -Value $remaining[0]) {
            $argOffset = 1
        }

        $profile = Get-ProfileOrActive -Profile $(if ($argOffset -eq 1) { $remaining[0] } else { $null })
        $contentArg = $remaining[$argOffset]
        $filename = $remaining[$argOffset + 1]
        $content = if (Test-Path -LiteralPath $contentArg) { Get-Content -LiteralPath $contentArg -Raw } else { $contentArg }
        $body = @{ document = $content; filename = $filename } | ConvertTo-Json -Depth 4 -Compress
        ConvertTo-JsonOutput -Value (Invoke-GitGuardianApi -Profile $profile -Method POST -Path '/scan' -JsonBody $body)
    }

    'incidents' {
        $profile = Get-ProfileOrActive -Profile $(if ($remaining.Count -ge 1) { $remaining[0] } else { $null })
        ConvertTo-JsonOutput -Value (Invoke-GitGuardianApi -Profile $profile -Method GET -Path '/incidents/secrets')
    }

    'sources' {
        $profile = Get-ProfileOrActive -Profile $(if ($remaining.Count -ge 1) { $remaining[0] } else { $null })
        ConvertTo-JsonOutput -Value (Invoke-GitGuardianApi -Profile $profile -Method GET -Path '/sources')
    }

    'status' {
        $profile = Get-ProfileOrActive -Profile $(if ($remaining.Count -ge 1) { $remaining[0] } else { $null })
        Get-ProfileStatus -Profile $profile | Format-List
    }

    'status-all' {
        if (-not (Test-Path -LiteralPath $accountRoot)) {
            Write-Host 'No GitGuardian profiles found.'
            return
        }

        $profiles = @(Get-ChildItem -LiteralPath $accountRoot -Directory -Force | Where-Object { $_.Name -match '^[^\s@]+@[^\s@]+\.[^\s@]+$' } | Sort-Object Name)
        if ($profiles.Count -eq 0) {
            Write-Host 'No GitGuardian profiles found.'
            return
        }

        $profiles |
            ForEach-Object { Get-ProfileStatus -Profile (Get-ProfileName -Directory $_) } |
            Format-Table -AutoSize
    }

    'list' {
        if (-not (Test-Path -LiteralPath $accountRoot)) {
            Write-Host 'No GitGuardian profiles found.'
            return
        }

        $active = Get-ActiveProfile
        $profiles = @(Get-ChildItem -LiteralPath $accountRoot -Directory -Force | Where-Object { $_.Name -match '^[^\s@]+@[^\s@]+\.[^\s@]+$' } | Sort-Object Name)
        if ($profiles.Count -eq 0) {
            Write-Host 'No GitGuardian profiles found.'
            return
        }

        foreach ($profileDir in $profiles) {
            $profile = Get-ProfileName -Directory $profileDir
            $marker = if ($profile -eq $active) { '*' } else { ' ' }
            Write-Host "$marker $profile"
        }
    }

    'current' {
        $active = Get-ActiveProfile
        if ($active) {
            Write-Host $active
        } else {
            Write-Host 'No active GitGuardian email profile set.'
        }
    }

    'path' {
        $profile = Get-ProfileOrActive -Profile $(if ($remaining.Count -ge 1) { $remaining[0] } else { $null })
        Write-Host (Get-ProfilePath -Profile $profile)
    }

    'env' {
        $profile = Get-ProfileOrActive -Profile $(if ($remaining.Count -ge 1) { $remaining[0] } else { $null })
        Write-Host "`$env:GITGUARDIAN_API_TOKEN = <vault-native (dashboard.gitguardian.com notes)>"
        Write-Host "`$env:GITGUARDIAN_API_ENDPOINT = '$apiEndpoint'"
    }

    'logout' {
        $profile = Get-ProfileOrActive -Profile $(if ($remaining.Count -ge 1) { $remaining[0] } else { $null })
        Remove-Profile -Profile $profile
    }

    default {
        Show-Usage
        throw "Unknown command: $command"
    }
}
