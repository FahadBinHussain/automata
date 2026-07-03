# wacli-pipeline.ps1 - single script: wacli sync + reverse polling for AI replies
# no tunnel needed. local machine polls HF for outgoing replies.
# RUN IN A VISIBLE WINDOW to see real-time logs.

param(
    [string]$StorePath = "$env:APPDATA\mainframe\accounts\whatsapp\<your-phone-number>\store",
    [int]$ProxyPort = 7870,
    [int]$PollSeconds = 5
)

$WindowTitle = "Murmur WhatsApp Pipeline"
$Host.UI.RawUI.WindowTitle = $WindowTitle

# ── kill any previous pipeline windows ─────────────────────────────────────────
Get-Process -Name "pwsh" -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.Id -ne $PID -and $_.MainWindowTitle -eq $WindowTitle) {
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Killed old pipeline PID $($_.Id)" -ForegroundColor Yellow
    }
}
Start-Sleep -Seconds 2

# ── singleton guard ───────────────────────────────────────────────────────────
$SingletonFile = "$env:TEMP\murmur-pipeline.lock"
if (Test-Path $SingletonFile) {
    $existingPid = Get-Content $SingletonFile -ErrorAction SilentlyContinue
    if ($existingPid) {
        $running = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
        if ($running) {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Another pipeline is already running (PID $existingPid). Exiting." -ForegroundColor Yellow
            Start-Sleep -Seconds 3
            exit 1
        }
    }
}
$PID | Set-Content $SingletonFile -Force

$SentMsgIdsPath = "$env:TEMP\murmur-sent-msg-ids.json"
$global:SentMsgIds = @{}
if (Test-Path $SentMsgIdsPath) {
    $data = Get-Content $SentMsgIdsPath -ErrorAction SilentlyContinue | ConvertFrom-Json -ErrorAction SilentlyContinue
    if ($data) { $data | Get-Member -MemberType NoteProperty | ForEach-Object { $global:SentMsgIds[$_.Name] = $true } }
}

function Now { Get-Date -Format 'HH:mm:ss' }

$ProxyScript   = Join-Path $PSScriptRoot "..\whatsapp.com\murmur-proxy.js"
$HfTokenPath   = "$env:APPDATA\mainframe\accounts\hf\<your-email>\token.txt"
$HfToken       = if (Test-Path $HfTokenPath) { (Get-Content $HfTokenPath -Raw).Trim() } else { "" }
$MurmurWebhook = "https://<murmur-space>/wacli/webhook"
$WebhookSecret = "MURMUR_WEBHOOK_SECRET"
$ProxyUrl      = "http://localhost:$ProxyPort/webhook"
$WacliBin      = "C:\Users\<user>\go\bin\wacli.exe"
$PollUrl       = "https://<murmur-space>/api/outbox"
$AckUrl        = "https://<murmur-space>/api/outbox/ack"

# ── helpers ──────────────────────────────────────────────────────────────────

function Log($msg, $color = "White") {
    Write-Host "[$(Now)] $msg" -ForegroundColor $color
}

function Kill-AllChildren {
    Get-Process -Name "node" -ErrorAction SilentlyContinue | ForEach-Object {
        $cmd = (Get-WmiObject Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine
        if ($cmd -like "*$ProxyScript*") {
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
            Log "killed proxy node PID $($_.Id)" DarkGray
        }
    }
    Get-Process -Name "wacli" -ErrorAction SilentlyContinue | ForEach-Object {
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        Log "killed wacli PID $($_.Id)" DarkGray
    }
    Start-Sleep -Seconds 2
    Remove-Item "$StorePath\LOCK" -Force -ErrorAction SilentlyContinue
    Remove-Item "$StorePath\.send.sock" -Force -ErrorAction SilentlyContinue
}

function Start-Proxy {
    if (-not (Test-Path $ProxyScript)) {
        Log "PROXY SCRIPT NOT FOUND at $ProxyScript" Red
        return $null
    }
    Log "=== STARTING PROXY on :$ProxyPort ===" Cyan
    $proc = Start-Process -FilePath "node" -ArgumentList $ProxyScript -WindowStyle Hidden -PassThru
    Start-Sleep -Seconds 3
    $port = Get-NetTCPConnection -LocalPort $ProxyPort -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($port) {
        Log "PROXY LISTENING on PID $($port.OwningProcess)" Green
    } else {
        Log "PROXY FAILED to bind to port $ProxyPort" Red
    }
    return $proc
}

function Start-Wacli {
    Log "=== STARTING WACLI SYNC ===" Green
    $args = @(
        "sync", "--follow",
        "--store", $StorePath,
        "--webhook", $ProxyUrl,
        "--webhook-secret", $WebhookSecret,
        "--webhook-allow-private"
    )
    $proc = Start-Process -FilePath "wacli" -ArgumentList $args -WindowStyle Hidden -PassThru
    Start-Sleep -Seconds 5
    $running = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
    if ($running) {
        Log "WACLI RUNNING PID $($proc.Id)" Green
    } else {
        Log "WACLI FAILED TO START" Red
    }
    return $proc
}

function Send-ViaWacli($jid, $text) {
    Log "SENDING reply to $jid" Cyan
    # Replace newlines with spaces — wacli --message can't handle multi-line via command line
    $cleanText = $text -replace "`r`n", " " -replace "`n", " " -replace "`r", " "
    $preview = if ($cleanText.Length -gt 60) { $cleanText.Substring(0, 60) + "..." } else { $cleanText }
    Log "  text: $preview" DarkGray
    $tmpOut = "$env:TEMP\wacli-send-$([int](Get-Random -Maximum 9999999)).log"
    $tmpErr = "$env:TEMP\wacli-err-$([int](Get-Random -Maximum 9999999)).log"
    $proc = Start-Process -FilePath $WacliBin -ArgumentList @(
        "send", "text",
        "--store", $StorePath,
        "--to", $jid,
        "--message", $cleanText
    ) -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput $tmpOut -RedirectStandardError $tmpErr
    $stdout = Get-Content $tmpOut -ErrorAction SilentlyContinue
    $stderr = Get-Content $tmpErr -ErrorAction SilentlyContinue
    Remove-Item $tmpOut -Force -ErrorAction SilentlyContinue
    Remove-Item $tmpErr -Force -ErrorAction SilentlyContinue
    if ($proc.ExitCode -eq 0) {
        Log "  SENT OK: $stdout" Green
        return $true
    } else {
        Log "  SEND FAILED (exit=$($proc.ExitCode)): $stderr" Red
        return $false
    }
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
        Log "  FORWARDED OK to murmur" Green
        return $true
    } catch {
        Log "  FORWARD FAILED: $($_.Exception.Message)" Red
        return $false
    }
}

