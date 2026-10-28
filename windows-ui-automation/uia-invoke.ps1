<#
.SYNOPSIS
  Drive another window's UI WITHOUT stealing focus (Windows UI Automation).

.DESCRIPTION
  Finds an element by UIA Name/AutomationId in the target window, walks up to
  the nearest ancestor carrying the pattern for the requested action (a WinUI
  TextBlock label has no pattern - its Button parent does), runs it, then
  samples GetForegroundWindow for ~2s. the InvokePattern round-trip itself can
  activate the target window intermittently (OS foreground lock dependent) -
  if it happens, foreground is YANKED BACK to the previous window within
  ~100ms and a loud `focus STEAL -> REVERTED` line prints (exit 1 only when
  that restore fails). works while the target is minimized. verifies effects
  by polling the UIA tree, which stays live even when a minimized window
  cannot repaint.

  exit codes: 0 ok (a reverted steal = loud warning, still 0) | 1 focus stolen
              AND restore failed | 2 window not found | 3 element not found
              4 no actionable pattern | 5 verify failed

.PARAMETER Action
  Invoke (InvokePattern) | Toggle (TogglePattern) | Select (SelectionItemPattern)
  | SetValue (ValuePattern, needs -Value) | Scroll (ScrollPattern; -Value =
  SmallIncrement/LargeIncrement/SmallDecrement/LargeDecrement/NoAmount, or
  First/Last to jump - default SmallIncrement) | List (browse elements, no action)

.EXAMPLE
  .\uia-invoke.ps1 -ProcessName Aura -Action List -Name Home
  .\uia-invoke.ps1 -ProcessName Aura -Name Categories -Action Invoke -PollAbsent "Select Your Wallpaper Source"
  .\uia-invoke.ps1 -ProcessName Aura -AutomationId MainScrollViewer -Action Scroll -Value Last
  .\uia-invoke.ps1 -WindowTitle "Dolby Access" -Name "Play" -Action Invoke
#>
[CmdletBinding()]
param(
    [string]$ProcessName = '',
    [string]$WindowTitle = '',
    [string]$Hwnd = '',
    [string]$Name = '',
    [string]$AutomationId = '',
    [ValidateSet('Invoke', 'Toggle', 'Select', 'SetValue', 'Scroll', 'List')]
    [string]$Action = 'Invoke',
    [string]$Value = '',
    [string]$PollPresent = '',
    [string]$PollAbsent = '',
    [int]$PollSeconds = 10,
    [int]$Index = -1,
    [int]$MaxDepth = 8,
    [int]$MaxList = 200
)

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class UiaNative {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
}
'@

# yank foreground back to $prev. plain SetForegroundWindow first (no side
# effects); if the OS foreground lock blocks a background caller, attach our
# input queue to the CURRENT foreground window (the one that just stole) and
# retry - that is the documented exemption, no synthetic keystrokes sent.
function Restore-Foreground([IntPtr]$prev) {
    if ($prev -eq [IntPtr]::Zero) { return $false }
    [void][UiaNative]::SetForegroundWindow($prev)
    for ($i = 0; $i -lt 5; $i++) {
        Start-Sleep -Milliseconds 40
        if ([UiaNative]::GetForegroundWindow() -eq $prev) { return $true }
    }
    $fgNow = [UiaNative]::GetForegroundWindow()
    if ($fgNow -ne [IntPtr]::Zero) {
        $fgTid = [UiaNative]::GetWindowThreadProcessId($fgNow, [IntPtr]::Zero)
        $myTid = [UiaNative]::GetCurrentThreadId()
        if ($fgTid -ne 0 -and $fgTid -ne $myTid) {
            if ([UiaNative]::AttachThreadInput($myTid, $fgTid, $true)) {
                [void][UiaNative]::SetForegroundWindow($prev)
                [void][UiaNative]::AttachThreadInput($myTid, $fgTid, $false)
                for ($i = 0; $i -lt 5; $i++) {
                    Start-Sleep -Milliseconds 40
                    if ([UiaNative]::GetForegroundWindow() -eq $prev) { return $true }
                }
            }
        }
    }
    return $false
}

