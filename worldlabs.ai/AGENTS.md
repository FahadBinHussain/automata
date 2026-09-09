# worldlabs.ai automation notes

## file conventions (learned 2026-09-09)

- `<slug>.json` = flat view-config `{position, rotation, offset, cameraRadius,
  radius, duration}` — the ONLY shape imgvault scene upload accepts as the
  3rd (config) file.
- `<name>.world.json` = raw Marble API world dump (`id`, `display_name`,
  `generation_output.spz_urls`, `minimap_metadata`, …) — reference only.
  uploading it as the scene config silently does nothing in the viewer
  (no camera fields; imgvault ≥2.12.49 warns at upload time).
- `--marble <worldUrl>` writes both: dump + stub derived from
  `minimap_metadata` as position (rotation `[π,0,0]`, radius = |position|).
  stub is a starting point — tweak `position`/`cameraRadius` by eye.

## comparing a downloaded scene to the original (2026-09-09)

- **the original site cannot be iframed.** `marble.worldlabs.ai/world/<id>`
  sends `x-frame-options: DENY` + `content-security-policy: frame-ancestors
  'none'`. compare by eye against worldlabs' own published render
  (`thumbnail_1440.webp`, 1440x960 = 3:2), with a plain link
  out to the live page. do not try to embed it.
- **two different json shapes exist — do not confuse them:**
  - our scripts write `{position, rotation, offset, cameraRadius, radius,
    duration}` (the imgvault upload shape).
  - the json that actually lands in Downloads from a scene download is the
    **imgvault scene-viewer** shape `{position, rotation, offset, scale, fov,
    radius, duration}` — e.g. `Heavenly_Gateway_to_Jannah.json`
    (`scale:1`, `fov:75`). it has NO `cameraRadius`, so the viewer auto-fits.
- **OFFICIAL worldlabs viewer spec** (scraped 2026-09-09 from their published
  embed `https://marble.worldlabs.ai/viewer.html?spzUrl=&marbleWorldId=`,
  full sources kept in `official/` + `official/README.md` with re-scrape
  commands): `fov` 75 ·
  splat at origin with quaternion `(1,0,0,0)` = **rotX 180° flip** (NOT
  identity — identity would be `(0,0,0,1)`) · scale 1 · `SparkControls`
  fly-style (`update(camera)` per frame, drag look, WASD/arrows move, wheel
  dolly) · NO lights, NO tone mapping, black background · camera spawns at
  origin; the world PAGE instead uses an orbit canvas defaulting to
  `(0,0,5)`. `compare/view.html` ports this 1:1 (json rotation multiplies
  the flip, `cameraRadius` sets spawn distance default 5, json fov/scale
  defaults 75/1). three 0.180.0 via cdnjs there, jsdelivr here — same file.
- imgvault's own viewer (`nextgen-extension/dist/assets/sceneViewer-*.js`)
  differs: OrbitControls + ACES tone mapping + ambient light + auto-fit
  attempt — that is why imgvault framing never matched official pixel one.
- **SplatMesh has EMPTY geometry** (`frustumCulled=false` in spark) — so
  `Box3().setFromObject(mesh)` is EMPTY and auto-fit silently does nothing.
  any viewer MUST preset `(0,0,N)` first (see above) or the camera sits at
  the origin and orbit is degenerate (scene looks like a frozen picture).
  this bit us in `compare/view.html` — fixed by mirroring the preset.
- **engine versions**: `@sparkjsdev/spark` 2.1.0 is the current latest (npm
  registry) — matches worldlabs/imgvault; pair with three 0.180.0.
- **viewer**: `compare/view.html` + `compare/serve.mjs`. single-canvas viewer
  reproducing the camera logic above (preset `(0,0,N)`, auto-fit fallback),
  drag-drop .spz/.json, keys f = fit, r = reset, loud veil on failure.
  `node serve.mjs` roots at `%USERPROFILE%\Downloads` (that is where the
  downloader drops spz/json/webp) on port 8123, `/` opens the viewer.
- **serve.mjs windows gotcha**: `resolve()` BOTH the root and the request path
  before the traversal check. `join()` emits backslashes on windows, so
  comparing a forward-slash root string against a joined path 403s every
  single request (silent: all files look "missing").
- the compare viewer needs http (a `file://` page cannot fetch a 30MB local
  .spz), or use its drag-and-drop for one-off files.
