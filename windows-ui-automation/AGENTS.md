# windows-ui-automation (local notes)

helper: `uia-invoke.ps1` — drive any window's UI **without activating or focusing it**, using Windows UI Automation (UIA) — the same accessibility API screen readers and ChatGPT-desktop-style apps use. works while the target is minimized. pairs with `window-capture\` (capture without focus): together they are click + screenshot, zero focus theft.

```powershell
cd C:\Users\<user>\Downloads\automata-private\windows-ui-automation

# browse elements (no action, no focus risk)
.\uia-invoke.ps1 -ProcessName Aura -Action List -Name "Categories"

# invoke a control + verify the effect landed (polls the UIA tree)
.\uia-invoke.ps1 -ProcessName Aura -Name "Categories" -Action Invoke -PollPresent "Technics"
.\uia-invoke.ps1 -ProcessName Aura -Name "Home" -Action Invoke -PollPresent "Select Your Wallpaper Source"

# other actions / window targeting
.\uia-invoke.ps1 -ProcessName Aura -Name "SomeToggle" -Action Toggle
.\uia-invoke.ps1 -ProcessName Aura -Name "SomeBox" -Action SetValue -Value "text"
  .\uia-invoke.ps1 -ProcessName Aura -AutomationId MainScrollViewer -Action Scroll -Value Last
.\uia-invoke.ps1 -WindowTitle "Dolby Access" -Name "Play" -Action Invoke   # UWP-safe: title, not process
.\uia-invoke.ps1 -Hwnd 0x9103C0 -Name "X" -Action Invoke                  # exact window
```

exit codes: `0` ok (a reverted steal = loud yellow warning, still 0) | `1` focus stolen AND restore failed | `2` window not found | `3` element not found | `4` no pattern | `5` verify failed.

## how it works

1. resolve window: `-Hwnd` > `-WindowTitle` (across all processes → UWP works) > `-ProcessName` (0 or >1 match = loud error, no silent pick).
2. `FindAll` by `Name`/`AutomationId` under the window root; print every candidate with class/rect/patterns (use `-Index` to pin one when names repeat).
3. walk UP from the element (`TreeWalker.ControlViewWalker`, `-MaxDepth`, default 8) to the nearest ancestor carrying the requested pattern — a WinUI `TextBlock` label has no pattern, its parent `Button` (`AutomationId` like `CategoriesButton`) does.
4. run the pattern (`Invoke`/`Toggle`/`Select`/`SetValue`/`Scroll`), then sample `GetForegroundWindow` for ~1.8s: the InvokePattern round-trip ITSELF intermittently activates the target window (measured 2026-10-06, see gotchas) — when detected, foreground is YANKED BACK to the pre-action window within ~100ms (`focus STEAL #n detected -> REVERTED`, yellow) and the run continues. exit 1 only when that restore FAILS (focus stuck on the target). window's `IsIconic` before/after printed.
5. optional `-PollPresent "name"` / `-PollAbsent "name"` re-queries the UIA tree until the expected page marker appears/disappears (`-PollSeconds`, default 10) → `verify OK` / loud `verify FAILED`.

## gotchas (measured 2026-10-05, Aura = WinUI 3)

