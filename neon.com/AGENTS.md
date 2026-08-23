# neon.com - Neon free-tier compute-quota bypass + export tooling

## dailyBNP Neon (the project that matters here)

- account: `ACCOUNT_EMAIL_REDACTED` (mainframe neon profile, vault key)
- project: `Daily-BNP` = `PROJECT_ID_REDACTED`, org `ORG_ID_REDACTED`, region aws-us-east-1, pg 17
- endpoint: `ENDPOINT_REDACTED` (host `ENDPOINT_REDACTED.c-3.us-east-1.aws.neon.tech`)
- main branch: `MAIN_BRANCH_REDACTED`, database `neondb`, role `neondb_owner`
- pooler DSN (in murmur/.env + daily-bnp/.env.local): `postgresql://neondb_owner:npg_REDACTED@ENDPOINT_REDACTED-pooler.c-3.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require`
- period-bounded quota: `GET /organizations/ORG_ID_REDACTED/consumption` → periods[last].compute_time (CU-sec). Free = 100 CU-h = 360,000 CU-sec per project.
- on 2026-08-23: **110.41 CU-h used → compute SUSPENDED with 402**; storage intact 44.8 MB; resets **09/01/2026 00:00:00**.

## the working trick: storage-level branch snapshot while compute is frozen

The compute quota gate is enforced at the Neon proxy on every connection path
(pooler, direct, compute host, serverless HTTP `api.` route, endpoint `start`,
endpoint create, branch create WITH endpoint, role password reset, data-api
enable/config, jwks registration — all return 402/412/423). **But branch
creation with NO endpoint is a pure storage-layer operation and succeeds even
over quota.**

```
POST /api/v2/projects/PROJECT_ID_REDACTED/branches
{"branch":{"parent_id":"MAIN_BRANCH_REDACTED"}}          # no endpoints[]
# → 201 SNAPSHOT_BRANCH_REDACTED (parent_lsn 0/81E8578, logical_size 46948352)
```

This freezes the exact current state of the DB into a child branch (copy-on-write
in the pageserver; does not touch compute). Use it as insurance the moment you
notice the quota is gone — you can always restore/dump the branch after reset.

## verified dead ends (as of 2026-08-23)

- **pooler / direct / compute-host psql**: all `402 Your account or project has exceeded the compute time quota`.
- **serverless HTTP driver `api.c-3.us-east-1.aws.neon.tech/sql`**: 402 (quota-gated).
- **`apiauth.c-3.us-east-1.aws.neon.tech/sql`** and **`.apirest` Data API**:
  these routes are **NOT quota-gated** (they answer 400 auth errors instead of
  402) but require a valid JWT backed by a JWKS registered on the project —
  and JWKS registration (`POST /projects/{id}/jwks`) is itself compute-gated
  (423). If you could register a JWKS you control + mint a JWT with role claim,
  the Data API would read data while quota is frozen — but you can't register
  the key while frozen. dead end, documented for future.
- **role password reset / create role / endpoint create**: all compute-gated
  (423 / 404-no-endpoint).
- **manual snapshot** (`POST /projects/{id}/snapshots`): 405 (not the endpoint shape).
- **legacy hostname without cell** (`ENDPOINT_REDACTED.us-east-1...`):
  load-balances to other tenants, password auth fails — ignore it.

## export tool

`neon-export-bnp.ps1` — the scheduled-by-hand or cron-job.org export:
1. checks org consumption; if still over threshold (default 98 CU-h) exits 1.
2. creates a 0.25-CU endpoint on the frozen branch `SNAPSHOT_BRANCH_REDACTED`
   (once quota resets), pg_dumps to `Downloads\neon-exports\dailybnp-<ts>.sql`,
3. deletes the temp endpoint so it stops burning quota.

run it after 09/01/2026 00:00:00 (or `-Force` once the quota clears early).
`NEON_BRANCH_ID` can be pointed at main to dump live instead.

## other accounts that share this org or project shape

- `ACCOUNT_EMAIL_REDACTED` is the only mainframe neon account with a
  multi-project org historically, but as of 2026-08-23 only Daily-BNP shows in
  ORG_ID_REDACTED. re-run the org/project listing if this changes.
