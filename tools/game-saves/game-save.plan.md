# Plan: standardize game-save backups in a private GitHub repo

## goal

replace the ad-hoc Notion-per-game backup with a standardized, agent-friendly
system where any game can have **multiple backups at different points in time**,
and restore picks the right one. agents should be able to run backup/restore
without re-discovering per-game save paths or guessing which zip is newest.

## 0. game identity = store URL (matches your Notion convention)

your 2ndbrain "my game collections" pages are named by **store URL**, e.g.
`store.steampowered.com/app/1017180/The_Long_Drive/`. that's the canonical,
clash-proof identity (unique per game even when names collide, e.g. two games
both called "Camp with Mom"). we use the same identity for backups.

- **canonical id** = the store URL exactly as Notion page name.
- **slug** = url sanitized for git paths/release tags, derived by: lowercase,
  strip scheme + trailing slash, `/` → `-`, keep dots: e.g.
  `store.steampowered.com/app/1017180/The_Long_Drive` →
  `store-steampowered-com-app-1017180-The_Long_Drive`.
- the store URL is stored in `game.json` (`storeUrl`); the slug is used for
  the folder name and release-tag prefix. names can never clash because the
  URL (hence slug) is unique.
- games with no store URL (standalone/itch/etc.) fall back to `site.com/…`
  if one exists, else the exact Notion page title if that's already unique.

## 1. where: private GitHub repo

- new private repo `game-saves` under `FahadBinHussain`.
- `gh` CLI already authed; no 1-hour upload window, no 5MB/extension whitelist,
  download URLs don't expire, free private repo.
- binary saves live in **GitHub Releases** (not git history) → no repo bloat,
  natural versioning, downloadable via `gh release download`.
- game metadata + manifests (json) live in the repo tree (tiny, textual).

## 2. repo layout

```
game-saves/
  README.md                  # root: how to backup/restore + game inventory
  games/
    store-steampowered-com-app-1017180-The_Long_Drive/
      game.json              # durable per-game knowledge + storeUrl
      README.md              # human restore instructions + game notes
    store-steampowered-com-app-3527290-PEAK/
      game.json
      README.md
  engine/
    game-save.ps1            # shared backup/restore engine (moved from automata)
    game-save.plan.md        # this doc
```

`games/` mirrors your Notion collection: one folder per game, keyed by the
same store-URL-derived slug. a `list`-style inventory table can be regenerated
from `game.json` files (storeUrl + display name).

## 3. release naming / multiple backups

- one GitHub Release per backup.
- tag = `<slug>-<timestamp>` e.g. `store-steampowered-com-app-1017180-The_Long_Drive-2026-08-24-1116`.
- asset(s) inside the release:
  - `<slug>-<timestamp>.zip` — the save bundle (saves + reg, same zip format as now)
  - `<slug>-<timestamp>.json` — manifest: storeUrl, slug, sha256, save file list,
    registry keys, game version, timestamp, created-by, optional note.
- releases are immutable-ish snapshots: a game accumulates many over time; restore
  picks a specific tag, defaulting to the latest for that game.
- prune policy: keep last N (configurable, default keep all) per game; older tags
  deletable via `gh release delete` + `git tag -d`/push delete.

## 4. agent workflows (engine commands)

```
# backup (creates latest point-in-time, uploads as a release)
.\game-save.ps1 backup -Game <slug-or-url>            # e.g. -Game store-steampowered-com-app-1017180-The_Long_Drive
.\game-save.ps1 backup -Game <slug> -Note "post-dinner save"

# list available backups for a game
.\game-save.ps1 list -Game <slug>                     # table: tag, date, sha256, note

# restore a specific backup (default = latest for the game)
.\game-save.ps1 restore -Game <slug>                  # download latest release zip + manifest, apply
.\game-save.ps1 restore -Game <slug> -Tag <full-tag>
```

`-Game` accepts either the full store URL or its slug (engine normalizes).

## 5. manifest schema (per backup)

```json
{
  "game": "The Long Drive",
  "storeUrl": "store.steampowered.com/app/1017180/The_Long_Drive/",
  "slug": "store-steampowered-com-app-1017180-The_Long_Drive",
  "tag": "store-steampowered-com-app-1017180-The_Long_Drive-2026-08-24-1116",
  "timestamp": "2026-08-24T11:16:00Z",
  "created_by": "<user>@example.com",
  "note": "",
  "sha256": "…",
  "game_version": "…",
  "files": ["…", "…"],
  "registry": ["HKCU\\SOFTWARE\\…"]
}
```

## 6. engine changes (from current automata game-save.ps1)

- add `gh release create <tag> <zip> <manifest> --notes "<note>"` on backup.
- add `gh release download <tag> --pattern '*.zip' --clobber` + manifest parse on restore.
- `list` = `gh release list` filtered by game slug prefix.
- keep the existing expected-files verification (the thing that caught the first
  missing-saves bug).
- default restore = latest release for the game; explicit `-Tag` overrides.
- env needs: `GH_REPO` (default `FahadBinHussain/game-saves`) via `.env.local`.
- slug/url normalization helper (accept url or slug).

## 7. migration

- first backup of campwithmom (current in-progress save) → create the repo,
  seed `games/<slug>/game.json` + `README.md`, and make the first release from
  the existing zip. existing Notion pages stay as-is (read-only archive); new
  backups go to github.
- campwithmom has no store URL → check what the Notion page title actually is
  (`Camp with Mom (CMP_Extend v1.01 HD)`) and use that as the fallback identity.

## 8. adding a new game

1. `games/<slug>/game.json` (copy shape; set storeUrl + display name).
2. add restore instructions to `games/<slug>/README.md`.
3. no engine changes. `game-save.ps1 backup -Game <slug>` just works.

## open questions

- keep the current `tools/game-saves/` automata copy or move engine fully into the
  repo? → plan: repo is source of truth; automata keeps a thin note pointing there.
- prune default (keep all vs keep last 10)? → default keep all, prune manually/flag.
- who creates the repo — script or manual `gh repo create --private`? → scripted.
