# violentmonkey.github.io — userscript injection without the browser UI

`inject.ps1` pushes a userscript update straight into Violentmonkey's
chrome.storage.local LevelDB (backup -> close Edge -> write -> verify ->
optional reopen); `leveldb.mjs` is the node helper it spawns
(`list`/`find`/`inject`; classic-level auto-installed to
`%TEMP%\opencode\vm-edit\node_modules` on first run). built 2026-08-24 to
ship the neon watch-progress tracker 0.7.7 fix without clicking through the
options page. moved from `tools\violentmonkey\` 2026-10-08 (renamed
`violentmonkey-inject.ps1` -> `inject.ps1`, `vm-leveldb.mjs` -> `leveldb.mjs`).

## run

    pwsh .\inject.ps1 -ScriptPath "C:\...\script.user.js" -CloseBrowser -Reopen
    pwsh .\inject.ps1 -List

full parameter docs live in the `inject.ps1` header.

## gotchas

- extension id `eeagobfjdenkkddmbclomhiblgggliao` = Violentmonkey 2.x (Edge);
  storage dir = `Local Extension Settings\<id>` under the Edge profile
  (`-DbPath` overrides detection).
- Edge MUST be closed while writing (LevelDB is locked while it runs, and
  Edge rewrites the db on exit) — `-CloseBrowser` closes it, `-SkipClose`
  errors if it's running instead.
- scripts are stored JSON-encoded (`code:<id>`); writing raw text breaks the
  options page — it hangs forever. `val:<id>` (GM_* values) is never touched.
- every write takes a full backup first (`%TEMP%\opencode\vm-backups`) and
  ends with a verify round-trip; non-zero exit on any failure.
- the browser-UI route (options-editor URL + Save-button poll) and the
  Edge-install extension-id discovery recipe live in `youtube.com\AGENTS.md`.
