# neon-via-proton: reach Neon Postgres while Proton VPN is on

Proton's WFP filter driver blocks direct psql/pgx traffic even when host
routes are added, and the Proton client rewrites ServiceSettings.json
split-tunnel edits on restart — don't fight the config file. Instead, route
through v2rayN's mihomo core (which is allowed to egress freely).

## Prerequisites

- v2rayN running (scoop app `v2rayn`), mihomo listening on
  127.0.0.1:7891 (socks), external-controller 127.0.0.1:9090.
- mihomo config runs in `mode: global`, so all traffic goes through the
  `GLOBAL` selector. It must point at `PROXY` (the url-test group), NOT
  DIRECT — otherwise Neon traffic egresses DIRECT and Proton blocks it.

## Steps

1. Switch mihomo GLOBAL -> PROXY (needed after every v2rayN restart or
   config regeneration):

   ```powershell
   Invoke-WebRequest -Uri "http://127.0.0.1:9090/proxies/GLOBAL" -Method PUT -ContentType "application/json" -Body '{"name":"PROXY"}'
   ```

   Verify: `(Invoke-RestMethod http://127.0.0.1:9090/proxies/GLOBAL).now`

2. Start the one-shot socks relay (accepts multiple connections, exits
   after the last relay closes — use CopyToAsync for the relay, NEVER
   Start-Job; network streams can't cross runspaces):

   ```powershell
   $out = "$env:TEMP\fwd-out.txt"
   Remove-Item $out -ErrorAction SilentlyContinue
   Start-Process pwsh -ArgumentList '-NoProfile','-File','C:\Users\<user>\Downloads\automata\tools\neon-via-proton\socks5-fwd.ps1' -RedirectStandardOutput $out -RedirectStandardError "$env:TEMP\fwd-err.txt" -WindowStyle Hidden
   Start-Sleep 4
   Get-Content $out -Raw
   ```

3. Connect psql through the relay. SNI is lost (we hit 127.0.0.1), so the
   Neon endpoint id MUST be passed explicitly or Neon errors
   "Endpoint ID is not specified":

   ```powershell
   $env:PGPASSWORD='<password>'
   psql "postgresql://<user>@127.0.0.1:5433/<db>?sslmode=require&options=endpoint%3D<endpoint-id>" -c "SELECT 1;"
   ```

   endpoint-id = first part of the Neon hostname, e.g. host
   `<neon-endpoint>.us-west-2.aws.neon.tech` -> `<neon-endpoint>`.

## Notes

- The relay listens on 127.0.0.1:5433 and forwards to
  <neon-endpoint>.us-west-2.aws.neon.tech:5432 via socks
  127.0.0.1:7891 (defaults in the script params).
- Get the DSN/password via mainframe helper:
  `C:\Users\<user>\Downloads\mainframe\neon-account.ps1 run <email> connection-string`
  (never commit the DSN).
- Verified 2026-08-17 with Proton on + v2rayN/mihomo: psql SELECT works,
  3-row lumen_snapshots upsert works.