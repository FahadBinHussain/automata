# Game save backup (local notes)

always capture both **progress** (save files) and **settings** (registry/config).

## per-game engine (PREFERRED — own repo `FahadBinHussain/game-saves`)

The engine now lives in its own private repo: `<user-home>\Downloads\game-saves`
(`engine/game-save.ps1`, per-game configs in `games/<slug>/game.json`). Backups go to
GitHub Releases (one release per point-in-time, tag `<slug>-<timestamp>`).

```
.\engine\game-save.ps1 list                            # all games
.\engine\game-save.ps1 backup -Game camp-with-mom      # zip + manifest -> new release
.\engine\game-save.ps1 backup -Game camp-with-mom -Note "post-dinner save"
.\engine\game-save.ps1 restore -Game camp-with-mom     # latest backup
.\engine\game-save.ps1 restore -Game camp-with-mom -Tag <full-tag>
```

- game identity = store URL (matches the 2ndbrain Notion collection), slug = url sanitized.
  `-Game` accepts the URL or the slug.
- game.json encodes save dirs, registry keys, expected file patterns, restore steps —
  agents don't re-investigate per-game save locations and can't silently skip save files
  (the mistake the first Camp With Mom backup made — only the display `.reg` was captured,
  real progress was in `NaninovelData\Saves\*.nson`).
- backup verifies `expectedFiles` exist and warns loudly if a save dir or expected file is
  missing.
- add a new game = drop `games/<slug>/game.json` + `README.md`; no engine changes.

## legacy (pre-repo) workflow — manual registry scan, Notion upload

- search `HKCU:\SOFTWARE` for game keys and export the matching ones (achievements, unlock states, play time, and session data often live there instead of save files).
- **don't only match root key names against the game's title** — Unity PlayerPrefs live under `HKCU\Software\<Company>\<Product>` where Company is the dev company, not the game name (The Long Drive = `Genesz\TheLongDrive`, holding distance stats + last-save pointers the saves alone don't carry).
- use recursive scans looking for game-like keys by:
  - (a) the game's own name AND known dev/company names
  - (b) Unity PlayerPrefs signatures (`Screenmanager *` values, `unity.player_*` values, `*_h\d+` hashed value names)
  - (c) keys modified around the game's last run
- then export the whole matching company/product key.
- also check `HKCU\Software\Microsoft\Windows\CurrentVersion` MuiCache/App paths for the exe path when in doubt.

## save/config files

- locate in `%LOCALAPPDATA%\Low`, `%LOCALAPPDATA%`, `%APPDATA%`, and the game install folder, excluding telemetry/analytics folders.
- zip the save files together with the registry export (`.reg`).

## notion page (2ndbrain DB)

- search the `2ndbrain` Notion database for an existing page with the same title and **update** it instead of creating a duplicate; create new under `2ndbrain` only if none exists.
- page name = store URL (Steam `store.steampowered.com/app/{APPID}/{game-name}`, GOG `gog.com/game/{game-name}`, otherwise the store URL or plain game name).
- put the zip's SHA256 hash plus restore instructions (where to extract saves, which registry keys to import) in the page body.
- upload the zip with `C:\Users\<user>\Downloads\automata\notion.com\notion-upload-file.ps1` (see the notion.com AGENTS.md for whitelist/flow).