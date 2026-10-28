# qBittorrent under Proton VPN (free tier) — P2P bypass

## The model

- Proton free: no P2P on their servers, no split tunneling.
  `ServiceSettings.json` (scoop install:
  `C:\Users\<user>\scoop\apps\proton-vpn\current\v5.1.6\ServiceData\ServiceSettings.json`)
  has `"SplitTunnel":{"Mode":0,"AppPaths":[],"Ips":[]}` — NOTHING is excluded,
  and Proton rewrites split-tunnel edits on restart (don't fight the config).
- Everything tunnels through Proton (default route). Out-of-tunnel flows
  (host routes / attempted direct egress) get dropped by the WFP driver —
  that's why direct outbound sockets die and why socks-relay bridges exist.
- The bypass works because mihomo's PROXY nodes ride the tunnel and the
  node servers do the actual egress. qBittorrent uses THE SAME pattern:
  point it at mihomo's socks (127.0.0.1:7891, GLOBAL->PROXY) and torrent
  traffic lands on the proxy-node IPs, not Proton's P2P-blocked servers.
- DEAD END, do not retry: a second standalone mihomo instance with
  `MATCH,DIRECT` does NOT egress direct — there is no per-process exclusion to
  borrow (Mode 0), its direct outbound just returns the VPN IP. The
  v2rayN core's GLOBAL->DIRECT also fails mid-response. Proton free = no
  out-of-tunnel egress, period.

## Setup

qBittorrent runs with `--profile=C:\Users\<user>\scoop\persist\qbittorrent\profile`
(config: `profile\qBittorrent\config\qBittorrent.ini`), WebUI on
http://127.0.0.1:8080 with `WebUI\LocalHostAuth=false` (no auth on localhost).

```powershell
$body = @{ json = '{"proxy_type":"SOCKS5","proxy_ip":"127.0.0.1","proxy_port":7891,"proxy_auth_enabled":false,"proxy_peer_connections":true,"proxy_bittorrent":true,"proxy_hostname_lookup":true}' }
Invoke-WebRequest -Uri "http://127.0.0.1:8080/api/v2/app/setPreferences" -Method Post -Body $body
```

Verify: `GET /api/v2/app/preferences` -> proxy_type=SOCKS5, proxy_bittorrent=True,
proxy_peer_connections=True, proxy_ip=127.0.0.1, proxy_port=7891.

## relay-up.ps1 (run this first when torrents stall)

*(merged from `tools\qbittorrent-via-proton\` 2026-10-06 — this folder always
held the Proton bypass doc; the runnable half now lives beside it.)*

`.\relay-up.ps1` - resurrects mihomo if dead, forces `GLOBAL` -> `PROXY`, probes
socks egress with a real HTTPS request, and reports qBittorrent WebUI status.
`-CheckOnly` verifies without touching anything. exit 1 = relay down.

where the pieces live:

- mihomo core exe: `C:\Users\<user>\scoop\apps\v2rayn\current\bin\mihomo\mihomo.exe`
- mihomo config: `C:\Users\<user>\scoop\apps\v2rayn\current\binConfigs\config.json`
  (YAML with UTF-8 BOM - do NOT ConvertFrom-Json; regex it. v2rayN regenerates
  this file on restart, so read the ports fresh every time, never hardcode)
- qBittorrent proxy config: `scoop\persist\qbittorrent\profile\qBittorrent\config\qBittorrent.ini`
  `[Network] Proxy\Type=SOCKS5 Proxy\IP=127.0.0.1 Proxy\Port=@Variant(...)` (7891)
  `Proxy\Profiles\BitTorrent=true` - peer traffic only; trackers go direct
- qBittorrent logs: `...\profile\qBittorrent\data\logs\`

resurrection steps the script automates (from `neon.com\neon-via-proton\AGENTS.md` "Core
resurrection"):
1. kill ALL stray mihomo processes, then start ONE core with ABSOLUTE paths:
   `mihomo.exe -d <binConfigs> -f <binConfigs>\config.json` (relative `-f` loads
   a stray `C:\Users\<user>\config.json` with wrong ports)
2. force `PUT http://127.0.0.1:<controller>/proxies/GLOBAL` body `{"name":"PROXY"}`
   - if GLOBAL points at DIRECT, traffic egresses direct and Proton blocks it
3. verify socks listener + `curl`-style HTTPS through socks (never `telnet://`
   through socks - hangs regardless of connectivity)

relay gotchas:

- never run a blocking browser command / direct `mihomo.exe -f relative` from an agent bash
  tool - use relay-up.ps1 or Start-Process detached (see mainframe AGENTS.md)
- Proton blocks non-443 direct egress per-process; keep relay-up.ps1 as the
  one-shot health check
- qBittorrent only applies proxy to the `BitTorrent` profile here (trackers direct) -
  if trackers start timing out (status=4) while the relay is healthy, check
  whether `Proxy\Profiles\Tracker=true` was added and whether that breaks
  tracker UDP through socks

## bare magnet gotcha - the actual "not downloading" fix

magnets added from torrent-search helpers carry their tracker URLs in the magnet,
so they bootstrap fine. but a BARE infohash magnet
(`magnet:?xt=urn:btih:<hash>&dn=<name>`) has NO trackers, and this
qBittorrent has `Session\DHTEnabled=false` + `PeX/LSD` disabled - so there is
NO way to find peers and fetch metadata. the torrent sits in `metaDL` forever
even with a healthy relay. fix = inject public trackers per torrent via the
Web API, then reannounce:

```powershell
$trackers = @("udp://tracker.opentrackr.org:1337/announce","udp://open.stealth.si:80/announce","udp://tracker.torrent.eu.org:451/announce","udp://tracker.dler.org:6969/announce","udp://exodus.desync.com:6969/announce","http://tracker.opentrackr.org:1337/announce")
# per stuck torrent (hash lowercase):
Invoke-WebRequest -Uri "http://127.0.0.1:8080/api/v2/torrents/addTrackers" -Method Post -Body @{ hash = $h; urls = $t } -UseBasicParsing
Invoke-WebRequest -Uri "http://127.0.0.1:8080/api/v2/torrents/reannounce" -Method Post -Body @{ hashes = $h } -UseBasicParsing
```

- `addTrackers` takes SINGULAR `hash`; `reannounce` takes PLURAL `hashes`
- HTTP 204 from addTrackers = SUCCESS (not a failure - 204 is the success body)
- after ~30s the announce cycle returns peers; the torrent leaves `metaDL`
  once it fetches metadata from a peer.

## Gotchas

- qBittorrent v5.x WebUI prefs use the STRING enum `proxy_type` ("SOCKS5"),
  not the old int 2; `proxy_bittorrent` must be true or only peer connections
  get proxied (the "use proxy for torrents" checkbox).
- The mihomo GLOBAL selector MUST stay `PROXY` (never `DIRECT` for torrents):
  other bridges depend on it AND direct egress is blocked anyway
  (`PUT http://127.0.0.1:10813/proxies/GLOBAL {"name":"PROXY"}` to restore).
- If the proxy nodes throttle/block P2P, torrents will be slow/starved — that
  is a node-provider property, not a config error. Alternatives then: a
  P2P-friendly proxy provider, Proton paid, or torrenting from another
  machine not behind Proton.
- Edit qBittorrent.ini only while qBittorrent is CLOSED (it rewrites on exit);
  the WebUI API is the safe live path.
- Proton VPN scoop install path (config/registry hunts are wasted time):
  `C:\Users\<user>\scoop\apps\proton-vpn\current\v5.1.6\` - ServiceData\ has
  ServiceSettings.json + WireGuard\*.conf.

## Egress testing

- VERIFIED WORKING path (the one qBittorrent uses - SOCKS5, remote DNS):
  `curl.exe --socks5-hostname 127.0.0.1:7891 -sS --max-time 15 https://api.ipify.org`
  -> proxy-node IP, NOT the home/VPN IP.
- HTTP CONNECT through mihomo's mixed-port (`Invoke-WebRequest -Proxy
  "http://127.0.0.1:7891"`) FAILS against these free nodes ("response ended
  prematurely" / "an error occurred while sending the request") even when
  SOCKS5 works fine. Do NOT diagnose via HTTP -Proxy tests; always test with
  the socks5 curl form.
- The PROXY group is a url-test over ~250 free nodes, most flagged RISKY
  (dead). Manual node pinning via `PUT /proxies/PROXY {"name":"..."}` does
  NOT stick (url-test re-selects). Pinning via `PUT /proxies/GLOBAL
  {"name":"<node>"}` DOES stick (selector), use that only if the auto-picked
  node dies mid-download; exact node strings must come from `GET
  /proxies/PROXY` -> `all` (do not retype them, the unicode markers differ).

## Leak hardening

Symptom: unpausing torrents makes Proton drop the session. Cause: qBittorrent's
SOCKS5 proxy only covers TCP - uTP + DHT + PeX + LSD + UDP trackers all ride
UDP and went straight out of the tunnel, so Proton's free servers saw P2P
traffic and killed the VPN. Fix = make EVERYTHING TCP and kill UDP sources:

```powershell
$body = @{ json = '{"bittorrent_protocol":1,"dht":false,"pex":false,"lsd":false,"upnp":false,"nat_port_mapping":false}' }
Invoke-WebRequest -Uri "http://127.0.0.1:8080/api/v2/app/setPreferences" -Method Post -Body $body
```

- `bittorrent_protocol` enum (5.x API): 0 = TCP+uTP (DEFAULT - the leak), 1 =
  TCP only, 2 = uTP only. It is an INT, not a string - `"tcp"` is ignored.
- the UDP listener socket (Session\Port) STAYS OPEN even with uTP/DHT off -
  harmless once nothing sends; do not chase it with netstat.
- `removeTrackers` (udp:// tracker stripping) returns 204 but is a NO-OP in
  this build - the udp trackers remain and re-announce (tiny packets, fine).
- peer discovery is weaker now (no DHT/uTP/PeX, most trackers udp) - slow
  starts are expected; the free proxy nodes throttle/starve P2P anyway.
- qBittorrent DIED once right when Proton dropped (no WER event, no crash
  dump) - after any Proton drop, check the process + WebUI before debugging
  the proxy.

## Revert (restore stock torrent networking)

```powershell
$body = @{ json = '{"bittorrent_protocol":0,"dht":true,"pex":true,"lsd":true,"upnp":true,"nat_port_mapping":true}' }
Invoke-WebRequest -Uri "http://127.0.0.1:8080/api/v2/app/setPreferences" -Method Post -Body $body
```

To also drop the proxy entirely: `{"proxy_type":"None","proxy_peer_connections":false,"proxy_bittorrent":false}` -
read back `GET /api/v2/app/preferences` -> proxy_type after; verify with the
socks5 curl in Egress testing above to confirm egress is gone.

Restart (clean, for when settings changed while it was dead):
`POST /api/v2/app/shutdown`, wait for exit, then
`Start-Process "C:\Users\<user>\scoop\apps\qbittorrent\current\qbittorrent.exe" -ArgumentList "--profile=C:\Users\<user>\scoop\persist\qbittorrent\profile"`.
Note: the profile dir is inside scoop's `persist\` - ini edits survive updates,
but only touch qBittorrent.ini while qBittorrent is CLOSED (it rewrites on exit).
