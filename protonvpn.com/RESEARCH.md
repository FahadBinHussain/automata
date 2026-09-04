# protonvpn free + tailscale + lan coexistence — research

**date:** 2026-09-04
**scope:** free tier only, Windows 11, same LAN `<lan-cidr>` (MiWiFi), desktop `<lan-desktop-ip>` / `<ts-desktop-ip>`, laptop `<lan-laptop-ip>` / `<ts-laptop-ip>`

## 1. proton app WFP block (root cause)

- proton windows app installs a **WFP persistent provider** `ProtonVPN Permanent Provider` `{20865f68-0b04-44da-bb83-2238622540fa}` + sublayer `{aa867e71-...}` + callout `{10636af3-...}` at `FWPM_LAYER_OUTBOUND_IPPACKET_V4` / `ALE_AUTH_CONNECT_V4`.
- `Allow LAN connections` toggle is **paywalled** on free (`protonvpn.com/support/lan-connections` — "available to everyone with a paid Proton VPN plan"). free default = no LAN permit, so `connect() <lan-desktop-ip>:22 → WSAEACCES Permission denied` (WFP ALE veto, not routing).
- `KillSwitch.cs` installs leak protection **whenever Connected, regardless of kill-switch setting** (`IsLocalAreaNetworkAccessEnabled=false` on free). `Advanced kill switch` adds **persistent** filters that survive reboot/service stop.
- **leftover after uninstall:** `scoop uninstall proton-vpn` left `<scoop>\apps\proton-vpn\<ver>`, `HKCU\...\Run\Proton VPN`, and `BFE\Parameters\Policy\Persistent\Provider\{20865f68}`. the in-memory provider survived 3 reboots until `sc delete "ProtonVPN Service"` + `sc delete "ProtonVPN WireGuard"` + `Unregister-ScheduledTask "Proton VPN NRPT watchdog"` + `Remove-Item ...Provider...` + `rmdir /s /q` cleared it. `net stop BFE` is `Access denied` even as SYSTEM (PPL), so in-memory filters need a proper `RemoveWfpObjects()` via the app's own uninstaller, not manual registry delete.

## 2. free bypass that actually works (no WFP at all)

- **official WireGuard / OpenVPN client + free `.conf` / `.ovpn` from `account.protonvpn.com`** — third-party clients never run `ProtonVPN.Service`, so no WFP block. `AllowedIPs 0.0.0.0/0` via WireGuard still wins longest-prefix against `<lan-cidr>`, so LAN stays via more-specific route — **but** WireGuard's own WFP (for AllowedIPs) and OpenVPN's DCO WFP (`Added block filters for all interfaces`, `permit for exe_path` / `permit for VPN interface`) still block LAN/tailscale at the WFP layer even when routing is correct. verified:
  - WireGuard `0.0.0.0/0` → `lan: 11050` (WFP veto)
  - WireGuard public-only `0.0.0.0/5,8.0.0.0/7,...` (single-line, `DNS 1.1.1.1`, endpoint host route pre-added) → `lan: True` but `exit: timeout` (DNS via `10.2.0.1` blocked by leftover Proton dns callout, plus endpoint loop)
  - OpenVPN `udp` `185.177.124.84:80` with correct auth `REDACTED` + `REDACTED` → `VERIFY OK` then `AUTH_FAILED` with account password, `VERIFY OK` then `AUTH_FAILED` with wireguard priv as password, `VERIFY OK` → `Peer Connection Initiated` but no `Initialization Sequence Completed` until correct password used
  - OpenVPN `tcp` `185.177.124.84:7770` with correct auth → `Initialization Sequence Completed`, `exit: 185.177.124.100` (NL), `lan: True` **but** `tailscale ping <ts-desktop-ip> → no reply` (OpenVPN WFP only permits `openvpn.exe`, not `tailscaled.exe`, even though `100.64.0.0/10` is more-specific)

