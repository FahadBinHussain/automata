# steampowered.com automations

## free license add: CM path works on LIMITED accounts, web path is gated by $5 (verified 2026-08-25)

steam free games/dlc/demos can be added to a library with ZERO spend, but only through one of two code paths:

| method | path | limited ($0-spend) account |
|--------|------|---------------------------|
| steamdb collector (`/freepackages/`) | web `POST store.steampowered.com/freelicense/addfreelicense/<subID>` | **403 Forbidden** |
| ASF addlicense with `sub/` or `Packages` body | web `addfreelicense` (falls back to the same gated endpoint) | **403 Forbidden** |
| store "Add to Library" button (sept 2025) | store purchase flow | works |
| client console `app_license_request <appid>` | CM protocol | works |
| ASF `!addlicense <bot> app/<appID>` | CM protocol | works |

key takeaway: the $5 gate lives on the WEB endpoint `addfreelicense` only. the CM-protocol license add (what the steam client itself uses) is NOT gated. any bulk tool must drive ASF with `app/` (appID) prefixes, not `sub/` or the `Packages` api body.

### verified on a $0 limited account (steamid64 in .env.local)
- `!addlicense <bot> app/630` (Alien Swarm) -> added, shows "Complimentary" on `/account/licenses/`
- `!addlicense <bot> app/11020` (TrackMania Nations Forever) -> added
- a 10-appID `app/` batch returned Status: OK on all; 6 landed as new licenses (the rest likely already-owned)
- the same appIDs sent as `Packages` (web) returned Result 15 + `Forbidden <- POST .../freelicense/addfreelicense/<id>`
- ASF logs "This account is limited, farming process is unavailable until the restriction is removed!" but license ADD is unaffected

## bulk tools (both drive ASF via appIDs -> CM path)

- `louisa-uno/claim-free-steam-packages` (cloned at `C:\Users\<user>\Downloads\claim-free-steam-packages`) - `!addlicense <bot> app/<id>`, paces itself (74s sleep, ~50/hr), skips already-activated from `activated_packages.txt`, package list auto-updated via GH Actions. this is the go-to for "add everything".
- `woctezuma/add-free-licenses` (cloned at `C:\Users\<user>\Downloads\add-free-licenses`) - same `app/` approach, older.
- `Citrinate/FreePackages` ASF plugin - same underlying path, not separately tested.

## ASF setup (scoop `archisteamfarm`, config at scoop\persist\archisteamfarm\config)

- bot config `<account>.json`: `SteamLogin` must be the account NAME (e.g. `<account-name>`), NOT the email. using the email gives `InvalidPassword` from ASF even with the right password.
- global `ASF.json`: set `"Headless": true` + `IPCPassword` - IPC `input` calls only work in headless mode.
- credentials: steam password + google (gws) creds live in the Bitwarden vault (`store.steampowered.com` / `google.com - <user>` items), not in the repo. read via `mainframe\vault-secret.psm1`.
- steam guard: the account uses EMAIL 2FA. the code lands in the account's gmail and is read with gws (below). ASF prompts `GetUserInput()`, then answer via IPC:
  `POST http://localhost:1242/Api/Bot/<bot>/Input` body `{"Type":3,"Value":"<code>"}` (Type 3 = SteamGuard enum). the `input` command via `/Api/command` returns "only in headless mode".
- fresh code per attempt: ASF's login re-sends a new steam guard email each try, and the old code expires. fetch the LATEST email (q=`from:steampowered.com newer_than:30m`) right before sending, not a cached one.
- crash loop: repeated failed logins write `ASF.crash` in the config dir and ASF refuses to start ("crashed too many times"). delete `ASF.crash` before restarting.
- API endpoints (v6.3.8.4): auth header `Authentication: <IPCPassword>` (NOT X-API-Key). `/Api/command` body `{"command":"..."}`, `/Api/Bot/<bot>/AddLicense` body `{"Apps":[...]}` or `{"Packages":[...]}` (PascalCase field names), `/Api/Bot/<bot>/Input` body `{"Type":3,"Value":"..."}`. full schema at `http://localhost:1242/swagger/ASF/swagger.json`.

## gws (google workspace cli) = the gmail reader for steam guard / 2fa codes

