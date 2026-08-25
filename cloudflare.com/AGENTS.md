# Cloudflare Turnstile bypass via agent-browser

the standard way to get past Cloudflare Turnstile (checkbox or invisible) on a target site
is **agent-browser with a mainframe profile** - a real synced Edge session auto-passes the
checkbox, so the page's JS fetches the real token-protected data. no captcha solving needed.

## the working pattern (copy-paste)

1. **sync** the profile (standalone, safe from an agent shell):
   ```powershell
   & "$env:USERPROFILE\Downloads\mainframe\edge-cdp-profile-sync.ps1" -Email <email>
   ```
2. **spawn** the browser detached (the agent-browser poll bug means never call `open`
   directly from the agent shell tool):
   ```powershell
   $profileDir = "$env:APPDATA\mainframe\accounts\agent-browser\<email>"
   Remove-Item "$profileDir\DevToolsActivePort" -Force -EA SilentlyContinue
   Remove-Item "$profileDir\SingletonLock" -Force -EA SilentlyContinue
   Start-Process pwsh -ArgumentList '-NoExit','-Command',@"
   `$env:AGENT_BROWSER_PROFILE = '$profileDir'
   `$env:AGENT_BROWSER_EXECUTABLE_PATH = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
   `$env:AGENT_BROWSER_ARGS = '--disable-blink-features=AutomationControlled,--disable-features=AutomationControlled'
   agent-browser open 'https://<target-url>'
   "@ -WindowStyle Normal
   ```
3. **wait** ~10-15s for the page + turnstile to settle, then run control commands via
   `Start-Job` (returns cleanly) with `AGENT_BROWSER_*` env vars set:
   ```powershell
   $env:AGENT_BROWSER_PROFILE = $profileDir
   $env:AGENT_BROWSER_EXECUTABLE_PATH = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
   $env:AGENT_BROWSER_ARGS = '--disable-blink-features=AutomationControlled,--disable-features=AutomationControlled'
   $job = Start-Job { agent-browser eval "document.title" 2>&1 }
   Wait-Job $job -Timeout 20 | Out-Null; Receive-Job $job; Remove-Job $job -Force
   ```
   `Start-Job` + `Wait-Job -Timeout` beats the `Start-Process pwsh -Command ... > file`
   detach-and-poll pattern when commands start hanging; it returns the output directly.

## gotchas

- **the stealth flags matter**: `--disable-blink-features=AutomationControlled,
  --disable-features=AutomationControlled` (they come from the User-scope `AGENT_BROWSER_ARGS`,
  re-inject them anyway). without them Cloudflare treats the session as a bot.
- turnstile pages are SPAs - the download/data links are often rendered only AFTER the
  checkbox auto-passes, and they may be `a[href]` elements with empty innerText (icons).
  query `document.querySelectorAll('a')` for hrefs matching the real host instead of
  scanning visible text. e.g. gog-games.to renders Gofile/Pixeldrain/FileDitch/1fichier
  hrefs once passed.
- `window.turnstile` exists but `turnstile.getResponse()` throws "Could not find widget"
  on invisible-widget pages - read the rendered hrefs, don't fight the widget API.
- `document.body.innerText` is the fastest way to confirm the protected data loaded.
- remember to `agent-browser close --all` when done (safe from agent shell).
- full agent-browser workflow, profile semantics and the detached-spawn rules live in
  `<user-home>\Downloads\mainframe\AGENTS.md` under the agent-browser sections - read
  that before non-trivial automation.

## where the older references live

- `1337x.to\AGENTS.md` - "cloudflare turnstile checkbox click passes" note for live 1337x search.
- `theoldllm.vercel.app\theoldllm-cli\theoldllm-debug.mjs` - Playwright debug script that
  sniffs turnstile token responses (inspection only, not a bypass).
