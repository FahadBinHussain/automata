# annas-archive (Anna's Archive)

reusable DDoS-Guard bypass + direct download for annas-archive.pk. verified working 2026-08-26 for `Meanwhile: Pick Any Path. 3,856 Story Possibilities` (md5 1a1566ba5e912d2b6252ee16dab252d5, 7.25MB pdf, 45.3.63.28:6060 partner IP).

## the bypass (the important part)

annas-archive.pk sits behind **DDoS-Guard**. it has two gates:

1. **JS challenge** (`/.well-known/ddos-guard/js-challenge/`) - a proof-of-work + fingerprint heuristic. when it passes, you get in silently.
2. **hCaptcha fallback** (`/.well-known/ddos-guard/h-captcha/`) - image grid that only appears when the JS challenge REJECTS your fingerprint. this is the wall.

what works and what doesn't:

| tool | engine | result |
|------|--------|--------|
| mainframe agent-browser (Edge CDP) | Chromium | hCaptcha grid shows. `navigator.webdriver=false` but IP is fingerprint-scored, challenge shown. token is server-signed -> cannot forge |
| Camoufox (camoufox pkg) | Firefox fork | JS challenge runs but is **rejected** ("Sorry, we could not verify your browser automatically") -> falls to hCaptcha. DDG fingerprints Firefox markers. even with geoip=True / os=windows |
| **nodriver + real Edge** | **Chromium via CDP** | **JS challenge PASSES silently (~10-16s), no hCaptcha.** this is the working combo |

**rule: use nodriver (`pip install nodriver`) launched with the real Edge binary (`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`).** the raw JS challenge auto-passes. do not use agent-browser for this (hCaptcha wall) and do not use Camoufox (fingerprint rejected).

generic version of this bypass (any DDG-protected site) lives in `automata\tools\ddos-guard-bypass\` (`ddg-bypass.py <url>`). aa-get.py is the annas-specific wrapper on top of the same trick. curl_cffi (TLS/HTTP2 impersonation, no browser) may solve pure-JS-challenge targets without nodriver — see tools\ddos-guard-bypass\AGENTS.md (untested on AA, hCaptcha still needs the browser).

## download links on the md5 page

- **Fast Partner Server #1-21** (`/fast_download/<md5>/0/<n>`) -> **require a membership/donation**. non-member lands on `fast_download_not_member`. skip unless logged in.
- **Slow Partner Server #1-4** -> "slightly faster but with waitlist". **#5-8 -> "no waitlist, can be very slow"** (prefer these).
- slow download page renders a JS widget that, after a short wait, reveals the **direct file URL** on an IP partner server (e.g. `http://45.3.63.28:6060/d4/z/anon/s/<ts>/53/.../<file>.pdf~/<hash>/annas-arch-<md5-short>.pdf`). that URL is **captcha-free and direct** -> hand to IDM.
- external downloads ("show external downloads") may show `libgen.li` (DDC catalog link, not a direct file) and `z-library.sk`.

## usage

```
.venv\Scripts\python.exe aa-get.py <md5>
```

prints `DIRECT_URL=...`. paste into IDM: `IDMan.exe /d <url> /p <dir> /f <name> /n`.

setup (already done, venv lives here):

```
uv venv .venv
uv pip install --python .venv\Scripts\python.exe nodriver camoufox
# camoufox only if you want to test the (failing) firefox path
```

## gotchas

- the `fast_download` URL is member-gated; do not report it as the answer for non-members.
- slow-download page is a JS SPA: `body.innerText` shows mostly nav for the first ~5-20s; the real link is in `document.documentElement.outerHTML` as a raw `http://<ip>:<port>/...pdf` string. wait 12-20s before scraping it.
- dedupe matches: the same URL appears twice in html (once with `&quot;`/`.then()` suffix). skip those.
- nodriver `page.evaluate` intermittently returns an `ExceptionDetails` object instead of a string; guard with `isinstance(v, str)`.
- `asyncio` on Windows floods stderr with "I/O operation on closed pipe" during shutdown — harmless, ignore (or redirect stderr to a file).
- slow servers are genuinely slow/rotating; if the direct IP times out, reload the slow page to get a fresh timestamp/hash link, or try a different #.
- the `n` index in `slow_download/<md5>/0/<n>` selects the partner; 0-7 = servers #1-8.
