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

## notes / gotchas

- `pwsh.exe` fails to launch via `Start-Process -Credential` ("access denied"), but
  `cmd.exe` works - so the inner command goes through `cmd.exe /c`.
- acrobat's `Acrobat.exe /t file.pdf Printer` crashes (0xC0000005) when run under a
  non-interactive/hidden `Start-Process -Credential` context; text prints via
  `powershell.exe ... Out-Printer` work fine. for pdf files, either print from the
  interactive id session, or render the pdf to pcl/printable content first.
- secedit /configure is broken on this machine (always prints usage), so do NOT rely
  on granting "log on as a batch job"; the `Start-Process -Credential` route works
  without it.
- only test jobs were sent during bring-up (multiple `P`/pjl-patched direct-lpr
  attempts that were NOT attributed). see AGENTS.md in the automata root for repo
  conventions.
