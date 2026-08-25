# udrop.com storage bridge

udrop (https://www.udrop.com) is a backup source alongside TeraBox.

## account + credentials
- vault item `udrop.com` (username + password; the login password is the WebDAV/API password).
- crypt keys for the rclone remote are in that same vault item's notes as `[rclone UdropCrypt keys]`.

## rclone remotes (in `$env:USERPROFILE\scoop\apps\rclone\current\rclone.conf`)
- `udrop` — webdav remote: url `https://www.udrop.com/webdav/`, vendor `other`, user/pass = udrop login creds.
  - WebDAV is still live even though the settings page hides it (no visible "WebDAV" section; auth is login username + password).
- `UdropCrypt` — crypt wrapping `udrop:` (filename_encryption standard, dir name encryption on). Same layout as the TeraBox bridge so both sources mount/look identical.

## mirror workflow (standardized)
see `automata\tools\storage-mirror.ps1` for the cross-source sync helper. it copies from a
`*Crypt:` source to a `*Crypt:` dest, serial transfers (`--transfers 1`) because parallel
reads wedge the AList Terabox driver, and reports per-source file counts.

## known issues / gotchas
- udrop account comes with default folders (Documents, Images, Music, Videos) — delete them once so the crypt root is clean (they show as "undecryptable dir" warnings otherwise).
- udrop WebDAV upload speed is fine (~2.7 MB/s single connection). no large-file cap observed.
- TeraBox (the other leg) throttles: free tier refuses `download_api=official` dlinks for files > ~20MB (`errno 113` / `no dlink found`) and the CDN caps large-file throughput at ~30KB/s (`tsl=30&csl=30` in the redirect URL) vs ~2MB/s for small files. use `download_api=crack` on the AList Terabox storage so large files at least download (slowly). do NOT run parallel transfers against AList for big trees — the driver wedges (stalls at 0 bytes, AList restart needed).
