# Game save backup (local notes)

always capture both **progress** (save files) and **settings** (registry/config).

## per-game engine (PREFERRED — own repo `FahadBinHussain/game-saves`)

The engine lives in its own private repo: `<user-home>\Downloads\game-saves`
(`engine/game-save.ps1`, per-game configs in `games/<slug>/game.json`). Backups go to
GitHub Releases. Every backup is categorised by **kind** so a game can hold main +
device + mod backups side by side:

| kind | tag shape | example |
|---|---|---|
| `main` (default) | `<slug>-<ts>` | `<game>-2026-08-24-1124` |
| `device` | `<slug>-device-<machine>-<ts>` | `<game>-device-<machine>-2026-08-24-1124` |
| `mod` | `<slug>-mod-<modname>-<ts>` | `<game>-mod-<modname>-2026-08-24-1124` |

```
.\engine\game-save.ps1 list [-Game <slug>] [-Kind main|device|mod]   # games, or backups for one game
.\engine\game-save.ps1 backup -Game <slug>                            # main (default)
.\engine\game-save.ps1 backup -Game <slug> -Note "post-dinner save"
.\engine\game-save.ps1 backup -Game <slug> -Kind device                # device (auto = this machine)
.\engine\game-save.ps1 backup -Game <slug> -Kind device -DeviceName <machine>
.\engine\game-save.ps1 backup -Game <slug> -Kind mod -ModName <modname>
.\engine\game-save.ps1 restore -Game <slug>                            # latest MAIN backup
.\engine\game-save.ps1 restore -Game <slug> -Kind device -DeviceName <machine>
.\engine\game-save.ps1 restore -Game <slug> -Kind mod -ModName <modname>
.\engine\game-save.ps1 restore -Game <slug> -Tag <full-tag>            # specific backup
```

- game identity = store URL (matches the 2ndbrain Notion collection), slug = url sanitized.
  `-Game` accepts the URL or the slug.
- game.json encodes save dirs, registry keys, expected file patterns, restore steps —
  agents don't re-investigate per-game save locations and can't silently skip save files
  (a past mistake only captured a display `.reg`, real progress was in a `NaninovelData\Saves\*.nson`-style path).
- backup verifies `expectedFiles` exist and warns loudly if a save dir or expected file is missing.
- `restore` with no `-Kind` = latest **main** only — a mod/device backup can never silently
  clobber a main playthrough. manifest records `kind`/`device`/`mod` for traceability.
- add a new game = drop `games/<slug>/game.json` + `README.md`; no engine changes.
- for a standalone game with no store URL, use a plain slug as the fallback (its game.json `storeUrl` field holds the plain title).

## DO NOT USE Notion for game saves anymore

**Game-save backups are repo-only (`FahadBinHussain/game-saves`).** Never upload save
backups to Notion again. Reasons: Notion has a 1-hour upload window, 5MB cap, and an
extension whitelist that blocks `.reg`/`.sav`; backups can be lost when external links
expire. The 2ndbrain game pages are legacy read-only notes — do not attach backup files
to them.

## legacy (DEPRECATED, reference only) workflow - manual registry scan, Notion upload

- search `HKCU:\SOFTWARE` for game keys and export the matching ones (achievements, unlock states, play time, and session data often live there instead of save files).
- **don't only match root key names against the game's title** — Unity PlayerPrefs live under `HKCU\Software\<Company>\<Product>` where Company is the dev company, not the game name.
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

## achievements for cracked games (research)

cracked/repacked games replace the real steam dll with a **steam emulator** so the game thinks steam is running. these emulators can also simulate achievements locally.

### emulators and achievement support
- **Goldberg Steam Emulator** — most common. auto-generates `achievements.json`/`stats.json` from the game's own definitions, so it has the full real achievement list matching steam exactly. achievements unlock locally as you earn them, but **no popup notifications** by default (no toast/sound).
- **SmartSteamEmu** — can show a small in-game overlay message when achievements unlock, but it's basic, not steam's toast + sound.
- **CreamAPI** / **SteamworksFix** — just DLL replacements to bypass steam ownership checks; no achievement tracking.
- **Steam Achievement Manager (SAM)** — force-unlock tool, but only works for owned games on steam (pointless on cracked).

### popup notifications
- **short answer**: mostly no. emulators log unlocks to local files, no steam-style popup by default.
- **SmartSteamEmu** is the only one that can show an in-game overlay message on unlock.
- **RetroAchievements** — real popup notifications + progress tracking, but only for emulated/retro games, not modern repacks.
- **Playnite** (library tracker) — can show toast notifications if a connected achievement data source feeds it, but cracked games typically have nothing feeding it.

### no pre-built database
no emulator ships a pre-built database of every game's achievements. each game defines its own achievement list (ids + names) inside its `steam_api` binary, and the emulator reads that game's definitions at runtime. so the emulator has that game's full list, but only for games you actually crack.

### realistic options for steam-style popups on cracked games
- **SmartSteamEmu** overlay (basic) — works for any game the emulator supports
- **RetroAchievements** — works for emulated retro games with real popups
- **Playnite + plugin** — works if the game has an achievement data source
- otherwise, need the legit steam copy for real steam notifications
