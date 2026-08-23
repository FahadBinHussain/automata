# supabase/neon watcher + cloud quota design (2026-08-22, rev 2026-08-23)

status: DESIGN FINALIZED. NOT BUILT. lumen holds its own tokens in its Neon
DB; vaultwarden is NOT in the lumen flow at all (only local bootstrap + local
agents).

---

## goal

cloud quota watchers (supabase egress/DB, neon CU-hours) run inside lumen and
alert to chat. zero staleness, scales to many accounts, nothing about the
user's master password ever touches Render. local scripts keep working.

current tracked services:
- supabase (blindspot project <project-ref>): egress 5 GB, DB 500 MB,
  storage 1 GB
- neon (future, if it returns): CU-hours 100/project/month
- render (lumen <service-id>): free tier resource headroom check
  (CPU 0.1, memory 512 MB) - lives in automata as a LOCAL script, NOT lumen

---

## part 1 - what exists now (local, working)

### vault layout (personal, local-only)

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

source: supabase dashboard JS bundles (frontend-assets.supabase.com), 2026-08-22.

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

## part 2 - cloud design (FINAL: lumen owns its tokens, no vaultwarden)

DECIDED 2026-08-23: lumen holds its watcher tokens in its OWN Neon DB
(persistence DB it already has). vaultwarden is NOT part of the lumen flow.

### why NOT vaultwarden (rejected after deep investigation)

vaultwarden is zero-knowledge: every item value is encrypted, and only a
master-password-derived key can decrypt it. there is NO way for a machine to
read plaintext item values without holding a password:

- personal API key (client_credentials) -> authenticates, but returns ENCRYPTED
  blobs (verified 2026-08-23: cipher name/password/notes + profile key/privateKey
  all come back as `2.IV|CT|MAC` blobs). no decryption key.
- org sharing -> items shared to a collection are encrypted with a collection
  key that EACH MEMBER decrypts with their OWN password. works for humans, but
  lumen would need to be a member with its OWN password (= a new watcher user
  whose password lumen holds). possible, but adds a user + org + sharing setup
  and still requires lumen to hold a credential.
- Bitwarden Secrets Manager -> the right IDEA (machine tokens, no master pass)
  but NOT implemented in vaultwarden (all /api/secrets/, /api/machine-accounts/,
  /api/projects/, /sm/ endpoints 404 on vaultwarden 1.37.1). it's Bitwarden-cloud
  only, which would fork secrets away from the self-hosted vault.
- master password in lumen env -> works but puts the whole vault's decryption
  key on Render (co-located with the encrypted data). rejected.

conclusion: lumen should NOT read the vault at all.

### the design (final)

lumen's own Neon DB (the persistence DB it already uses for snapshots/sessions)
gets an `app_state` table:

```
app_state (key text pk, value text, updated_at timestamptz)
  supabase.<ref>.refresh_token     = lumen's session (self-rotating)
  supabase.<ref>.issuer            = alt.supabase.io
  neon.<account>.api_key           = stable
  render.<svc>.password            = stable (if a render watcher is ever added)
  ... one row per account per service
```

lumen reads its token rows, calls the service, and writes back any rotation.
atomically. the supabase refresh token is lumen's OWN session credential - it
self-rotates in lumen's DB and never needs vaultwarden.

### bootstrap (one-time seed, local, master password stays on the PC)

a LOCAL script (automata\supabase.com\supabase-seed-lumen.ps1):
1. reads tokens from the local vault (master password, local only)
2. writes them into lumen's Neon `app_state` table via lumen's DATABASE_URL
   (or a lumen /api endpoint)
3. thereafter lumen owns its rows; no further sync needed

new accounts: add a row to `app_state` (via the same local seed script), lumen
picks it up on the next notify tick. (lumen is a persistent process that never
dies - it's not "picked up next run", the notify loop reads app_state every
tick while it runs.)

### per-run flow (lumen notify, every N hours)

