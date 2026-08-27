# ddos-guard-bypass (generic DDoS-Guard JS-challenge bypass)

generic helper to pass **DDoS-Guard** protection on any site using **nodriver + real Edge** (Chromium via CDP). the JS challenge (`/.well-known/ddos-guard/js-challenge/`) auto-passes in ~10-16s; hCaptcha never appears. verified on annas-archive.pk 2026-08-26.

## usage

```
# with a venv that has nodriver
.venv\Scripts\python.exe ddg-bypass.py <url> [--dump <out.txt>]
```

prints `PASSED DDG`, `URL=`, `TITLE=`, `COOKIES=` (useful if you need the clearance cookie for a download manager), and optionally dumps body text.

venv setup (reuse the annas-archive venv, or make your own):

```
uv venv .venv
uv pip install --python .venv\Scripts\python.exe nodriver
```

## why this combo works (and the dead ends)

| tool | engine | result |
|------|--------|--------|
| Camoufox | Firefox fork | JS challenge computed but fingerprint **rejected** -> falls to hCaptcha. do not use |
| agent-browser (Edge CDP, mainframe) | Chromium | `navigator.webdriver=false` but IP scored -> hCaptcha grid. token server-signed, cannot forge |
| **nodriver + real Edge** | **Chromium via CDP** | **JS challenge passes silently, no hCaptcha.** use this |

DDoS-Guard's hCaptcha (`/.well-known/ddos-guard/h-captcha/`) token is signed by hCaptcha's server; the `/hc` endpoint rejects every forged/random token (returns single space, no clearance cookie). the only real bypass is making the JS challenge pass, which the nodriver+Edge fingerprint does.

## hcaptcha token flow (for reverse-engineering)

page has `data-callback="callbackHCaptcha"` -> reads `__ddg3` + `hcaptcha.getResponse()`, then `fetch('/.well-known/ddos-guard/hc?ddg3=<t>&id=<token>&depricated=<0|1>')` and reloads. `depricated` is 1 if `navigator.webdriver`/headless markers detected. can't be faked.

## faster no-browser path (curl_cffi, untested)

for sites that only use the JS challenge (no hCaptcha), **curl_cffi** (`pip install curl_cffi`, `requests=True`, `impersonate="chrome124"`) gives a real TLS/JA3 + HTTP2 fingerprint and usually solves the JS challenge without a browser. try it before spinning up nodriver on simple targets; it does NOT work when hCaptcha is involved. worth testing + documenting a verified one-liner here when we hit a pure-JS-challenge target.

## gotchas

- nodriver `page.evaluate` intermittently returns an `ExceptionDetails` object instead of a string; guard with `isinstance(v, str)`.
- Windows asyncio floods stderr with "I/O operation on closed pipe" at shutdown - harmless, redirect stderr to a file.
- if the JS challenge falls back to "Sorry, we could not verify your browser automatically" -> fingerprint rejected (usually Camoufox/Firefox); switch to nodriver+Edge.
- site-specific download flows (e.g. annas-archive slow/fast partner servers) live in `automata\annas-archive\AGENTS.md`.