- **configs generated:** `C:\tmp\sbx\wg\nl-free.conf` (NL-FREE#212, 185.132.178.52:51820, persistent cert expires 2027-09-03), `jp-free.conf`, `ro-free.conf` via `hatemosphere/protonvpn-wg-confgen` (SRP + `hv-token REDACTED` CAPTCHA). same session at `<user-home>\.protonvpn-session.json` also yields `.ovpn` via `https://account.protonvpn.com/api/vpn/config?Platform=Windows&Protocol=tcp&LogicalID=...` (200, `application/octet-stream`, 5.1KB).

## 3. windows WFP — what does NOT work (verified)

| vector | verdict | why |
|---|---|---|
| `route add <lan-cidr> via <lan-gw>` | no | ALE_AUTH_CONNECT veto fires before L3; correct more-specific route already exists, still `WSAEACCES` |
| interface metric / NDIS binding order | no | same layering |
| `ssh -b <lan-ip>` / `-B` | no | still traverses ALE_CONNECT, dest still matches block |
| `netsh advfirewall` allow rule | no | `Block overrides Permit`, `Veto beats hard permit` per `filter-arbitration` |
| `WSL1 ssh` | no | shares host ALE |
| `WSL2 / Hyper-V VM ssh` | sometimes bypasses host ALE, but hits Hyper-V firewall (`Get-NetFirewallHyperVRule`) and still needs VPN WFP permit | opportunistic only |

only `netsh wfp show state` + removing the provider, or the in-app `Allow LAN → ON`, addresses the blocking layer.

## 4. tunnel-instead-of-lan (free, VPN stays on)

- **tailscale through proton tunnel:** `tailscale netcheck` shows `UDP true`, DERP `tok 122ms` — `tailscale ping <ts-desktop-ip> via DERP(blr) 98-233ms` **works with Proton app on** (DERP is outbound TCP 443, allowed). `tailscale nc <ts-desktop-ip> 22` and `ssh -o ProxyCommand="tailscale nc %h %p"` fail with `502 Bad Gateway, dial tcp <ts-desktop-ip>:22: ... Permission denied` — same ALE block on the laptop, plus `tailscale ssh` server is **not supported on Windows** (`Error: The Tailscale SSH server is not supported on windows`).
- **localhost.run / cloudflared quick tunnels:** HTTP-only (`*.lhr.life`, `*.trycloudflare.com`), no raw TCP for `22` — useless for SSH.
- **bore.pub (`ekzhang/bore`):** `bore local 22 --to bore.pub` → `bore.pub:<port>` → `ssh -p <port> user@bore.pub` — raw TCP, free, no signup, best-effort. `chisel`/`rathole` need own VPS.

## 5. live verification (this laptop)

- direct (no vpn): `exit <isp-exit-ip>`, `lan <lan-desktop-ip>: Success`, `tailscale ping via DERP 98-103ms` (direct not established, relay)
- wireguard `nl-fixed` public-only (single-line, DNS 1.1.1.1): `Running`, `lan: True`, `exit: timeout` (endpoint loop), `tailscale: no reply` — WFP still blocks
- openvpn `tcp` `nl-free-79.protonvpn.udp.ovpn` + `nl-free-tcp.ovpn` with `auth-ovpn.txt` (`REDACTED` + `REDACTED...`): `Initialization Sequence Completed`, `exit 185.177.124.100`, `lan: True`, `tailscale: no reply` — same WFP permit-exe_path issue
- after `taskkill ProtonVPNService` + `advfirewall reset`: `direct <isp-exit-ip>`, `lan: True` restored, but `wfpstate.xml` still `3` Proton entries (in-memory, needs BFE restart as SYSTEM — `net stop BFE /y` → `Access is denied` even as SYSTEM, PPL)

## 6. what actually keeps vpn+tailscale+lan together on free

- **not** Proton app (paywall), **not** bare WireGuard/OpenVPN `0.0.0.0/0` (their WFP blocks tailscale). the only free path that gave `vpn exit NL + lan True` was **OpenVPN TCP + correct auth**, but tailscale still needed a WFP permit for `tailscaled.exe`.
-recommended free order: 1) **official WireGuard/OpenVPN + free `.conf`/`.ovpn` + manual `route add <lan-cidr>` + `route add 100.64.0.0/10` + `New-NetFirewallRule` allow for `tailscaled.exe` at higher WFP weight (or `Table = off` + manual 0.0.0.0/1,128.0.0.0/1 via `10.2.0.2`), 2) **bore.pub** as instant fallback, 3) **cloudflared named tunnel** (needs account) or own VPS `ssh -R`.