- **the InvokePattern round-trip ITSELF can activate the target window (root-caused 2026-10-06, Aura = WinUI 3)**: the app has ZERO `Focus()`/`Activate()`/`SetForegroundWindow` calls outside startup `m_window.Activate()`, a **no-op chip** whose handler returns instantly still stole, and the same action passes/steals on different runs — the split tracks the OS foreground lock, so it is intermittent, not code-path dependent. we cannot prevent it from outside: a background pwsh's own `SetForegroundWindow(target)` probe is DENIED while the user works (the activation comes from the TARGET's own process, which keeps its own grant). the helper therefore DETECTS + REVERTS: plain `SetForegroundWindow(prev)` first, then (if the lock blocks it) `AttachThreadInput` to the current foreground (stealing) thread and retry — no synthetic keystrokes. revert fires within ~100ms, prints `focus STEAL #n detected -> REVERTED`, and only exits 1 when restore itself fails. the reverted state still means a possible ~100ms flash on screen — the truly flash-free mode is a MINIMIZED target (every minimized round ever run: `preserved=True`, no activation, no revert).
- **restore-function unit test technique**: slice the helper text between `Add-Type -AssemblyName` and `# ---- resolve window` + `Invoke-Expression` to exercise the SHIPPED `Restore-Foreground` without running the main flow (same pattern as the opencode v1-rollback rehearsal). as of 2026-10-06 the probe step (`SetForegroundWindow(target)` from background pwsh) is denied by the foreground lock while the user is active, so the unit path needs an idle moment or a real steal to run.
- **focus assertion must be "did the TARGET become foreground", never a bare fg diff before/after**: this machine's fg handle changes constantly from the user's own activity (ChatGPT/terminal/edge). a bare diff reports false steals; resolving to a process showed the target never came forward. if the target WAS already foreground the check prints `SKIPPED` (yellow) instead of pretending it passed.
- **minimized windows report garbage `BoundingRectangle`** (`-31987,-31824` = iconified space). never filter candidates by screen rect while minimized — filter by size (e.g. sidebar label was `50x14` vs page header `1300x38`) or use `-Index`.
- **duplicate names are normal**: two elements named `Categories` existed (sidebar TextBlock + page header TextBlock). the script picks the first that has the pattern up its ancestry; pin with `-Index` when it matters.
- **pattern absence throws** `Unsupported Pattern.` as a `MethodInvocationException` in PowerShell (it does not return null) — every `GetCurrentPattern` must be try/catch'd; the ancestor walk depends on it.
- **UIA tree is live while the window is minimized and can't repaint** — it is the ground truth for "did the app navigate". a DWM thumbnail / screenshot may show a **stale frozen frame** of the last painted state, so verify state via `-PollPresent`/`-PollAbsent`, not via image, when minimized.
- assemblies: `Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes` (both needed for patterns + `TreeScope`/conditions).
- rejected alternatives: `PostMessage`-synthetic clicks (WinUI routes input through its own pipeline; message clicks are unreliable there) and any restore-then-click (steals focus, see `window-capture\AGENTS.md`).
- **`Scroll` action + .NET `ScrollAmount` names (added 2026-10-06)**: the .NET enum is `NoAmount, LargeDecrement, SmallDecrement, SmallIncrement, LargeIncrement` - NOT the COM `LineUp/PageDown` names (parsing those fails loudly). `First`/`Last` have no enum member, so the helper maps them to `SetScrollPercent(0|100)` (this is what you want for infinite-scroll load-more). `ScrollPattern.Scroll`'s signature is `(horizontalAmount, verticalAmount)` - horizontal FIRST, easy to swap. an axis reporting `ScrollPercent = -1` must get `-1`/`NoAmount` or the call throws. works while minimized (see verified section).
- **never count elements from `-Action List` output**: it caps at `-MaxList` (default 200) and prints `(showing first 200)` - in a wallpaper grid the children fill the budget, so only ~30 `type=ListItem` lines show no matter the real count. this fake-read as a phantom "data reset" for half a session; counts must use `-MaxList 5000` or a direct `FindAll` on `ControlType.ListItem`.
- **a MINIMIZED window can hold the foreground** (proven live 2026-10-06: `iconic=True` while `GetForegroundWindow()` = the target): an external `ShowWindow(SW_MINIMIZE)` does not transfer fg, so the helper's focus check then prints `SKIPPED` even though nothing was touched. to drop fg back to the user's window: ALT-tap (`keybd_event` VK_MENU down/up) + `SetForegroundWindow(target)` — that plain call succeeds right after the tap; if it still fails, `AttachThreadInput` to the current fg thread first (same path as `Restore-Foreground`).
- **one-off process death (2026-10-06)**: after one minimized-Scroll run the target (Aura) was gone with NO trace — no WER event, no `app.log` entry, no dump — and an identical rerun (incl. minimized Scroll) was clean. not reproduced; the original "closed by hand" guess is SUPERSEDED — manual close was disproven for this death class on 2026-10-07 (see the correction below: exit=0 main-return, only under drill load). when a target disappears with no crash record, capture the held-handle exit code first, then blame nothing.
- **a window MINIMIZED SINCE BIRTH has no scroll range**: never restored at a real size means the layout never computed, so the ScrollViewer reports `ScrollPercent=-1` / `VerticalViewSize=100` and `SetScrollPercent` cannot move anything - the helper's axis guard then passes `-1` (no-op) and still prints `action=Scroll OK`, i.e. a silently inert scroll. restore the window ONCE (`ShowWindow(9)` + `SetWindowPos` to a real size) to establish layout; the range then survives later minimize (verified: `v%=46.6` read back while minimized, jump loaded the next page).
- **network failure injection on this machine = hosts, NOT firewall**: all three firewall profiles report `enabled=False`, so `New-NetFirewallRule -Action Block` creates a perfect-looking rule (right remote IPs, `Profile Any`, `Enabled=True`, `Direction Outbound`) that filters NOTHING - always prove coverage with a control request BEFORE touching the app (a control `curl` exited 0 straight through the rule). working recipe, in try/finally: raw-backup the hosts file, append a marker comment + `127.0.0.1 <host>`, `Clear-DnsClientCache`, require the control curl to fail (instant `exit 7` connection-refused instead of a 30s timeout), run the test, then restore the exact original bytes + clear cache + require the control to pass again. caveat: an already-established keep-alive connection bypasses any DNS change - a warm pooled connection still succeeds on the first post-injection request; wait for the server to drop it (attempt a jump, expect a live load, retry after ~150s) or inject before the first connection.

