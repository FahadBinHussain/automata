# murmur-wacli-poller.ps1 - polls wacli DB for unprocessed /ai messages and forwards to murmur HF

$ErrorActionPreference = "Continue"

$envLocal = Join-Path $PSScriptRoot ".env.local"
if (Test-Path $envLocal) {
    foreach ($line in Get-Content $envLocal) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2].Trim().Trim('"', "'"), "Process")
        }
    }
}

$StoreDir = "$env:APPDATA\mainframe\accounts\whatsapp\<your-phone-number>\store"
$DbPath = "$StoreDir\wacli.db"
$StatePath = "$env:TEMP\murmur-poller-state.json"
$TokenPath = "$env:APPDATA\mainframe\accounts\hf\<your-email>\token.txt"
$HfToken = (Get-Content $TokenPath -Raw).Trim()
$MurmurWebhook = if ($env:MURMUR_WEBHOOK_URL) { $env:MURMUR_WEBHOOK_URL.Trim() } else { "https://<murmur-space>.hf.space/wacli/webhook" }
$WebhookSecret = $env:MURMUR_WEBHOOK_SECRET

function Load-State {
    if (Test-Path $StatePath) {
        $data = Get-Content $StatePath -Raw | ConvertFrom-Json
        return @{ ProcessedIds = [System.Collections.Generic.HashSet[string]]::new($data.ids); LastPollTs = $data.lastPollTs }
    }
    return @{ ProcessedIds = [System.Collections.Generic.HashSet[string]]::new(); LastPollTs = 0 }
}

function Save-State($state) {
    $data = @{ ids = $state.ProcessedIds | Select-Object -Last 5000; lastPollTs = $state.LastPollTs }
    $data | ConvertTo-Json | Set-Content $StatePath -Force
}

function Compute-HMAC($payload) {
    $hmac = New-Object System.Security.Cryptography.HMACSHA256
    $hmac.Key = [System.Text.Encoding]::UTF8.GetBytes($WebhookSecret)
    $hash = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($payload))
    return "sha256=" + [BitConverter]::ToString($hash).Replace("-", "").ToLower()
}

function Forward-ToMurmur($payload) {
    $sig = Compute-HMAC $payload
    try {
        $resp = Invoke-RestMethod -Uri $MurmurWebhook -Method POST -Headers @{
            "Content-Type" = "application/json"
            "Authorization" = "Bearer $HfToken"
            "X-Wacli-Signature" = $sig
        } -Body $payload -TimeoutSec 30
        return @{ Success = $true; Status = 200; Body = $resp }
    } catch {
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

function Poll-Database {
    $state = Load-State
    $lastTs = $state.LastPollTs

    # Query unprocessed /ai messages
    $query = "SELECT msg_id, ts, chat_jid, sender_jid, sender_name, text FROM messages WHERE text LIKE '/ai%' AND from_me = 0 AND ts > $lastTs ORDER BY ts ASC;"
    $result = & sqlite3 $DbPath ".mode json" $query 2>$null

    if (-not $result) { return }

    # sqlite3 .mode json outputs a JSON array, collect all lines and parse as one
    $jsonText = ($result -join "`n").Trim()
    $rows = @()
    try {
        $parsed = $jsonText | ConvertFrom-Json -ErrorAction Stop
        if ($parsed -is [array]) {
            $rows = $parsed
        } elseif ($parsed -is [System.Management.Automation.PSCustomObject]) {
            $rows = @($parsed)
        }
    } catch {
        Write-Host "  [warn] json parse error: $($_.Exception.Message)"
    }
    if (-not $rows) { return }

    $maxTs = $lastTs
    foreach ($row in $rows) {
        $msgId = $row.msg_id
        if (-not $msgId) { continue }
        if ($state.ProcessedIds.Contains($msgId)) { continue }

        $text = $row.text
        if (-not $text.Trim().StartsWith('/ai')) { continue }

        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Forwarding: $msgId from $($row.chat_jid)"

        $chatJid = $row.chat_jid
        $chatUser = if ($chatJid -match '^(.*?)@') { $matches[1] } else { $chatJid }
        $chatServer = if ($chatJid -match '@(.*)$') { $matches[1] } else { 's.whatsapp.net' }

        $payload = @{
            Chat = @{ user = $chatUser; server = $chatServer }
            ID = $msgId
            SenderJID = $row.sender_jid
            Timestamp = [DateTimeOffset]::FromUnixTimeSeconds([long]$row.ts).ToString("o")
            FromMe = $false
            Text = $text
            PushName = $row.sender_name
        } | ConvertTo-Json -Depth 3 -Compress

        $resp = Forward-ToMurmur $payload
        if ($resp.Success) {
            Write-Host "  -> OK"
            [void]$state.ProcessedIds.Add($msgId)
        } else {
            Write-Host "  -> FAILED: $($resp.Error)"
            break
        }

        if ($row.ts -gt $maxTs) { $maxTs = $row.ts }
    }

    $state.LastPollTs = $maxTs
    Save-State $state
}

Write-Host "=== murmur-wacli-poller started ==="
Write-Host "Polling every 10 seconds for /ai messages..."

while ($true) {
    Poll-Database
    Start-Sleep -Seconds 10
}
