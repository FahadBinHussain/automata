# official worldlabs viewer sources (scraped 2026-09-09)

evidence behind the viewer spec in `../AGENTS.md`. all three fetched with a
plain Chrome-UA fetch — no auth, no browser needed.

- `viewer.html` — the published embed viewer, COMPLETE readable source:
  `https://marble.worldlabs.ai/viewer.html?splatUrl=<spz>&marbleWorldId=<id>`
  (this is what `compare/view.html` ports 1:1). the money lines are the
  `<script type="module">` at the bottom: fov 75, splat quaternion
  `(1,0,0,0)`, `SparkControls`, no lights/tone mapping.
- `world-page-shell.html` — `https://marble.worldlabs.ai/world/<id>` first
  paint: bare TanStack Start shell + the `/assets/*.js` manifest (133
  chunks). the 3D viewer is lazy-loaded, not inline.
- `world-route-chunk-DQM_EMyH.js` — the world-page route bundle (313KB
  minified): world viewer canvas is `camera:{fov:75,...}` + orbit controller
  store (`getPosition`/`getOrbitTarget`/`setPositionAndOrbitTarget`); the
  "embed this world" flow builds the `viewer.html?splatUrl=&mobileUrl=&
  marbleWorldId=` iframe URL here.

re-scrape: `curl -sL -A "<chrome UA>" <url> -o <file>` — all endpoints are
static GETs. chunk hashes in filenames rotate on their deploys; re-list
`/assets/*.js` from the shell if a chunk 404s.