function Poll-DB-AndForward {
    # Query wacli DB for unprocessed /ai messages
    $query = "SELECT msg_id, ts, chat_jid, sender_jid, sender_name, text FROM messages WHERE text LIKE '/ai%' AND from_me = 0 AND ts > (SELECT COALESCE(MAX(last_poll_ts), 0) FROM pipeline_state) ORDER BY ts ASC;"
    $result = & sqlite3 "$StorePath\wacli.db" ".mode json" $query 2>$null
    
    if (-not $result) { return }
    
    $jsonText = ($result -join "`n").Trim()
    $rows = @()
    try {
        $parsed = $jsonText | ConvertFrom-Json -ErrorAction Stop
        if ($parsed -is [array]) { $rows = $parsed } elseif ($parsed -is [System.Management.Automation.PSCustomObject]) { $rows = @($parsed) }
    } catch { return }
    if (-not $rows) { return }
    
    Log "DB POLL: found $($rows.Count) new /ai message(s)" Cyan
    
    $maxTs = 0
    foreach ($row in $rows) {
        $msgId = $row.msg_id
        if (-not $msgId) { continue }
        
        $text = $row.text
        if (-not $text.Trim().StartsWith('/ai')) { continue }
        
        $chatJid = $row.chat_jid
        $senderJid = $row.sender_jid
        $senderName = $row.sender_name
        $ts = $row.ts
        $timeStr = [DateTimeOffset]::FromUnixTimeSeconds([long]$ts).ToLocalTime().ToString('HH:mm:ss')
        
        Log "  INCOMING MESSAGE:" Yellow
        Log "    time:    $timeStr" White
        Log "    chat:    $chatJid" White
        Log "    sender:  $senderJid ($senderName)" White
        Log "    text:    $text" White
        Log "    msg_id:  $msgId" White
        
        $chatUser = if ($chatJid -match '^(.*?)@') { $matches[1] } else { $chatJid }
        $chatServer = if ($chatJid -match '@(.*)$') { $matches[1] } else { 's.whatsapp.net' }
        
        $payload = @{
            Chat = @{ user = $chatUser; server = $chatServer }
            ID = $msgId
            SenderJID = $senderJid
            Timestamp = [DateTimeOffset]::FromUnixTimeSeconds([long]$ts).ToString("o")
            FromMe = $false
            Text = $text
            PushName = $senderName
        } | ConvertTo-Json -Depth 3 -Compress
        
        Log "  FORWARDING to murmur HF..." DarkGray
        Forward-ToMurmur $payload
        
        if ($row.ts -gt $maxTs) { $maxTs = $row.ts }
    }
    
    # Update last poll timestamp in DB
    if ($maxTs -gt 0) {
        & sqlite3 "$StorePath\wacli.db" "CREATE TABLE IF NOT EXISTS pipeline_state (id INTEGER PRIMARY KEY, last_poll_ts INTEGER); INSERT OR REPLACE INTO pipeline_state (id, last_poll_ts) VALUES (1, $maxTs);" 2>$null
        Log "  updated last_poll_ts to $maxTs" DarkGray
    }
}

