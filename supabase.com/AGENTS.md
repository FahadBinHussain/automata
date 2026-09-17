# Supabase quota (local notes)

reusable script: `C:\Users\<user>\Downloads\automata\supabase.com\supabase-quota.ps1`

checks supabase free-tier usage (egress/storage/MAU daily stats) via the
DASHBOARD JWT path - the Management API (PAT) only exposes DB disk/util +
analytics/endpoints; egress numbers live behind `/platform/*` which requires a
dashboard session JWT.

## script

- args: `-ProjectRef` (default from env/.env.local), `-Days` (lookback, default
  30), `-Email` (default from env/.env.local), `-OrgSlug`,
  `-RawJson` (dump full json), `-AllProjectsFlag`.
- flow: read refresh token from vault -> refresh via gotrue (rotates the
  refresh token, old token dies immediately) -> write the ROTATED refresh token
  back to the vault BEFORE querying daily-stats -> GET
  /platform/projects/{ref}/daily-stats per attribute. if the process dies
  between refresh and vault save the stored token is dead and the next run
  gets 400 refresh_token_already_used - the script now catches that and
  prints the re-login steps instead of a raw 400.
- vault item: `supabase.com` -> "Dashboard Session" section, value format
  `<issuer>|<refresh_token>` (issuer = `alt.supabase.io`). requires the
  Bitwarden vault unlocked (automata\bitwarden.com\unlock.ps1 or BW_SESSION).
- free plan: 5 GB egress / 1 GB storage / 500 MB DB per project. DB size comes
  from the PAT (`v1/projects/{ref}/config/disk/util`); egress/MAU come from
  the daily-stats JWT endpoint.

## reverse-engineered endpoints (from the dashboard JS bundles)

all `/platform/*` paths return `401 {"message":"JWT could not be decoded"}`
with a PAT - they need the dashboard user JWT (from
`localStorage["supabase.dashboard.auth.token"]`, refreshed via gotrue).

- refresh: `POST https://alt.supabase.io/auth/v1/token?grant_type=refresh_token`
  body `{"grant_type":"refresh_token","refresh_token":"<token>"}` -> fresh
  access_token (30 min) + ROTATED refresh_token. the rotated token must be
  saved back after each use or the stored one goes stale.