```
supabase watcher:
  -> read supabase.<ref>.refresh_token + issuer from lumen Neon app_state
  -> gotrue refresh -> fresh access JWT (30 min) + ROTATED refresh token
  -> query daily-stats (egress) + disk/util (db size)
  -> write ROTATED refresh token back to app_state (atomic)
  -> alert in chat if egress > 80% of 5 GB or db > 80% of 500 MB (dedupe
     per period, once per reset window)

neon watcher (if neon returns):
  -> read neon.<account>.api_key from app_state
  -> org consumption endpoint -> warn if CU-hours > 80%
```

### zero staleness

- rotating token (supabase refresh): lives ONLY in lumen's DB, read+written by
  lumen every notify tick. no env var, no vault copy to drift. a write-back
  failure costs THIS tick only; the next tick reads whatever the DB has.
- stable tokens (neon api key, PAT): never rotate, so they cannot go stale.

### what lumen needs

- `internal/notify/supabase.go` mirroring neonusage.go: app_state read/write +
  gotrue refresh + daily-stats/disk-util queries + threshold + dedupe
- `app_state` table in the existing persistence Neon DB (schema migration)
- config section `notify.supabase:` (project_ref, thread_id, thresholds,
  app_state table name)
- the local seed script (bootstrap only)

### scheduler

lumen's existing notify loop (internal ticker per poller, already built -
notify.go). no external cron needed.

### alert channel

lumen bridge -> messenger/whatsapp/discord threads (already working). no new
channel needed.

---

## open questions / not decided

- how lumen reaches its Neon app_state: direct DATABASE_URL (already has one
  for persistence) vs a small /api endpoint on the bridge. direct is simpler.
- whether the supabase PAT also moves into app_state (for disk/util) or the
  dashboard JWT covers it (disk/util works with the PAT; the JWT is only for
  daily-stats egress). likely both rows per account.
- whether neon watcher is worth it (neon currently off after the supabase
  migration; only if a neon project returns).

## cleanup (post-build)

- **neon watcher (bundled) — DONE 2026-08-23**: the neon call was removed from
  cookie-health.ps1 (lumen-cookie-health-watch task stays — it still does FB
  cookie health). lumen's own neon_usage watcher (internal/notify/neonusage.go,
  already enabled in production.yaml) is the sole neon quota watcher now.
- local scripts stay as manual/on-demand tools (`supabase-quota.ps1`,
  `render-quota.ps1`, `neon-hours-table.ps1`, etc.) — no need to delete them.

note: the old cron-job.org neon watchdog job `8287828` was disabled
2026-08-20 after the supabase migration — not part of this cleanup.

## gotchas (learned 2026-08-22/23)

- supabase refresh token ROTATES on every refresh; must be saved back or the
  stored one goes stale after one use
- `[switch]$Raw` in a ps1 that also reads `$raw` from the vault module =
  PowerShell case-insensitive variable collision (string -> SwitchParameter);
  use distinct names (script uses `$RawJson` + `$vaultSession`)
- `/platform/*` needs the dashboard JWT; `analytics/endpoints/*` + disk/util
  work with the PAT
- automation-browser login hits an invisible hcaptcha that can deadlock on
  "Signing in..." forever; retrying the submit sometimes auto-passes it
- vaultwarden API-key client_credentials needs `device_identifier` +
  `device_type` in the token body (else "device_identifier cannot be blank").
  verified: it authenticates but CANNOT decrypt items (encrypted blobs).
- vaultwarden 1.37.1 has NO Secrets Manager (all /sm/ + /api/secrets/ +
  /api/machine-accounts/ endpoints 404).
- render signIn mutation needs NO captcha and NO auth header - just
  {operationName: signIn, variables: {email, password}} - perfect for
  per-run fresh login (no token storage).
- the vaultwarden admin panel is DISABLED (no ADMIN_TOKEN env) and the
  register API 404s even though config says disableUserRegistration: false.
  (relevant only if the org/watcher-user route is ever revisited.)
