# wacli sync daemon with murmur webhook forwarding + localtunnel
# single script the scheduled task runs

param(
    [string]$StorePath = "$env:APPDATA\mainframe\accounts\whatsapp\<your-phone-number>\store"
)

$ErrorActionPreference = "Continue"

function Now { Get-Date -Format 'HH:mm:ss' }

$ProxyScript  = Join-Path $PSScriptRoot "..\whatsapp.com\murmur-proxy.js"
$ProxyPort    = 7870
$ProxyUrl     = "http://localhost:$ProxyPort/webhook"
$WebhookSecret = "MURMUR_WEBHOOK_SECRET"
$HfTokenPath  = "$env:APPDATA\mainframe\accounts\hf\<your-hf-email>\token.txt"
$HfToken      = (Get-Content $HfTokenPath -Raw).Trim()
$MurmurSpace  = "<hf-username>/murmur"

function Update-TunnelSecret($tunnelUrl) {
    $sendUrl = "$tunnelUrl/send"
    $body = @{ key = 'WACLI_SEND_WEBHOOK_URL'; value = $sendUrl } | ConvertTo-Json
    try {
        Invoke-RestMethod -Uri "https://huggingface.co/api/spaces/$MurmurSpace/secrets" -Method POST -Headers @{ Authorization = "Bearer $HfToken"; "Content-Type" = "application/json" } -Body $body -TimeoutSec 15 | Out-Null
        Write-Host "[$(Now)] HF secret updated: $sendUrl" -ForegroundColor Cyan
    } catch {
        Write-Host "[$(Now)] HF secret update failed: $($_.Exception.Message)" -ForegroundColor Red
    }
}

function Start-Localtunnel {
    $ltOut = "$env:TEMP\lt.out"
    $ltErr = "$env:TEMP\lt.err"
    $proc = Start-Process -FilePath "pwsh" -ArgumentList @("-NoProfile", "-Command", "npx lt --port $ProxyPort") -RedirectStandardOutput $ltOut -RedirectStandardError $ltErr -WindowStyle Hidden -PassThru
    Start-Sleep -Seconds 15
    $out = Get-Content $ltOut -ErrorAction SilentlyContinue
    $urlLine = $out | Select-String -Pattern "https://[a-z0-9-]+\.loca\.lt" | Select-Object -First 1
    if ($urlLine) {
        $url = $urlLine.Matches[0].Value
        $url | Set-Content "$env:TEMP\tunnel-url.txt" -Force
        Write-Host "[$(Now)] localtunnel: $url" -ForegroundColor Cyan
        return @{ Proc = $proc; Url = $url }
    }
    Write-Host "[$(Now)] localtunnel failed to get URL" -ForegroundColor Red
    return @{ Proc = $proc; Url = $null }
}

function Kill-ExistingProcesses {
    Get-Process -Name "wacli" -ErrorAction SilentlyContinue | ForEach-Object {
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
    Get-Process -Name "node" -ErrorAction SilentlyContinue | ForEach-Object {
        $cmd = (Get-WmiObject Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine
        if ($cmd -like "*$ProxyScript*") {
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
    }
    # Kill old localtunnel pwsh
    Get-Process -Name "pwsh" -ErrorAction SilentlyContinue | ForEach-Object {
        $cmd = (Get-WmiObject Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine
        if ($cmd -like "*npx lt --port*") {
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Seconds 2
}

while ($true) {
    Kill-ExistingProcesses

    # Start proxy
    if (Test-Path $ProxyScript) {
        Write-Host "[$(Now)] starting murmur proxy..." -ForegroundColor Cyan
        $proxyProc = Start-Process -FilePath "node" -ArgumentList $ProxyScript -WindowStyle Hidden -PassThru
        Start-Sleep -Seconds 3
    }

    # Start localtunnel
    Write-Host "[$(Now)] starting localtunnel..." -ForegroundColor Cyan
    $lt = Start-Localtunnel
    if ($lt.Url) {
        Update-TunnelSecret $lt.Url
        Start-Sleep -Seconds 30  # wait for HF space restart
    }

    # Start wacli sync
    Write-Host "[$(Now)] starting wacli sync..." -ForegroundColor Green
    try {
        $wacliArgs = @(
            "sync", "--follow",
            "--store", $StorePath,
            "--webhook", $ProxyUrl,
            "--webhook-secret", $WebhookSecret,
            "--webhook-allow-private"
        )
        $proc = Start-Process -FilePath "wacli" -ArgumentList $wacliArgs -WindowStyle Hidden -PassThru
        $start = Get-Date
        
        while (-not $proc.HasExited) {
            $elapsed = [math]::Round(((Get-Date) - $start).TotalMinutes, 1)
            if ($elapsed % 5 -eq 0) {
                Write-Host "[$(Now)] wacli running for ${elapsed}m" -ForegroundColor DarkGray
            }
            Start-Sleep -Seconds 30
        }
        
        Write-Host "[$(Now)] wacli exited with code $($proc.ExitCode), restarting in 5s..." -ForegroundColor Yellow
    } catch {
        Write-Host "[$(Now)] failed to start wacli: $_" -ForegroundColor Red
    }
    
    # Cleanup before restart
    if ($proxyProc -and -not $proxyProc.HasExited) {
        Stop-Process -Id $proxyProc.Id -Force -ErrorAction SilentlyContinue
    }
    if ($lt.Proc -and -not $lt.Proc.HasExited) {
        Stop-Process -Id $lt.Proc.Id -Force -ErrorAction SilentlyContinue
    }
    
    Start-Sleep -Seconds 5
}
