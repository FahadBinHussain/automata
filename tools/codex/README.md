# Codex thread mover

Move a local Codex Desktop conversation/thread into a project by updating the local Codex state that the Desktop app uses to group conversations.

This is an unsupported repair utility for local Codex Desktop state. It edits files under `%USERPROFILE%\.codex`, so it creates timestamped backups before every real move and refuses to run while Codex appears to be open.

## What it updates

- `state_5.sqlite`: updates the thread `cwd`.
- `sessions/.../rollout-*.jsonl`: updates rollout `session_meta` and `turn_context` cwd values.
- `.codex-global-state.json`: removes the thread from projectless state, clears stale workspace hints, and adds the target project root if needed.

The script keeps pinned state by default. Pass `-Unpin` if you also want to remove the thread from Codex Desktop's pinned list.

## Requirements

- Windows PowerShell 5.1 or newer.
- `sqlite3` available on `PATH`.
- Codex Desktop closed before running a real move.

## Usage

List recent threads:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\codex\Move-CodexThread.ps1 -ListThreads
```

List known project roots:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\codex\Move-CodexThread.ps1 -ListProjects
```

Preview a move by title:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\codex\Move-CodexThread.ps1 `
  -Title "find old phones resources" `
  -ProjectRoot "$HOME\Downloads\samsung-ifg-decoder" `
  -DryRun
```

Move by exact thread id and unpin:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\codex\Move-CodexThread.ps1 `
  -ThreadId "019e1bc8-ec7d-7723-abbd-0abc554168f9" `
  -ProjectRoot "$HOME\Downloads\samsung-ifg-decoder" `
  -Unpin
```

Use `-ThreadId` when a title is ambiguous.

## Backups

Backups are written to:

```text
tools/codex/backups/codex-thread-move-YYYYMMDD-HHMMSS/
```

You can override the location with `-BackupRoot`.

## Notes

- This tool does not call any network service.
- It does not install or update Codex.
- If Codex changes its internal storage format, inspect a dry run before applying a move.
