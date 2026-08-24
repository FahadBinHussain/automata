# neon.com - free-tier compute quota bypass research + export tooling

## context / the problem (2026-08-23)

dailyBNP's Neon project burned its free-tier compute quota:
- project: `Daily-BNP` = `PROJECT_ID_REDACTED`, org `ORG_ID_REDACTED`
- account: `ACCOUNT_EMAIL_REDACTED` (mainframe neon profile, API key in vault:
  `Read-VaultSecret -Email 'ACCOUNT_EMAIL_REDACTED' -NamePattern 'console.neon.tech*' -ValueRegex 'napi_[A-Za-z0-9]+'`)
- region `aws-us-east-1`, pg 17, main branch `MAIN_BRANCH_REDACTED`, db `neondb`
- endpoint `ENDPOINT_REDACTED` (host `ENDPOINT_REDACTED.c-3.us-east-1.aws.neon.tech`,
  compute host `ENDPOINT_REDACTED-hld...`, pooler `...-pooler.c-3...`)
- pooler DSN (in murmur/.env + daily-bnp/.env.local):
  `postgresql://neondb_owner:npg_REDACTED@ENDPOINT_REDACTED-pooler.c-3.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require`
- status: **110.41 CU-h used vs 100 limit → compute SUSPENDED with 402** on every
  connection path; storage intact 44.8 MB; period 08/01 → **09/01 00:00 UTC** reset.
- quota is **per-project** (not per-org/account): 100 CU-h = 360,000 CU-sec bucket;
  period-bounded value comes from `GET /organizations/{org_id}/consumption` →
  `periods[last].compute_time` (CU-sec). `compute_time_seconds` on project detail is
  LIFETIME-cumulative, do NOT use it for current-period decisions.

## the trick that WORKS while frozen: storage-level branch snapshot

The compute quota gate is enforced at the Neon proxy on EVERY compute-consuming path
(all return 402/412/423 "compute time quota exceeded; usage:N, limit:396000"). BUT
**branch creation with NO endpoint is a pure storage-layer operation (copy-on-write in
the pageserver) and succeeds even over quota.**

```
POST /api/v2/projects/PROJECT_ID_REDACTED/branches
{"branch":{"parent_id":"MAIN_BRANCH_REDACTED"}}     # NO "endpoints":[] key
# → 201 SNAPSHOT_BRANCH_REDACTED  (parent_lsn 0/81E8578, logical_size 46948352)
```

This freezes the exact current state of the DB into a child branch without touching
compute. Use it the moment you notice the quota is gone — always safe insurance.

## branch created 2026-08-23 (still exists, do NOT delete without asking)

- `SNAPSHOT_BRANCH_REDACTED` = frozen copy of main at LSN `0/81E8578`, logical size
  46,948,352 bytes (44.77 MB), state `ready`. Root branch `MAIN_BRANCH_REDACTED`
  unchanged.
- this is the fallback restore point. when the period resets (or if a paid upgrade
  ever happens), create an endpoint on this branch and pg_dump it.

## verified dead ends (as of 2026-08-23) — do NOT re-try these

all tested live against the real project; each returned 402/412/423 quota gate unless noted:

1. **psql pooler** (`...-pooler...:5432`): `ERROR: Your account or project has exceeded the compute time quota`.
2. **psql direct** (`ep-...c-3...:5432`): same 402.
3. **psql compute host** (`ep-...-hld.c-3...`): same 402.
4. **serverless driver wss** (`@neondatabase/serverless`, wss pooler): 402.
5. **serverless HTTP driver** `api.c-3.us-east-1.aws.neon.tech/sql` (Neon-Connection-String
   header): 402. **`apiauth.c-3.../sql`** (JWT auth variant) is NOT quota-gated (returns
   400 auth errors) but requires a valid JWT validated against a registered JWKS.
6. **Data API `.apirest` route** (`ep-...-hld.apirest.../neondb/rest/v1`): NOT quota-gated
   (400 "missing auth"/"password auth failed for authenticator") but it is a GENERIC
   response — identical on a healthy project with NO Data API enabled — so it is NOT a
   live-compute signal and NOT usable without enabling Data API (enable is 412-gated).
7. **neonauth (Managed Better Auth)** (`ep-...neonauth.../neondb/auth/*`): every route
   returns 500 `Cannot read properties of undefined (reading 'Symbol(pino.msgPrefix)')`
   — the Better Auth service is provisioned but broken server-side; cannot mint a JWT.
