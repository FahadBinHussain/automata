<#
.SYNOPSIS
  Capture a window screenshot without bringing it to foreground.

.DESCRIPTION
  Uses PrintWindow API with PW_RENDERFULLCONTENT to render any window
  (even occluded/background) to a bitmap without changing focus or z-order.
  Result is saved to a file and optionally copied to clipboard.

  For UWP apps (Dolby Access, Settings, etc.) the window is hosted by
  ApplicationFrameHost, not the app process — so ProcessName-based lookup
  misses them. Use -WindowTitle or -Hwnd instead.

.PARAMETER ProcessName
  Process name to search for (e.g. "msedge", "chrome", "Code").
  Use "*" or omit for title-only search (needed for UWP apps).

.PARAMETER WindowTitle
  Substring to match against window title. Used with -ProcessName "*" for
  UWP apps (e.g. -ProcessName * -WindowTitle "Dolby Access").

.PARAMETER Hwnd
  Direct window handle as hex string (e.g. "0x1207C0"). Bypasses process
  and title search entirely — most reliable for UWP and shared-process windows.

.PARAMETER OutPath
  Destination file path. Defaults to temp directory.

.PARAMETER CopyToClipboard
  Also copy the captured image to the Windows clipboard.

.EXAMPLE
  .\Capture-WindowBackground.ps1 -ProcessName msedge -CopyToClipboard

.EXAMPLE
  .\Capture-WindowBackground.ps1 -ProcessName Code -WindowTitle "MyProject"

.EXAMPLE
  # UWP app (window hosted by ApplicationFrameHost, not the app process)
  .\Capture-WindowBackground.ps1 -ProcessName * -WindowTitle "Dolby Access"

.EXAMPLE
  # direct HWND (most reliable for UWP / shared-process windows)
  .\Capture-WindowBackground.ps1 -Hwnd 0x1207C0
#>
param(
    [string]$ProcessName = "*",

    [string]$WindowTitle = "",

    [string]$Hwnd = "",

    [string]$OutPath = "",

    [switch]$CopyToClipboard
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $scriptDir "window-capture.exe"

if (-not (Test-Path $exe)) {
    Write-Error "window-capture.exe not found in script directory. compile from WinCap.cs first."
    exit 1
}

$out = if ($OutPath) { $OutPath } else { Join-Path ([System.IO.Path]::GetTempPath()) "window_capture.png" }
$clip = if ($CopyToClipboard) { "1" } else { "0" }

if ($Hwnd) {
    & $exe "hwnd:$Hwnd" "" $out $clip
} else {
    & $exe $ProcessName $WindowTitle $out $clip
}