- daily stats: `GET https://api.supabase.com/platform/projects/{ref}/daily-stats?attribute=<attr>&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
  -> `{"data":[{dt, total_egress, period_start}], "total", "totalAverage", "maximum", "format":"bytes"}`.
  attributes: `total_egress` (all), `total_rest_egress`, `total_storage_egress`,
  `total_realtime_egress`, `total_auth_egress`, `total_cached_egress`,
  `total_supavisor_egress_bytes` (pooler), `total_auth_billing_period_mau`,
  + request-count attributes (total_get_requests, total_post_requests, ...).
- infra monitoring: `GET /platform/projects/{ref}/infra-monitoring?attributes=&startDate=&endDate=&interval=` (cpu/ram/disk).
- org usage: `GET /platform/organizations/{slug}/usage/daily?start=&end=&project_ref=` (JWT).
- analytics (PAT-accessible, no JWT needed):
  - `v1/projects/{ref}/analytics/endpoints/logs.all?sql=<sql>` - live Logflare SQL engine (project-scoped; no schema enumeration).
  - `v1/projects/{ref}/analytics/endpoints/usage.api-counts?interval=15min|30min|1hr|3hr|1day|3day|7day`
  - `v1/projects/{ref}/analytics/endpoints/usage.api-requests-count`
  - `v1/projects/{ref}/analytics/endpoints/functions.combined-stats`
- DB size (PAT): `v1/projects/{ref}/config/disk/util` -> `metrics.fs_used_bytes` (dashboard "Database size"; free quota 500 MB). note raw `pg_database_size` is far smaller than `fs_used_bytes` - fs includes WAL/cluster overhead, and the quota uses fs.

## gotchas

- **supabase-quota.ps1 vault module path was a literal placeholder (fixed 2026-09-17)**: the
  script had `$vaultModule = "<user-home>\Downloads\mainframe\vault-secret.psm1"` - a literal
  string that never resolves, so EVERY run died at Import-Module with "vault module not found".
  the docs convention writes `C:\Users\<user>` in AGENTS.md, but executable code must use
  `$env:USERPROFILE` / `Join-Path $env:USERPROFILE ...`. audit other automata scripts for the
  same placeholder leak if they touch mainframe.
- **mainframe supabase-usage-table.ps1 is token.txt-only, not vault (2026-09-17)**:
  `supabase-account.ps1` (login/token-add) writes the PAT to BOTH the vault and
  `%APPDATA%\mainframe\accounts\supabase\<email>\token.txt`, but two profiles here had the
  vault secret and NO token.txt, so `supabase-usage-table.ps1` printed the false negative
  "No Supabase projects found." instead of an error - it silently treats a missing token.txt
  as "zero projects". if that line ever appears again, check `Test-Path ...\<email>\token.txt`
  first; materialize it from the vault (`Read-VaultSecret -ValueRegex 'sbp_v0_[A-Za-z0-9]+'`)
  rather than re-running `token-add`.
- **vault item NAMING is inconsistent across supabase accounts (2026-09-17)**:
  most accounts' PAT lives in an item named `supabase.com` / `supabase.com[2]`
  (matches the `supabase-account.ps1` lookup `-NamePattern 'supabase.com*'`),
  but `amihimu492@gmail.com`'s PAT is in an item named **`supabase amihimu492`**,
  which does NOT match that pattern. consequence: the helper's `status-all`
  reports `HasToken=False` and the profile looks unprovisioned even though a
  valid PAT exists - and I told the user the account "needs a login" when it
  did not. read it with `-NamePattern 'supabase*amihimu*'` (or a broad pattern)
  before concluding an account has no token. its token.txt is now materialized
  so the file-based bulk scripts see it regardless.

  `400 refresh_token_already_used` = rotation desync (script crashed between POST and vault
  save; re-login NOT needed if the rotated token can be recovered). `400 session_expired` /
  "Invalid Refresh Token: Session Expired (Inactivity)" = the dashboard session itself died
  from inactivity; no token trick recovers it, only the agent-browser login bootstrap below.
  the supabase-quota.ps1 error text already distinguishes them - read it before assuming
  rotation desync.

- **refresh token rotation / already_used (2026-09-02)**: every refresh returns
  a NEW refresh token and the old one dies immediately; if you don't save it
  back (crash between POST and vault write, BW_SESSION expiry, etc.) the
  stored token is single-use and the next run gets
  `400 refresh_token_already_used`. the script now catches that code and
  prints the re-login recovery steps. manual tests must save the rotated
  token too.
- **egress metric gotcha (2026-09-02)**: `total_egress` has been 0 every day
  since project creation (2026-08-20); actual DB egress is in
  `total_supavisor_egress_bytes` (pooler, 902 MB in 13 days). the script now
  reports free egress as `max(total_egress, supavisor)` so it doesn't show
  0% while the pooler burns quota - the dashboard counts pooler toward the
  5 GB cap.
- the automation-browser login flow hits an invisible hcaptcha that can deadlock
  ("Signing in..." forever); retrying the submit sometimes auto-passes it.
  there's no browser-free way to mint the initial session - it requires one
  dashboard login per account, captured from localStorage.
- `[switch]$Raw` in a script that ALSO reads `$raw` from the vault module is a
  PowerShell case-insensitive collision (string -> SwitchParameter conversion
  error). the script uses `$RawJson` + `$vaultSession` - keep the rename if
  editing.
- vault value regex must be `alt\.supabase\.io\|\S+` (escape the pipe).

## login bootstrap (only needed once per account, reuses mainframe agent-browser)

1. sync profile: `edge-cdp-profile-sync.ps1 -Email <email>`
2. spawn: `agent-browser open https://supabase.com/dashboard/sign-in` (detached)
3. fill creds from the `supabase.com` vault item, submit; solve captcha if it appears
4. read `localStorage["supabase.dashboard.auth.token"]`, store the refresh
   token + issuer as "Dashboard Session" in the same vault item

## migrating a live app DB onto Supabase (vaultwarden, 2026-09-17)