## verified (2026-10-05)

round-trip on a **minimized** Aura: `List` browse → `Home` invoke (home marker appeared) → `Categories` invoke (all 19 backiee category names `Abstract…Technics` appeared) — both `focus preserved=True`, `minimized before=True after=True`, verify polls OK.

## verified (2026-10-06): steal → auto-revert, live

visible + background Aura, 5 back-to-back no-op chip invokes: **4/5 stole and
all 4 printed `focus STEAL #1 detected -> REVERTED`** (restore succeeded every
time, window never stayed up), run 5 passed clean (`preserved=True`) — the
intermittency is real. a single `restore FAILED` occurred once while an
ad-hoc ALT-tap sequence had just errored mid-tap in the same minute (cause not
proven — probably that poisoned input state, not the helper); a later re-run
of 3/3 steals reverted cleanly through the helper's own AttachThreadInput
path. setup used: `ShowWindow(SW_RESTORE)` to make the window
visible, then ALT-tap (`keybd_event` VK_MENU down/up) + `SetForegroundWindow(fg0)`
to drop focus back - a plain `SetForegroundWindow` from the background pwsh is
foreground-lock denied, the ALT tap re-arms it. test window: 860x600 at
40,700 (small, bottom-left) so any flash stays off the user's work area.

## verified (2026-10-06): Scroll action (infinite scroll, flash-free minimized)

`-AutomationId MainScrollViewer -Action Scroll -Value Last` against minimized
Aura: `action=Scroll OK`, `focus preserved=True`, **`minimized before=True
after=True`** (no un-minimize, no activation), and the app's ViewChanged
load-more fired anyway — item count 180 -> **210 while minimized** (+30 = one
server page per jump, measured with a direct `ListItem` FindAll, see the
MaxList gotcha). `SetScrollPercent` also lands at exactly `v%=100` instantly,
so `Last` is reliable for bottom-of-page triggers; `LargeIncrement` can throw
`Operation is not valid due to the current state of the object` mid-layout -
prefer `First`/`Last`.