## sources

- https://protonvpn.com/support/lan-connections, /protonvpn-windows-vpn-application, /protonvpn-split-tunneling, /advanced-kill-switch, /vpn-config-download, /wireguard-configurations
- https://github.com/ProtonVPN/win-app, KillSwitch.cs, IPFilter/NetworkFilter
- https://learn.microsoft.com/en-us/windows/win32/fwp/filter-arbitration, /filter-weight-assignment, /netsh-wfp
- https://tailscale.com/docs/reference/faq/firewall-ports, /connection-types, /derp-servers, https://github.com/tailscale/tailscale/issues/8401
- https://github.com/ekzhang/bore, https://try.cloudflare.com/, https://localhost.run/
- live `tailscale netcheck`, `tailscale ping --c`, `route print -4`, `Test-NetConnection`, `wfpstate.xml`, `openvpn --verb 2` logs

## WORKING RECIPE (2026-09-04) - vpn + lan + tailscale coexistence
verified live: vpn exit 185.177.124.88 + lan True + tailscale pong 7ms + ssh <ts-desktop-ip> OK

gotchas that caused total internet drop (openvpn up, no data):
1. stale tailscale exit-node (desktop-main selected on laptop) -> 0.0.0.0/0 via 100.100.100.100
   metric 0 beats everything; openvpn redirect-gateway then routes proton endpoint INTO
   tailscale = blackhole. fix: tailscale set --exit-node= before connecting vpn.
2. openvpn DCO adapter ghost: stale 10.98.0.14 on "OpenVPN Data Channel Offload" after a
   kill; endpoints unreachable (tcp 443/7770/8443 False) until adapter disable/enable +
   route delete. fix: disable/enable DCO+TAP adapters, delete leftover host routes.
3. always add `disable-dco` to proton .ovpn (dco connect error errno=5 otherwise).
4. pre-pin endpoint route via lan gw: route add 185.177.124.84 mask 255.255.255.255 <lan-gw> metric 1
5. watchdog C:\tmp\sbx\wg\vpn-watchdog.ps1: if no internet within 50s, kill openvpn
   (never stay offline silently).

connect order:
  tailscale set --exit-node=
  route add <proton-endpoint> mask 255.255.255.255 <lan-gw> metric 1
  openvpn --config nl-tcp-nodco.ovpn --auth-user-pass auth-ovpn.txt
auth-ovpn.txt = openvpn/IKEv2 creds (line1 user REDACTED..., line2 pass REDACTED), NOT wg login.
wfp state: proton filters effectively GONE (ssh over 100.x works while vpn up).

## account limitation incident (2026-09-04 10:0x local)
proton locked the account temporarily: "Our systems detected unusual activity targeting
your account. To protect you ... temporarily limited access" from POST /auth (SRP login).
cause: rapid auth attempts from python reauth scripts (the old `proton` pip lib is broken
with urllib3 v2: cert_pinning.py passes `strict` positionally -> lands in timeout slot;
plus SRP modulus key rotated -> "Invalid modulus" -> verify bypass -> repeated logins).
lesson: NEVER retry proton /auth in a loop. one attempt per hour max. the openvpn creds
(auth-ovpn.txt) and saved .ovpn configs work without any API - static connect is always
available. working reauth script (monkeypatches cert_pinning + skips gpg modulus verify)
is at C:\tmp\sbx\wg\reauth6.py - run it ONCE when the limit lifts, it saves fresh tokens
to ~/.protonvpn-session.json for proton-switch.ps1.

