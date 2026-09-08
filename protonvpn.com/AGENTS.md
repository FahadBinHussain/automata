# protonvpn.com switcher notes

scripts: `proton-switch.ps1` (cli), `proton-gui.ps1` (winforms, self-elevates), `run.cmd`.
prereqs: openvpn (scoop), `C:\tmp\sbx\wg\auth-ovpn.txt` (openvpn/IKEv2 creds, NOT
account password), `~/.protonvpn-session.json` (api tokens), `.env.local` here
(`LAN_GW`, `LAN_DESKTOP_IP`, `TS_DESKTOP_IP` — never commit).

## commands

- `list | best | <cc|name>` need the proton api (session refresh). dead while the
  account is api-limited — every one of these fails, loudly.
- `static <path-to-ovpn>` connects from a saved .ovpn with zero api calls. this is
  the fallback when the session is dead. known-good files live in `C:\tmp\sbx\wg`
  (`nl-tcp-nodco.ovpn` verified 2026-09-08, exit `185.177.124.97`).
- `status | off` never touch the api.

## gotchas

- **status honesty (fixed 2026-09-08):** `status` used to print `vpn exit:` whenever
  the internet worked, and the gui painted that green — so direct showed "VPN: ON"
  with the isp ip. now ON requires openvpn running + a non-link-local tunnel ip;
  direct prints `direct exit: <ip> (vpn OFF)`, which the gui shows gray. `169.254.*`
  addresses are never reported as tunnel ips.
- **watchdog race (fixed 2026-09-08):** the old watchdog accepted the first
  successful ifconfig.me, which usually answers over direct *before*
  redirect-gateway applies — connect then reported the isp ip as "vpn exit".
  now `Connect-Ovpn` snapshots the pre-connect direct ip and only succeeds when a
  tunnel ip exists AND the exit ip differs from direct. 60s max, then kill.
- **shared connect path:** api (`default` branch) and `static` both go through
  `Connect-Ovpn` (endpoint pin, `disable-dco` inject, lan-gw host route, watchdog,
  state.txt). fix connect logic there, not in both branches.
- **session 400 = dead refresh token.** `reauth6.py` (in `C:\tmp\sbx\wg`, needs
  `wg-user.txt`/`wg-pass.txt` in `$env:TEMP`) revives it — but if proton answers
  the abuse-limiter ("unusual activity ... temporarily limited"), STOP. one attempt
  max, never loop /auth. use `static` until the limit lifts.
- **saved .ovpn files hold private key material.** they stay in `C:\tmp\sbx\wg`
  (scratch), never in this folder/repo. the gui `staticMap` references them by
  filename only (nl/jp/ro); countries without a saved file fall through to the api
  path and fail loud while limited.
- **lan False + tailscale-ssh False with tunnel up:** check the lan gateway ping +
  route table first. if the gateway answers and `192.168.31.0/24` is on-link, the
  local side is fine and the desktop itself is down/asleep (both lan ping and
  tailscale ping die together then). separately: openvpn's WFP only permits
  `openvpn.exe`, so tailscale-through-tunnel stays blocked even with the desktop
  awake (see RESEARCH.md) — that one is expected, not a bug in these scripts.
