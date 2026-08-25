# facebook.com cookie health + bridge watchdog

## cookie-health.ps1 (FB cookie watchdog)

single health check of a bridge + messenger outbox (stale-cookie
signature: "send returned empty message ID" rows), triggers a browserless cookie refresh
through the agent-browser cookie vault when the failure threshold is hit. exit codes:
0 healthy, 2 refresh triggered, 3 bridge down, 4 DB error. env: BNP_DATABASE_URL (else
a project .env), MURMUR_HF_SPACE_URL (else http://127.0.0.1:8791), COOKIE_HEALTH_LOG (default
$env:TEMP\lumen-cookie-health.log), BNP_COOKIE_REFRESH_* tuning vars. full docs in the
script header. run: `pwsh cookie-health.ps1` or `-Loop`.

**proxy gotcha**: the /api/health call uses `-NoProxy` — never let it
depend on the system proxy. symptom: every check logged
`UNREACHABLE (... actively refused it. (127.0.0.1:7890))` while fresh pwsh processes
hit the bridge fine — the long-lived watch window caches WebRequest.DefaultWebProxy
at boot, so a proxy enabled at logon keeps being used hours after it is disabled.
the window picks up script edits on the next cycle (script files re-read per
invocation), but a restart of the watch task is the belt-and-suspenders move.

**silent-delivery loss gotcha**: the bridge returns HTTP 200
`{"status":"sent"}` even when the messenger send FAILED (bridge contract) — so a
warning whose send failed is recorded as sent in the dedup state and never re-fires.
symptom: state file has the org key but no message arrived anywhere. diagnosis:
bridge logs show `send failed: ... websocket not connected` right after the
`automation notification` line, while the bridge still answered 200. recovery:
(1) restart the proxy/socks dependency (creds from `.env.local` — never commit
them); (2) if the whatsapp websocket does not reconnect on its own, trigger a
deploy to force a fresh boot; (3) the lost warning will NOT auto-resend (dedup state
already marks it warned) — re-send it manually; (4) verify real delivery via the
bridge log line confirming the message was sent (NOT the bridge 200). check
messenger liveness directly via the bridge's liveness endpoint — a
`websocket not connected` response = down.

## lumen-cookie-health-watch.ps1 (VISIBLE window)

visible console window so the user can see the watchdog working:
runs cookie-health.ps1 every 30 min forever in the foreground, color-coded, window title
"lumen cookie-health watch". spawned by scheduled task **lumen-cookie-health-watch**
(at logon, InteractiveToken, LeastPrivilege, ExecutionTimeLimit PT0S, IgnoreNew).
manual: `pwsh -NoExit -File lumen-cookie-health-watch.ps1 [-IntervalMinutes N]`.
per-check details still land in the same $env:TEMP\lumen-cookie-health.log.

## murmur-cookie-refresher.mjs

browserless FB cookie refresher: agent-browser cookie vault -> bridge
/cookies/upload + reload. invoked by cookie-health.ps1 on threshold hit; can also be
run standalone with the same env (MURMUR_HF_SPACE_URL, AGENT_BROWSER_EMAIL, HF_EMAIL).

## facebook-watch-unmute.user.js

tampermonkey userscript - unmutes facebook/messenger pages when the browser tab is
visible so voice-call notifications actually play; see header for update notes
(version bump required on every edit).
