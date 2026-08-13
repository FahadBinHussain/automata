# Window capture (local notes)

helper: `C:\Users\<user>\Downloads\automata\tools\window-capture\Capture-WindowBackground.ps1` (wraps the compiled `window-capture.exe`, PrintWindow-based).

## visible windows (foreground/on-screen)

use `GetWindowRect` on the target process `MainWindowHandle` and `CopyFromScreen` only that rect.

## background/occluded windows (behind others)

`PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT)` renders the window to a bitmap regardless of z-order or occlusion, without activating or foregrounding it. example:

```powershell
cd C:\Users\<user>\Downloads\automata\tools\window-capture
.\Capture-WindowBackground.ps1 -ProcessName msedge -CopyToClipboard
```

works for any window - edge, vscode, games, etc. - even when fully covered by other windows.

## UWP app windows (Dolby Access, Settings, Calculator, etc.)

the window is hosted by `ApplicationFrameHost.exe`, NOT the app process - so `Process.MainWindowHandle` returns 0 and `-ProcessName <app>` finds nothing. use title-based or HWND-based capture instead:

```powershell
# title-only search across all processes (finds UWP windows by their title)
.\Capture-WindowBackground.ps1 -ProcessName * -WindowTitle "Dolby Access"
# or find the HWND first via EnumWindows + title match, then pass directly
.\Capture-WindowBackground.ps1 -Hwnd 0x1207C0
```

to find a UWP HWND from PowerShell, enumerate visible top-level windows and match by title - the owning PID will be `ApplicationFrameHost`, not the app. `CopyFromScreen` on a UWP rect is unreliable (grabs overlapping windows); always prefer `PrintWindow` for UWP.