$patternTypes = @{
    'Invoke'   = [System.Windows.Automation.InvokePattern]::Pattern
    'Toggle'   = [System.Windows.Automation.TogglePattern]::Pattern
    'Select'   = [System.Windows.Automation.SelectionItemPattern]::Pattern
    'SetValue' = [System.Windows.Automation.ValuePattern]::Pattern
    'Scroll'   = [System.Windows.Automation.ScrollPattern]::Pattern
}

function Fail([string]$Msg, [int]$Code) {
    Write-Host "ERROR: $Msg" -ForegroundColor Red
    exit $Code
}

function Get-ElementText($el) {
    $r = $el.Current.BoundingRectangle
    $rect = if ($r.Width -gt 0) { "{0},{1} {2}x{3}" -f [int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height } else { "(degenerate)" }
    "type=$($el.Current.ControlType.ProgrammaticName -replace 'ControlType\.', '') class='$($el.Current.ClassName)' name='$($el.Current.Name)' id='$($el.Current.AutomationId)' rect=$rect offscreen=$($el.Current.IsOffscreen)"
}

function Get-PatternNames($el) {
    $names = @()
    foreach ($k in @('Invoke', 'Toggle', 'Select', 'SetValue', 'Scroll')) {
        try { $null = $el.GetCurrentPattern($patternTypes[$k]); $names += $k } catch { }
    }
    return ($names -join ',')
}

# ---- resolve window: -Hwnd > -WindowTitle > -ProcessName (no silent picks) ----
$h = [IntPtr]::Zero
if ($Hwnd) {
    $n = if ($Hwnd -match '^0x[0-9a-fA-F]+$') { [Convert]::ToInt64($Hwnd, 16) } else { [int64]$Hwnd }
    $h = [IntPtr]$n
    if ($h -eq [IntPtr]::Zero) { Fail "-Hwnd parsed to 0 (got '$Hwnd')" 2 }
} elseif ($WindowTitle) {
    $hits = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$WindowTitle*" })
    if ($hits.Count -eq 0) { Fail "no window title matches '*$WindowTitle*' (check the title, or pass -Hwnd; UWP windows live under ApplicationFrameHost.exe)" 2 }
    if ($hits.Count -gt 1) { Fail ("$($hits.Count) windows match '*$WindowTitle*': " + (($hits | ForEach-Object { "$($_.ProcessName) pid=$($_.Id) '$($_.MainWindowTitle)'" }) -join '; ') + " - narrow -WindowTitle or pass -Hwnd") 2 }
    $h = [IntPtr]$hits[0].MainWindowHandle
} elseif ($ProcessName) {
    $pn = $ProcessName -replace '\.exe$', ''
    $hits = @(Get-Process -Name $pn -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
    if ($hits.Count -eq 0) { Fail "no process '$pn' with a main window (use -WindowTitle or -Hwnd)" 2 }
    if ($hits.Count -gt 1) { Fail ("$($hits.Count) '$pn' windows: " + (($hits | ForEach-Object { "pid=$($_.Id) '$($_.MainWindowTitle)'" }) -join '; ') + " - use -WindowTitle or -Hwnd") 2 }
    $h = [IntPtr]$hits[0].MainWindowHandle
} else {
    Fail "need one of -ProcessName, -WindowTitle, -Hwnd" 2
}

$root = [System.Windows.Automation.AutomationElement]::FromHandle($h)
if ($null -eq $root) { Fail "UIA could not attach to hwnd $h" 2 }

$descendants = [System.Windows.Automation.TreeScope]::Descendants

function New-ElementCondition {
    $cond = $null
    if ($Name) { $cond = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $Name) }
    if ($AutomationId) {
        $idc = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, $AutomationId)
        $cond = if ($cond) { [System.Windows.Automation.AndCondition]::new($cond, $idc) } else { $idc }
    }
    return $cond
}

