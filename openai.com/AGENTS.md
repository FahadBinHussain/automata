# openai.com — agent-rules-sync (AGENTS.md propagator)

`agent-rules-sync.ps1` — logon task **`AgentsMdSync`**, a file watcher that copies
`~/AGENTS.md` into each tool's global rules path:

| # | target | mode |
|---|---|---|
| 1 | `~/.cursor/rules/user-preferences.mdc` (Cursor Home, Glass mode) | copy + yaml frontmatter |
| 2 | Cursor `state.vscdb` → `aicontext.personalContext` (Settings > Rules) | sqlite |
| 3 | `~/.kiro/steering/AGENTS.md` | copy |
| 4 | `~/.kilocode/rules/AGENTS.md` | symlink/copy |
| 5 | `~/.kiro/skills` → `~/.agents/skills` | junction |
| 6 | `~/.minimax/skills` → `~/.agents/skills` | junction |
| 7 | `~/Documents/Cline/Rules/AGENTS.md` | copy |
| 8 | `~/.gemini/AGENTS.md` (Antigravity v1.20.3+) | copy |
| 9 | ~~`~/.workbuddy/AGENTS.md` + `~/.workbuddy-ai/AGENTS.md`~~ — **dropped 2026-10-27**, never read | — |
| 10 | `~/.grok/rules/AGENTS.md` | plain copy, **no yaml header** (grok loads every `*.md` in that dir as-is) |
| 11 | Cue by Manus (`1cue`, `1blindspot`, `1opencode`, `1koodo-reader`, `1mainframe`) | Connect-RPC API (`POST https://api.manus.im/agents.v1.AgentsService/UpdateAgent` using `~/.cue/token`) |
| 12 | `~/.adcode/AGENTS.md` + `~/.adcode/skills` → `~/.agents/skills` | plain copy + junction |
| 13 | `~/.minimax/AGENTS.md` | plain copy, **32 KB ceiling** (`GLOBAL_INSTRUCTIONS_MAX_BYTES = 32768` in `app.asar`, silently dropped if exceeded) |
| 14 | `~/.qoder/rules/AGENTS.md` + `~/.qoder/skills` → `~/.agents/skills` | plain copy + junction (precedence 10 user rule in Qoder harness) |
| 15 | `~/.zcode/AGENTS.md` + `~/.zcode/skills` → `~/.agents/skills` | plain copy, **100 KB max** (injected under `# agentsMd` as user default instructions) + junction |

## provenance

lives in `openai.com\` because OpenAI invented AGENTS.md (Aug 2025, Codex) — the
standard this script propagates. path history: mainframe repo → `tools\agents-sync\`
(stale 6-target copy) → `agent-rules-sync\` (top level, 2026-10-02) → here. moved
2026-10-02 as part of the mainframe → automata merge: mainframe's copy was deleted
(`4975ed9`), the task repointed to this path, and mainframe's 10-target version
replaced the stale copy. mainframe\AGENTS.md still carries the behavior notes
(skills-nesting guard section).

runtime artifacts written next to the script (never commit): `last-sync-content.txt`
(dump of `~/AGENTS.md`), `agent-rules-sync.log` — both gitignored.

## gotchas

* **after editing the script, restart the task** — the running watcher holds it in
  memory, so a new target stays dark until the next logon otherwise:
  `Restart-ScheduledTask -TaskName AgentsMdSync`
* **target #8 writes `~/.gemini/AGENTS.md` ONLY (2026-10-15)** — it used to write
  `GEMINI.md` too, and antigravity loads both files when both exist: the same
  `user_global` rule showed twice and the pair cost 5004 x2 tokens of the 20000
  rules budget (measured in antigravity's Rules + Customizations panels). do not
  re-add GEMINI.md; the removed copy is at
  `C:\tmp\gemini-GEMINI.md.bak-20261015-duplicate-removal`.
* **Cue by Manus sync**: Cue agents execute in Manus cloud, so instructions must be pushed
  via Connect-RPC to `api.manus.im`. The session token lives in `~/.cue/token` (1-year lifetime,
  extracted from Cue's Chromium cookie jar).
* **WorkBuddy AI has no global AGENTS.md slot (verified 2026-10-27)** — the shipped
  runtime reads guidance only as `join(cwd, f)` over
  `['CODEBUDDY.md', '.codebuddy/CODEBUDDY.md', 'AGENTS.md']` (`app.asar`,
  `readProjectGuidance`), and `cli/dist/codebuddy-lite-wb.mjs` contains **0** occurrences
  of `.workbuddy-ai`. so target #9 was writing two files nothing loads, while the verify
  block still printed `[OK] WorkBuddy-AI synced`. target removed; WorkBuddy now gets the
  rules via `personalization.customPrompt` in `~/.workbuddy-ai/app/app-config.json`,
  pointing at `C:\Users\Admin\AGENTS.md` (absolute path — the old `"always read global
  agent.md"` was ambiguous and resolved to whichever copy an agent picked). leftover inert
  files `~/.workbuddy/AGENTS.md` and `~/.workbuddy-ai/AGENTS.md` are safe to delete.
  caveat: the app may rewrite `app-config.json` from memory on exit — if the prompt
  reverts, set it in Settings > Personalization > Custom Instructions instead.
