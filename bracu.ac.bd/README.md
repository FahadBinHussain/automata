# BRAC campus printer (SafeQ / UPMS) printing as a student-id account

purpose: print a local file (pdf/text) to the campus SafeQ `secure` queue so it shows
up under a student's id at the printer, WITHOUT switching the interactive windows
login to that account. SafeQ attributes jobs to the windows session that submits
them, not to the lpr control-file `P` field, so the job must be submitted from a
process running as a local account whose name is the student id.

## how it works

- a local windows account named like the student id (e.g. `23101376`) exists on the
  machine, with a known password (created once by `safeq-account-setup.ps1`).
- `safeq-print.ps1` runs elevated (UAC), then launches a hidden `cmd.exe` as that
  account (`Start-Process -Credential`), which runs the print through the normal
  windows spooler -> Campus.Printer -> LPR -> SafeQ. SafeQ then matches the job to
  the student id; releasing at the printer is done by scanning the id badge there.

## prerequisites

- printer `Campus.Printer` (HP Universal PCL 6) on LPR port to the SafeQ server
  (172.16.0.111:515, queue `secure`).
- the id-named local account exists (run `safeq-account-setup.ps1` once, elevated).
- direct lpr sends (custom client) do NOT get attributed - SafeQ ignores the lpr
  `P`/pjl `Username:` fields for attribution, so don't go down that path.

## usage

powershell -ExecutionPolicy Bypass -File safeq-print.ps1 -File "C:\path\doc.pdf" -Copies 20

copies are printed as separate jobs (one per copy) so each can be released at the
printer.

## files

- `safeq-print.ps1` - main print script (needs elevation; relaunches itself elevated).
- `safeq-account-setup.ps1` - one-time account creation for the student id.
- `.env.local` - personal values (student id, password, printer/server), gitignored.
- `.env.example` - placeholder template for `.env.local`.

## account password policy

this machine enforces **minimum password length 8** (`net accounts`). the
student-id local account password must be 8+ chars or `New-LocalUser` throws
`InvalidPasswordException` (e.g. a 7-char password fails). always verify
length before creating the account; ask the user for a compliant password
instead of inventing one.

## staging dir

the file to print AND `SumatraPDF.exe` must be readable by the student account,
so stage both under `C:\Users\Public\SafeQPrint\` (BUILTIN\Users RX granted).
files under the admin's own profile (Downloads, scoop apps) are NOT readable
from the `Start-Process -Credential` context. same for WRITES: the inner
processes cannot write logs to the admin's TEMP, so the script pre-creates
the inner log file and grants `BUILTIN\Users` write access to it.

## notes / gotchas

- `pwsh.exe` fails to launch via `Start-Process -Credential` ("access denied"), but
  `cmd.exe` works - so the inner command goes through `cmd.exe /c`.
- acrobat's `Acrobat.exe /t file.pdf Printer` crashes (0xC0000005) when run under a
  non-interactive/hidden `Start-Process -Credential` context; pdfs print via
  portable `SumatraPDF.exe -print-to ... -silent -exit-on-print` staged in the
  shared dir above (scoop `sumatrapdf`, exe copied out since the student account
  cannot read the admin's scoop folder). text files print via
  `powershell.exe ... Out-Printer`; never pipe a pdf through Out-Printer (it
  sends raw bytes as text = garbage pages).
- copies-squared bug (fixed): the old script looped `$Copies` times in the outer
  loop AND `$Copies` times inside the inner command = Copies^2 jobs. the inner
  command now prints exactly once; the outer loop owns the repeat count.
- secedit /configure is broken on this machine (always prints usage), so do NOT rely
  on granting "log on as a batch job"; the `Start-Process -Credential` route works
  without it.
- only test jobs were sent during bring-up (multiple `P`/pjl-patched direct-lpr
  attempts that were NOT attributed). see AGENTS.md in the automata root for repo
  conventions.
