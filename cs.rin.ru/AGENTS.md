# cs.rin.ru (Steam Underground) - local automation notes

## access model (verified 2026-08-13)
- NOT Cloudflare. custom nginx JS-cookie gate: 401 page whose inline JS sets `securitytoken` + `securitytoken_expiration` (24h) cookies and redirects to `/securitycheck/<path>`. bypass = extract token from 401 body -> send as cookie -> GET /securitycheck/forum/ -> 302 -> session ready. no browser, no JS engine.
- `feed.php` is WHITELISTED: global `feed.php`, per-forum `feed.php?f=10`, per-topic `feed.php?t=67450` -> 200 Atom, zero challenge, no login.
- guests can browse forums/topics/search; ONLY download links hidden ("[Please login to see this link.]" - "link_removed" class).
- mirrors: csrin.org (301 -> cs.rin.ru), official onion services exist (per staff blog).
- no JSON API; feed.php is the only structured endpoint.

## scripts (this folder)
- csrin-session.ps1 - token bootstrap, caches session to %TEMP%\csrin.session.json (~24h); callers: `$s = & csrin-session.ps1`
- csrin-feed.ps1 - topic/forum/global Atom pull; no session needed; objects with versions extracted
- csrin-search.ps1 - keyword search w/ flood retry (35s sleeps x3)
- csrin-thread.ps1 - viewtopic page extraction (-LastPage for the newest page)

## gotchas
- search.php flood control: "Sorry but you cannot use search at this time" - leave 30-60s between searches, never fire more than 1 search/min.
- securitytoken is in the page JS (`document.cookie = "securitytoken=..."`), NOT a Set-Cookie header.
- viewtopic pagination: `start=N`, 15 posts/page; "Page 1 of N" in pagination bar; no flood control but pace ~1 req/2s.
- topic search results (`search.php?keywords=..&t=<id>`) return POST links (viewtopic.php?p=), global search returns TOPIC links (class="topictitle" with nested <span> tag markup - strip tags from titles).
- feed.php content for guests strips links; authors/timestamps/text/version numbers all visible. login only gains the actual file links.
- RUNE crack for GTA V Legacy v1.0.3889.0 = `Grand.Theft.Auto.V.Legacy.v1.0.3889.0-RUNE` (scene, Jul 2026); Goldberg/Socialclub emu does NOT work on this build (DRM updated); crack-only exists in thread (~p3557198 area, LikeAG6 info post points to kVAL uploads page).