* **MiniMax Code global AGENTS.md (added 2026-10-27)** — reverse-engineered from
  `app.asar`: MiniMax Code resolves global instructions from `join(dataDir, 'AGENTS.md')`
  (`~/.minimax/AGENTS.md`). Enforces `GLOBAL_INSTRUCTIONS_MAX_BYTES = 32 * 1024` (32,768 bytes).
  If the file exceeds 32 KB, `stat.size > 32768` triggers an early return of `undefined`/empty string,
  silently ignoring all instructions without warning. The sync script guards this and fails loudly if
  `~/AGENTS.md` exceeds 32,768 bytes. Note: custom persona templates live in
  `~/.minimax/agents/<name>/agent.md` (Handlebars + YAML frontmatter), whereas general global
  instructions belong in `~/.minimax/AGENTS.md`. Workspace instructions are read from
  `<workspace>/AGENTS.md` (or legacy `CLAUDE.md`, also 32 KB max). Details in `minimax.io/AGENTS.md`.
* **Qoder global rules & skills (added 2026-10-27)** — reverse-engineered from
  `~/.qoder/plugins/cache/qoder-bundler/better-harness/scripts/agent-customize/` and
  `agent-lint/host-instructions.mjs`. Qoder's instruction loader scans `~/.qoder/rules/`
  recursively up to depth 4 for `*.md`, `*.mdc`, and `*.markdown` files as user-level rules
  (`precedence: 10`). Project instructions are read from `<workspace>/.qoder/rules/*.md`
  (`precedence: 20`) and `<workspace>/AGENTS.md` (`precedence: 30`). No 32 KB ceiling is enforced.
  Skills are resolved natively from `~/.agents/skills` and `~/.qoder/skills` (junction created to
  unify). Verified live via `better-harness/scripts/agent-customize/cli.mjs --provider qoder --json`.
  Details in `qoder.com/AGENTS.md`.
* **ZCode global AGENTS.md & skills (added 2026-10-28)** — reverse-engineered from
  `resources/glm/zcode.cjs` and the bundled `zcode-guide-plugin`. ZCode resolves user
  instructions from `~/.zcode/AGENTS.md` and workspace instructions from `<workspace>/AGENTS.md`
  via `NodeContextSourceAdapter`. When both exist, it injects `~/.zcode/AGENTS.md` first as
  `Contents of ... (user default instructions)` under `# agentsMd`, followed by workspace
  instructions (`workspace instructions`). Enforces `maxBytes = 100 * 1024` (100 KB); if
  exceeded, it truncates the file with a `[File truncated: AGENTS.md]` note rather than dropping
  it. Skills are scanned across `~/.zcode/skills`, `~/.agents/skills`, `<workspace>/.zcode/skills`,
  and `<workspace>/.agents/skills`. Junction `~/.zcode/skills → ~/.agents/skills` unifies all
  skills. Details in `zcode.ai/AGENTS.md`.
* **watcher misses atomic saves (fixed 2026-10-27)** — `NotifyFilter` was `LastWrite`
  only. editors that save via temp-file + rename fire `Renamed` on the *temp* name, which
  a `FileSystemWatcher` filtered on `AGENTS.md` never matches. the 2026-10-26 20:07 rewrite
  of `~/AGENTS.md` was dropped this way and the copies sat 2h21m stale — that is exactly
  where the rule-15 (vision) drift between `~/AGENTS.md` and the old
  `~/.workbuddy-ai/AGENTS.md` came from. fixed with `-bor Created -bor Renamed` plus a 5s
  SHA256 poll that calls the same `Sync-Rule` (not a second engine) and prints a loud line
  when it catches a save the event handler missed.
* **self-healing skills-nesting guard** (runs at every logon): if
  `~\.agents\skills\skills\skills` exists (depth ≥ 2) the nested chain is a copy
  artifact and is deleted, keeping only the top-level tree. per-skill sparse-checkout
  `skills\<name>\` subdirs are legitimate git content and are **not** touched.
* `last-sync-content.txt` next to the script is the watcher's dump of `~/AGENTS.md`
  (personal rules) — gitignored here and in mainframe. never commit it.

## usage

```powershell
pwsh openai.com\agent-rules-sync.ps1     # watcher (normally only via the task)
Restart-ScheduledTask -TaskName AgentsMdSync   # reload after an edit
```
