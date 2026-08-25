# qBittorrent automation

home of reusable qBittorrent scripts (headless add/status via the Web API).

## pick rules

- **4K first, 1080p floor** (user rule): always prefer 2160p when it exists with seeds; fall back to 1080p; never below 1080p (unless nothing >=1080p exists, e.g. shorts/SD-only extras). `yts.lt\search.ps1` enforces this by default (`-Allow720` to relax).

## scripts

- `add-torrent.ps1` - add a magnet URI or .torrent URL and start it (optionally `-Paused`). ensures qBittorrent is running, enables the Web UI config if needed, restarts, adds, and reports state/save path.
  ```
  powershell -File add-torrent.ps1 -Url "magnet:?xt=urn:btih:..."
  ```

## setup facts

- installed via scoop: `qbittorrent`, runs with a **persisted profile**:
  - exe: `C:\Users\<user>\scoop\apps\qbittorrent\current\qbittorrent.exe`
  - launch: `qbittorrent.exe --profile=C:\Users\<user>\scoop\persist\qbittorrent\profile`
  - config: `C:\Users\<user>\scoop\persist\qbittorrent\profile\qBittorrent\config\qBittorrent.ini` (5.x uses `.ini`; the old `%APPDATA%\qBittorrent\qBittorrent.conf` is **ignored** - writing WebUI settings there does nothing)
  - downloads default to `...\profile\qBittorrent\downloads` — to change: set global `save_path` via `POST /api/v2/app/setPreferences` (body `json={"save_path":"C:\\Users\\<user>\\Downloads"}`), and move existing torrents with `POST /api/v2/torrents/setLocation` (form `hashes`, `location`) which relocates files on disk. `apps\qbittorrent\current\profile` is a **junction** to `persist\qbittorrent\profile`, so `--profile` and bare launches share one config.
  - log: `...\profile\qBittorrent\data\logs\` (check here when WebUI won't start)
- **WebUI is disabled by default** and 5.x refuses to enable it without credentials: log line `WebUI: Credentials are not set`. must set all of:
  ```
  [Preferences]
  WebUI\Enabled=true
  WebUI\Username=admin
  WebUI\Password_PBKDF2=<iterations>:<base64salt>:<base64hash>
  WebUI\Port=8080
  WebUI\LocalHostAuth=false   (optional; skips auth from localhost)
  ```
- password format: PBKDF2-HMAC-SHA512, 100000 iterations, `"<iterations>:<salt_b64>:<hash_b64>"` (no @ByteArray wrapper; that's the legacy MD5 format)
- Web API (v2, no auth needed from localhost when `LocalHostAuth=false`):
  - `GET  /api/v2/app/version`
  - `POST /api/v2/torrents/add` - form field `urls` (magnet or http .torrent URL), `paused=true|false`; response has `success_count`/`failure_count`
  - `GET  /api/v2/torrents/info?hashes=<infohash>` - state, progress, save_path, seq_dl, f_l_piece_prio
  - `POST /api/v2/torrents/delete?hashes=<infohash>&deleteFiles=true` - **query-string params get dropped with "Missing required parameters" on this build; send a form body instead**: `Invoke-RestMethod -Method Post -Body @{ hashes = '<hash>'; deleteFiles = 'true' }` (hash must be lowercase or WebUI rejects).
  - `POST /api/v2/torrents/toggleSequentialDownload` + `toggleFirstLastPiecePrio` - form `hashes`; these EXIST on 5.2.1 (earlier "404" claim was wrong). **toggle flips state** - only call when `seq_dl`/`f_l_piece_prio` is currently false.
- **sequential + first/last-piece download** (user rule): user wants BOTH on every torrent. the ini `[Preferences]` keys `SeqDL=true`/`FLPPieces=true` survive qBittorrent's own ini rewrites but are **NOT applied to WebAPI adds** on 5.2.1 (new torrents land with seq_dl=False). `add-torrent.ps1` now ensures both via the toggle endpoints after every successful add (idempotent - only toggles when false).
- getting magnets: 1337xx.to mirror detail pages work with plain HTTP via `..\1337x.to\get-magnet.ps1` (search on that mirror is a honeypot - never trust it). for movie search use `..\yts.lt\search.ps1`, for games/niche `..\thepiratebay.org\search.ps1` - both have `-Add` to push straight in here.

## proxy + BitTorrent gotchas

- **SOCKS5/VPN proxy kills P2P**: if torrents sit in `metaDL`/`stalledDL` at 0 bytes even when trackers report healthy seed counts, and DHT `connection_status` stays `firewalled`, check for `proxy_type=SOCKS5` pointing at a VPN/proxy client (e.g. mihomo under v2rayN in `mode: global`). in global mode ALL BitTorrent traffic (tracker HTTP, UDP DHT, AND peer connections) is forced through free proxy/VPN servers, which throttle/break P2P. the dead giveaway: leechers (all at 0%) connect but **no seeder ever transfers data**.
- **fix**: set `proxy_type=None` via `POST /api/v2/app/setPreferences` (body `json={"proxy_type":"None"}`). afterwards peer connections go direct and the swarm shows real peers. do NOT re-enable a global-mode SOCKS5 for qBittorrent without a strong reason.
- **preference-write gotcha**: `setPreferences` must use `-ContentType 'application/x-www-form-urlencoded'` with body `json=<urlencoded>`; sending raw JSON with `-ContentType 'application/json'` returns 400 and silently no-ops.

## IDM (direct downloads)

user prefers **Internet Download Manager** for direct (non-torrent) downloads, e.g. hoster/DDL links from masked-link workflows. CLI + gotchas live in `..\internetdownloadmanager.com\AGENTS.md`.

## watched-and-delete workflow gotchas

when a watched episode/movie file is removed from a torrent's save path, the safe sequence is:
1. `POST /api/v2/torrents/stop` (form `hashes`) - stop the whole torrent first.
2. `POST /api/v2/torrents/filePrio` - **this endpoint takes `hash` (SINGULAR), NOT `hashes`**. using `hashes=` silently 400s with "Missing required parameters: hash" and the priority does NOT change. form: `hash=<infohash>&id=<file_index>&priority=0` (priority 0 = do not download; the file index comes from `GET /api/v2/torrents/files?hash=<infohash>`).
3. kill qbittorrent (`Stop-Process -Name qbittorrent -Force`).
4. `Remove-Item` ONLY that one file (and its sidecar .srt). never delete a whole season folder.
5. restart qbittorrent, then **always `POST /api/v2/torrents/recheck` (form `hashes`)** and wait for `state` to leave `checking`.

critical facts:
- killing qbittorrent while a torrent is stopped with a missing file makes it come back in `missingFiles` at progress 0 (fastresume saved in a bad state). this LOOKS like the whole download was wiped but the on-disk files are untouched - a recheck revalidates the real data and restores progress. verify on disk with `Get-ChildItem` before panicking.
- `torrents/resume` does NOT exist on 5.2.1 (404 "Endpoint does not exist") - use `POST /api/v2/torrents/start` (form `hashes`) instead.
- qbittorrent path is scoop: `C:\Users\<user>\scoop\apps\qbittorrent\current\qbittorrent.exe` (the `C:\Program Files\qbittorrent.exe` guess is wrong).