- gws is the google workspace cli (pnpm global `@googleworkspace/cli`). mainframe helper: `C:\Users\<user>\Downloads\mainframe\gws-account.ps1`, profiles at `%APPDATA%\mainframe\accounts\gws\<email>\`.
- pnpm global shims die when pnpm re-links - the `gws.ps1` shim can point at a deleted hash dir (`node_modules\@googleworkspace\cli\run.js` missing). fix = `pnpm add -g @googleworkspace/cli`.
- read the latest steam guard code:
  `gws gmail users messages list --params '{"userId":"me","maxResults":5,"q":"from:steampowered.com newer_than:30m"}'`
  then `gws gmail users messages get --params '<{userId,id,format:"metadata"}>'` and regex `\b[A-Z0-9]{5}\b` out of the snippet.
- OAuth login for a new gws profile is browser-based. drive it with agent-browser (mainframe 3-step detached workflow), filling the google password + TOTP from the vault item (`google.com - <user>` has a `totp://` secret; compute the code with a 30s TOTP). grant the full scope list. after consent the CLI writes `credentials.enc` locally and reads gmail forever.
- **403 `serviceusage.serviceUsageConsumer` gotcha**: gws gmail calls fail with "Caller does not have required permission to use project <gcp-project>" until the target google account is added to the OAuth client's gcp project iam with `roles/serviceusage.serviceUsageConsumer`. grant via `gcloud projects add-iam-policy-binding <project> --member=user:<email> --role=roles/serviceusage.serviceUsageConsumer` (propagation can take a minute).

## bulk sweep script (owns rate-limit detection + progress persistence)

`steam-free-license-sweep.py` is a wrapper that drives ASF IPC directly, with:

- **rate-limit detection**: when asf returns `Status: OK` without `Items:` for 5+ consecutive calls, it assumes rate-limited and backs off 1h, then retries the same appID. this fixes the `#2687` false-ok issue.
- **progress persistence**: `activated_packages.txt` is appended and flushed after each confirmed add (response contains `Items:`). `skipped_packages.txt` captures permanently ungrantable appIDs. both survive internet death, power loss, ctrl+c.
- **resume-safe**: reads both files at start, skips anything already there.
- `--max N` flag to stop after N successful adds (for session-based runs).

run:
```
python steam-free-license-sweep.py
python steam-free-license-sweep.py --max 1000   # stop after 1000 adds
```
- runtime state files (`activated_packages.txt`, `skipped_packages.txt`, `config.json.local`, `sweep.log`) are gitignored. `config.json.local` = same shape as the claim tool's config (IPC host/password/accounts).
- live free-appID list is ~42k (2026-08-26, the auto-updated `package_list.txt`); at ~48/hr that's ~37 days continuous, but most are already-owned/ungrantable so real time is far less. run in `--max` sessions.

### what happens if internet dies / pc restarts
- **internet blip**: the asf localhost call fails (connection refused or timeout) → script catches the error → retries the same appID after a backoff. no progress lost, nothing skipped.
- **pc shutdown mid-run**: `activated_packages.txt` already has everything confirmed up to that point. on restart, re-run the script — it reads the file, skips what's done, resumes from where it left off.
- **asf crash**: asf auto-reconnects. the script's localhost calls fail until asf is back. the script retries, nothing is lost.

### response patterns handled

| response | meaning | action |
|----------|---------|--------|
| `Status: OK \| Items: ...` | confirmed add | append to activated_packages.txt |
| `Status: Fail/AlreadyPurchased` | already owned | append to activated_packages.txt (skip) |
| `Status: OK` (no Items) | not granted / rate-limited | if 5+ consecutive: back off 1h, retry same id |
| connection error | asf/net down | retry same id with backoff (up to 5 tries, then advance) |

## steam client cef bridge / shortcut launch (existing scripts)

- `steam-launch.ps1` + `steam-cdp-eval.mjs` - launch shortcuts via the CEF `SteamClient.Apps.RunGame` bridge (steam://rungameid doesn't work for shortcuts). see header comments.
- `steam-shortcuts.ps1` - read/write `shortcuts.vdf`. see header comments + automata root AGENTS.md "steam shortcuts vdf gotchas".
