# notion file upload workflow (global AGENTS.md rule 33)
# uploads a file to a notion page via /v1/file_uploads (whitelisted extensions only,
# 5 MiB free tier per file, 1 hour attach window) and attaches it as a file block.
#
# usage:
#   .\notion-upload-file.ps1 -PageId <page-id> -FilePath C:\path\file.zip [-FileName name] [-ContentType app/zip]
#
# token: read from the mainframe notion profile (default <email>)
# or pass -Token directly. never print the token.
#
# returns the uploaded file url; attach id printed on success.

param(
    [Parameter(Mandatory)][string]$PageId,
    [Parameter(Mandatory)][string]$FilePath,
    [string]$FileName,
    [string]$ContentType,
    [string]$Email = '<email>',
    [string]$Token
)

$ErrorActionPreference = 'Stop'

if (-not $FileName) { $FileName = [System.IO.Path]::GetFileName($FilePath) }
if (-not $ContentType) {
    $map = @{
        '.7z' = 'application/x-7z-compressed'; '.zip' = 'application/zip'; '.docx' = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        '.pdf' = 'application/pdf'; '.pptx' = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        '.xlsx' = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; '.txt' = 'text/plain'; '.md' = 'text/markdown';
        '.csv' = 'text/csv'; '.json' = 'application/json'; '.xml' = 'application/xml'; '.gif' = 'image/gif'; '.jpg' = 'image/jpeg';
        '.jpeg' = 'image/jpeg'; '.png' = 'image/png'; '.svg' = 'image/svg+xml'; '.webp' = 'image/webp'; '.mp3' = 'audio/mpeg';
        '.ogg' = 'audio/ogg'; '.wav' = 'audio/wav'; '.avi' = 'video/x-msvideo'; '.mov' = 'video/quicktime'; '.mp4' = 'video/mp4'
    }
    $ContentType = $map[[System.IO.Path]::GetExtension($FileName).ToLower()]
    if (-not $ContentType) { throw "unknown content type for $FileName - pass -ContentType explicitly" }
}

if (-not $Token) {
    $tokenFile = "$env:APPDATA\mainframe\accounts\notion\$Email\token.txt"
    if (-not (Test-Path $tokenFile)) { throw "no notion token at $tokenFile - run notion-account.ps1 login first" }
    $Token = (Get-Content $tokenFile -Raw).Trim()
}

$headers = @{ Authorization = "Bearer $Token"; 'Notion-Version' = '2022-06-28' }

"creating upload object for $FileName..."
$body = @{ mode = 'single_part'; filename = $FileName; content_type = $ContentType } | ConvertTo-Json
$upload = Invoke-RestMethod -Uri 'https://api.notion.com/v1/file_uploads' -Method Post -Headers $headers -Body $body -ContentType 'application/json'

"uploading $([Math]::Round((Get-Item $FilePath).Length / 1KB, 1)) KB..."
$fileBytes = [System.IO.File]::ReadAllBytes($FilePath)
$form = New-Object System.Net.Http.MultipartFormDataContent
$fileContent = [System.Net.Http.ByteArrayContent]::new($fileBytes)
$fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse($ContentType)
$form.Add($fileContent, 'file', $FileName)
$client = New-Object System.Net.Http.HttpClient
$client.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $Token)
$client.DefaultRequestHeaders.Add('Notion-Version', '2022-06-28')
$resp = $client.PostAsync($upload.upload_url, $form).Result
if (-not $resp.IsSuccessStatusCode) { throw "upload failed: $($resp.StatusCode) $($resp.Content.ReadAsStringAsync().Result)" }

"attaching file block to $PageId..."
$attach = @{
    children = @(
        @{
            type = 'file'
            file = @{
                type = 'file_upload'
                file_upload = @{ id = $upload.id }
            }
        }
    )
} | ConvertTo-Json -Depth 10
$r = Invoke-RestMethod -Uri "https://api.notion.com/v1/blocks/$PageId/children" -Method Patch -Headers $headers -Body $attach -ContentType 'application/json'

"done. upload id: $($upload.id), block id: $($r.results[0].id)"