moved the vaultwarden vault DB off burning Neon (`morning-boat-12477900`,
bengalforce, 96.27/100 CU-h, always-on) onto a fresh free Supabase project
`vaultwarden` (`htpilohdqzbfhzlksxeg`, us-west-2, slot 2/2 on
fahadbinhussain001@gmail.com). the app is the Render web service
`vaultwardenn` (`srv-d31qaobuibrs73980e2g`, oregon, repo
FahadBinHussain/vaultwarden-render-template) - same recipe as the lumen neon
migration: dump -> restore -> verify -> flip the service env -> redeploy ->
prove a live write -> suspend the old endpoint.

recipe (zero downtime, ~15 min):
1. `pg_dump -F c` the source (10 MB -> 975 KB compressed); save the OLD
   DATABASE_URL to C:\tmp first so rollback survives a vault outage (this vault
   holds every other credential - a failed swap with no rollback = total
   lockout).
2. create the project: `POST /v1/projects` with `{name, organization_id,
   db_pass, region, plan:'free'}`. pick the region to match the *compute*
   (oregon render -> us-west-2), not the old DB region.
3. `pg_restore --no-owner --no-privileges -d <dsn> <dump>`. PG 18 dump into a
   PG 17 target restored clean (vaultwarden's schema is plain).
4. diff the table SET between source and target (`pg_tables where
   schemaname='public'`), not just counts - count-only checks miss a dropped
   table.
5. flip the service env + redeploy, then PROVE the cutover: record
   `max(updated_at)` on both DBs, run a real authenticated write through the
   app (`bw sync`), re-read both. target advanced + source frozen = done.

### CRITICAL: PostgREST auto-exposes every public table to the public anon key

unlike plain neon, Supabase publishes a REST + GraphQL API over the `public`
schema authenticated with the `anon` key, which is embedded in client bundles =
effectively public. restoring a secrets DB into `public` unhardened makes the
whole vault readable by strangers - verified: `SET ROLE anon; SELECT count(*)
FROM ciphers` returned **1259** before hardening. this is a new attack surface
that did not exist on neon. harden on EVERY such migration:

```sql
DO $do$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $do$;
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
```

RLS with NO policies = deny-by-default to `anon`/`authenticated`; the `postgres`
service role BYPASSES RLS, so the app (which connects as `postgres`) is
unaffected. **do NOT add `FORCE ROW LEVEL SECURITY`** - that would also bind
the service role the app connects as and break it. after hardening, anon gets
`permission denied for table ciphers` (verified) while the service role still
reads 1259. keep the SQL in a file and `psql -f` it - a PowerShell `@"..."@`
here-string mangles `$$` blocks (`\$do\$` -> literal backslash-dollar ->
syntax error), and that silent failure leaves the vault EXPOSED while the
verification query says the DO block "ran" (it did not - the error is easy to
miss in the output).

### new Supabase projects: direct DB host is IPv6-ONLY, use the session-mode pooler

`db.<ref>.supabase.co` resolves to AAAA only (no A record) for fresh projects.
from an IPv4-only machine (this one has no IPv6 route) `psql`/`pg_restore`
fail with "could not translate host name". the universally-reachable target is
the **session-mode pooler**: `aws-0-<region>.pooler.supabase.com:5432`, user
`postgres.<ref>`, `?sslmode=require`. use port **5432** (session mode), NOT
6543 (transaction mode - breaks session state/prepared statements). this works
for the Render service too, since it routes by the `postgres.<ref>` username.
`GET /v1/projects/{ref}/database/settings` does not exist (404 "Cannot GET") -
do not hunt for a connection-strings endpoint, assemble the DSN from the ref +
region.

### free-tier caveats vs neon always-on

- Supabase free **pauses a project after ~7 days of no DB/API activity**.
  always-on neon had no such failure mode. the bw CLI hits the vault
  constantly, so it should stay warm, but a fully quiet week would pause the
  vault and break every automation's secret source. watch for it.
- free DB quota is 500 MB (this DB is 10 MB - fine).
- the direct connection is `db.<ref>.supabase.co:5432`, role `postgres`, but
  the pooler is the practical target from IPv4-only hosts (above).

### where the DSN lives

`automata\supabase.com\.env.local` holds the project ref + region (no secret).
the full DSN is in the vault item `supabase.com` under the header `Vaultwarden
Database (pooler session mode)`; the app's live copy is the Render service env
(read it back with `GET /v1/services/{sid}/env-vars` if the vault is down).
old neon DSN for rollback: `C:\tmp\vw-rollback.txt`; dump:
`backups\vaultwarden\vaultwarden_2026-09-17.dump`.

## same recipe, second instance: dailybnp (2026-09-17)

moved the **dailybnp.com** news portal off burning Neon (`Daily-BNP`,
sparkling-shape-81096821, ahmedtouhid88, 91.63/100 CU-h, always-on, ~33h to
death) onto a fresh free Supabase project `dailybnp`
(`hgjurljzuntgpuhxloza`, us-east-1, slot 2/2 on fahadbix@gmail.com). same
dump -> restore -> harden -> flip -> prove recipe; two things differed.

**1. the app is Next.js + Prisma + NextAuth on VERCEL, not a Render service.**
the flip is a Vercel env change + a new deployment, not a Render env PUT:
- the old `DATABASE_URL` was type `encrypted` (unreadable via API). delete it
  (`DELETE /v9/projects/dailybnp/env/{id}?teamId=`) then POST the new one with
  `type: "plain"` and `target: ["production","preview","development"]` - the
  API rejects `"config"`, wants `plain`.
- `POST /v13/deployments/{id}/redeploy` 404s ("endpoint not found") on this
  account - do NOT chase it. instead create a fresh deployment from the same
  git source: `POST /v13/deployments?teamId=` with
  `{name, project, target:"production", gitSource:{type:"github", repoId, ref, sha}}`
  (repoId + sha from `GET /v13/deployments/{latest}`). right after creation the
  GET on the new id 404s for ~a minute while it initializes - the *list*
  endpoint (`/v6/deployments?projectId=`) already shows `READY`; poll that.
- the import cron (cron-job.org) hits a Vercel API route, not the DB, so it
  needs NO reconfiguration - it just keeps writing through the app.

**2. NextAuth's token tables make the PostgREST exposure worse.** the restored
schema includes NextAuth's `Account` (access_token / refresh_token /
id_token), `Session` and `VerificationToken`. unhardened those are live OAuth
credentials readable by strangers. the same RLS + REVOKE block covers them -
verified `SET ROLE anon` gets `permission denied` while Prisma's `postgres`
service role still reads. note the app originally looked Supabase-native
(roles `authenticator`/`anonymous`/`authenticated`, empty `auth`/`pgrst`
schemas) but its real auth is NextAuth in `public` - dump `-n public` only and
skip the empty legacy schemas.

