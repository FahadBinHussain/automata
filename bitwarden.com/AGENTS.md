# bitwarden.com

vault CLI helpers (unlock/login/session) + unattended passkey approval.
vault session gotchas live in the REPO ROOT AGENTS.md ("bitwarden.com unlock
gotchas" section) - this file only adds what is not there.

## passkey-approve.ps1 (added 2026-10-10)

drives the two OS windows that appear when a browser passkey login is
intercepted by the Bitwarden extension. the site-specific parts (triggering
the ceremony - e.g. browser-use clicking "try again" on a 2FA page - and
verifying the page moved) stay with the CALLER; this script only does the
window clicks.

    # trigger the ceremony in the browser first, then:
    .\passkey-approve.ps1 -TimeoutSec 30

flow it automates, measured live 2026-10-10 on a cloudflare 2FA login:

1. bitwarden extension popup, window title exactly `Bitwarden` (~480x570):
   "Log in with passkey?" chooser with one passkey card. click the card at
   **53% x / 37.5% y** of the window rect (vision-measured center; a blind
   36% x guess landed near the icon and looked like it worked but the
   ceremony silently died - always use the measured center).
2. the card click makes **windows security** pop its passkey dialog
   (heading: "Choose a passkey" as of 2026-10-14, was "Choose where to save
   your passkey" on 2026-10-10; controls are the same: iPhone/iPad/Android
   device | Security key | Cancel). this
   dialog HIJACKS the ceremony - if it is not canceled, the login silently
   resets to "try again". the script vision-confirms the dialog really is
   that one (never trusts the title alone), then clicks Cancel at
   **75% x / 85.5% y**. any OTHER windows security dialog = loud exit with
   the capture path, never clicked blindly.
3. after the cancel the passkey ceremony completes on its own (bitwarden
   asserts, page logs in). exit 0 = card clicked + hijack canceled.

the extension popup auto-dismisses after ~1-2 min idle; a stale popup whose
click "did nothing" is usually this hijack, not a missed click.

### vision gate engine: `opencode2 run --standalone` (raw zengate HTTP is DEAD)

the gate no longer uses raw HTTP. since **2026-10-14** the zen free-tier gate
accepts ONLY the real client's FULL main-agent body (registered system-prompt
prefix + a tools array); the byte-exact title-prompt body that used to work now
403s `FreeTierError` on **every** shape - the official prompt with its sha
guard, real captured headers, HTTP/2, even `opencode2 run --agent title`. that
403 text blames your headers while the BODY rule is what broke, so do not go
chasing User-Agent/session-id/header shapes again. full bisect + evidence:
`opencode.ai\AGENTS.md`, section "gate change 2026-10-14".

`Invoke-ZenVision` therefore shells out to the real client and ANNOUNCES it on
first use (loud second engine, never a silent fallback):

    opencode2 run --standalone -m opencode/mimo-v2.6-flash-free -f <png> "<question>"

measured **7-9s** per call on this box (docs say up to ~90s), exit 0, correct
verbatim text. gotchas encoded in the function:

- **the question must be ONE argv element.** `Start-Process -ArgumentList`
  joins the array with bare spaces, so a sentence with spaces gets split into
  many positionals - pre-wrap it in quotes (`'"' + $askText + '"'`).
- **the scoop shim's `WaitForExit(ms)` does wait for the real process**, and the
  answer goes to the redirected stdout file (the `> build <model>` banner goes
  to stderr) - so stdout is parseable directly.
- **strip ANSI before matching**: the CLI paints its answer with colour codes,
  which broke `-match 'cancel'`. drop the `> build ...` banner line too.
- a preflight `Get-Command opencode2` is the only engine check; there is NO
  fallback engine, so a missing shim is a loud die before any window is touched.

### the passkey dialog's HEADING changed - never match on one heading string

2026-10-10 the windows-security hijack read **"Choose where to save your
passkey"**; 2026-10-14 the same dialog reads **"Choose a passkey"** (same three
controls: `iPhone, iPad, or Android device` | `Security key` | `Cancel`). the
gate now matches on what makes it THIS dialog - `passkey` AND `cancel` AND one
of `save your passkey|iphone|ipad|android|security key` - so a Microsoft
wording change fails LOUDLY ("unexpected Windows Security dialog - NOT
clicking") instead of silently never matching and timing out.

### clicks are foreground-VERIFIED, and the card click is PROVEN to have landed

- **a real `mouse_event` lands on whatever window OWNS the foreground**, not on
  the hwnd you targeted. if `SetForegroundWindow` is refused (Windows
  foreground-lock - the user is typing), the click goes into the USER'S app
  while the log still says "clicked": a silent wrong-target click and a mystery
  timeout. `Click-At` now retries the foreground 5x over ~1.75s and then DIES
  naming both hwnds instead of clicking blind. measured live 2026-10-14: while
  the user was working, foreground stayed on their window and the check refused
  every time.
- the driver retries that refusal as a TRANSIENT arm (up to the fido cap), each
  retry logged loudly - same method, not a second method.
- **the card click is then proven**: capture the popup before and after and
  pixel-diff them (`Get-DiffPct`, every 3rd pixel, >24 per channel). the run
  must see the chooser close, the windows-security dialog appear, or the chooser
  change visibly - otherwise it dies with both capture paths. this exists
  because 2026-10-14 a run logged "clicked passkey card" and then timed out at
  60s while a capture showed the chooser sitting there untouched.
- `AttachThreadInput` to the foreground thread does NOT defeat the foreground
  lock here, and `PostMessage(WM_CLOSE)` / `WM_COMMAND IDCANCEL` are ignored by
  the secure dialog. **`PostMessage(WM_KEYDOWN, VK_ESCAPE)` closes it** with no
  focus stolen - that is the right cleanup for an orphaned hijack dialog left
  behind by a failed run (never do it while an approver is live, it would cancel
  a real ceremony mid-flight).

### window gotchas

- the bitwarden popup is an EXTENSION popup window: it never shows up in
  CDP targets (`list_tabs()`), so browser-use cannot see or click it - find
  it via EnumWindows title match (`bitwarden`, case-insensitive) and click
  with SetCursorPos + mouse_event.
- it is NOT the bitwarden desktop app (no `Bitwarden` process needed -
  extension-only box).
- the popup times out/closes on its own; if the script reports "never
  appeared", re-trigger the ceremony and rerun (rerun is always safe -
  every hwnd is clicked at most once).
