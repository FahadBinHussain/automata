# fmhy.net (FreeMediaHeckYeah) - chain-of-trust download logic

FMHY (`fmhy.net`) is the starting point for finding download sources. It's a curated index that lists sites per category; the sites it lists are "trusted". anything NOT reachable through FMHY's listed chains is NOT trusted - do not add it.

## trust rule

"chain inside chain" - a download source is trusted only if it can be traced as:

```
FMHY category page -> listed index -> listed sub-source -> actual release
```

- verify every hop is a documented link on the previous page (fetch the pages, follow the anchors).
- if any hop is missing (the release/site is NOT listed in the chain), do NOT trust it -> do NOT add/download. tell the user which hop failed instead of silently working around it.

## how to use

1. identify the game/category, fetch the matching FMHY page (e.g. `/gaming`, `/audio`, `/video`, `/downloading`, `/reading`).
2. to scan the WHOLE wiki at once, use the single-page dump: `https://fmhy.net/single-page.md` (every page in one markdown file) - grep it for the category/site you need.
3. pick the listed index most relevant to the content (see category map below).
4. follow the index's own listed sub-sources (chain inside chain) until the actual release is found.
5. only add a download if it comes from a source reached through the chain.

## do NOT store a local copy

- `single-page.md` (and FMHY generally) updates frequently - do NOT download/save a copy in this repo or anywhere persistent. always fetch the live URL when you need it (webfetch or `Invoke-WebRequest`), or clone fresh (`git clone --depth 1 https://github.com/fmhy/FMHY.git <tmp>`). treat it as a live reference, not a cached file.

## category map

### games - full chain map (verified via fmhy.net/single-page.md)

- FMHY `/gaming` -> **Otaku Games Indexes**: [Wotaku](https://wotaku.wiki/games) or [EverythingMoe](https://everythingmoe.com/section/game)
- Wotaku -> **Nyaa** (torrent index) - the chain for otaku/visual-novel games is:
  `FMHY /gaming -> Wotaku -> Nyaa -> release`
- EverythingMoe `/section/game` -> **does NOT list Nyaa**. its VN-relevant entries are official/retail + DDL: vndb, dlsite, mangagamer, avn, jastusa, desonovel, doujinstylegame, yinghu, betterrepack, craneanime, visualdise, sekaiproject, kaguragames, shiravune, etc.
- FMHY `/gaming` "Visual Novel Tools" + "Special Interest" -> VN resources/databases (VNDB, vnwiki, GARbro, translators) and VN download spots (LemmaSoft renai, vgperson, DoujinStyle, Visual Novels Android). the game DDL sources all live under Wotaku/EverythingMoe.
- non-otaku games: FMHY `/gaming` -> CS.RIN.RU (`cs.rin.ru/forum`) or other listed sites directly.

## lessons learned

- check the WHOLE wiki via `https://fmhy.net/single-page.md` (grep the dump) instead of fetching one page at a time - categories are cross-linked and the real source often lives under an index you haven't opened.
- EverythingMoe's game index is mostly official/retail DDL - if the game isn't sold there (dead/niche), the otaku chain is Wotaku -> Nyaa or nothing.
- Nyaa torrents can have 0 seeders even when listed (old-era releases) - check seeders before adding, and expect old DDL links (rapidgator/uploadable/ul.to/datafile) to be dead.

### general downloads

- FMHY `/downloading` lists direct-download indexes (also `r/PiratedGames Mega`, `CS.RIN Mega`, `privateersclub`).
- relevant automata helpers: `..\cs.rin.ru\csrin-search.ps1`, `..\qbittorrent.com\add-torrent.ps1`, `..\thepiratebay.org\search.ps1`, `..\1337x.to\get-magnet.ps1`.

## notes / gotchas

- Nyaa is a user-uploaded index, not a scene-release site - it's trusted only because Wotaku lists it, not because of any intrinsic curation. still treat the files like any torrent download.
- file lists are often unavailable on Nyaa torrents - you cannot pre-scan contents before adding.
- keep this chain rule strict: never add a source that isn't traceable through FMHY's listed indexes, even if it looks reputable elsewhere. if unsure, ask the user.
