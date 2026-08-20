#!/usr/bin/env pwsh
# murmur-reverse-poller.ps1
# Polls HF Space /api/outbox for replies and sends them via wacli

$ErrorActionPreference = 'Stop'

$envLocal = Join-Path $PSScriptRoot ".env.local"
if (Test-Path $envLocal) {
    foreach ($line in Get-Content $envLocal) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2].Trim().Trim('"', "'"), "Process")
        }
    }
}

$HF_BASE   = if ($env:MURMUR_HF_SPACE_URL) { $env:MURMUR_HF_SPACE_URL.Trim() } else { 'https://<murmur-space>.hf.space' }
$HF_TOKEN  = (Get-Content "$env:APPDATA\mainframe\accounts\hf\<your-email>\token.txt" -Raw).Trim()
$WACLI_BIN = if ($env:WACLI_BIN) { $env:WACLI_BIN } else { "$env:USERPROFILE\go\bin\wacli.exe" }
$WACLI_STORE = if ($env:WACLI_STORE) { $env:WACLI_STORE } else { "$env:APPDATA\mainframe\accounts\whatsapp\<your-phone-number>\store" }

$POLL_INTERVAL_SEC = 5
$STATE_PATH = "$env:TEMP\murmur-reverse-poller-state.json"

# Load dedup state
$global:processedIds = @{}
$global:lastPollTime = [datetime]::UtcNow.AddMinutes(-5).ToString('o')
if (Test-Path $STATE_PATH) {
    $state = Get-Content $STATE_PATH | ConvertFrom-Json
    $global:processedIds = @{}
    foreach ($id in $state.ids) { $global:processedIds[$id] = $true }
    if ($state.lastPollTime) { $global:lastPollTime = $state.lastPollTime }
    Write-Output ('[init] loaded {0} processed IDs, lastPollTime={1}' -f $global:processedIds.Count, $global:lastPollTime)
} else {
    Write-Output ('[init] fresh state, lastPollTime={0}' -f $global:lastPollTime)
}

function Save-State {
    $data = @{
        ids = @($global:processedIds.Keys) | Select-Object -Last 5000
        lastPollTime = $global:lastPollTime
    }
    $data | ConvertTo-Json | Set-Content $STATE_PATH -Force
}

function Send-Reply($jid, $text) {
    $args = @('send', 'text', '--store', $WACLI_STORE, '--to', $jid, '--message', $text)
    Write-Output ('[send] wacli send text --to {0} --message "{1}"' -f $jid, $text.Substring(0, [Math]::Min(50, $text.Length)))
    $proc = Start-Process -FilePath $WACLI_BIN -ArgumentList $args -Wait -PassThru -RedirectStandardOutput "$env:TEMP\wacli-send-stdout.log" -RedirectStandardError "$env:TEMP\wacli-send-stderr.log" -WindowStyle Hidden
    $stdout = Get-Content "$env:TEMP\wacli-send-stdout.log" -ErrorAction SilentlyContinue
    $stderr = Get-Content "$env:TEMP\wacli-send-stderr.log" -ErrorAction SilentlyContinue
    if ($proc.ExitCode -ne 0) {
        Write-Output ('[send] FAILED exit={0} stderr={1}' -f $proc.ExitCode, ($stderr -join '; '))
        return $false
    }
    Write-Output ('[send] OK: {0}' -f ($stdout -join '; '))
    return $true
}

function Poll-Outbox {
    try {
        $headers = @{ Authorization = 'Bearer ' + $HF_TOKEN }
        $resp = Invoke-RestMethod -Uri ('{0}/api/outbox' -f $HF_BASE) -Method GET -Headers $headers -TimeoutSec 15 -MaximumRedirection 0 -ErrorAction SilentlyContinue

        if (-not $resp.messages) {
            Write-Output ('[{0}] outbox: empty' -f (Get-Date -Format 'HH:mm:ss'))
            return
        }

        Write-Output ('[{0}] outbox: {1} messages' -f (Get-Date -Format 'HH:mm:ss'), $resp.messages.Count)

        $ackedIds = @()
        foreach ($msg in $resp.messages) {
            $id = $msg.id
            if ($global:processedIds[$id]) {
                Write-Output ('[skip] already processed: {0}' -f $id)
                $ackedIds += $id
                continue
            }

            $jid = $msg.recipient_jid
            $text = $msg.text
            Write-Output ('[reply] {0} -> {1}: {2}' -f $id, $jid, $text.Substring(0, [Math]::Min(80, $text.Length)))

            $ok = Send-Reply $jid $text
            if ($ok) {
                $global:processedIds[$id] = $true
                $ackedIds += $id
            }
        }

        # Acknowledge processed messages
        if ($ackedIds.Count -gt 0) {
            $body = @{ ids = $ackedIds } | ConvertTo-Json
            $ack = Invoke-RestMethod -Uri ('{0}/api/outbox/ack' -f $HF_BASE) -Method POST -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 10 -ErrorAction SilentlyContinue
            Write-Output ('[ack] {0} messages acknowledged' -f $ackedIds.Count)
        }

        Save-State
    } catch {
        Write-Output ('[poll] ERROR: {0}' -f $_.Exception.Message)
    }
}

# Main loop
Write-Output ('=== Murmur Reverse Poller ===')
Write-Output ('HF Space: {0}' -f $HF_BASE)
Write-Output ('Poll interval: {0}s' -f $POLL_INTERVAL_SEC)
Write-Output ('Ctrl+C to stop')
Write-Output ''

while ($true) {
    Poll-Outbox
    Start-Sleep -Seconds $POLL_INTERVAL_SEC
}
