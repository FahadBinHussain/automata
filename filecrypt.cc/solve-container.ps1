# filecrypt.cc container solver - headless PoW captcha bypass (no browser)
# purpose: resolve a filecrypt.cc/Container/<ID>.html page to its real host
#          download links (pixeldrain/gofile/1fichier/...), passing the
#          proof-of-work "I am a human" gate entirely headless.
# inputs:  -Url <container url> (required) e.g. https://filecrypt.cc/Container/FCE74DF1E1.html
#          -Password <string> for password-protected containers (optional)
# run:     & solve-container.ps1 -Url "https://filecrypt.cc/Container/FCE74DF1E1.html"
# output:  resolved host links (pixeldrain/gofile/...) or throws loudly
# deps:    node (v18+) in PATH - used to run the page's own m.js/s.js to mint
#          the pow_x / pow_data anti-bot signals; C# SHA1 PoW via Add-Type.
# notes:
#   - captcha is a SHA-1 proof-of-work (challenge:nonce, leading-zero bits =
#     difficulty) + two obfuscated signal collectors (m.js R() = env signal,
#     s.js S.collect() = dwell+pointer signal). no image captcha involved.
#   - flow: GET container -> POST /captchasession/<id>.json {pow_x,pow_y,pow_yn,tz}
#     -> solve challenge -> POST container form {pow_id,pow_nonce,pow_elapsed,
#     pow_pauses,pow_data,pow_x,password} -> response page contains /Link/<id>.html
#     buttons + filecrypt link ids.
#   - the /Link/<id>.html pages are ad-gate redirects (linkonclick.com) - they
#     are NOT the final host links. final links only appear on the unlocked
#     container page itself (dlhoster anchors).
#   - if the server escalates difficulty (24 seen) solving takes a few seconds
#     (C# SHA1 ~2-4M h/s single thread).
param(
    [Parameter(Mandatory = $true)][string]$Url,
    [string]$Password = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$work = Join-Path $env:TEMP ('fc-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$builder = Join-Path $PSScriptRoot 'run-signals-builder.cjs'
if (!(Test-Path $builder)) { throw "missing $builder" }
try {

# --- C# SHA1 PoW solver (leading zero bits >= difficulty) ---
$cs = @"
using System;
using System.Security.Cryptography;
public static class FcPow {
    public static long Solve(string challenge, int difficulty) {
        using (var sha = SHA1.Create()) {
            byte[] prefix = System.Text.Encoding.ASCII.GetBytes(challenge + ":");
            byte[] input = new byte[prefix.Length + 20];
            Array.Copy(prefix, input, prefix.Length);
            for (long n = 0; n < 300000000L; n++) {
                byte[] nb = System.Text.Encoding.ASCII.GetBytes(n.ToString());
                for (int i = 0; i < nb.Length; i++) input[prefix.Length + i] = nb[i];
                byte[] h = sha.ComputeHash(input, 0, prefix.Length + nb.Length);
                int bits = 0;
                for (int i = 0; i < 20; i++) {
                    if (h[i] == 0) { bits += 8; continue; }
                    int v = h[i]; int lz = 0;
                    while ((v & 0x80) == 0 && lz < 8) { lz++; v <<= 1; }
                    bits += lz; break;
                }
                if (bits >= difficulty) return n;
            }
            return -1;
        }
    }
}
"@
Add-Type -TypeDefinition $cs -Language CSharp

$ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
$navHeaders = @{
    'sec-ch-ua' = '"Not/A)Brand";v="8", "Chromium";v="126", "Microsoft Edge";v="126"'
    'sec-ch-ua-mobile' = '?0'
    'sec-ch-ua-platform' = '"Windows"'
    'sec-fetch-dest' = 'document'
    'sec-fetch-mode' = 'navigate'
    'sec-fetch-site' = 'none'
    'sec-fetch-user' = '?1'
    'upgrade-insecure-requests' = '1'
    'Accept' = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7'
    'Accept-Language' = 'en-US,en;q=0.9'
}
$jsHeaders = @{
    'sec-fetch-dest' = 'empty'
    'sec-fetch-mode' = 'cors'
    'sec-fetch-site' = 'same-origin'
    'Accept' = '*/*'
    'Origin' = 'https://filecrypt.cc'
    'Referer' = $Url
}

# 1. GET container page
$sess = $null
$page = Invoke-WebRequest $Url -UseBasicParsing -SkipHttpErrorCheck -TimeoutSec 30 -UserAgent $ua -SessionVariable sess -Headers $navHeaders
if ($page.StatusCode -ne 200) { throw "container GET failed: HTTP $($page.StatusCode)" }
$sessionPath = [regex]::Match($page.Content, 'data-session="([^"]+)"').Groups[1].Value
if (!$sessionPath) { throw 'no data-session on page (page layout changed or already unlocked)' }
Write-Verbose "session endpoint: $sessionPath"

# 2. mint pow_x via the page's own m.js R() in node
$hostPage = $page.Content
$mSrc = [regex]::Match($hostPage, 'data-ext="([^"]+)"').Groups[1].Value
$sSig = [regex]::Match($hostPage, 'data-sig="([^"]+)"').Groups[1].Value
$base = ([uri]$Url).GetLeftPart([System.UriPartial]::Authority)
Invoke-WebRequest ($base + $mSrc) -UseBasicParsing -TimeoutSec 30 -UserAgent $ua | ForEach-Object { $_.Content | Out-File (Join-Path $work 'm_ext.js') -Encoding utf8 }
Invoke-WebRequest ($base + $sSig) -UseBasicParsing -TimeoutSec 30 -UserAgent $ua | ForEach-Object { $_.Content | Out-File (Join-Path $work 's_signals.js') -Encoding utf8 }
node $builder (Join-Path $work 'm_ext.js') | Out-Null
$px = (node (Join-Path $work 'run_payload.mjs') 2>$null | Select-String '^RESULT=').Line.Substring(7)
if (!$px) { throw 'pow_x mint failed (node run failed)' }
Write-Verbose "pow_x: $($px.Substring(0, [Math]::Min(24, $px.Length)))..."

# 3. pow_y: cid from the y endpoint (captcha.filecrypt.cc)
$yn = '{0:x}{1:x}' -f (Get-Random -Max 1099511627776), (Get-Random -Max 1099511627776)
$y = $null
foreach ($yHost in @('https://captcha.filecrypt.cc', 'https://pow.filecrypt.cc')) {
    try { $y = Invoke-RestMethod "$yHost/?t=$yn" -WebSession $sess -TimeoutSec 12 -UserAgent $ua; if ($y.cid) { break }; $y = $null } catch { }
}
if (!$y -or !$y.cid) { throw 'pow_y cid fetch failed' }

# 4. start signals collector in parallel (s.js S.collect() - needs dwell+clicks)
$collector = Start-Job -ScriptBlock {
    param($w, $b)
    Set-Location $w
    node $b (Join-Path $w 's_signals.js') signals 2>$null | Out-Null
    node (Join-Path $w 'run_payload.mjs') 2>$null | Select-String '^COLLECT=' | ForEach-Object { $_.Line.Substring(8) }
} -ArgumentList $work, $builder

# 5. fetch challenge
$ch = Invoke-RestMethod "$base$sessionPath" -Method Post -Body @{ pow_x = $px; pow_y = $y.cid; pow_yn = $yn; tz = [timezoneinfo]::Local.Id } -WebSession $sess -UserAgent $ua -TimeoutSec 30 -Headers $jsHeaders -ContentType 'application/x-www-form-urlencoded; charset=UTF-8'
if (!$ch.success -or !$ch.challenge) { throw "challenge fetch failed: $($ch | ConvertTo-Json -Compress)" }
$challenge = $ch.challenge
Write-Verbose "challenge: $($challenge.id) diff=$($challenge.difficulty)"

# 6. solve PoW
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$nonce = [FcPow]::Solve($challenge.challenge, [int]$challenge.difficulty)
$sw.Stop()
if ($nonce -lt 0) { throw 'PoW solve failed (no nonce found)' }
$elapsed = [Math]::Max(3200, $sw.ElapsedMilliseconds + 3800)
Write-Verbose "nonce: $nonce ($($sw.ElapsedMilliseconds)ms)"

# 7. collect signals + submit
$powData = (Receive-Job -Job $collector -Wait) | Select-Object -Last 1
Remove-Job $collector -Force
if (!$powData) { throw 'pow_data collect failed' }
Write-Verbose "pow_data: $($powData.Length) chars"

$form = @{
    pow_id = $challenge.id
    pow_nonce = "$nonce"
    pow_elapsed = "$elapsed"
    pow_pauses = '0'
    pow_data = $powData
    pow_x = $px
    password = $Password
}
$submit = Invoke-WebRequest -Uri $Url -Method Post -Body $form -WebSession $sess -UserAgent $ua -SkipHttpErrorCheck -TimeoutSec 30 -Headers $navHeaders -ContentType 'application/x-www-form-urlencoded' -MaximumRedirection 5
$txt = [System.Net.WebUtility]::HtmlDecode(($submit.Content -replace '<[^>]+>', "`n"))
if ($txt -match "confirm you're not a robot" -or $txt -match 'I am a human') { throw 'submit rejected - still gated (signals failed or layout changed)' }

# 8. extract real host links from the unlocked page
$links = [regex]::Matches($submit.Content, '(?is)<a[^>]*class="[^"]*dlhoster[^"]*"[^>]*href="([^"]+)"') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
if (!$links) {
    $links = [regex]::Matches($submit.Content, 'https?://[^\s"<>]*(?:pixeldrain|gofile|megaup|1fichier|ddownload|rapidgator|mega\.nz)[^\s"<>]*') | ForEach-Object { $_.Value } | Select-Object -Unique
}
if (!$links) { throw 'unlocked but no host links found (layout changed)' }

Write-Output "UNLOCKED - $($links.Count) host link(s):"
$links | ForEach-Object { Write-Output $_ }

} finally {
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
