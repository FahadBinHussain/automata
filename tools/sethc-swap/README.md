# sethc-swap

Swap the lock-screen sticky-keys binary with cmd.exe (classic recovery /
convenience trick). After applying, pressing Shift 5 times (or Win+5 x5) at
the Windows login screen opens an elevated cmd instead of the accessibility
dialog.

## run (as admin, on the target PC)

apply:

    pwsh -File sethc-swap.ps1

revert:

    pwsh -File sethc-swap.ps1 -Undo

## notes

- needs elevation (files are TrustedInstaller-owned; the script takes
  ownership automatically)
- original binary is saved as `sethc-old.exe` next to the swapped one
- `-Binary utilman` swaps utilman.exe (Win+U) instead of sethc
- a Windows feature update may restore the original binary; re-run after
