# hotdebrid/okdebrid/youdebrid/anydebrid/maxdebrid/downloader.now family + premiumlinkgen nodes.
# same backend: ticket/article maze (box_01->box_04) ending in single-use /dl or premiumlinkgen node link.

## hotdebrid maze (scripted in get-premiumlink.ps1 — no agent-browser)
- generator: `POST /article/<slug>` form (`links` + `next=box_01`) or trusted click on
  `Generate Premium Link` (eval `.click()` does NOT fire the handler; use playwright `click <ref>`).
- generate `/api` body: `link=<rapidgator>&lang=<static b64>&token=__&chck=,` -> resp
  `{size,name,host,next:"external",link:<b64 homepage>,ticket:<long blob>,target:_blank}`.
- page fn `b1(link_b64,target,next,ticket)` builds POST form (action=atob(link),
  inputs `ticket=` + `next=`) and submits. call it in-page with `_self`:
  `b1(link,'_self','external',ticket)` -> lands on article, machine auto-POSTs
  `{ticket:<short>,pageID,chck:','}` -> `{next:box_03,link:<b64 article>,wait:32,...}`.
- no GET/GRAB buttons render headless (O() needs `#tr`); drive manually:
  `b1(link,'_self','box_03',ticket)` -> `box_04` -> `{directDl:"1",link:<b64 /dl>,s:<bytes>,name}`.
- `/dl?id=` is single-use + IP/session-locked (consumed -> `dl?cod=10`; HEAD -> 404).
  download it in the SAME browser profile (cookies) single-connection. Edge via
  playwright temp profile loses the file — use `--persistent --profile` with pinned
  `Default/Preferences` download dir. IDM multi-connection on session URL = 1.8GB junk.
- quota: `{"error_code":4,"left":"3","sufix":"hours"}` after repeated generates (~3h cooldown).
- JS is obfuscator.io + RC4 (`bW`/`ea`/`d5` aliases, rotation IIFE). decode harness pattern:
  stub document/window/navigator via Proxy, indirect `(0,eval)` whole file, call decoder
  with real `(0xNNN,'key')` call sites. ticket flow: `aw`=localStorage set, `ax`=check,
  `aC()`=dlModal, `aJ()`=atob(window.dlLink), popup handshake via `xyz_ping` postMessage.
- curl POST to generator hits `ANTIBOT CHECK` (abck checkbox) — browser required for step 1.

## premiumlinkgen.com nodes (discovered 2026-09-09)
- shared CDN backend for *debrid clones (ok/you/any/maxdebrid traffic all lands here).
- bare file servers `1-5.premiumlinkgen.com` (CF, v1.0.4/1.0.5); apex NXDOMAIN, no homepage.
- `GET /file_<id>.zip?ticket=<7hex>` only; consumed/expired -> `Download ticket has expired.#1#1.0.4` / 404.
- single-use + IP-locked ("locked and only accessible to the user that initiated").

## premium-leech.com (CPA trap, NOT a leecher)
- `sgen()` = pure setTimeout theater, zero XHR. Download -> `_VR()` = CPBContentLocker
  (`026013b.js`, requiredLeads=1) -> `CPABuildComplete()` -> `vaiamigo()` ->
  `/error?fileid=` = "temporary error". never holds files. no premiumlinkgen refs.

## premiumlinkgenerator.net api (pure-curl generate, ouo-wrapped)
- `POST /rapidgator/api.php?action=generate` H `X-PLG-Authorization: plg-secure-token-2026`
  body `{"link":"..."}` -> `{download_url:"https://ouo.io/XXXXX",filename,filesize,id}`.
- IP quota: `?action=status` -> `{max_limit:3,used,remaining}` (~3/day).
- ouo.io -> cuttty.com -> cuttty "I am not a robot" stays disabled (dead end, needs account).
- leechpremium.link = CF Turnstile (no curl). premiumlink.site = parked (parklogic). okdebrid
  form = same hotdebrid maze. downloader.now/rapidgator returns 200 but JS-redirects to hotdebrid.
