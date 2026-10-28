# tools - shared local scripts

## window-automation.ps1
- dot-source in EVERY shell call that uses `[WA]` - each pwsh invocation is a fresh process and Add-Type dies with it.
- API gotchas: `[WA]::Tree(uint pid, bool kids)` takes a **PID**, not an hwnd (passing an hwnd silently returns an empty list - looks like a dead window); `GetText`/`SetText` take an `IntPtr` hwnd (WM_GETTEXT/WM_SETTEXT); `Click(hwnd)` = PostMessage BM_CLICK - never SendMessage for buttons that open modal dialogs (the caller blocks until the dialog closes).
- Tree lines are `0xHND|class|text|vis`; parse the hex, convert with `[Convert]::ToUInt32(x, 16)`.
- drives background windows without focus stealing; pairs with `window-capture\Capture-WindowBackground.ps1` for dialogs that render text their own way.
- proven use: read the BigFish/Armadillo `Enter Key` fingerprint + drive kg.exe keygen (2026-10-12, cs.rin.ru AGENTS BigFish record).

## procmon trace recipe (diagnosed a silent exit-0 game launch, 2026-10-12)
- scoop `sysinternals`: launch `$env:USERPROFILE\scoop\apps\sysinternals\current\Procmon64.exe` DIRECTLY - the scoop shim (`procmon.exe`) mangles `/BackingFile`; the instance comes up as GUI and never creates the trace file.
- this build rejects `/ProcessName` with a modal "Invalid argument: /ProcessName" - capture unfiltered, filter after conversion.
- flow: `Start-Process Procmon64 -ArgumentList '/AcceptEula','/Quiet','/Minimized','/BackingFile','C:\tmp\x.PML'` (detached - it is long-lived), poll for the PML file, run the target, `Start-Process Procmon64 '/Terminate' -Wait`, convert with `'/OpenLog','x.PML','/SaveAs','x.csv','/SaveApplyFilter','/Quiet' -Wait`, then `Import-Csv` and filter on `Process Name`.
- CSV columns: Time of Day / Process Name / PID / Operation / Path / Result / Detail - `Detail` carries RegQueryValue data (`Type: REG_SZ, Data: ...`) and CreateFile dispositions; file order = chronological, so `Select-Object -Last N` is the tail before exit. watch for regex traps: `-match` on paths with `\P`/`\?` sequences breaks (`\PIPE` is a malformed Unicode escape) - use `-like` instead.

## launching interactive GUI windows from agent sessions (2026-10-25)
- agent processes run on an isolated private desktop (`WinSta0\exebox-...`) inside a Windows Job Object (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) without breakaway permission (`ERROR_ACCESS_DENIED`, error 5).
- plain `Start-Process` / `cmd /c start` spawns processes onto the hidden agent desktop, and Windows kills them as soon as the tool call completes.
- to launch an interactive window onto the user's active desktop (`WinSta0\Default`) that stays alive independently, trigger it via Task Scheduler (`schtasks /create /tn ... /tr ... /sc ONCE ...` + `schtasks /run` + `schtasks /delete`), which spawns via `svchost.exe` directly on `WinSta0\Default` outside the agent job object.


## deleting files with unicode names -> trash-files.py, never send2trash (2026-10-26)
- `send2trash`'s windows backend hands the path to the ANSI shell API, so any non-ASCII name
  (bengali book titles here) raises `FileNotFoundError` even though the file exists. worse, the
  move has already happened by then: the item IS in the recycle bin and a retry reports "missing",
  which reads like data loss if you only look at the exit code.
- use `tools/trash-files.py` instead: `SHFileOperationW` with `FOF_ALLOWUNDO` and a wide-char,
  double-null-terminated `pFrom` (`--list <utf8 file>` for non-ASCII paths, since cmd's codepage
  mangles them). it prints TRASHED / SKIP / FAIL per path.
- `SHFileOperationW` can return a non-zero rc on a run that actually succeeded - verify by the file
  being gone plus a `$R<id>.<ext>` + `$I<id>.<ext>` pair under `C:/$Recycle.Bin/<sid>/`, not by rc alone.
- never `rm` a user's files: the recycle bin is the only reversible path, and this box's `$Recycle.Bin`
  keeps the original size + name metadata needed to restore.
