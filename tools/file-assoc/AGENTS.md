# file-assoc tools (set default apps per file type)

`set-file-assoc.ps1` - classic UserChoice hash writer (validated against PS-SFTA 1.2.0 + Mozilla
WindowsUserChoice.cpp). works when the UserChoice key is not UCPD-protected (no existing
UserChoice, or UCPD not present). supports `-Mpv` preset, `-VerifyOnly`, toast silencing.

`ucpd-bypass.ps1` - for Win11 24H2/25H2 where UCPD.sys blocks writes. verified working
2026-08-19 on 25H2 build 26200, UCPD 4.5.0.626647.

## UCPD protection (the blocker)

- driver `C:\Windows\System32\drivers\UCPD.sys` (service UCPD, FSFilter, auto-start,
  not stoppable at runtime). re-enable task: `\Microsoft\Windows\AppxDeploymentClient\UCPD
  velocity` (disable it if you ever disable the service).
- blocks UserChoice writes from a deny-list of exe names: dllhost, reg, rundll32,
  powershell, regedit, wscript, cscript, cmd, InfDefaultInstall, pwsh, WmiPrvSE.
- protected keys carry a Deny-SetValue ACE for the owning user only (SYSTEM/Admins
  have FullControl Allow). that ACE + the deny-list = two independent layers.
- published bypasses (mshta, regini, WMI, RegRenameKey) are patched in v4.5; no reboot-
  free third-party tool does it. UI Settings click also works but is not scriptable here.

## the bypass (no reboot, no driver changes)

1. copy the current pwsh install to `%TEMP%\ucpd-bypass\ps7` and rename `pwsh.exe`
   to `pwsh2.exe` - Microsoft-signed binary whose name is not on the deny-list.
2. stage a self-contained worker script that writes hashed UserChoice keys under
   `HKEY_USERS\<sid>\Software\...\FileExts\<ext>\UserChoice` (delete key, write Hash,
   write ProgId, retry if minute boundary crossed - same order as set-file-assoc.ps1).
3. run the worker via a scheduled task as SYSTEM (New-ScheduledTaskPrincipal -UserId
   'SYSTEM' -LogonType ServiceAccount -RunLevel Highest) - SYSTEM is not covered by
   the user Deny-SetValue ACE.
4. verify stored hash == recomputed hash from key last-write-time; cleanup task + temp.

## gotchas (learned the hard way)

- a `[string]` type constraint on a param() variable PERSISTS for the whole script:
  `$Exts = @('a','b')` after `param([string]$Exts)` silently coerces to the
  space-joined string "a b". use untyped params (or no params) in worker scripts.
- pwsh `-File` passes args as single tokens: `-Exts a b c` binds only `a` to a
  [string[]] named param. embed the extension list as a literal inside the worker.
- worker writes to HKEY_USERS\<sid> (SYSTEM's HKCU is its own hive, not the user's).
- user context must be elevated? no - the bypass itself needs no admin; the
  scheduled task creation does (RunLevel Highest + SYSTEM principal).
- after writing, silence toasts under
  `HKCU\Software\Microsoft\Windows\CurrentVersion\ApplicationAssociationToasts`
  as `<progid>_<ext>` = 0 (DWORD).
- verify with `set-file-assoc.ps1 -Mpv -VerifyOnly` (recomputes from live last-write-time).

## usage

    pwsh .\ucpd-bypass.ps1 -Mpv                 # mpv for the 49-ext video list (SYSTEM task)
    pwsh .\set-file-assoc.ps1 -Mpv -VerifyOnly  # check current state
    pwsh .\set-file-assoc.ps1 -Mpv              # direct write (no UCPD / unprotected exts)