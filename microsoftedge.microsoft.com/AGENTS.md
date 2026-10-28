# microsoftedge.microsoft.com — Edge Add-ons store

- `extension-crx-downloader.ps1` — download any listed extension's CRX package
  from the official store endpoints (Edge first, Chrome Web Store as fallback),
  with metadata/manifest saved alongside. full inputs, endpoints, retry behavior
  and crx2/crx3 extraction notes live in the script header.
  run: `pwsh .\extension-crx-downloader.ps1 -Url <store-detail-url> | -Id <id>`
  flags: `-OutDir`, `-Extract`, `-MetaOnly`.

## gotchas (from the script header, keep in sync)

- edge crx endpoint is FLAKY + load-balanced: same id can 404 on one try and 302
  on the next; script retries metadata 3x / crx 5x with backoff. the 302 lands on
  msedgeextensions CDN with a signed time-limited link served over http ONLY —
  download immediately.
- edge metadata api sometimes 301-redirects to the store homepage.
- PowerShell trap: `Invoke-WebRequest -MaximumRedirection 0` throws on 302s —
  the script uses `HttpClient` with `AllowAutoRedirect=$false`, don't "simplify"
  it back to IWR.
- unpublished/removed packages report "listed but not servable" (exit 1 / exit 2
  in `-MetaOnly`), e.g. Plucky Lite `mbiehjpcjnckjbpegnahbjgeddpmeigj`.
- verify a downloaded crx version against store metadata (compare manifests).
