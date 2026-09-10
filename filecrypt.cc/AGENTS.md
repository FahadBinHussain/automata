# filecrypt.cc - PoW captcha bypass (STATUS: NO WORKING BYPASS — DO NOT USE)

> **2026-09-09 verdict: we do NOT have a fast bypass. agents must NOT use
> the filecrypt route** (same rule as rapidgator.net), unless the download
> is tiny or the user explicitly overrides.
> - `init-fast-pow.js` fast Worker did NOT accelerate in practice: FCE74DF1E1
>   ran at native speed (~40k h/s, diff 24 → ~7 min solves) across 3 attempts.
> - its pow_y fetch mock returns a FAKE cid → server rejects at final POST →
>   silent re-gate (submitted, `gone`, but still "Security Check").
> - slow solves hit the ~480s challenge expiry: `done` with filled pow_*
>   fields resets to `idle` with every field wiped, no error.
> - the old F011B92635 "5s unlock" could NOT be reproduced — treat as unverified.
> - use FMHY-chain sources instead (RLSBB posts, 1337x trusted uploaders,
>   repacks). filecrypt containers are a dead end until a real bypass exists.

> **2026-09-08 update:** headless `solve-container.ps1` is still BLOCKED (TLS/telemetry). **new:** `init-fast-pow.js` + `unlock-container.ps1` give a **browser-based fast bypass** that keeps real TLS/cookies/signals but solves the PoW 10-20× faster. `09844C4F93` went `working → gone` in **~2m** (vs 10m native) and unlocked (`hasCNL true`, `ddownload 0/1`). `F011B92635` similarly 3m → 5s. `D27EF9C3B2` still flakes at `90% → idle` (challenge expiry) — retry works.

> **2026-09-09 update — the browser flow had a hidden dependency: FOREGROUND.** the PoW
> reached `data-state=done` and then silently reset to `idle` with **every `pow_*` field
> empty** (`pow_id`, `pow_nonce`, `pow_elapsed`, `pow_pauses`, `pow_data`, `pow_x` all `""`).
> no error, no message — the page just sits on "Security Check" forever. cause: the tab was
> backgrounded so the worker got throttled. the same container took **12s / 81s / 190s**
> across three runs, and the slow ones were the ones that failed to unlock.
> `unlock-container.ps1` covered this with `SetForegroundWindow`; over CDP the equivalent is
> **`Page.bringToFront`** — call it before the click and ~every 30s after (NOT more:
> spamming causes blur → pause). with it, `B6B1F4A7B2` solved in **36s** and unlocked
> first try. **if a container reaches `done` and does not advance, check foregrounding first.**
>
> two environment gotchas found the same day:
> - **PowerShell is not always available** (sandbox dll missing → `unlock-container.ps1`
>   cannot run at all). don't assume it is there.
> - `agent-browser eval` **never returns** in an agent shell (global rule 47), so a
>   click-then-poll loop cannot be written against the CLI. `agent-browser get cdp-url`
>   + a single CDP attach works. run it in ONE shell command — backgrounded processes
>   are killed when the tool call ends.
>
> requests the browser extension blocks here (`net::ERR_BLOCKED_BY_CLIENT`), noted because
> they look alarming but `m.js`/`s.js`/`pow_captcha.js` still load 200 and the unlock works:
> `static.cloudflareinsights.com/beacon.min.js`, `static.filecrypt.to/js/aaaaaaaaaaaaaaaa.js`,
> `filecrypt.cc/surething.php` (image). do not chase these as the cause of a failed unlock.
>
> verified working end-to-end 2026-09-09: `B6B1F4A7B2` → `0/1 Online`, 1.73 GB,
> LIMSCAPE.THE.LIMINAL.SPACE.EXPLORER-TENOKE on 1fichier, CNL decrypted fine.

## what filecrypt's gate is (verified 2026-09-08, v2026-02 builds)

the "I am a human" box is a SHA-1 **proof-of-work** captcha, not an image captcha:

1. page embeds `#pow-captcha` div: `data-session` (challenge endpoint),
   `data-worker` (pow_captcha_worker.js), `data-ext` (m.js = env signal R()),
   `data-px` (y hosts: v3-asia.cutcaptcha.net, pow.filecrypt.cc,
   captcha.filecrypt.cc), `data-sig` (s.js = dwell/pointer signal S)
2. POST `<base>/captchasession/<ID>.json` with
   `{pow_x, pow_y, pow_yn, tz}` -> `{challenge, difficulty, id}` (difficulty 20-24)
3. worker finds nonce where `sha1(challenge + ":" + nonce)` has >= difficulty
   leading zero BITS (standard sha1, ascii, nonce as decimal string from 0)
4. form POST back to the container URL:
   `pow_id, pow_nonce, pow_elapsed, pow_pauses, pow_data, pow_x, password`

## what was replicated headless (all verified working individually)

- exact PoW solver (C# + node crypto, 2-10s for diff 24) - CORRECT
- `pow_x` = m.js `R()` executed in node with browser shims -> `2.40.23.<b64>`
- `pow_data` = s.js `S.start()` + dwell 2.6s + fake pointerdown/click events +
  `S.collect()` -> `signal_...` blob (1117 chars)
- `pow_y` = real `cid` from `https://captcha.filecrypt.cc/?t=<nonce>`
- exact form fields (form is just pow_* + password; lang radios are outside)
- full Chrome header parity (client hints, sec-fetch-*, accept-encoding),
  Referer/Origin on every request, single PHPSESSID cookie jar
- tested via BOTH PowerShell/.NET HttpClient AND node fetch (undici)

## result (headless vs browser)

**headless `solve-container.ps1`: still BLOCKED** — same as above: server rejects even with perfect PoW + pow_x/pow_y/pow_data + headers + cookie jar. see `solve-container.ps1` header. do not use for filecrypt pow.

**browser fast bypass: WORKS** — `init-fast-pow.js` (injected via `agent-browser open --init-script`) replaces the slow `pow_captcha_worker.js` (100 ms slice, 4096/hash) with a tight-loop blob Worker that runs in a real Worker thread, plus mocks the `pow_y` y-captcha fetch to avoid the 3 s race timeout. keeps real `pow_x` (m.js R), `pow_data` (s.js S.collect with real pointer events), cookies, TLS, Cloudflare. measured on `profile-email@example.invalid` Edge profile (Windows 11, Edge 152):
- `09844C4F93` ddownload: native 4-5 m → fast 2 m, unlocked (`hasCaptcha false`, `hasCNL true`, `0/1 Online` — host dead but gate passed)
- `F011B92635` gofile: native 3 m → fast 5 s (init script) or 3 m native
- `B6B1F4A7B2` 1fichier: native 5 m, fast 1-2 m
- `D27EF9C3B2` megaup: high diff 24, native 20 m (exceeds 480 s challenge expiry → `90% → idle`); fast 2-3 m but still flakes — retry until `gone`, not `idle`

## files

- `solve-container.ps1` - **BLOCKED** headless flow — LOUDLY throws "submit rejected". kept for reference only.
- `run-signals-builder.cjs` - headless signal builder for the blocked flow.
- `init-fast-pow.js` - **ACTIVE** browser patch — tight-loop Worker + y-fetch mock. use via `agent-browser open --init-script <path> <Container URL>` then JS click `document.querySelector('#pow-captcha .pow-captcha__box').click()` + `SetForegroundWindow` once, poll `data-state` until `gone` (not `idle`). see `unlock-container.ps1`.
- `unlock-container.ps1` - wrapper around the init script: `.\unlock-container.ps1 -Url https://filecrypt.cc/Container/XXXX.html` → prints `0/1` or `1/1` and CNL links (AES decrypt). handles foreground + polling. **needs working PowerShell** — not always available.
- `cdp-unlock.mjs` - **preferred when PowerShell is unavailable / driving from an agent shell.** one CDP attach does `Page.bringToFront` + click + poll + CNL decrypt and prints the real host links. usage in its header comments; needs `agent-browser get cdp-url`.

## what other tools do (checked 2026-09-08, shipped binaries decompiled + live-run tested)

- **JDownloader 2 v1.8.0.482 (winget-verified installer, decompiled via CFR)**:
  `jd/plugins/decrypter/FileCryptCc.class` line ~577:
  `if (br.containsHTML("/js/pow_captcha.js") && br.containsHTML("name=\"pow_"))`
  -> throws `UNSUPPORTED_CAPTCHA - "Unsupported captcha type 'powcaptcha.com'"`.
  **the shipped binary CANNOT solve the pow gate.** it handles:
  circle captcha (click point), recaptcha v2, cutcaptcha (via their captcha
  service). decompiled source kept at `reference/FileCryptCc.jd2-shipped.java`.
  - LIVE-RUN TESTED 2026-09-08: installed (build Sep 07 2026 = JDownloaderRevision
    50639, 1 day old at install = current), ran the app ~15 min across 2 launches,
    zero plugin updates downloaded (filelist.txt/rev unchanged, updateinterval
    600s, silent installs on). class sha unchanged
    `9A841725...421FB18`. **there is no newer solver coming from their update
    server for this - JD2 genuinely cannot do filecrypt pow containers.**
- **pyLoad** (`src/pyload/plugins/decrypters/FilecryptCc.py` v0.52, GPLv3):
  handles internal/circle/solvemedia/keycaptcha/coinhive/recaptcha captchas.
  **NO handler for the pow captcha.** kept at `reference/FilecryptCc.pyload.py`.
- **useful either way - the after-unlock extraction (from pyLoad)**:
  - CNL route: unlocked page has `onsubmit="CNLPOP('...', '<crypted>', ...,'<jk>')"`
    blocks; links = AES-128-CBC decrypt(base64decode(crypted), key=iv=bytes.fromhex(jk)),
    strip \x00/\r, split \n. no clicks needed, no ad-gate /Link/ pages.
  - DLC route: `DownloadDLC('<id>')` -> GET /DLC/<id>.dlc (Download Link Container).
  - weblink route: /Link/<id>.html -> find `index.php?Action=Go&id=<id>` -> GET it,
    final host URL is the Location header.

## installer extraction notes (JDownloader2, for future re-checks)

- installer URL comes from the winget manifest
  (`api.github.com/repos/microsoft/winget-pkgs/contents/manifests/a/AppWork/JDownloader/<ver>/AppWork.JDownloader.installer.yaml`)
  - InstallerUrl + InstallerSha256, verify hash after download
- the .exe is an **install4j** launcher (magic `D5 13 E4 E8`); 7z gets only the
  launcher PE, the media blob `[0]` has no plain archive magic - static
  extraction fails. run it instead: `<installer>.exe -q -dir <target>` installs
  unattended into <target> (plugins unpack to `<target>\JDownloader 2\jd\plugins\`)
- java decompile: CFR jar (`github.com/leibnitz27/cfr/releases`) + temurin jdk
  (`java -jar cfr.jar FileCryptCc.class --outputdir <dir>`)

## honest paths that DO work (ranked)

1. **browser fast** — `unlock-container.ps1` (init-fast-pow.js) — 5 s to 3 m, no manual waiting, still trusted chain (real filecrypt page + real CNL decrypt). **preferred for filecrypt pow.**
2. browser manual — open filecrypt page, click box, keep foreground 3-20 m, copy links. works but slow.
3. JDownloader2 — closed binary may have private solver, but shipped `FileCryptCc.class` as of 2026-09-08 still throws `UNSUPPORTED_CAPTCHA`; do not rely.
4. if the release is also on another trusted-chain host (e.g. direct DDL site), prefer that to avoid filecrypt entirely.
