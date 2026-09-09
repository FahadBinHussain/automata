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
