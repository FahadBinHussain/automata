# restart.ps1 - one-shot restart of the pipeline
param(
    [string]$StorePath = "$env:APPDATA\mainframe\accounts\whatsapp\<your-phone-number>\store"
)

$ErrorActionPreference = "Stop"

Write-Host "=== Killing existing processes ==="
Get-Process -Name "pwsh" -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $PID } | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Get-Process -Name "node" -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Get-Process -Name "wacli" -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 3

Write-Host "=== Cleaning state ==="
Remove-Item "$env:TEMP\murmur-proxy-processed.json" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:TEMP\murmur-poller-state.json" -Force -ErrorAction SilentlyContinue
Remove-Item "$StorePath\LOCK" -Force -ErrorAction SilentlyContinue
Remove-Item "$StorePath\.send.sock" -Force -ErrorAction SilentlyContinue

Write-Host "=== Starting proxy ==="
$proxy = Start-Process -FilePath "node" -ArgumentList "C:\Users\<user>\Downloads\automata\whatsapp.com\murmur-proxy.js" -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 3

$port = Get-NetTCPConnection -LocalPort 7870 -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $port) {
    Write-Error "Proxy did not start on port 7870"
    exit 1
}
Write-Host "Proxy OK (PID $($port.OwningProcess))"

Write-Host "=== Starting cloudflared ==="
Start-Process -FilePath "cloudflared" -ArgumentList @("tunnel", "--url", "http://localhost:7870") -RedirectStandardOutput "$env:TEMP\cf-out.log" -RedirectStandardError "$env:TEMP\cf-err.log" -WindowStyle Hidden
Write-Host "Waiting 20s for tunnel..."
Start-Sleep -Seconds 20

$log = Get-Content "$env:TEMP\cf-err.log" -ErrorAction SilentlyContinue
$urlLine = $log | Select-String -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -First 1
if (-not $urlLine) {
    Write-Error "No tunnel URL found. Log:`n$($log | Select-Object -Last 10)"
    exit 1
}

$url = $urlLine.Matches[0].Value.Trim()
Write-Host "Tunnel: $url"
$url | Set-Content "$env:TEMP\tunnel-url.txt" -Force -NoNewline

Write-Host "=== Testing tunnel ==="
$test = & curl -s --max-time 10 "$url/status" 2>$null
Write-Host "Test response: $test"
if (-not $test -or $test -match "502|503|Bad Gateway") {
    Write-Error "Tunnel not working"
    exit 1
}
Write-Host "Tunnel WORKING!"

Write-Host "=== Updating HF secret ==="
$HfToken = (Get-Content "$env:APPDATA\mainframe\accounts\hf\<your-email>\token.txt" -Raw).Trim()
$sendUrl = "$url/send"
$body = @{ key = "WACLI_SEND_WEBHOOK_URL"; value = $sendUrl } | ConvertTo-Json
Invoke-RestMethod -Uri "https://huggingface.co/api/spaces/<hf-username>/murmur/secrets" -Method POST -Headers @{ Authorization = "Bearer $HfToken"; "Content-Type" = "application/json" } -Body $body
Write-Host "HF updated: $sendUrl"

Write-Host "=== Starting wacli ==="
$wacli = Start-Process -FilePath "wacli" -ArgumentList @("sync", "--follow", "--store", $StorePath, "--webhook", "http://localhost:7870/webhook", "--webhook-secret", "MURMUR_WEBHOOK_SECRET", "--webhook-allow-private") -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 5

$running = Get-Process -Id $wacli.Id -ErrorAction SilentlyContinue
if (-not $running) {
    Write-Error "wacli failed to start"
    exit 1
}
Write-Host "wacli OK (PID $($wacli.Id))"

Write-Host ""
Write-Host "=== PIPELINE READY ==="
Write-Host "Proxy: http://localhost:7870"
Write-Host "Tunnel: $url"
Write-Host "wacli: PID $($wacli.Id)"
Write-Host ""
Write-Host "Send /ai test now."
