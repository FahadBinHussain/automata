# unlock-container.ps1 — fast filecrypt PoW unlock via agent-browser + init-fast-pow.js
# purpose: unlock a filecrypt.cc/Container/<ID>.html page without 20m manual wait
# usage: .\unlock-container.ps1 -Url "https://filecrypt.cc/Container/09844C4F93.html" [-TimeoutSec 300]
# output: prints Online status and CNL-decrypted host links; exits 0 on unlock, 1 on fail
# deps: agent-browser (Edge; account email via .env.local AGENT_BROWSER_ACCOUNT), init-fast-pow.js next to this script
# notes: keeps real TLS/cookies/signals, only the Worker is swapped to a tight-loop blob
param(
  [Parameter(Mandatory=$true)][string]$Url,
  [int]$TimeoutSec = 300
)
$ErrorActionPreference = 'Stop'
$envFile = Join-Path $PSScriptRoot '.env.local'
if (-not (Test-Path $envFile)) { throw "missing $envFile — set AGENT_BROWSER_ACCOUNT=<your-email> there" }
foreach ($l in (Get-Content $envFile)) { if ($l -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$') { Set-Item ("Env:" + $Matches[1]) $Matches[2].Trim() } }
if (-not $env:AGENT_BROWSER_ACCOUNT) { throw 'AGENT_BROWSER_ACCOUNT not set in .env.local' }
$env:AGENT_BROWSER_PROFILE = Join-Path $env:APPDATA "mainframe\accounts\agent-browser\$env:AGENT_BROWSER_ACCOUNT"
$env:AGENT_BROWSER_EXECUTABLE_PATH = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$init = Join-Path $PSScriptRoot 'init-fast-pow.js'
if (!(Test-Path $init)) { throw "missing $init" }
if ($Url -notmatch 'filecrypt\.cc/Container/') { throw "Url must be a filecrypt Container URL" }

# close any stale filecrypt tabs to avoid session bleed
& agent-browser close --all 2>$null | Out-Null
Start-Sleep 2

Write-Host "opening $Url with fast PoW patch..." -ForegroundColor Cyan
& agent-browser open --init-script $init $Url 2>$null | Out-Null
Start-Sleep 8

# verify patch loaded
$patched = & agent-browser eval "String(window.Worker).includes('fastUrl')" 2>$null
if ($patched -ne 'true') { Write-Warning "fast patch not detected (Worker not patched) — continuing anyway" }

# click via JS (more reliable than @e ref when overlay present)
$clicked = & agent-browser eval "document.querySelector('#pow-captcha .pow-captcha__box').click(); 'clicked'" 2>$null
if ($clicked -ne '"clicked"') { Write-Warning "click may have failed: $clicked" }

# foreground once — keep it foregrounded, do NOT spam SetForegroundWindow (causes blur → pause)
Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);' -Name 'WinFg' -Namespace 'WinFg' -ErrorAction SilentlyContinue
$w = Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match 'Filecrypt' }
if ($w) { [WinFg.WinFg]::SetForegroundWindow($w[0].MainWindowHandle) | Out-Null; Write-Host "foregrounded — hands off for up to $TimeoutSec sec" -ForegroundColor Yellow }

$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-Date) -lt $deadline) {
  Start-Sleep 5
  $state = & agent-browser eval "document.querySelector('#pow-captcha') ? document.querySelector('#pow-captcha').getAttribute('data-state') : 'gone'" 2>$null
  $state = $state.Trim('"')
  $progress = & agent-browser eval "document.querySelector('#pow-captcha .pow-captcha__progress i') ? document.querySelector('#pow-captcha .pow-captcha__progress i').style.width : '-'" 2>$null
  Write-Host "$(Get-Date -Format HH:mm:ss) $state $progress"
  if ($state -eq 'gone' -or $state -eq 'done') { break }
  if ($state -eq 'fail' -or $state -eq 'idle') {
    # idle after working means server rejected or challenge expired — retry once
    Write-Warning "state $state — will retry once"
    break
  }
}

$hasCaptcha = & agent-browser eval "!!document.querySelector('#pow-captcha')" 2>$null
if ($hasCaptcha -eq 'true') {
  Write-Error "still gated (hasCaptcha true) — unlock failed"
  exit 1
}

# extract Online status and CNL
$txt = & agent-browser get text body 2>$null | Out-String
$online = ($txt -split "`n" | Where-Object { $_ -match 'Online' } | Select-Object -First 1)
Write-Host "status: $online" -ForegroundColor Green

$cnl = & agent-browser eval "JSON.stringify(Array.from(document.querySelectorAll('form[onsubmit*=\"CNLPOP\"]')).map(f=>f.getAttribute('onsubmit')))" 2>$null
if ($cnl -and $cnl -ne '[]') {
  Write-Host "CNL blocks found — decrypting via AES (see solve-container.ps1 for offline decrypt)" -ForegroundColor Cyan
  # quick decrypt in node if available
  $js = @'
const crypto=require("crypto");
function dec(k,d){const kb=Buffer.from(k,"hex");const dec=crypto.createDecipheriv("aes-128-cbc",kb,kb);let o=Buffer.concat([dec.update(Buffer.from(d,"base64")),dec.final()]).toString();return o.replace(/\x00/g,"").replace(/\r/g,"");}
'@
  # parse CNLPOP args and decrypt
  $matches = [regex]::Matches($cnl, "CNLPOP\('[^']+','([^']+)','([^']+)'")
  foreach ($m in $matches) {
    $crypted = $m.Groups[1].Value; $jk = $m.Groups[2].Value
    $link = node -e "const crypto=require('crypto');const k=Buffer.from('$jk','hex');const d=crypto.createDecipheriv('aes-128-cbc',k,k);let o=Buffer.concat([d.update(Buffer.from('$crypted','base64')),d.final()]).toString();console.log(o.replace(/\x00/g,'').replace(/\r/g,''))" 2>$null
    Write-Host "host link: $link"
  }
} else {
  Write-Host "no CNL — checking dlhoster anchors"
  $links = & agent-browser eval "JSON.stringify(Array.from(document.querySelectorAll('a')).map(a=>a.href).filter(h=>h.includes('gofile')||h.includes('1fichier')||h.includes('ddownload')||h.includes('megaup')||h.includes('rapidgator')))" 2>$null
  Write-Host $links
}

Write-Host "unlock done" -ForegroundColor Green
