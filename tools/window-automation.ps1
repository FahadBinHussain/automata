# window-automation.ps1 - dot-source, then drive any Win32 UI via messages.
# works on background windows (no focus stealing). pairs with window-capture\Capture-WindowBackground.ps1.
# gotchas: each pwsh invocation is a fresh process - Add-Type dies with it, so always dot-source
# this file in EVERY shell call that uses [WA]. Tree() takes a PID (an hwnd silently returns an
# empty list); GetText/SetText/Click take an IntPtr hwnd. SendMessage-based driving needs the target
# process alive; classic Edit/Static/Button/ComboBox controls respond, owner-drawn/custom-drawn
# controls (games, Delphi TEdit-as-TEdit is fine, TButton too) mostly work, pure-render UIs don't.
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public class WA {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Auto, EntryPoint="SendMessage")] static extern IntPtr SendTxt(IntPtr h, uint msg, IntPtr w, StringBuilder l);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  static List<string> res;
  static bool Collect(IntPtr h, IntPtr l) {
    var cls = new StringBuilder(256); GetClassName(h, cls, 256);
    var txt = new StringBuilder(512); GetWindowText(h, txt, 512);
    res.Add(string.Format("0x{0:X}|{1}|{2}|{3}", h.ToInt64(), cls, txt, IsWindowVisible(h) ? "vis" : "hid"));
    return true;
  }
  // one line per window: hwnd|class|text|vis/hid. kids=true adds all descendants flat.
  public static List<string> Tree(uint pid, bool kids) {
    res = new List<string>();
    EnumWindows((h, l) => { uint wpid; GetWindowThreadProcessId(h, out wpid); if (wpid == pid) { Collect(h, IntPtr.Zero); if (kids) EnumChildWindows(h, Collect, IntPtr.Zero); } return true; }, IntPtr.Zero);
    return res;
  }
  public static string GetText(IntPtr h) { var sb = new StringBuilder(2048); SendTxt(h, 0x000D, (IntPtr)sb.Capacity, sb); return sb.ToString(); }   // WM_GETTEXT
  public static void SetText(IntPtr h, string t) { SendTxt(h, 0x000C, IntPtr.Zero, new StringBuilder(t)); }                                       // WM_SETTEXT
  // PostMessage BM_CLICK: NEVER SendMessage - button handlers that open modal loops (file dialogs)
  // would block the caller until the user closes the dialog.
  public static void Click(IntPtr h) { PostMessage(h, 0x00F5, IntPtr.Zero, IntPtr.Zero); }                                                       // BM_CLICK
  public static int ComboFind(uint pid, IntPtr combo, string text) {                                                          // CB_FINDSTRINGEXACT
    IntPtr r = SendTxt(combo, 0x0158, (IntPtr)(-1), new StringBuilder(text)); return r.ToInt64() == -1 || r.ToInt64() == 0xFFFFFFFE ? -1 : r.ToInt32();
  }
  public static void ComboSelect(uint pid, IntPtr combo, int idx) { SendMessage(combo, 0x014E, (IntPtr)idx, IntPtr.Zero); }                      // CB_SETCURSEL
  public static string ComboGet(uint pid, IntPtr combo) {
    IntPtr cur = SendMessage(combo, 0x0147, IntPtr.Zero, IntPtr.Zero);                                                        // CB_GETCURSEL
    int idx = cur.ToInt32(); if (idx < 0 || idx > 60000) return "";
    IntPtr len = SendMessage(combo, 0x0149, cur, IntPtr.Zero);                                                                // CB_GETLBTEXTLEN
    var sb = new StringBuilder(len.ToInt32() + 8); SendTxt(combo, 0x0148, cur, sb); return sb.ToString();                      // CB_GETLBTEXT
  }
}
'@
function Wait-WAWindow {
  param([uint32]$ProcessId, [string]$Class, [string]$TitlePattern, [int]$TimeoutSec = 15)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    foreach ($line in [WA]::Tree($ProcessId, $false)) {
      $p = $line.Split('|')
      if ((-not $Class -or $p[1] -eq $Class) -and ($p[2] -match $TitlePattern)) { return [IntPtr]([Convert]::ToInt64($p[0].Replace('0x',''), 16)) }
    }
    Start-Sleep -Milliseconds 250
  }
  return [IntPtr]::Zero
}
function Get-WAChild {
  param([uint32]$ProcessId, [string]$Class, [string]$TextPattern = '')
  foreach ($line in [WA]::Tree($ProcessId, $true)) {
    $p = $line.Split('|')
    if ($p[1] -eq $Class -and ($TextPattern -eq '' -or $p[2] -match $TextPattern)) { return [IntPtr]([Convert]::ToInt64($p[0].Replace('0x',''), 16)) }
  }
  return [IntPtr]::Zero
}
