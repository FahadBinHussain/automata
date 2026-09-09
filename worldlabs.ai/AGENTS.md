# worldlabs.ai automation notes

## file conventions (learned 2026-09-09)

- `<slug>.json` = flat view-config `{position, rotation, offset, cameraRadius,
  radius, duration}` — the ONLY shape imgvault scene upload accepts as the
  3rd (config) file. homepage showcase worlds come from `save-configs.mjs`.
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
  'none'`. any side-by-side must use worldlabs' own published render
  (`thumbnail_1440.webp`, 1440x960 = 3:2) as the reference, with a plain link
  out to the live page. do not try to embed it.
- **two different json shapes exist — do not confuse them:**
  - our scripts write `{position, rotation, offset, cameraRadius, radius,
    duration}` (the imgvault upload shape).
  - the json that actually lands in Downloads from a scene download is the
    **imgvault scene-viewer** shape `{position, rotation, offset, scale, fov,
    radius, duration}` — e.g. `Heavenly_Gateway_to_Jannah.json`
    (`scale:1`, `fov:75`). it has NO `cameraRadius`, so the viewer auto-fits.
- **imgvault scene viewer camera logic** (reverse-engineered from
  `nextgen-extension/dist/assets/sceneViewer-*.js`), reproduce exactly when
  matching framing: `fov` default 90 · `scale` default 4.5 · `rotation` in
  radians · if `cameraRadius` (or `controls.camera_radius` /
  `camera.position[2]`) is set → `camera.position.set(0,0,radius)` +
  `lookAt(0,0,0)`; **otherwise auto-fit** `dist = boundsRadius /
  sin(fov/2) * 1.05` along the current view direction, target = bounds center.
  `offset` is accepted by the format but **ignored** by that viewer.
- **engine versions**: `@sparkjsdev/spark` 2.1.0 is the current latest (npm
  registry) — matches worldlabs/imgvault; pair with three 0.180.0.
- **compare harness**: `compare/index.html` + `compare/serve.mjs`. viewer
  reproduces the camera logic above, then compares against the official
  render — side-by-side / wipe / blink / difference (mean abs diff + match %),
  live fov·scale·position·rotation·offset·cameraRadius controls, auto-fit,
  snapshot png, copy/download json. keys 1-4 = modes, f = fit, r = reset.
  `node serve.mjs` roots at `%USERPROFILE%\Downloads` (that is where the
  downloader drops spz/json/webp) on port 8123.
- **serve.mjs windows gotcha**: `resolve()` BOTH the root and the request path
  before the traversal check. `join()` emits backslashes on windows, so
  comparing a forward-slash root string against a joined path 403s every
  single request (silent: all files look "missing").
- the compare viewer needs http (a `file://` page cannot fetch a 30MB local
  .spz), or use its drag-and-drop for one-off files.
