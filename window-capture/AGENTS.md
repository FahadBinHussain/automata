# Window capture (local notes)

helper: `C:\Users\<user>\Downloads\automata\window-capture\Capture-WindowBackground.ps1` (wraps the compiled `window-capture.exe`, PrintWindow-based).

## build from source
`window-capture.exe` is a build artifact — rebuild from `WinCap.cs` after any scoop/OS update:
```powershell
& "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /out:window-capture.exe /target:exe /platform:anycpu WinCap.cs
```

## visible windows (foreground/on-screen)

use `GetWindowRect` on the target process `MainWindowHandle` and `CopyFromScreen` only that rect.

## background/occluded windows (behind others)

`PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT)` renders the window to a bitmap regardless of z-order or occlusion, without activating or foregrounding it. example:

```powershell
cd C:\Users\<user>\Downloads\automata\window-capture
.\Capture-WindowBackground.ps1 -ProcessName msedge -CopyToClipboard
```

works for any window - edge, vscode, games, etc. - even when fully covered by other windows.

## minimized windows (2026-10-05)

PrintWindow on an iconic (minimized) window returns BLANK content: the window has no surface while minimized, `GetWindowRect` gives the `-32000,-32000` iconified rect (~160x28), and screenshotting the taskbar thumbnail is a screen grab, not a window grab. do NOT "restore then capture" — every restore path steals focus:

- `ShowWindow(SW_SHOWNOACTIVATE)` still activated the window (measured: `GetForegroundWindow` changed to the target).
- `SetWindowPlacement(showCmd=4)` likewise activated, and a `showCmd=4` placement round-trip left the window in a broken `136x39 @0,0` state that `ShowWindow(SW_SHOWMINNOACTIVE)` could no longer minimize.

working method = **DWM thumbnail snap**: render the minimized window's thumbnail into an off-screen window WE own, PrintWindow that, destroy it. target is never touched (stays minimized, foreground asserted unchanged):

1. size = `GetWindowPlacement().rcNormalPosition` (the restored size — not `GetWindowRect`).
2. create `WS_VISIBLE|WS_POPUP` dest at `-30000,-30000`, ex-style `WS_EX_TOOLWINDOW|WS_EX_NOACTIVATE` — **`WS_EX_NOACTIVATE` is `0x08000000`, not `0x80000000`** (wrong constant = `CreateWindowEx` fails with a win32 error; that bug shipped once).
3. `DwmRegisterThumbnail(dest, minimizedHwnd)` → `DwmUpdateThumbnailProperties` with `dwFlags = TNP_RECTDESTINATION|TNP_OPACITY|TNP_VISIBLE` — **omit `TNP_RECTSOURCE`**: `DwmQueryThumbnailProperties` is NOT exported on this machine (`GetProcAddress` miss), and DWM defaults to the whole window source anyway, which is what we want.
4. pump our own messages ~700ms (DWM composites into OUR dest; a `WS_CHILD`/hidden dest renders nothing — hidden dest measured 0 changed pixels), PrintWindow `PW_RENDERFULLCONTENT` the dest, unregister + `DestroyWindow`.
5. the exe self-checks: uniformity probe on the saved PNG (blank capture = ERROR + exit 1) and `focus preserved=True/False` line. it prints `method=DWM thumbnail snap` so a minimized capture is never silent.

all of this lives in `WinCap.cs` `CaptureMinimized()` — `Capture-WindowBackground.ps1` needs no flags; it auto-detects `IsIconic` and takes the thumbnail path. verified end-to-end on a minimized Aura: correct UI in the PNG, `target still minimized=True`, `focusStolen=False`; visible-window path regression-tested on a background Antigravity window (unchanged, `focusStolen=False`).

**stale-frame caveat**: the thumbnail reflects the last PAINTED state — if you change the app's state (e.g. navigate via UIA) while minimized, the new frame may not composite until the window paints again; trust the UIA tree (`..\windows-ui-automation\uia-invoke.ps1 -PollPresent/-PollAbsent`) over the image for state checks. click/drive without focus: `..\windows-ui-automation\`.


## UWP app windows (Dolby Access, Settings, Calculator, etc.)

the window is hosted by `ApplicationFrameHost.exe`, NOT the app process - so `Process.MainWindowHandle` returns 0 and `-ProcessName <app>` finds nothing. use title-based or HWND-based capture instead:

```powershell
# title-only search across all processes (finds UWP windows by their title)
.\Capture-WindowBackground.ps1 -ProcessName * -WindowTitle "Dolby Access"
# or find the HWND first via EnumWindows + title match, then pass directly
.\Capture-WindowBackground.ps1 -Hwnd 0x1207C0
```

to find a UWP HWND from PowerShell, enumerate visible top-level windows and match by title - the owning PID will be `ApplicationFrameHost`, not the app. `CopyFromScreen` on a UWP rect is unreliable (grabs overlapping windows); always prefer `PrintWindow` for UWP.