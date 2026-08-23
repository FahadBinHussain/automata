# supabase watcher + cloud quota design (2026-08-22)

status: DESIGN ONLY - not built. single source of truth = vaultwarden.
local supabase quota script exists and works; cloud watchers are the plan.

---

## goal

one source of truth (vaultwarden) drives quota watching for our hosted
services. no per-service token drift between environments. local scripts and
cloud functions read the same vault items.

current tracked services:
- supabase (blindspot project <project-ref>): egress 5 GB, DB 500 MB,
  storage 1 GB
- neon (future, if it returns): CU-hours 100/project/month
- render (lumen <service-id>): free tier resource headroom check
  (CPU 0.1, memory 512 MB) - lives in automata as a LOCAL script, NOT lumen

---

## part 1 - what exists now (local, working)

### vault layout

vaultwarden item `supabase.com`:

```
Dashboard Session
alt.supabase.io|<refresh_token>        <- JWT path (rotates, saved back)

Access Tokens
sbp_v0_...                             <- Management API PAT

Xenovate
i5!^H$B&9e2j4                          <- (unrelated account data)
```

### local script

`automata\supabase.com\supabase-quota.ps1`:

1. read `Dashboard Session` from vault -> `<issuer>|<refresh_token>`
2. `POST {issuer}/auth/v1/token?grant_type=refresh_token` -> fresh access_token
   (30 min) + ROTATED refresh_token
3. `GET /platform/projects/{ref}/daily-stats?attribute=<attr>&startDate&endDate`
   with the access token -> egress/MAU/request numbers
4. write the ROTATED refresh token back into the vault -> cycle stays alive

run: `.\supabase-quota.ps1 [-ProjectRef <ref>] [-Days N] [-RawJson]`

limits: runs only on this pc, needs vault unlocked, no scheduled alerting.

### reverse-engineered endpoint catalog

source: supabase dashboard JS bundles (frontend-assets.supabase.com),
2026-08-22.

PAT-accessible (no login):
- `v1/projects/{ref}/config/disk/util` - DB disk (fs_used_bytes; quota 500 MB;
  note fs includes WAL/cluster overhead, raw pg_database_size is ~11 MB)
- `v1/projects/{ref}/analytics/endpoints/logs.all?sql=<sql>` - live Logflare
  SQL engine, project-scoped, no schema enumeration
- `v1/projects/{ref}/analytics/endpoints/usage.api-counts?interval=15min|30min|1hr|3hr|1day|3day|7day`
- `v1/projects/{ref}/analytics/endpoints/usage.api-requests-count`
- `v1/projects/{ref}/analytics/endpoints/functions.combined-stats`

JWT-only (dashboard session; PAT -> 401 "JWT could not be decoded"):
- `platform/projects/{ref}/daily-stats?attribute=<attr>&startDate&endDate`
  - attributes: total_egress, total_rest_egress, total_storage_egress,
    total_realtime_egress, total_auth_egress, total_cached_egress,
    total_supavisor_egress_bytes, total_auth_billing_period_mau, plus
    request-count attributes
  - response: `{"data":[{dt, total_egress, period_start}], "total",
    "totalAverage", "maximum", "format":"bytes"}`
- `platform/projects/{ref}/infra-monitoring?attributes=&startDate=&endDate=&interval=`
  (cpu/ram/disk)
- `platform/organizations/{slug}/usage/daily?start=&end=&project_ref=` (org)

login bootstrap (one-time per account): mainframe agent-browser -> sign-in ->
hcaptcha (invisible, retry submit may auto-pass) -> read
`localStorage["supabase.dashboard.auth.token"]` -> store refresh token in vault.

### render resource checker (LOCAL script, reverse-engineered 2026-08-23)

render does NOT expose CPU/RAM via its REST API (api.render.com/v1 with the
rnd_ API key) - those live behind the dashboard's GraphQL endpoint, which
needs the web-session idToken (NOT the API key).

- auth: a `signIn` GraphQL mutation on api.render.com/graphql accepts
  email+password and returns `{idToken, expiresAt}` with NO captcha - so the
  script logs in FRESH every run from the vault password. no session token is
  stored, so there is no 8-day expiry / refresh problem at all.
- query (captured from dashboard network traffic):
  ```graphql
  query metrics($query: MetricsQueryInput!) {
    metrics(query: $query) {
      series { unit labels { field value } values { time value } }
    }
  }
  ```
  variables.query = `{ filters:[{field:"RESOURCE", values:["<serviceId>"]}],
  start, end, name:"<METRIC>", resolution, parameters:[], aggregateBy:[],
  aggregationMethod:"NONE" }`