**proving the cutover on a cron-driven app:** the importer writes a heartbeat
to `SystemConfig.source_import_external_token_last_run_at` every ~2 min, so
read that column on BOTH DBs around a cycle. target advanced + source frozen
across two reads = done (04:05:10 -> 04:07:05 on supabase, neon stuck at
03:57:05).

where things live: DSN in vault item `supabase.com` (fahadbix) under
`DailyBNP Database (pooler session mode)`; project ref in
`daily-bnp\.env.local` (repo `FahadBinHussain/daily-bnp`); rollback neon DSN
`C:\tmp\bnp-rollback.txt`; dump
`backups/daily-bnp/dailybnp_2026-09-17.dump` (4.45 MB, public schema only).

## third instance: wakapi (2026-09-17) - a QUOTA migration, not a dying-DB one

moved the **wakapi** coding-tracker DB (`kjmphyzcfvqgxejxfmph`, fahadbix,
ap-south-1) onto a fresh free project `wakapi` (`fqbwubhxwtswdslwzwmn`,
ap-south-1, slot 1/2 on amihimu492@gmail.com). the trigger was different:
neon was fine, but the OLD project sat at **502.6 MB of its 500 MB DB quota**
(100.5%) - a soft cap (notify -> grace period -> fair-use pause/read-only/402),
so it was a scheduled death rather than an imminent one. same dump -> restore
-> harden -> flip -> prove recipe, but the flip is a **Render** service
(free web service `srv-cu294r52ng1s73ftke50`, muety/wakapi, singapore,
`https://wakapi-qt1b.onrender.com`), so the env change is the Render API, not
Vercel.

proved: old frozen at 159,224 heartbeats / 06:29:11; fresh took a live
heartbeat POST (201) and went 159,090 -> 159,091 with exactly the test row
(`project=wakapi-migration-verify`, 07:52:40.093).

### CRITICAL: Render PUT /env-vars REPLACES the whole set - it does NOT merge

