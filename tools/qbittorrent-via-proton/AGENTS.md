# qbittorrent-via-proton: BitTorrent egress while Proton VPN is on

Proton's WFP filter driver blocks direct sockets for qBittorrent (symptom: trackers
time out, metadata never fetches, torrents stuck in `metaDL`). qBittorrent is
configured to route BitTorrent traffic through v2rayN's mihomo core socks port,
which Proton allows to egress freely. this folder is the qBittorrent side of the
same trick as `tools\neon-via-proton` (that one relays Neon; this one is the
torrent client).

## where the pieces live

- mihomo core exe: `C:\Users\<user>\scoop\apps\v2rayn\current\bin\mihomo\mihomo.exe`
- mihomo config: `C:\Users\<user>\scoop\apps\v2rayn\current\binConfigs\config.json`
  (YAML with UTF-8 BOM - do NOT ConvertFrom-Json; regex it. v2rayN regenerates
  this file on restart, so read the ports fresh every time, never hardcode)
- qBittorrent proxy config: `scoop\persist\qbittorrent\profile\qBittorrent\config\qBittorrent.ini`
  `[Network] Proxy\Type=SOCKS5 Proxy\IP=127.0.0.1 Proxy\Port=@Variant(\0\0\0\x85\x1e\xd3)` (7891)
  `Proxy\Profiles\BitTorrent=true` - peer traffic only; trackers go direct
- qBittorrent logs: `...\profile\qBittorrent\data\logs\`

## the relay-up.ps1 script (run this first when torrents stall)

`.\relay-up.ps1` - resurrects mihomo if dead, forces `GLOBAL` -> `PROXY`, probes
socks egress with a real HTTPS request, and reports qBittorrent WebUI status.
`-CheckOnly` verifies without touching anything. exit 1 = relay down.

resurrection steps the script automates (from neon-via-proton AGENTS.md "Core
resurrection"):
1. kill ALL stray mihomo processes, then start ONE core with ABSOLUTE paths:
   `mihomo.exe -d <binConfigs> -f <binConfigs>\config.json` (relative `-f` loads
   a stray 16-byte `C:\Users\<user>\config.json` with wrong ports)
2. force `PUT http://127.0.0.1:<controller>/proxies/GLOBAL` body `{"name":"PROXY"}`
   - if GLOBAL points at DIRECT, traffic egresses direct and Proton blocks it
3. verify socks listener + `curl`-style HTTPS through socks (never `telnet://`
   through socks - hangs regardless of connectivity)

## bare magnet gotcha (2026-08-20) - the actual "not downloading" fix

magnets added from `yts.lt\search.ps1` / `thepiratebay.org\search.ps1` carry
their tracker URLs in the magnet, so they bootstrap fine. but a BARE infohash
magnet (`magnet:?xt=urn:btih:<hash>&dn=<name>`) has NO trackers, and this
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
  once it fetches metadata from a peer. verified 2026-08-20: 6 stuck magnets ->
  peers found (13-147 per torrent), downloads started.

## verified state (2026-08-20)

- relay resurrected: mihomo listening on socks 7891 + controller 10813, GLOBAL ->
  PROXY, socks egress HTTP 200, qBittorrent 5.2.1 WebUI up
- completed-torrent peer traffic flows through the relay fine (All Hail the King
  100%); the stall was metadata bootstrap, not peer flow

## gotchas

- never run `agent-browser` / direct `mihomo.exe -f relative` from an agent bash
  tool - use relay-up.ps1 or Start-Process detached (see mainframe AGENTS.md)
- ProtonVPN + Windscribe services run on this machine; Proton blocks non-443
  direct egress per-process. keep relay-up.ps1 as the one-shot health check
- qBittorrent only applies proxy to `BitTorrent` profile here (trackers direct) -
  if trackers start timing out (status=4) while the relay is healthy, check
  whether `Proxy\Profiles\Tracker=true` was added and whether that breaks
  tracker UDP through socks