# ---- List: browse elements (no action, no focus risk) ----
if ($Action -eq 'List') {
    $cond = New-ElementCondition
    if ($null -eq $cond) { $cond = [System.Windows.Automation.Condition]::TrueCondition }
    $all = $root.FindAll($descendants, $cond)
    Write-Host "elements under hwnd 0x$($h.ToInt64().ToString('X')): $($all.Count)$(if ($all.Count -gt $MaxList) { " (showing first $MaxList)" })"
    $i = 0
    foreach ($el in $all) {
        if ($i -ge $MaxList) { break }
        Write-Host ("  [{0}] {1} patterns={2}" -f $i, (Get-ElementText $el), (Get-PatternNames $el))
        $i++
    }
    exit 0
}

if (-not $Name -and -not $AutomationId) { Fail "-Action $Action needs -Name or -AutomationId (or use -Action List to browse)" 3 }
if ($Action -eq 'SetValue' -and -not $PSBoundParameters.ContainsKey('Value')) { Fail "-Action SetValue needs -Value" 3 }

$cond = New-ElementCondition
$found = $root.FindAll($descendants, $cond)
if ($found.Count -eq 0) {
    Fail "no element in window matches$(if ($Name) { " name='$Name'" })$(if ($AutomationId) { " id='$AutomationId'" }) - run -Action List to browse" 3
}

Write-Host "candidates ($($found.Count)):"
for ($i = 0; $i -lt $found.Count; $i++) { Write-Host "  [$i] $(Get-ElementText $found[$i]) patterns=$(Get-PatternNames $found[$i])" }

if ($Index -ge 0) {
    if ($Index -ge $found.Count) { Fail "-Index $Index out of range ($($found.Count) candidates)" 4 }
    $pick = $Index
} else {
    $pick = -1
    for ($i = 0; $i -lt $found.Count; $i++) {
        $n = $found[$i]
        if (((Get-PatternNames $n) -split ',') -contains $Action) { $pick = $i; break }
        $w = [System.Windows.Automation.TreeWalker]::ControlViewWalker
        $node = $n; $depth = 0
        while ($null -ne $node -and $depth -le $MaxDepth) {
            try {
                $null = $node.GetCurrentPattern($patternTypes[$Action])
                $pick = $i
                break
            } catch { }
            try { $node = $w.GetParent($node) } catch { $node = $null }
            $depth++
        }
        if ($pick -ge 0) { break }
    }
    if ($pick -lt 0) { Fail "no candidate supports $Action within $MaxDepth ancestors of itself" 4 }
}

# resolve the actionable node: self first, then walk up
$cand = $found[$pick]
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$node = $cand
$depth = 0
$pat = $null
while ($null -ne $node -and $depth -le $MaxDepth) {
    try { $pat = $node.GetCurrentPattern($patternTypes[$Action]); break } catch { }
    try { $node = $walker.GetParent($node) } catch { $node = $null }
    $depth++
}
if ($null -eq $pat) { Fail "candidate [$pick] has no $Action pattern within $MaxDepth ancestors" 4 }
Write-Host ("using [{0}] -> {1} depth={2} pattern={3}" -f $pick, (Get-ElementText $node), $depth, $Action)

# ---- run the action, watch for activation, yank focus back the moment it happens ----
# measured 2026-10-06: the UIA InvokePattern round-trip ITSELF can activate the
# target window (app code has zero Focus()/Activate() calls; even a no-op chip
# whose handler returns instantly steals), and success/failure tracks the OS
# foreground lock - so it is intermittent. we cannot stop the activation from
# outside, but we detect it within ~60ms and restore the previous window.
$fgBefore = [UiaNative]::GetForegroundWindow()
$wasFg = $fgBefore -eq $h
$iconicBefore = [UiaNative]::IsIconic($h)

