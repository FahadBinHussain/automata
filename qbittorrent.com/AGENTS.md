# qBittorrent automation

home of reusable qBittorrent scripts (headless add/status via the Web API).

## scripts

- `add-torrent.ps1` - add a magnet URI or .torrent URL and start it (optionally `-Paused`). ensures qBittorrent is running, enables the Web UI config if needed, restarts, adds, and reports state/save path.
  ```
  powershell -File add-torrent.ps1 -Url "magnet:?xt=urn:btih:..."
  ```

## setup facts (learned 2026-08-16)

- installed via scoop: `qbittorrent` (5.2.1), runs with a **persisted profile**:
  - exe: `C:\Users\<user>\scoop\apps\qbittorrent\current\qbittorrent.exe`
  - launch: `qbittorrent.exe --profile=C:\Users\<user>\scoop\persist\qbittorrent\profile`
  - config: `C:\Users\<user>\scoop\persist\qbittorrent\profile\qBittorrent\config\qBittorrent.ini` (5.x uses `.ini`; the old `%APPDATA%\qBittorrent\qBittorrent.conf` is **ignored** - writing WebUI settings there does nothing)
  - downloads default to `...\profile\qBittorrent\downloads`
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
  - `GET  /api/v2/torrents/info?hashes=<infohash>` - state, progress, save_path
  - `POST /api/v2/torrents/delete?hashes=<infohash>&deleteFiles=true` - **query-string params get dropped with "Missing required parameters" on this build; send a form body instead**: `Invoke-RestMethod -Method Post -Body @{ hashes = '<hash>'; deleteFiles = 'true' }` (hash must be lowercase or WebUI rejects).
- getting magnets: 1337xx.to mirror detail pages work with plain HTTP via `..\1337x.to\get-magnet.ps1` (search on that mirror is a honeypot - never trust it). for movie search use `..\yts.lt\search.ps1`, for games/niche `..\thepiratebay.org\search.ps1` - both have `-Add` to push straight in here.