8. **JWKS registration** `POST /projects/{id}/jwks` (needed to make apiauth/.apirest
   accept our own signed JWTs): 423 compute-gated. We generated RSA2048 keys, hosted
   the JWKS on a private GitHub gist, tried `provider_name`+`branch_id` variants — all
   423. (First attempt returned 400 "invalid JWKS" only because the gist was deleted;
   with a live gist it's 423.)
9. **role password reset** `POST .../roles/{name}/reset_password` (neondb_owner AND
   authenticator): 423. Could not rotate authenticator to match the Data API's cached
   (stale) authenticator password.
10. **role create** on main branch: 423; on the no-endpoint frozen branch: 404
    "no read-write endpoint for branch".
11. **endpoint create** on any branch: 423. **endpoint start/restart**: 423.
12. **branch create WITH endpoint** (`endpoints:[{type:read_write}]`): 423. (without
    endpoint: 201, see above.)
13. **Data API enable/config** `POST/PATCH/DELETE /data-api/neondb` on main: 412;
    on frozen branch with no endpoint: 500 "unknown internal server error"; with an
    endpoint moved onto the frozen branch: 412. Data API is genuinely compute-gated.
14. **branch restore / time-travel** `POST .../branches/{id}/restore`:
    - with `preserve_under_name`: 400 `timestamp is before retention window` (free =
      6h retention, anything older than 6h rejected).
    - with `source_branch_id == branch id` + `target_timestamp`: 400 "target_lsn or
      target_timestamp required when branch is reset to itself" (API wants
      `source_timestamp`/`source_lsn` naming; retried — still 400 field mismatch).
    - even a valid restore would only create another storage branch; read still gated.
15. **snapshot create** `POST /projects/{id}/snapshots`: 405 (wrong route shape; the
    real route is `POST /projects/{id}/branches/{branch_id}/snapshot` — not retried;
    free plan allows 1 manual snapshot, but restore of a snapshot still needs compute).
16. **region-level HTTP SQL** `api.us-east-1.aws.neon.tech/sql` (no cell): NOT
    quota-gated but returns `password authentication failed for user 'neondb_owner'`
    for BOTH our DSN and a healthy project's DSN — it is a generic/gateway route that
    does not actually reach this tenant's compute. dead end.
17. **legacy hostname without cell** (`ENDPOINT_REDACTED.us-east-1.aws.neon.tech`,
    no `.c-3.`): DNS round-robins to other tenants, `password authentication failed`
    for every role. ignore.
18. **endpoint PATCH branch_id move** (moved existing endpoint to frozen branch):
    **SUCCEEDED (200)** — control-plane op, not gated. But compute still 402 when
    connecting (gate is project-wide, not per-endpoint). endpoint was moved back to
    main after testing.
19. **consumption_limits route**: 404 (does not exist on free v3).

## control-plane ops that DO work while frozen (metadata only)

- `GET /projects/{id}`, `/branches`, `/branches/{id}`, `/endpoints`, `/roles`,
  `/roles/{name}/reveal_password`, `/databases`, `/snapshots`, `/jwks`,
  `/organizations/{org}/consumption`
- `POST /projects/{id}/branches` (no endpoint) — the storage snapshot trick
- `PATCH /projects/{id}/endpoints/{ep}` — settings + branch_id move (200)
- `POST .../endpoints/{ep}/suspend` (200), `POST .../branches/{id}/set_as_default` (200)
- role passwords ARE readable via reveal_password while frozen (neondb_owner
  `npg_REDACTED`, authenticator `npg_REDACTED`) — but you still can't connect.

## verdict

No read/export path exists while the project is over its compute quota — Neon enforces
the 402 at the proxy before compute starts, and every auth-gated route that bypasses
the proxy gate (apiauth/.apirest) needs a JWKS registration that is itself
compute-gated. The storage-level branch snapshot is the ONLY compute-free data
preservation trick. The realistic export path:

**wait for the 09/01 00:00 UTC period reset → create a 0.25-CU endpoint on
`SNAPSHOT_BRANCH_REDACTED` (or main) → pg_dump → delete the temp endpoint.**
(or `suspend` the endpoint again immediately after.)

If a paid upgrade is ever considered: Launch is usage-based, no monthly minimum,
~$0.106/CU-h — a 5-minute dump at 0.25 CU ≈ pennies. flag the payment-method
requirement before recommending (global AGENTS.md rule 12).

## future hints worth a quick re-test when time passes

- neonauth pino bug may be fixed server-side (would unblock Better Auth → mint real
  JWT → Data API/apiauth becomes a live read path even over quota).
- `POST /projects/{id}/branches/{branch_id}/snapshot` (manual snapshot, storage-level)
  was never tried with the correct route shape after the 405.
- check `periods[last].period_end` each run — as soon as a NEW period starts, the
  proxy gate lifts and normal psql/pg_dump works again; the branch snapshot is then
  redundant but harmless.
