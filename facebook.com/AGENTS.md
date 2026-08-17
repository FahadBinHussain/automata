# facebook.com cookie health + lumen watchdog

## cookie-health.ps1 (lumen FB cookie watchdog)

single health check of the lumen bridge + dailyBNP outbox (BNP_MESSENGER stale-cookie
signature: "send returned empty message ID" rows), triggers a browserless cookie refresh
through the agent-browser cookie vault when the failure threshold is hit. exit codes:
0 healthy, 2 refresh triggered, 3 bridge down, 4 DB error. env: BNP_DATABASE_URL (else
murmur/.env), MURMUR_HF_SPACE_URL (else http://127.0.0.1:8791), COOKIE_HEALTH_LOG (default
$env:TEMP\lumen-cookie-health.log), BNP_COOKIE_REFRESH_* tuning vars. full docs in the
script header. run: `pwsh cookie-health.ps1` or `-Loop`.

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
