# facebook.com cookie health + lumen watchdog

## cookie-health.ps1 (lumen FB cookie watchdog)

single health check of the lumen bridge + dailyBNP outbox (BNP_MESSENGER stale-cookie
signature: "send returned empty message ID" rows), triggers a browserless cookie refresh
through the agent-browser cookie vault when the failure threshold is hit. exit codes:
0 healthy, 2 refresh triggered, 3 bridge down, 4 DB error. env: BNP_DATABASE_URL (else
murmur/.env), MURMUR_HF_SPACE_URL (else http://127.0.0.1:8791), COOKIE_HEALTH_LOG (default
$env:TEMP\lumen-cookie-health.log), BNP_COOKIE_REFRESH_* tuning vars. full docs in the
script header. run: `pwsh cookie-health.ps1` or `-Loop`.

**proxy gotcha (2026-08-18)**: the /api/health call uses `-NoProxy` — never let it
depend on the system proxy. symptom: every check logged
`UNREACHABLE (... actively refused it. (127.0.0.1:7890))` while fresh pwsh processes
hit the bridge fine — the long-lived watch window caches WebRequest.DefaultWebProxy
at boot, so a proxy enabled at logon keeps being used hours after ProxyEnable=0.
the window picks up script edits on the next cycle (script files re-read per
invocation), but a restart of the watch task is the belt-and-suspenders move.

**neon usage watcher (2026-08-18, murmur parity)**: cookie-health.ps1 now also
runs murmur's old hourly Neon quota watcher — `neon-hours-table.ps1 -Json`
(mainframe) -> one warning per org per quota period at 90 of 100 CU-h, sent via
the lumen bridge notifications endpoint (`source: neon-usage`, dedupeKey
`neon-<hours>:<orgId>:<resetDate yyyy-MM-dd>`), dedup state
`%APPDATA%\mainframe\state\lumen-neon-usage-warnings.json` + hourly gate marker
`lumen-neon-usage-last-check.txt`. default target = the lumen whatsapp test
contact (NEON_USAGE_WARNING_THREAD_ID, set in facebook.com/.env.local — the
jid is personal data, never commit it; messenger is NOT live on lumen —
murmur warned a messenger thread; override with
NEON_USAGE_WARNING_PLATFORM/THREAD_ID). env
overrides: NEON_USAGE_TABLE_SCRIPT, NEON_USAGE_CHECK_INTERVAL_SECONDS,
NEON_USAGE_WARNING_HOURS, HF_EMAIL (token must match the lumen bridge secret).
first live firing 2026-08-18: Daily-BNP at 105.61 CU-h (genuinely over the
100 CU-h free cap) — warning sent to the whatsapp test contact.

**silent-delivery loss gotcha (2026-08-20)**: the bridge returns HTTP 200
`{"status":"sent"}` even when the whatsapp send FAILED (murmur contract, see
lumen-agent AGENTS.md) — so a warning whose send failed is recorded as sent
in the dedup state and never re-fires. symptom: state file has the org key
but no message arrived anywhere. cause this time: the laptop socks5-proxy
(tailnet upstream for lumen's whatsapp) had died, lumen's
whatsapp websocket was down since ~06:58 local, and the 15:48 vaultwarden
warning (90.27 CU-h, <neon-org-id>) hit the window. diagnosis:
lumen Render logs show `bridge: whatsapp send failed: ... websocket not
connected` right after the `automation notification` line, while the bridge
still answered 200. recovery: (1) restart the proxy detached with the socks5
creds from facebook.com/.env.local (`SOCKS5_USER`/`SOCKS5_PASS` — never
commit them; the one previously exposed in this doc must be rotated) then
`Start-Process ...\socks5-proxy.exe 0.0.0.0:1080 -WindowStyle Hidden`
(creds must match Render's SOCKS_CHAIN_UPSTREAM); (2) if whatsmeow does not
reconnect on its own (no `Dialing wss://web.whatsapp.com` lines in logs —
its backoff can stall), trigger a Render deploy to force a fresh boot +
tailscale rejoin; (3) the lost warning will NOT auto-resend (dedup state
already marks the org warned) — re-send it manually with the same
Send-NeonUsageWarning payload; (4) verify real delivery via the lumen log
line `WhatsApp message sent via whatsmeow` (NOT the bridge 200). check
lumen whatsapp liveness directly: `GET /api/whatsapp/groups` with the bridge
secret — `websocket not connected` = down.

## lumen-cookie-health-watch.ps1 (VISIBLE window)

murmur-task-style visible console window so the user can see the watchdog working:
runs cookie-health.ps1 every 30 min forever in the foreground, color-coded, window title
"lumen cookie-health watch". spawned by scheduled task **lumen-cookie-health-watch**
(at logon, InteractiveToken, LeastPrivilege, ExecutionTimeLimit PT0S, IgnoreNew).
manual: `pwsh -NoExit -File lumen-cookie-health-watch.ps1 [-IntervalMinutes N]`.
replaces the old silent `lumen-cookie-health` task (logon + PT30M repetition), deleted
2026-08-17 after the visible task took over. per-check details still land in the same
$env:TEMP\lumen-cookie-health.log.

## murmur-cookie-refresher.mjs

browserless FB cookie refresher: agent-browser cookie vault -> lumen bridge
/api/cookies/upload + reload. invoked by cookie-health.ps1 on threshold hit; can also be
run standalone with the same env (MURMUR_HF_SPACE_URL, AGENT_BROWSER_EMAIL, HF_EMAIL).

## facebook-watch-unmute.user.js

tampermonkey userscript - unmutes facebook/messenger pages when the browser tab is
visible so voice-call notifications actually play; see header for update notes
(version bump required on every edit).