function Poll-HF-ForReplies {
    if (-not $HfToken) { 
        Log "HF token missing, skipping reverse poll" Yellow
        return 
    }
    try {
        $resp = Invoke-RestMethod -Uri $PollUrl -Method GET -Headers @{ Authorization = "Bearer $HfToken" } -TimeoutSec 15
        $msgCount = if ($resp.messages) { $resp.messages.Count } else { 0 }
        if ($msgCount -gt 0) {
            Log "REVERSE POLL: found $msgCount reply(s) from HF" Cyan
            $acked = @()
            foreach ($msg in $resp.messages) {
                $jid = $msg.jid
                $text = $msg.text
                $msgId = $msg.id
                $preview = if ($text.Length -gt 50) { $text.Substring(0, 50) + "..." } else { $text }
                Log "  REPLY: id=$msgId jid=$jid" Yellow
                Log "    text: $preview" DarkGray
                if ($global:SentMsgIds[$msgId]) {
                    Log "    ALREADY SENT - skipping" DarkGray
                    $acked += $msgId
                    continue
                }
                if ($jid -and $text) {
                    $sent = Send-ViaWacli $jid $text
                    if ($sent -and $msgId) { 
                        $acked += $msgId
                        $global:SentMsgIds[$msgId] = $true
                        $global:SentMsgIds | ConvertTo-Json | Set-Content $SentMsgIdsPath -Force
                    }
                } else {
                    Log "    SKIPPED - missing jid or text" Yellow
                }
            }
            # Acknowledge sent messages
            if ($acked.Count -gt 0) {
                $ackBody = @{ ids = $acked } | ConvertTo-Json
                Invoke-RestMethod -Uri $AckUrl -Method POST -Headers @{ Authorization = "Bearer $HfToken"; "Content-Type" = "application/json" } -Body $ackBody -TimeoutSec 10 | Out-Null
                Log "  ACKED $($acked.Count) message(s)" Green
            }
        } else {
            Log "reverse poll: empty" DarkGray
        }
    } catch {
        Log "REVERSE POLL ERROR: $($_.Exception.Message)" Yellow
    }
}

function Pipeline-HealthCheck {
    $issues = @()
    $port = Get-NetTCPConnection -LocalPort $ProxyPort -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $port) { $issues += "proxy not on $ProxyPort" }
    $w = Get-Process -Name "wacli" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $w) { $issues += "wacli not running" }
    return $issues
}

# ── main loop ────────────────────────────────────────────────────────────────

while ($true) {
    Log "========================================" Cyan
    Log "=== MURMUR WHATSAPP PIPELINE STARTING ===" Cyan
    Log "========================================" Cyan
    Log "Store:  $StorePath" White
    Log "Proxy:  :$ProxyPort" White
    Log "HF:     <murmur-space>" White
    Log "Poll:   every ${PollSeconds}s" White
    Log "========================================" Cyan
    
    Kill-AllChildren
    
    # clean state
    Remove-Item "$env:TEMP\murmur-proxy-processed.json" -Force -ErrorAction SilentlyContinue
    Remove-Item "$env:TEMP\murmur-poller-state.json" -Force -ErrorAction SilentlyContinue
    
    # init pipeline_state table
    & sqlite3 "$StorePath\wacli.db" "CREATE TABLE IF NOT EXISTS pipeline_state (id INTEGER PRIMARY KEY, last_poll_ts INTEGER); INSERT OR IGNORE INTO pipeline_state (id, last_poll_ts) VALUES (1, 0);" 2>$null
    
    $proxyProc = Start-Proxy
    $wacliProc = Start-Wacli
    $start = Get-Date
    $pollCounter = 0
    
    while ($true) {
        Start-Sleep -Seconds $PollSeconds
        $elapsed = [math]::Round(((Get-Date) - $start).TotalMinutes, 1)
        $pollCounter++
        
        # DB polling disabled - webhook handles incoming messages
        # if ($pollCounter % 2 -eq 0) {
        #     Poll-DB-AndForward
        # }
        
        # every poll (5s), check HF for replies
        Poll-HF-ForReplies
        
        # health check every 60s
        if ($elapsed % 1 -lt 0.1) {
            $issues = Pipeline-HealthCheck
            if ($issues.Count -eq 0) {
                Log "HEALTH CHECK: healthy (${elapsed}m)" DarkGray
            } else {
                Log "HEALTH CHECK: issues: $($issues -join '; ')" Yellow
            }
        }
        
        # restart if wacli dies
        if ($wacliProc.HasExited) {
            Log "WACLI EXITED (code $($wacliProc.ExitCode)), restarting..." Yellow
            break
        }
        
        # restart if proxy dies
        if ($proxyProc -and $proxyProc.HasExited) {
            Log "PROXY DIED, restarting..." Yellow
            break
        }
    }
    
    Log "Pipeline restart in 5s..." Yellow
    Start-Sleep -Seconds 5
}
