# neon-via-proton: reach Neon Postgres while Proton VPN is on

Proton's WFP filter driver blocks direct psql/pgx traffic even when host
routes are added, and the Proton client rewrites ServiceSettings.json
split-tunnel edits on restart - don't fight the config file. Instead, route
through v2rayN's mihomo core (which is allowed to egress freely).

## Prerequisites

- v2rayN running (scoop app `v2rayn`), mihomo core alive, socks + external
  controller ports bound. **Do NOT trust the old 9090/7890 constants** -
  v2rayN regenerates `binConfigs/config.json` on restart and the controller
  moved to `127.0.0.1:10813` on 2026-08-17. READ THE CURRENT PORTS:

  ```powershell
  Get-Content "C:\Users\<user>\scoop\apps\v2rayn\current\binConfigs\config.json" -TotalCount 12
  # -> socks-port: 7891, external-controller: 127.0.0.1:10813 (as of 2026-08-18)
  ```

- mihomo config runs in `mode: rule`, but the GLOBAL selector must point at
  `PROXY` (the url-test group), NOT DIRECT - otherwise Neon traffic egresses
  DIRECT and Proton blocks it.

## Core resurrection (when mihomo is alive but not listening)

Symptom: process exists, but `Get-NetTCPConnection` shows no 7891/10813
listener, and psql through the relay hangs (SYN silently dropped).

```powershell
# 1. kill ALL stray cores first (v2rayN may respawn its own - fine)
Get-Process mihomo -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force }

# 2. relaunch ONE core with ABSOLUTE config paths. `-f config.json` relative
#    to CWD loads a stray C:\Users\<user>\config.json (16 bytes,
#    `mixed-port: 7890`) that v2rayN/agents dropped there - wrong ports,
#    no socks, no controller, and two cores fight over cache.db.
Start-Process -FilePath "C:\Users\<user>\scoop\apps\v2rayn\current\bin\mihomo\mihomo.exe" `
  -ArgumentList '-d','C:\Users\<user>\scoop\apps\v2rayn\current\binConfigs','-f','C:\Users\<user>\scoop\apps\v2rayn\current\binConfigs\config.json' `
  -WindowStyle Hidden
Start-Sleep -Seconds 8
# verify: 7891 (socks) + controller port both listening, ONE mihomo process

# 3. force GLOBAL -> PROXY on the REAL controller port:
Invoke-WebRequest -Uri "http://127.0.0.1:10813/proxies/GLOBAL" -Method PUT `
  -ContentType "application/json" -Body '{"name":"PROXY"}'
(Invoke-RestMethod http://127.0.0.1:10813/proxies/GLOBAL).now   # -> PROXY
```

## Relay

`socks5-fwd.ps1` listens on 127.0.0.1:5433 and forwards via socks to Neon.
It is one-shot-ish but can stay alive; **check 5433 first and reuse** an
existing relay (verify its target via its command line):

```powershell
(Get-CimInstance Win32_Process -Filter "ProcessId=<pid of 5433 owner>").CommandLine
```

Start one only if 5433 is free (redirect output so you can see the
"listening" line; a second instance just errors with accept/bind noise):

```powershell
$out = "$env:TEMP\fwd-out.txt"
Remove-Item $out -ErrorAction SilentlyContinue
Start-Process pwsh -ArgumentList '-NoProfile','-File','C:\Users\<user>\Downloads\automata\tools\neon-via-proton\socks5-fwd.ps1','-ListenPort','5433','-TargetHost','<neon-endpoint>.aws.neon.tech','-TargetPort','5432','-SocksHost','127.0.0.1','-SocksPort','7891' -RedirectStandardOutput $out -RedirectStandardError "$env:TEMP\fwd-err.txt" -WindowStyle Hidden
Start-Sleep -Seconds 4
Get-Content $out -Raw
```

## psql

SNI is lost (we hit 127.0.0.1), so the Neon endpoint id MUST be passed
explicitly or Neon errors "Endpoint ID is not specified". Use the libpq
keyword form with `connect_timeout` (the URL `?options=endpoint%3D...` form
is fragile in some psql 18 invocations; keyword form works):

```powershell
$env:PGPASSWORD='<password>'
psql "host=127.0.0.1 port=5433 user=<user> dbname=<db> sslmode=require connect_timeout=8 options='endpoint=<endpoint-id>'" -c "SELECT 1;"
```

endpoint-id = first part of the Neon hostname, e.g. host
`<neon-endpoint>.aws.neon.tech` -> `<endpoint-id>`.

## Notes

- **lumen project = `<endpoint-id>` under `<neon-account-email>`**
  (tables: `lumen_snapshots`, `whatsapp_sessions`). A relay to
  `<other-endpoint-id>` seen on 2026-08-18 was a different/old target -
  don't reuse it for lumen.
- Get the DSN/password via mainframe helper:
  `C:\Users\<user>\Downloads\mainframe\neon-account.ps1 run <neon-account-email> connection-string`
  (never commit the DSN). "password authentication failed" from another
  account's password on this endpoint = wrong account, not a relay problem.
- psql hangs = relay/mihomo layer broken (see core resurrection), NOT the
  database. `connect_timeout=8` turns hangs into fast errors.
- Verified 2026-08-17 with Proton on + v2rayN/mihomo: psql SELECT works,
  3-row lumen_snapshots upsert works. Re-verified 2026-08-18 after a core
  resurrection: DELETE + SELECT fine.

## Browser/extension Neon access (browser-neon-pac.ps1)

**2026-08-19 correction: Proton only blocks NON-443 egress.** direct psql
(5432) to the Neon endpoint times out on all IPs while Proton is on, but
plain HTTPS (443) to the SAME host responds fine (`curl` -> 400, 3/3 tries)
and the WSS 443 endpoint answers too. the extension SW connects over
WSS/443, so it reaches Neon DIRECT with Proton on — the earlier
"proton blocks extension SW writes" conclusion was wrong; the real culprit
was a dead url-test node when a PAC was active. use the PAC only if 443
ever gets blocked too (unproven), and remember: while the PAC is enabled,
a dead socks node makes neon.tech UNREACHABLE for the browser (fetch fails,
"Link failed: Error connecting to database") even though direct would work.
when in doubt: disable the PAC and test direct first.

- script: `browser-neon-pac.ps1` (`-Enable` / `-Disable` / `-Status`), PAC
  file `neon-pac.js` in this folder (SOCKS5 127.0.0.1:7891 for neon.tech,
  DIRECT fallback). serves the PAC over `http://127.0.0.1:8000/neon-pac.js`
  (python http.server, started detached) - file:// PACs do NOT load in a
  normal browser session and fall back to a stale ProxyServer.
- read the socks port from `binConfigs/config.json` by REGEX - the file is
  YAML with a UTF-8 BOM (as of 2026-08-19), NOT json, ConvertFrom-Json fails.
- verified 2026-08-19: headless Edge with the system PAC loads
  console.neon.tech through socks; google loads direct; firestore.googleapis.com
  responds. later same day: socks node dead -> neon.tech fetch failed from
  the browser while direct curl worked -> PAC disabled, direct restored.
- same node flakiness applies: if the PROXY url-test group sits on a dead
  node, neon requests hang until it re-picks a live one - retry, don't
  rebuild anything. never diagnose with `curl telnet://` through socks (hangs
  on telnet negotiation regardless of connectivity) - use a real HTTPS
  request as the egress probe.