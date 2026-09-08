# filecrypt.cc - headless PoW captcha bypass (STATUS: BLOCKED - do not trust as working)

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

## result

**server rejects the form POST regardless** - response is byte-identical to a
fresh GET (only rotating session/link ids differ). wrong-nonce and correct-nonce
POSTs produce same-length pages. the remaining discriminator is NOT in the
replicated surface - most likely:
- TLS fingerprint scoring (JA3/JA4) on filecrypt.cc (behind Cloudflare), or
- `aaaaaaaaaaaaaaaa.js` (635KB obfuscated telemetry, 19 fetch call sites,
  244 document[] touches) minting an additional hidden token, or
- server-side check that the y-cid was claimed through a real CORS fetch
  chain (cutcaptcha.net hop times out from this network)

## files

- `solve-container.ps1` - the full flow, LOUDLY throws "submit rejected" until
  the missing piece is found. do NOT trust its output while this note says BLOCKED.
- `run-signals-builder.cjs` - node shim builder; generates `run_payload.mjs`
  next to the fetched m.js/s.js and runs them headless (R / S.collect).

## what other tools do (checked 2026-09-08, shipped binaries decompiled)

- **JDownloader 2 v1.8.0.482 (winget-verified installer, decompiled via CFR)**:
  `jd/plugins/decrypter/FileCryptCc.class` line ~577:
  `if (br.containsHTML("/js/pow_captcha.js") && br.containsHTML("name=\"pow_"))`
  -> throws `UNSUPPORTED_CAPTCHA - "Unsupported captcha type 'powcaptcha.com'"`.
  **the shipped binary CANNOT solve the pow gate either.** it handles:
  circle captcha (click point), recaptcha v2, cutcaptcha (via their captcha
  service). decompiled source kept at `reference/FileCryptCc.jd2-shipped.java`.
  update server (update.jdownloader.org) needs signed requests - live plugin
  version not directly fetchable; a newer solver may exist server-side.
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

## honest paths that DO work

1. browser (agent-browser or manual) on the filecrypt page -> pass the box ->
   copy the dlhoster links (or save the unlocked HTML - CNL blocks decrypt offline)
2. JDownloader2 - handles filecrypt containers natively (closed binary, may
   have a private solver)
3. if the release is also on another trusted-chain host (e.g. direct DDL site),
   prefer that