`PUT /v1/services/{sid}/env-vars` is a full overwrite. i sent only the 2 vars
i wanted to CHANGE (`WAKAPI_DB_USER`, `WAKAPI_DB_PASSWORD`) and it silently
DELETED the other 5 (`WAKAPI_DB_TYPE`, `_HOST`, `_PORT`, `_NAME`, `_SSL`).
symptoms were confusing: `/api/health` still returned `app=1 db=1` (db=1 is
just "i can open a DB" - with no `WAKAPI_DB_TYPE` wakapi silently falls back
to **SQLite**, so db=1 meant an empty sqlite FILE), and every API call 401'd
because that sqlite file had no users. nothing in the health endpoint reveals
the fallback. the only reliable signal was `pg_stat_activity` on the fresh
project showing zero app sessions.

the body must be a raw JSON **array**: `[{"key":"...","value":"..."}]`. the
object wrapper `{"envVars":[...]}` is rejected 400 "invalid JSON". and
`GET /env-vars` returns entries wrapped as
`{"envVar":{"key":...,"value":...},"cursor":...}` - read `.envVar.key`, not
`.key`. likewise `POST /deploys` returns the deploy object at the TOP level
(`{id,status,...}`), NOT under `.deploy` (only the LIST endpoint wraps in
`.deploy`).

the fix (2026-09-17): GET current vars, assemble the COMPLETE 7-var set, PUT
it back in one call, then `POST /v1/services/{sid}/deploys` with body `{}`,
poll `GET /deploys/{id}` until `live`. rule: **never PUT a partial env set to
Render - always send every var the service needs.**

### what the 502 MB actually was (nothing was reclaimable)

before migrating i tried to reclaim space and found there was nothing to
clean: 0% dead tuples on both big tables, no index bloat, no junk tables,
`VACUUM (ANALYZE)` changed nothing, `pg_switch_wal()` is permission-denied on
supabase. the real composition:
- **fixed ~180 MB floor every project pays** (postgres + extensions + supabase
  files). measured by the `fs_used_bytes - pg_database_size - WAL` gap on two
  QUIET projects: dailybnp 181.6 MB, vaultwarden 181.7 MB - identical.
- 119 MB real data (heartbeats 86 MB / 159k rows, durations 19 MB, summaries
  ~1.2 MB) - the actual user history, ~40 MB/yr growth.
- 160 MB WAL (vs 64-80 MB on quiet projects) because wakapi writes a heartbeat
  every ~2 min 24/7. WAL is RECYCLED at checkpoints (`checkpoint_timeout`=300s,
  `min_wal_size`=1024 MB) - it is a circular journal, not a one-way ratchet.

so ~36% of the volume is a fixed tax, not the user's data. wakapi's retention
setting (`WAKAPI_DATA_RETENTION_MONTHS`, default -1 = forever) would delete
BOTH heartbeats AND summaries older than the cutoff - irreversible loss of the
"forever coding history" - and `housekeeping.go` never cleans `durations`
anyway. the user rejected that; migration was the only real option.

### wakapi auth + heartbeat endpoints

auth is `Authorization: Basic base64(<api_key>)` (a plain Bearer also works -
`ExtractBearerAuth` accepts both). the api key is `users.api_key` (text) for
the local-auth user; the `api_keys` table is empty. heartbeat POST routes live
under the `/api` prefix: `/api/v1/users/current/heartbeats`,
`/api/heartbeat`, `/api/heartbeats` (a POST body is a single object or an
array; the response is `{"responses":[[{...},201]]}`). note
`GET /api/v1/users/current` is NOT a route (404 page not found) - do not use
it as an auth probe; POST a heartbeat instead.

where things live: DSN in vault item `supabase.com` (amihimu492) under
`Wakapi Database (pooler session mode)`; app env on the Render service (GET
`/v1/services/srv-cu294r52ng1s73ftke50/env-vars`); dumps
`backups/wakapi/wakapi_full_2026-09-17_pre-noise-cleanup.dump` (6.22 MB,
restore-verified 159,090 heartbeats into a scratch db) and
`backups/wakapi/wakapi_old_final_2026-09-17_frozen.dump` (6.29 MB, the LAST
state of old incl. the 134 heartbeats that arrived post-dump). old project is
frozen, NOT yet deleted (deletion is destructive - confirm with the user
first; the final frozen dump preserves everything if it gets deleted).
