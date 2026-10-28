<##
.SYNOPSIS
    Submit a public repository page to multiple preservation services.

.DESCRIPTION
    Sends the repository origin to independent preservation sites:
    Software Heritage for Git history, and Internet Archive Save Page Now for
    the public repository page. No local clone, mirror, archive, or external
    Git-host push is created.

.EXAMPLE
    .\repo-preserve.ps1 https://github.com/togg53192-cmd/jailbreaks

.EXAMPLE
    .\repo-preserve.ps1 https://github.com/togg53192-cmd/jailbreaks.git
##>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string] $RepositoryUrl
)

$ErrorActionPreference = 'Stop'

try {
    $uri = [System.Uri] $RepositoryUrl
} catch {
    throw "invalid repository URL: $RepositoryUrl"
}

if ($uri.Scheme -notin @('http', 'https') -or [string]::IsNullOrWhiteSpace($uri.Host)) {
    throw "repository URL must be an absolute http(s) URL: $RepositoryUrl"
}

$origin = $uri.AbsoluteUri.TrimEnd('/')
$encodedOrigin = [System.Uri]::EscapeDataString($origin)
$softwareHeritageEndpoint = "https://archive.softwareheritage.org/api/1/origin/save/?visit_type=git&origin_url=$encodedOrigin"
$failures = [System.Collections.Generic.List[string]]::new()
$softwareHeritageResponse = $null
$waybackResponse = $null

Write-Host "[Software Heritage] submitting Git origin: $origin"
try {
    $softwareHeritageResponse = Invoke-RestMethod -Method Post -Uri $softwareHeritageEndpoint -Headers @{ Accept = 'application/json' }

    if ($null -eq $softwareHeritageResponse) {
        throw 'Software Heritage returned an empty response.'
    }

    $status = if ($softwareHeritageResponse.save_request_status) { $softwareHeritageResponse.save_request_status } else { 'unknown' }
    $taskStatus = if ($softwareHeritageResponse.save_task_status) { $softwareHeritageResponse.save_task_status } else { 'unknown' }

    Write-Host "[Software Heritage] request status: $status"
    Write-Host "[Software Heritage] task status: $taskStatus"

    if ($softwareHeritageResponse.request_url) {
        Write-Host "[Software Heritage] request: $($softwareHeritageResponse.request_url)"
    }

    if ($softwareHeritageResponse.id) {
        Write-Host "[Software Heritage] status API: https://archive.softwareheritage.org/api/1/origin/save/$($softwareHeritageResponse.id)/"
    }

    if ($status -eq 'rejected') {
        throw "Software Heritage rejected the repository: $($softwareHeritageResponse.note)"
    }
} catch {
    $failures.Add("Software Heritage: $($_.Exception.Message)")
    Write-Error "[Software Heritage] FAILED: $($_.Exception.Message)"
}

Write-Host "[Internet Archive / Wayback Machine] saving public repository page: $origin"
$waybackEndpoint = "https://web.archive.org/save/$origin"
try {
    $waybackResponse = Invoke-WebRequest -Method Get -Uri $waybackEndpoint -MaximumRedirection 10
    $waybackUrl = $null
    if ($waybackResponse.BaseResponse.ResponseUri) {
        $waybackUrl = $waybackResponse.BaseResponse.ResponseUri.AbsoluteUri
    }
    if (-not $waybackUrl -and $waybackResponse.Headers.Location) {
        $waybackUrl = $waybackResponse.Headers.Location
    }
    Write-Host "[Internet Archive / Wayback Machine] submitted successfully"
    if ($waybackUrl) {
        Write-Host "[Internet Archive / Wayback Machine] result: $waybackUrl"
    } else {
        Write-Host "[Internet Archive / Wayback Machine] result: $waybackEndpoint"
    }
} catch {
    $failures.Add("Internet Archive / Wayback Machine: $($_.Exception.Message)")
    Write-Error "[Internet Archive / Wayback Machine] FAILED: $($_.Exception.Message)"
}

if ($failures.Count -gt 0) {
    throw ($failures -join '; ')
}

[PSCustomObject]@{
    RepositoryUrl = $origin
    SoftwareHeritageRequest = $softwareHeritageResponse.request_url
    WaybackSubmission = $waybackEndpoint
}
