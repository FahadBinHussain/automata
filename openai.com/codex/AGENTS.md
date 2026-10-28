# openai.com/codex - agent notes

## thread move / workspace remap: upstream state (2026-10-23)

- the app-server now has two metadata writes that cover most of
  openai/codex#15347:
  - `thread/metadata/update` -> `projectId` (assign/clear an existing
    project; also `gitInfo`, `daybreakEnabled`). no `cwd` field.
  - `thread/settings/update` -> `cwd`, applied as a per-thread override for
    subsequent turns.
- the `cwd` from the settings update is persisted into the thread index:
  `codex-rs/thread-store/src/thread_metadata_sync.rs` handles
  `ThreadSettingsApplied` with `update.cwd = Some(settings.cwd...)`.
  so remapping a moved workspace is per-thread cwd writes, not moving the
  thread files into the workspace.
- still missing: no bulk "old root -> new root" sweep (one thread per call),
  and rollouts keep the old cwd in `session_meta` / `turn_context`, so an
  index-only remap can be re-derived back unless the new cwd is recorded as
  a settings event.
- our 2026-05-13 fork commit
  (`FahadBinHussain/codex@2770047`, `cwd` in `thread/metadata/update`) is
  superseded by the settings-update path; it was never PR'd.
- `Move-CodexThread.ps1` here is the offline equivalent: rewrites
  `state_5.sqlite` thread `cwd`, rollout `session_meta`/`turn_context`, and
  `.codex-global-state.json`. it has no bulk mode yet - `-FromRoot`/`-ToRoot`
  would be the natural addition.
- 2026-10-23 comment on #15347:
  https://github.com/openai/codex/issues/15347#issuecomment-6363961552

## app update (Update-ChatGPTApp.ps1)

- reads update manifest at `https://persistent.oaistatic.com/codex-app-prod/windows-store-update.json`.
- gotcha: `$latest -le $pkg.Version` performed string comparison, so `"26.1021.3705.0" -le "26.924.2738.0"` returned `True` (char `'1'` < `'9'`) and falsely claimed the app was up to date. Must cast to `[System.Version]`.
- **the MSIX package identity is `OpenAI.Codex`, but the app is ChatGPT** (verified 2026-10-27 on 26.1021.3705.0). never infer the app name from the package family: `AppxManifest.xml` says
  `Properties.DisplayName = ChatGPT`, `PublisherDisplayName = OpenAI`, `Applications.Application.Executable = app/ChatGPT.exe`,
  `VisualElements.DisplayName = ChatGPT`, and `Get-StartApps` lists `ChatGPT -> OpenAI.Codex_2p2nqsd0c76g0!App`.
  so an `AI Tools\ChatGPT.lnk` whose arguments are `shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App` is CORRECT - a "that's Codex, not ChatGPT" verdict is wrong.
  OpenAI reuses the Codex package family for the ChatGPT desktop build; the only visible Codex leftovers are the package name and the secondary
  `CodexCoreCommandRunner` app entry (`app/resources/codex-command-runner.exe`).

