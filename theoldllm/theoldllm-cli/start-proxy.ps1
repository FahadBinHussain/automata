# TheOldLLM Proxy Launcher
# Starts the OpenAI-compatible proxy server on localhost:3001

$proxyDir = "C:\Users\<user>\Downloads\automata\theoldllm\theoldllm-cli"
Set-Location $proxyDir

# Check port 3001 directly — more reliable than process matching
$portInUse = $false
try {
    $conn = Get-NetTCPConnection -LocalPort 3001 -ErrorAction Stop | Where-Object { $_.State -eq 'Listen' }
    if ($conn) { $portInUse = $true }
} catch { }

if ($portInUse) {
    Write-Host "TheOldLLM proxy is already running on port 3001" -ForegroundColor Green
    Write-Host "Endpoint: http://localhost:3001"
    Write-Host ""
    Write-Host "If the proxy window closed earlier, the old process may still be running."
    Write-Host "Run this in an admin terminal to kill it:"
    Write-Host "  Get-Process node | Where-Object { `$_.CommandLine -match 'theoldllm-proxy' } | Stop-Process -Force"
    Write-Host ""
    Start-Sleep -Seconds 3
    exit 0
}

Write-Host "Starting TheOldLLM proxy on http://localhost:3001 ..." -ForegroundColor Cyan
Write-Host "Close this window to stop the proxy." -ForegroundColor DarkGray
Write-Host ""

try {
    node theoldllm-proxy.mjs
} catch {
    Write-Host ""
    Write-Host "Failed to start proxy: $($_.Exception.Message)" -ForegroundColor Red
    Start-Sleep -Seconds 3
}
