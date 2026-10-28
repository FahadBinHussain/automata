# bookmarklets — generic cross-site browser utilities (capability folder)

holds bookmarklets/userscripts with **no single target host** (`@match *://*/*`
or raw any-page) — same class as `voice-to-text` / `repo-preservation`: nothing
in the hostname-keyed tree fits. moved out of `tools\misc-bookmarklets\` on
2026-10-05; the one site-specific piece of that folder went to its host instead
(`youtube.com\youtube-link-audit-tool-comprehensive-duplicate-and-unique-link-reporter.js`).

## inventory

| file | kind | what it does |
|------|------|--------------|
| `mobile-hyperlink-overlay-menu-replacement.js` | userscript (`@match *://*/*`, GM_openInTab + GM_setClipboard) | long-press a link -> overlay menu: open in new tab / copy link / copy link text / cancel |
| `super-fast-infinite-scroll-content-expander-and-loader.js` | bookmarklet | start fast auto-scroll (scrollBy 500px every 5ms) to force-load infinite-scroll pages |
| `universal-browser-auto-scroll-process-terminator.js` | bookmarklet | stop the pair above (shared `window.scrollInterval`) |
| `universal-plain-text-url-to-clickable-link-converter.js` | userscript (`@match *://*/*`) | plain-text URLs -> real links; MutationObserver keeps converting dynamically added content |
| `webpage-image-link-extractor-and-thumbnail-grid-gallery-generator.js` | userscript (`@match *://*/*`) | open-directory page -> filtered thumbnail gallery + full viewer (dates/sizes parsed from listing text) |

## public @downloadURL / @updateURL contract (do not repoint)

The 3 userscripts carry `@downloadURL`/`@updateURL` pointing at the **public**
repo `FahadBinHussain/automata`, path `bookmarklets/<same filename>` (repointed during 2026-10-28 public sync)
(verified HTTP 200 on 2026-10-05). That is the live Tampermonkey auto-update
channel for the installed copies and it stays where it is until a public sync:

- never repoint them at this (private) repo — anonymous raw fetches 404 there.
- never repoint them at the new public path (`bookmarklets/<file>`) before a
  public sync has actually moved the files — that would break auto-update on the spot.
- private copies are updated **manually** (root AGENTS single-file userscript
  rule); the @URLs keep serving the public copies only.
- **public-sync handoff**: move the public files and repoint the @URLs in the
  SAME change. Moving without repointing 404s every installed copy's update check.

## usage

- userscripts: install from the public raw URL above (Tampermonkey), or paste
  the file body into the editor for a manual private copy.
- scroll pair: save each `javascript:` line as a bookmark; click start, click stop.
