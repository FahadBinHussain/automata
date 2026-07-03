# automata

A collection of browser userscripts, bookmarklets, and small automation utilities organized by target website/domain.

## Structure

- `tools/git/` - repo utilities (includes `git-streak.ps1`).
- `tools/codex/` - local Codex Desktop repair utilities (includes `Move-CodexThread.ps1`).
- `tools/misc-bookmarklets/` - generic bookmarklets and cross-site utilities.
- `files.vc/` - service-specific files.vc uploader utility.
- `<domain>/` folders (for example `google.com/`, `youtube.com/`) - scripts tailored for that site.

## Quick Start

### Userscripts / Bookmarklets

1. Open the relevant domain folder.
2. Pick the script file matching your target page.
3. Install in Tampermonkey/Greasemonkey or run as bookmarklet (depending on script type).

### Git streak utility

```powershell
# Run interactively (choose roots)
powershell -ExecutionPolicy Bypass -File .\tools\git\git-streak.ps1

# Generate HTML heatmap report
powershell -ExecutionPolicy Bypass -File .\tools\git\git-streak.ps1 -Gui -OpenGui

# Scan specific roots
powershell -ExecutionPolicy Bypass -File .\tools\git\git-streak.ps1 -Roots "$HOME\Downloads","$HOME\Documents"
```

## Conventions

- Package manager preference: `pnpm` where applicable.
- Domain-specific scripts live under their matching domain directory.
- Keep one lockfile type per Node project (`pnpm-lock.yaml` preferred).

## Notes

- Some subprojects may include their own local README and tooling.
- Root `.gitignore` includes safe defaults for Node/Python/editor/OS artifacts.

## Contributors

<a href="https://github.com/FahadBinHussain/automata/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=FahadBinHussain/automata" alt="Contributors" />
</a>
