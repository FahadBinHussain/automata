# Internet Download Manager (IDM) - CLI direct downloads

user prefers **IDM** for direct (non-torrent) downloads, e.g. hoster/DDL links (pixeldrain, gofile, mega, etc. from masked-link workflows). it's a normal install, NOT scoop: `C:\Program Files (x86)\Internet Download Manager\IDMan.exe`.

## CLI

```
& "C:\Program Files (x86)\Internet Download Manager\IDMan.exe" /d "https://host/file" /p "C:\Users\<user>\Downloads" /f "name.ext" /n
```

- `/d <url>` download URL, `/p <dir>` save folder, `/f <name>` filename, `/n` start immediately.
- resume is native (multi-part temp + rename on completion).

## gotchas

- **`/a` only queues - it does NOT start the download** (2026-08-25): a pixeldrain file added with `/a` sat idle in the queue while an earlier curl was still writing the same path - the file grew but it was curl, not IDM. use `/n` (or just omit `/a`) to actually start it.
- it downloads into its own multi-part temp then renames - if curl/another process already wrote a same-named file, IDM can look like it "isn't running" while the file grows. kill the competing downloader first, then let IDM own the path.
- IDMan runs as a long-lived tray process - do not `Stop-Process IDMan` casually; killing it mid-download loses the resume state. kill the competing downloader, not IDM.
- install location is fixed (`Program Files (x86)\Internet Download Manager\IDMan.exe`) - it's not managed by scoop.

## related

- torrent downloads: `..\qbittorrent.com\` (qBittorrent via Web API).
