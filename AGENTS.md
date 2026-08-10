# automata folder conventions

this directory holds reusable local automation scripts, keyed by the service/site they automate.

## folder naming rule

every subfolder name MUST be a URL-style hostname (domain) of the service it targets, for example:

- `youtube.com`
- `whatsapp.com`
- `google.com`
- `marketplace.visualstudio.com`
- `wall.alphacoders.com`
- `files.vc`

rules:
- use the bare domain/hostname only, lowercase, no scheme, no path, no trailing slash
- multi-label hosts keep their subdomains (e.g. `marketplace.visualstudio.com`, not `visualstudio.com`)
- if a service has no clear web hostname, use its canonical public domain when one exists (e.g. `bitwarden.com`), otherwise ask before creating a non-URL folder name
- generic/non-host folders such as `tools` are allowed only for cross-service shared helpers, and must be clearly named as such; do not add site-specific automation under `tools`

## what goes in here
- one-off and reusable browser/admin/API automation scripts
- each script should have a short header comment or companion README with purpose, inputs, and run command
- never commit secrets, cookies, tokens, browser profiles, private screenshots, or downloaded chat media
- put throwaway scratch files in `C:\tmp`, not here

## current non-conforming folders (as of 2026-07-16)
- `bitwarden` -> should be `bitwarden.com`
- `murmur` -> no public hostname (private app); keep as-is until a canonical domain is decided
- `theoldllm` -> should be the service's domain once confirmed
- `tools` -> allowed as cross-service shared helpers (see rule above)

When the project is a single-file userscript, always copy the complete userscript to the clipboard after every update.

## youtube neon sync userscript gotchas (youtube.com/youtube.com-watch-progress-tracker-with-neon-cloud-sync)

- flush() must never abort the loop on the first failing row - one persistently failing row (rate limit, bad content) starved every row behind it forever. each row gets its own attempt per pass; only failing rows stay in the dirty queue.
- never sweep the whole cache into the dirty set at sync time - a 200-row re-upload every 5s of watching trips neon's rate limit and causes the failures above. only actual dirty rows get pushed.
- pagehide/beforeunload must record(true) AND flush() - the debounced push never fires when the tab dies, so the final position is lost until the next visit.
- sync status lives in the floating panel + console (autoSync logs reason); connection string is a Neon role scoped to `watch_progress` only, never the owner role.

## steam shortcuts vdf gotchas (steampowered.com/steam-shortcuts.ps1)

- the whole `shortcuts.vdf` file IS a single set named `shortcuts` (`0x00 shortcuts 0x00 <entries> 0x08`) - there is NO outer wrapper set, so a reader must consume the root header directly; parsing it as a nested set makes the code expect a phantom 4th `0x08` and read past EOF (`$bytes[i]` returns null past the end, then `.ToString()` throws "cannot call a method on a null-valued expression").
- entry keys are `0x00 <index> 0x00` sets; fields are `0x01` (string: key, nul, value, nul) and `0x02` (int: key, nul, 4 bytes); `0x08` closes a set.
- some third-party writers emit a stray trailing `0x08`; tolerate EOF in the set loop (break when `Pos -ge Length`) so both formats parse.
- PowerShell `[ordered]@{}` (OrderedDictionary) has `.Contains()`, NOT `.ContainsKey()` - any `.ContainsKey()` call on parsed entries throws "method invocation failed".
- round-trip invariant: parse -> write with unchanged entries must be byte-identical; verify by comparing bytes before/after an add-then-remove on a temp copy.
- steam must be closed while writing, or it overwrites the file on exit; the script backs up to `shortcuts.vdf.bak-<timestamp>` before every write.
- WRITER MUST MATCH STEAM'S BYTES EXACTLY (nightly client 20260706+): a structurally-off file makes `LoadShortcuts` fail at every boot (`usershortcuts.cpp (131) : CSteamDoc::LoadShortcuts: failed to load shortcut file` in `logs\console_log.txt`) and Steam then renames `shortcuts.vdf` to `logs\shortcuts.previous.txt` (quarantine, rename preserves LastWriteTime). symptoms looked like an "external eater" - it's just Steam quarantining on parse failure. exact rules learned from diffing against a Steam-UI-written file: (1) the file must end with FOUR `0x08` closers after `tags 00` (`tags 00 08 08 08 08`) - three is rejected; (2) `StartDir` is written UNQUOTED and WITH trailing backslash (`C:\...\Win64\`), while `Exe` IS quoted; (3) appid = uint32 with high bit set (`0x80000000 | random31`) - small/negative ids get "Unknown GameID type" on rungameid URLs. verify any writer change with the round-trip test above against a UI-written file. note: `steam://rungameid/<id>` URLs don't work for shortcuts in this client ("Unknown GameID type" from steamid.cpp even with the correct id) - launch from the library UI instead; UI adds get appid 0 and Steam sanitizes (`sanitize shortcut app id ... replacing 0 with <id>`) which works fine.
