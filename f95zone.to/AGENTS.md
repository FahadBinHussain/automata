# f95zone.to - logged-in search + masked link resolution

XenForo-based forum. Guests get 403 on search and threads; with a logged-in session everything works over plain HTTP (no browser needed). The useful primitives here are (1) the XenForo login flow and (2) the **masked-link resolver** — the site masks all external download URLs behind `/masked/<host>/...` pages to deter bots/takedowns, and those pages resolve to the real host URL via a simple POST.

## scripts

- `login.ps1` - performs the XenForo login flow and saves the session cookies to `.session\cookies.json` (personal, gitignored). prints the account menu username + csrf token on success.
- `search.ps1` - search threads for a query (`-Query "..."`), prints thread titles + URLs. uses an existing session if present, otherwise runs login.
- `resolve-masked.ps1` - takes one or more `/masked/...` URLs and resolves them to the real host URL (gofile/mega/pixeldrain/etc). this is the key workflow: thread page -> extract `/masked/*` hrefs -> resolve each -> check which host is alive.

## login flow (reversed, XenForo)

1. `GET /login` -> keep session cookies (`xf_csrf`), scrape `name="_xfToken" value="<tok>"`.
2. `POST /login/login` with form body `login`, `password`, `remember=1`, `_xfToken=<tok>`, headers `X-Requested-With: XMLHttpRequest`, `Accept: application/json`. on success the page's `<html>` carries `data-logged-in="true"` and `xf_user` + `xf_session` cookies are set.
3. verify: `GET /account/` and check `data-logged-in="true"` + username present.

gotchas:
- response body is `message_page` HTML, not JSON, even with the XHR header. a `data-logged-in="true"` check on the html tag is the real signal.
- the login POST may return a page containing a notice like "locked due to common usage in spam messages" while still logging you in fine — don't treat that as failure, verify via `/account/`.
- `_xfToken` must come from the same session that POSTs (grab it on the login GET).

## masked link resolution (reversed)

the interstitial page (`/masked/<host>/<threadid>/<userid>/...`) has `<a href="#" class="host_link">Continue to <host></a>` which posts back to the same masked path:

```
POST <masked-url>        form: xhr=1, download=1
-> {"status":"ok","msg":"https:\/\/gofile.io\/d\/..."}   (real url)
   {"status":"error",...} or {"status":"captcha",...}    (rare; captcha needs a browser)
```

the logic lives in `/assets/js/masked.js` (jquery handler on `.host_link`, `data: {xhr:1, download:1}`). resolution needs the logged-in session.

## workflow for a game hunt

1. search the forum (or open the known thread) with a session.
2. scrape all `href="/masked/*"` links from the thread (often several — different hosts, plus multi-page re-posts of mirrors).
3. resolve each with `resolve-masked.ps1`; then probe each host's API/HEAD to check aliveness (e.g. `pixeldrain.com/api/file/<id>/info`, `api.gofile.io/getContent?contentId=<id>`, `mega.nz` needs the megatools/mega.py flow).
4. dead-host links (uploadhaven/krakenfiles "file not found", gofile 404) are common on old threads — the alive one is usually a pixeldrain/mega mirror.

## gotchas

- masked URLs expire/rotate per-user; resolve with the same session that fetched the thread.
- `go.systemflowhub.com/*` hrefs are ads/redirects — ignore.
- thread pages paginate (`/threads/<slug>.<id>/page-N`); mirrors often live on later pages. parse all pages.
- keep content generic per repo rule: no specific game names/titles in committed files.