switch ($Action) {
    'Invoke'   { $pat.Invoke() }
    'Toggle'   { $pat.Toggle() }
    'Select'   { $pat.Select() }
    'SetValue' { $pat.SetValue($Value) }
    'Scroll'   {
        # .NET ScrollAmount = NoAmount|LargeDecrement|SmallDecrement|SmallIncrement|
        # LargeIncrement (NOT the COM LineUp/PageDown names); First/Last jump via
        # SetScrollPercent because the enum has no "go to end" member.
        $amtName = if ($Value) { $Value } else { 'SmallIncrement' }
        $vOk = $pat.Current.VerticalScrollPercent -ge 0
        $hOk = $pat.Current.HorizontalScrollPercent -ge 0
        if ($amtName -match '^(?i)(first|last)$') {
            $pct = if ($amtName -match '^(?i)first$') { 0.0 } else { 100.0 }
            $pat.SetScrollPercent($(if ($hOk) { $pct } else { -1.0 }), $(if ($vOk) { $pct } else { -1.0 }))
        } else {
            try { $amt = [System.Enum]::Parse([System.Windows.Automation.ScrollAmount], $amtName, $false) }
            catch { Fail "-Value '$amtName' is not a System.Windows.Automation.ScrollAmount (NoAmount, LargeDecrement, SmallDecrement, SmallIncrement, LargeIncrement) or First/Last" 4 }
            $vAmt = if ($vOk) { $amt } else { [System.Windows.Automation.ScrollAmount]::NoAmount }
            $hAmt = if ($hOk) { $amt } else { [System.Windows.Automation.ScrollAmount]::NoAmount }
            $pat.Scroll($hAmt, $vAmt)
        }
    }
}
Write-Host "action=$Action OK"

$stolenCount = 0
$restoreFailed = $false
if (-not $wasFg) {
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 60
        if ([UiaNative]::GetForegroundWindow() -ne $h) { continue }
        $stolenCount++
        if (-not (Restore-Foreground $fgBefore)) { $restoreFailed = $true; break }
        Write-Host "focus STEAL #$stolenCount detected -> REVERTED (foreground yanked back to your window)" -ForegroundColor Yellow
    }
}
$iconicAfter = [UiaNative]::IsIconic($h)
if ($wasFg) {
    Write-Host "focus: check SKIPPED - target was already foreground before the action" -ForegroundColor Yellow
} elseif ($restoreFailed) {
    Fail "focus STEAL: target became foreground during/after $Action and restoring the previous window FAILED - focus is stuck on the target now" 1
} elseif ($stolenCount -gt 0) {
    Write-Host "focus: $stolenCount activation(s) detected and reverted; target may have flashed on screen for ~100ms - NOT fully focus-free, see AGENTS.md" -ForegroundColor Yellow
} else {
    Write-Host "focus preserved=True (target never became foreground; minimized before=$iconicBefore after=$iconicAfter)"
}

# ---- optional verification: poll the UIA tree for expected state ----
$checks = @()
if ($PollPresent) { $checks += , @($PollPresent, $true) }
if ($PollAbsent) { $checks += , @($PollAbsent, $false) }
if ($checks.Count -gt 0) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $before = @{}
    foreach ($c in $checks) {
        $r = [System.Windows.Automation.AutomationElement]::FromHandle($h)
        $pc = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $c[0])
        $before[$c[0]] = $r.FindAll($descendants, $pc).Count -gt 0
    }
    foreach ($k in $before.Keys) { Write-Host "verify before: '$k' present=$($before[$k])" }

    $ok = $false
    while ($sw.Elapsed.TotalSeconds -lt $PollSeconds) {
        $allOk = $true
        foreach ($c in $checks) {
            $r = [System.Windows.Automation.AutomationElement]::FromHandle($h)
            $pc = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $c[0])
            $present = $r.FindAll($descendants, $pc).Count -gt 0
            if ($present -ne $c[1]) { $allOk = $false }
        }
        if ($allOk) { $ok = $true; break }
        Start-Sleep -Milliseconds 500
    }
    foreach ($c in $checks) {
        $r = [System.Windows.Automation.AutomationElement]::FromHandle($h)
        $pc = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $c[0])
        $present = $r.FindAll($descendants, $pc).Count -gt 0
        $want = if ($c[1]) { 'present' } else { 'absent' }
        $now = if ($present) { 'present' } else { 'absent' }
        if ($ok) { Write-Host "verify OK: '$($c[0])' is $want after $([int]$sw.Elapsed.TotalSeconds)s" }
        else { Fail "verify FAILED after ${PollSeconds}s: '$($c[0])' is $now, expected $want" 5 }
    }
}
exit 0