## flyout control protocol: zero synthetic input (measured 2026-10-06, Aura/WinUI 3)

driving MenuFlyout menus (scope buttons, platform choosers) from the shell
WITHOUT ever touching the user's input: no `keybd_event`, no `mouse_event`,
no `SetCursorPos`, no ALT-tap, no restore-to-screen. validated end-to-end -
every scope/chooser pick landed, sampled foreground exposure 10-15ms per op,
final foreground = the user's window, window left minimized.

recipe, in order:

1. **minimized = the popup does not exist.** while the target is minimized,
   `flyout.ShowAt` never creates the popup window (0 new windows, 0
   `ControlType.MenuItem`) - "menu not found" while minimized is not a
   timeout, the menu cannot exist. reads/nav/scroll work minimized; flyout
   ops need step 2.
2. **offscreen-visible window**: `ShowWindow(h, 4)` (SW_SHOWNOACTIVATE) +
   `SetWindowPos(h, 0, -4000, -4000, w, h, 0x0010 -bor 0x0004)`
   (SWP_NOACTIVATE|SWP_NOZORDER) - flyouts anchor and open normally, the user
   can neither see nor click the window, the show itself steals nothing. end
   every run with `ShowWindow(h, 7)` (SW_SHOWMINNOACTIVE).
3. **open**: UIA `InvokePattern` on the anchor (e.g. `ScopeButton`), then
   poll every 5ms for `ControlType.MenuItem` descendants of RootElement
   filtered by ProcessId. do not move focus while the menu opens.
4. **pick immediately** (the user's own click elsewhere can light-dismiss the
   menu): `RadioMenuFlyoutItem` = **TogglePattern**, plain `MenuFlyoutItem` =
   **InvokePattern**; pattern lookup throws `Unsupported Pattern.` as a
   MethodInvocationException in pwsh - try/catch every `GetCurrentPattern`.
5. **revert the instant the pick lands**: `SetForegroundWindow(fg0)` (plain;
   if denied, `AttachThreadInput` to the current foreground thread + retry),
   then a 5ms-sample revert-loop until the target stays off foreground for
   300ms, teardown with step 2's `ShowWindow(h, 7)`.

measured dead ends - do not retry:

- **reverting before/during the menu kills it**: reverting within 5ms of open
  = the menu never appears; reverting once after the menu was found = it dies
  inside 300ms before the pick. WinUI light-dismiss requires the owner island
  to hold Win32 focus, so pick-then-revert is the only order that works.
- **`WS_EX_NOACTIVATE` (0x08000000) on the target does not block the
  activation** (menu open still moved foreground to the main or popup hwnd)
  and it LEAKS across runs when a probe exits before cleanup - strip it from
  every window of the process at start and end.
- **`LockSetForegroundWindow(LSFW_LOCK)` always fails from background pwsh**,
  even after `AttachThreadInput` to the foreground thread - only a process
  that could set the foreground anyway can lock. no external way exists to
  forbid the target's own activation.
- `EnableWindow(FALSE)` neither succeeded nor reduced the steal.

activation is intermittent (see the InvokePattern gotcha above); left alone
the natural holds measured 250-1200ms - long enough to eat keystrokes -
pick-then-revert bounds it to the sampled 10-15ms.

**zero-trace deaths vs window visibility**: the no-WER/no-`app.log` deaths
documented above all happened while the window was ON-SCREEN and
user-clickable; the full offscreen probe series afterwards (7 runs, same pid)
had zero deaths. keep test windows off-screen - a visible window invites a
stray click that kills the run and leaves no crash record.

**2026-10-07 correction - offscreen does NOT prevent the zero-trace death, and
menus are off-limits while the user works**:

- **offscreen flyout = visible top-left + focus steal.** step 2's parked
  position (-4000,-4000) makes the `MenuFlyout` popup itself render CLAMPED at
  the screen's TOP-LEFT corner (visible to the user) and it activates - the
  user reported "the dropdown coming in the top left of screen and stealing
  focus, i cant work like this". so while the user is at the machine the whole
  flyout recipe above is FORBIDDEN; verify MENULESS instead: only reads +
  direct-navigate single-source card invokes (no scope menu, no chooser) -
  that pass covered Global=112 cards + 9 drill-downs in ~90s with
  `popups-ever-seen=0` and 5ms max focus exposure. menus are for when the user
  is away, with the window offscreen as documented above.
- **two more zero-trace deaths happened WITH the window offscreen** (2026-10-07,
  probe11 on a 22h-old instance, probe12 525ms into the WallpaperHub drill of
  a fresh instance that had never been on-screen): no `app.log`, no WER event
  (WER events still fire for OTHER apps - checked), no System/Defender traces.
  the same-day "external WM_CLOSE / the user closed it" RESOLUTION IS
  DISPROVEN (re-checked 2026-10-07 evening): the closing handler is the
  target's only settings writer and it never ran on a death day
  (`HKCU\SOFTWARE\Aura` last-write stayed at the previous day's 20:49) - so
  no WM_CLOSE ever hit the window. the still-open picture after three
  cdb-catcher runs: deaths happen ONLY while the probe drives rapid menuless
  drills (idle targets never die, user-confirmed), all with **exit=0** and
  `main()` returning normally (`ucrtbase!common_exit` <-
  `__scrt_common_main_seh` = the message loop ended itself, not
  `Environment.Exit`, not a crash), the UIA tree goes ABSENT ~500ms before
  the process exits (window dies first), and no self-close path exists (the
  sole `Application.Current.Exit()` is the hot-reload button; invoke logs
  prove it was never invoked). one run caught the target calling
  `PostThreadMessageW` at the death moment (message value not captured).
  status: OPEN, paused. keep **`WS_EX_TOOLWINDOW` while parked** anyway
  (hides taskbar + alt-tab entry; strip on restore) so a hand-close can never
  contaminate a run, and keep the truth-first recipe: launch with
  `Start-Process <exe> -PassThru`, hold that handle, read `$proc.ExitCode`
  on death - `0` = clean main-return death, `1` = external force kill,
  **`0xC0000354` = STATUS_DEBUGGER_INACTIVE = a debugger killed the target
  (probe ARTIFACT - discard that run)**, any other negative = NTSTATUS
  crash. do not theorize before that number exists.
- **cdb catcher grammar (learned the hard way, 2026-10-07)**: every recipe
  below is required or the catcher silently lies:
  - `user32!DestroyWindow` cannot take a bp ("Couldn't resolve" - forwarder
    class, same as `kernel32!ExitProcess`) -> use `win32u!NtUserDestroyWindow`
    (rcx = hwnd). matrix-test any new bp bare before trusting it.
  - bp command strings split on `;` IGNORING the `{ }` braces: definition
    passes but runtime breaks `j cond { k; qd } { g }` into `j cond { k` +
    a stray `qd` that can make cdb quit kill-on-exit and slaughter the target
    (that is exactly how the 0xC0000354 artifact death happened). never put
    `;` inside a j-block - single commands only: `j cond { kb 20 } { g }`
    freezes the corpse with full args (msg value, hwnd), `k; g` prints the
    stack and keeps monitoring. no `qd` hooks at all.
  - wait for the `0:NNN> g` echo in the log before touching UIA (the target
    is suspended until then), and check the log for `Syntax error`/`Couldn't
    resolve` after it - arm failures must FAIL LOUD, never continue blind.
  - killing cdb kills the debuggee (measured) - teardown kills cdb first,
    then relaunches a fresh visible target.
