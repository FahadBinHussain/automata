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

## "main IDM executive file is damaged" - root cause (2026-09-09)

the popup is IDM's own integrity check. **the CLI above cannot damage idm** - it only passes args, and `IDMan.exe`'s mtime has not moved since 2026-09-01 despite many launches since. nothing in this doc needs changing.

- `IDMan.exe` (6,189,056 b, mtime 2026-09-01 23:01:18) is **patched**: 30 bytes changed across 14 spots, every one a license-check bypass (`jne`→`nop;jmp`, `je`→`jmp`, `test eax,eax`→`xor eax,eax`, fn prologues→`ret`, trial counter `1e`(30)→`ff ff ff 7f`), and its **authenticode signature was stripped** - that strip is exactly the 10,608-byte size delta.
- `IDMan.exe.BAK` (6,199,664 b) is the **genuine** digicert-signed **Tonec Inc.** binary. all 5 PE sections are byte-identical to the patched one; only those 30 bytes differ, plus the signature.
- cause: `C:\Users\<user>\Downloads\softwares\IDM_6.4x_Crack_v20.6.exe` (67,584 b, self-identifies `name="IDMan 6.4x Crack"`, references `_IDMan.exe`). a legit installer or idm auto-update would never strip a signature - only a patcher must, since patching invalidates it.
- so idm fails its self-check on every launch -> popup every time. it is about what the file *is*, not how you invoked it.

**resolved 2026-09-09 - clean official reinstall (fahad's chosen fix).** result: `IDMan.exe` is back to 6,199,664 b, sha256 `03cc62e9adb77a380f9dc12f67ccaaee5106f12844aa73ce32c914ddd16d607c`, authenticode PRESENT (10,608 b, tonec inc.) - byte-identical to `IDMan.exe.BAK`. launch clean, no popup.

**silent install gotcha (cost me 3 failed attempts):** official url is `https://download.internetdownloadmanager.com/idman643buildXX.exe` (find the current build on the /download.html page; was build10 2026-09). **`/S` alone does NOT work** - the installer extracts to `%TEMP%\IDM_Setup_Temp`, then exits rc=0 having installed nothing. the switch that actually works is **`/S /skipdlgs`**:

```
& "C:\Users\<user>\Downloads\Programs\idman643build10.exe" /S /skipdlgs
```

run it in the FOREGROUND (`subprocess.run(..., timeout=90)`) so you get the return code - launching it `DETACHED_PROCESS` or via `os.startfile(..., 'runas')` shows no uac prompt and it just vanishes, so you cannot tell success from failure. kill `IDMan.exe` first or files are locked. the installer is **not** inno/nsis (no markers) - it is tonec's own.

**verify after install:** `sha256sum IDMan.exe IDMan.exe.BAK` must match, and data directory 4 (security) must be non-zero.

**reusable diagnosis recipe:** `sha256sum` both files, then a small python PE/diff script - compare the section table, count differing bytes with first/last offsets, and read data directory 4 (security). a real authenticode blob starts with `WIN_CERTIFICATE` (`dwLength`, `wRevision=0x0200`, `wCertificateType=0x0002`) then `30 82 .. 06 09 2a 86 48 86 f7 0d 01 07 02` (pkcs#7 signeddata). **missing signature + a handful of flipped conditional jumps = patched, not corrupt.** a truncated/garbage tail would mean real damage instead.

## related

- torrent downloads: `..\qbittorrent.com\` (qBittorrent via Web API).