- valid metric names (from the dashboard's GraphQL type enum): CPU, CPU_LIMIT,
  CPU_TARGET, MEMORY, MEMORY_LIMIT, MEMORY_RSS, MEMORY_CACHE, MEMORY_TARGET,
  INSTANCES, DISK_USAGE, DISK_CAPACITY, DISK_READ/WRITE_THROUGHPUT, BANDWIDTH,
  ENRICHED_BANDWIDTH, HTTP_LATENCY, HTTP_REQUESTS, CONCURRENT_REQUESTS,
  ACTIVE_CONNECTIONS, CONNECTIONS_LIMIT, ...
- measured (lumen, 2026-08-23): CPU 0.0016 (1.6% of 0.1 limit),
  MEMORY_RSS 37.7 MB, MEMORY ~57 MB / 512 MB limit. ~7-11% memory, ~1.6% CPU -
  adding watchers is trivially safe.
- local script: `automata\render.com\render-quota.ps1` (BUILT 2026-08-23) -
  per-run signIn -> metrics query -> report headroom. NOT the lumen watcher -
  render usage is checked locally on demand.
- helper vault items: render.com login creds (<user>@example.com owns the
  workspace; the rnd_ API key also lives in the vault under API Keys).

---

## part 2 - proposed cloud design (single source of truth)

CHOSEN (2026-08-22): lumen + vaultwarden. NOT BUILT - waiting on more ideas.

principle: vaultwarden stays the ONE source of truth. lumen holds ZERO tokens
- no env vars for rotating secrets, nothing to drift. the token always comes
fresh from vaultwarden and the rotated one always goes back to vaultwarden.

### why lumen

lumen (FahadBinHussain/lumen-agent, Render <service-id>) ALREADY
ships a quota-watcher framework: `internal/notify/neonusage.go` is a faithful
Go port of the mainframe neon watcher (per-account api keys via env var names,
org consumption queries, threshold warnings, dedupe state per project/period,
delivery via postWebhook -> bridge -> messenger/whatsapp/discord threads).
a supabase watcher mirrors that file. lumen runs 24/7 on Render free tier and
already knows how to reach the chat threads.

### per-run flow

```
lumen notify wakeup (every N hours)
  -> vaultwarden: "give me the supabase refresh token"  (API-key auth)
  -> gotrue refresh -> fresh access JWT (30 min) + rotated refresh token
  -> query daily-stats (egress) + disk/util (db size)
  -> write ROTATED refresh token back to vaultwarden
  -> alert in chat if egress > 80% of 5 GB or db > 80% of 500 MB (dedupe per
     period, once per reset window)
```

### token handling - no staleness

- rotating secrets (supabase refresh token): read from vaultwarden, write back
  to vaultwarden. lumen never stores it across runs. a write-back failure only
  costs THIS run; next run reads whatever vaultwarden has.
- stable secrets (neon api key, supabase PAT): also vaultwarden items.
- lumen authenticates to vaultwarden via its API-key login (client_credentials
  on /identity/connect/token), NOT the master password - scoped, isolated from
  personal vault items.

### what lumen needs

- new `internal/notify/supabase.go` mirroring neonusage.go: refresh flow +
  daily-stats/disk-util queries + threshold + dedupe
- a vaultwarden API key (env var on render, non-rotating - it's a login key)
- a vaultwarden client helper (identity/connect/token + GET/PUT ciphers)
- config section `notify.supabase:` (project_ref, thread_id, thresholds)

### rejected alternatives (why not)

- vercel functions + per-service env vars: env vars for rotating tokens go
  stale (the whole problem this design avoids). only ONE env var could reach
  the vault (VAULTWARDEN_API_KEY) but that means a separate app just to do
  what lumen already does.
- lumen env var as token holder: write-back failure = stale token = dead
  watcher (same trap relocated).

### scheduler

lumen's notify loop (existing cron-style wakeup), or vercel cron / cron-job.org
hitting lumen's /api/automation/notifications as an external trigger. TBD.

### alert channel

lumen bridge -> messenger/whatsapp/discord threads (already working). no new
channel needed.

---

## open questions / not decided

- lumen notify scheduling: its internal loop vs an external cron trigger
  (vercel cron / cron-job.org) hitting the notifications endpoint
- vaultwarden API-key scoping details (dedicated cloud-watcher user vs org,
  exact collection permissions)
- whether the supabase PAT + neon api key also move into lumen watchers now,
  or only the egress/DB watcher first
- whether neon watcher is worth it (neon currently off after the supabase
  migration; only if a neon project returns)

## cleanup (post-build)

once the lumen watchers are live and verified:

- **neon watcher (bundled)**: it runs inside the `lumen-cookie-health-watch`
  scheduled task today — cookie-health.ps1 calls `neon-hours-table.ps1 -Json`
  every 30 min (murmur parity, added 2026-08-18). once lumen has its own
  neon_usage watcher enabled, REMOVE the neon call from cookie-health.ps1
  (the task itself stays — it still does FB cookie health).
- local scripts stay as manual/on-demand tools (`supabase-quota.ps1`,
  `neon-hours-table.ps1`, etc.) — no need to delete them.

note: the old cron-job.org neon watchdog job `8287828` was disabled
2026-08-20 after the supabase migration — not part of this cleanup.

## gotchas (learned 2026-08-22)

- supabase refresh token ROTATES on every refresh; must be saved back or the
  stored one goes stale after one use
- `[switch]$Raw` in a ps1 that also reads `$raw` from the vault module =
  PowerShell case-insensitive variable collision (string -> SwitchParameter);
  use distinct names (script uses `$RawJson` + `$vaultSession`)
- `/platform/*` needs the dashboard JWT; `analytics/endpoints/*` + disk/util
  work with the PAT
- automation-browser login hits an invisible hcaptcha that can deadlock on
  "Signing in..." forever; retrying the submit sometimes auto-passes it
