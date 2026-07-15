# TheOldLLM Proxy Launcher
# Starts the OpenAI-compatible proxy server on localhost:3001

$proxyDir = "C:\Users\<user>\Downloads\automata\theoldllm\theoldllm-cli"
Set-Location $proxyDir

# Check if already running
$existing = Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'theoldllm-proxy' }
if ($existing) {
    Write-Host "TheOldLLM proxy is already running (PID $($existing.Id))" -ForegroundColor Green
    Write-Host "Endpoint: http://localhost:3001"
    Write-Host ""
    Write-Host "Proxy output is in its own window. Check taskbar for minimized PowerShell."
} else {
    Write-Host "Starting TheOldLLM proxy on http://localhost:3001 ..." -ForegroundColor Cyan
    node theoldllm-proxy.mjs
}