- window-capture + PrintWindow works on both windows while occluded; use
  `-Hwnd` (hex string) since the popup shares the msedge process.

## repo-local secret files: making a local project delete-safe (recipe, 2026-10-16)

the situation: a folder exists only on this box (no git), holds a key or local-only
config, and the question is "can i delete it?". delete-safe = a private repo holding
everything committable + every gitignored secret in the vault + a PROVEN restore +
nothing else unique on disk. precedents: notion_manager (2026-10-09, 6/6 files) and
dailybnp-ocr (2026-10-16, folder deleted after the proof).

1. sanitize before the first commit: hardcoded keys move OUT of tracked launchers
   into the gitignored local file (`start.bat` calls `start.local.bat`, which sets
   `AI_OCR_API_KEY`; keep base urls/model names in the tracked file). `.gitignore`
   covers `.venv/`, `__pycache__/`, `node_modules/`, the local secret file, `.env*`.
2. private repo + push: `gh repo create <owner>/<repo> --private --source . --push`
   (git author `<user@example.com>`, human lowercase commit message).
3. vault every gitignored local-only file as a GENERIC repo-file item:
   - name `github.com/<owner>/<repo> / <repo-relative path>` (exact owner case)
   - type-1 login item, empty login, one HIDDEN (type 1) field per file:
     `{name: '<relpath>', type: 1, value: base64(raw file bytes)}` - the field name
     must contain `.`/`/`/`\` or env-sync falls back to the item-name relpath
   - notes: `"<repo> local-only file (gitignored). base64 payload in the field named
     by its repo-relative path. restore: automata-private\bitwarden.com\env-sync.ps1
     -Repo <clone-folder>"`
   - create exactly like vault-secret's New-VaultItem:
     `$newItem | ConvertTo-Json -Depth 12 | bw encode | bw create item --session $env:BW_SESSION`
4. prove the restore BEFORE deleting anything: rename the file to `.bak`, run
   `bitwarden.com\env-sync.ps1 -Repo <clone-folder>`, SHA256-compare restored vs
   `.bak`, remove `.bak` only on a match (mismatch: put `.bak` back, loud).
   `-Repo` matches the CLONE FOLDER name (or exact slug) and repos are discovered by
   their git remote, so the clone must exist on disk.
5. delete sweep: `git status --porcelain` empty; `git rev-parse HEAD` ==
   `git ls-remote origin refs/heads/main`; `git status --ignored --porcelain` lists
   ONLY recreatable things (`.venv`, caches) and vaulted files; no running process /
   scheduled task references the folder path; then `cmd /c rd /s /q <folder>` and
   assert `Test-Path` false.
6. document the vault item + restore line in the new repo's `AGENTS.md`, and add the
   precedent to the root AGENTS "delete-ready" registry (next to notion_manager).

gotchas: bare `bw status` always says "locked" even with a valid stored session - set
`$env:BW_SESSION` from `%APPDATA%\mainframe\accounts\bitwarden\session.key` and check
again (only run unlock.ps1 if that still says locked). inspecting items: print
name/type/length only, never field values. never commit real keys even to a private
repo - sanitize first (a future flip to public must not leak).

## agent & ground-truth thread model provenance (added 2026-10-27)

When vault unlock or approval is triggered (`mainframe\vault-secret.psm1`, `vault-approval.psm1`, `linux_real.py`), the request passes caller identity (`agent`, `model`, `host`, `ctx`) and a 2-digit verification code (`code`) to terminal banners, ntfy push notifications, and `docs/vault-tab.html`.

**Never ask the agent model to supply its own name**: LLMs frequently hallucinate or misreport their model version (e.g. guessing `gemini-2.5-pro` when running on `Gemini 3.8 Flash (High)`).
- **Antigravity thread model**: Runners inspect the ground-truth conversation transcript on disk using `$env:ANTIGRAVITY_CONVERSATION_ID` and `$env:ANTIGRAVITY_APP_DATA_DIR` (`<appDataDir>\brain\<convoId>\.system_generated\logs\transcript.jsonl`). It parses `<USER_SETTINGS_CHANGE>` regex `Model Selection.*?from\s+.*?\s+to\s+(.+?)\.\s+No need`, checking the tail first for mid-thread switches and falling back to initial step 0. This reliably returns the exact active model (e.g. `Gemini 3.8 Flash (High)`) without prompt hallucination.
- **OpenCode / Claude Code / Codex / Aider**: Runners inspect harness-level environment variables (`$env:OPENCODE_MODEL`, `$env:ANTHROPIC_MODEL`, `$env:CODEX_MODEL`, `$env:AIDER_MODEL`) or parent process ancestry, defaulting to `terminal` for interactive human shells.
- **Mobile approval card (`docs/vault-tab.html`)**: Renders animated tags (Rule 10) for host (`💻`), agent (`🤖`), model (`🧠`), and action (`⚡`), updating header badges and descriptions so users verify caller identity before biometric authorization.
