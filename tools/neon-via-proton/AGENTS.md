# neon-via-proton: reach Neon Postgres while Proton VPN is on

Proton's WFP filter driver blocks direct psql/pgx traffic even when host
routes are added, and the Proton client rewrites ServiceSettings.json
split-tunnel edits on restart - don't fight the config file. Instead, route
through v2rayN's mihomo core (which is allowed to egress freely).

## Prerequisites

- v2rayN running (scoop app `v2rayn`), mihomo core alive, socks + external
  controller ports bound. **Do NOT trust old port constants** -
  v2rayN regenerates `binConfigs/config.json` on restart and the controller
  can move. READ THE CURRENT PORTS:

  ```powershell
  Get-Content "C:\Users\<user>\scoop\apps\v2rayn\current\binConfigs\config.json" -TotalCount 12
  # -> socks-port: 7891, external-controller: 127.0.0.1:10813 (example values)
  ```

- mihomo config runs in `mode: rule`, but the GLOBAL selector must point at
  `PROXY` (the url-test group), NOT DIRECT - otherwise Neon traffic egresses
  DIRECT and Proton blocks it.

## Core resurrection (when mihomo is alive but not listening)

Symptom: process exists, but `Get-NetTCPConnection` shows no socks/controller
listener, and psql through the relay hangs (SYN silently dropped).

```powershell
# 1. kill ALL stray cores first (v2rayN may respawn its own - fine)
Get-Process mihomo -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force }

# 2. relaunch ONE core with ABSOLUTE config paths. `-f config.json` relative
#    to CWD loads a stray C:\Users\<user>\config.json (16 bytes,
#    `mixed-port: 7890`) that can be dropped there - wrong ports,
#    no socks, no controller, and two cores fight over cache.db.
Start-Process -FilePath "C:\Users\<user>\scoop\apps\v2rayn\current\bin\mihomo\mihomo.exe" `
  -ArgumentList '-d','C:\Users\<user>\scoop\apps\v2rayn\current\binConfigs','-f','C:\Users\<user>\scoop\apps\v2rayn\current\binConfigs\config.json' `
  -WindowStyle Hidden
Start-Sleep -Seconds 8
# verify: socks + controller port both listening, ONE mihomo process

# 3. force GLOBAL -> PROXY on the REAL controller port:
Invoke-WebRequest -Uri "http://127.0.0.1:10813/proxies/GLOBAL" -Method PUT `
  -ContentType "application/json" -Body '{"name":"PROXY"}'
(Invoke-RestMethod http://127.0.0.1:10813/proxies/GLOBAL).now   # -> PROXY
```

## mihomo boot timing (learned 2026-09-05)

- after relaunch the core can take 35-60s before socks + controller bind — it
  health-checks providers first. do NOT assume dead after 10-20s of no
  listeners; poll `Get-NetTCPConnection -State Listen` for the exact ports
  read from `binConfigs/config.json`.
- `Start DNS server(UDP) error: listen udp 0.0.0.0:5353: bind: ...` in the
  boot log is NON-FATAL (something else holds 5353); socks + controller still
  come up. capture the log with `-RedirectStandardOutput` on the
  `Start-Process` call to tell a slow boot apart from a real failure
  (e.g. the `global-client-fingerprint` config error, also non-fatal).

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

- Get the DSN/password via mainframe helper:
  `C:\Users\<user>\Downloads\mainframe\neon-account.ps1 run <neon-account-email> connection-string`
  (never commit the DSN). "password authentication failed" from another
  account's password on this endpoint = wrong account, not a relay problem.
- psql hangs = relay/mihomo layer broken (see core resurrection), NOT the
  database. `connect_timeout=8` turns hangs into fast errors.
- a relay to a different/old endpoint id is a different target - don't reuse
  it for the project you care about.

## Browser/extension Neon access (browser-neon-pac.ps1)

Proton only blocks NON-443 egress: direct psql (5432) to the Neon endpoint
times out while Proton is on, but plain HTTPS (443) to the SAME host responds
fine and WSS/443 works too. extensions/Serverless drivers that connect over
WSS/443 reach Neon DIRECT with Proton on. use the PAC only if 443 ever gets
blocked too, and remember: while the PAC is enabled, a dead socks node makes
neon.tech UNREACHABLE for the browser even though direct would work. when in
doubt: disable the PAC and test direct first.

- script: `browser-neon-pac.ps1` (`-Enable` / `-Disable` / `-Status`), PAC
  file `neon-pac.js` in this folder (SOCKS5 127.0.0.1:7891 for neon.tech,
  DIRECT fallback). serves the PAC over `http://127.0.0.1:8000/neon-pac.js`
  (python http.server, started detached) - file:// PACs do NOT load in a
  normal browser session and fall back to a stale ProxyServer.
- read the socks port from `binConfigs/config.json` by REGEX - the file is
  YAML with a UTF-8 BOM, NOT json, ConvertFrom-Json fails.
- node flakiness applies: if the PROXY url-test group sits on a dead
  node, neon requests hang until it re-picks a live one - retry, don't
  rebuild anything. never diagnose with `curl telnet://` through socks (hangs
  on telnet negotiation regardless of connectivity) - use a real HTTPS
  request as the egress probe.
