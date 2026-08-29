# neon.com - free-tier compute quota behavior + export tooling

## context / the problem

When a Neon project burns its free-tier compute quota, every compute-consuming path
returns a 402/412/423 gate ("compute time quota exceeded"). Storage stays intact; the
quota resets at the end of the billing period.

- project id, org id, account email, branch/endpoint ids: **personal values live in
  `.env.local` next to this file** (gitignored via `**/.env.local`), NOT in this repo.
- quota is **per-project** (not per-org/account): 100 CU-h = 360,000 CU-sec bucket;
  period-bounded value comes from `GET /organizations/{org_id}/consumption` →
  `periods[last].compute_time` (CU-sec). `compute_time_seconds` on project detail is
  LIFETIME-cumulative, do NOT use it for current-period decisions.

## egress (data transfer) is ALSO per-project on free — verified 2026-08-29

**The 5 GB/month egress (public network transfer) quota is PER-PROJECT, not
account-wide.** Despite the official plans page wording ("a single account-wide pool"),
creating a NEW project on the SAME account gives it a FRESH 5 GB egress bucket even
while another project on that account is transfer-quota-dead. Verified end-to-end on
the-daily-times (awdardcastle@gmail.com): old project `round-field-05224978` at
5.53 GB (suspended, `ERROR: Your project has exceeded the data transfer quota` on
pg_dump/psql) → created `twilight-mouse-28885519` ("the-daily-times-v2") on the same
account → project detail `data_transfer_bytes: 0` at creation, endpoint active,
`psql ... SELECT 1` works. So an egress-quota-exhausted DB can be migrated to a fresh
project on the same account (same as the blindspot migration drills, which hit the
same 5 GB cap 5x and each new project started at 0 transfer).

Caveats that still apply:
- the egress gate is per-PROJECT, but read it via the project detail endpoint
  (`data_transfer_bytes` on `GET /projects/{id}`), NOT the org consumption endpoint —
  org `data_transfer` aggregates every project in the org including deleted/suspended
  ones, so it overcounts a single project's situation.
- migrating data OUT of a quota-dead project is still blocked until its compute
  resumes (reset ~next period) — you can create the fresh project and point writes at
  it, but you can't pg_dump the dead one until the gate lifts.
- compute (CU-h) is per-project too: a fresh project resets BOTH buckets.

## the trick that WORKS while frozen: storage-level branch snapshot

The compute quota gate is enforced at the Neon proxy on EVERY compute-consuming path
(all return 402/412/423). BUT **branch creation with NO endpoint is a pure
storage-layer operation (copy-on-write in the pageserver) and succeeds even over
quota.**

```
POST /api/v2/projects/{project_id}/branches
{"branch":{"parent_id":"{main_branch_id}"}}     # NO "endpoints":[] key
# → 201 {snapshot_branch_id}  (parent_lsn 0/81E8578, logical_size 46948352)
```

This freezes the exact current state of the DB into a child branch without touching
compute. Use it the moment the quota is gone — always safe insurance. Keep the
snapshot branch id in `.env.local`; don't delete it until the restore is done.

## verified dead ends (free tier) — do NOT re-try these

all tested against a real project while over quota; each returned 402/412/423 unless noted:

1. **psql pooler / direct / compute host**: 402 on all three connection paths.
2. **serverless driver wss** (`@neondatabase/serverless`, wss pooler): 402.
3. **serverless HTTP driver** `api.c-3.us-east-1.aws.neon.tech/sql` (Neon-Connection-String header): 402. **`apiauth.c-3.../sql`** (JWT auth variant) is NOT quota-gated (returns 400 auth errors) but requires a valid JWT validated against a registered JWKS.
4. **Data API `.apirest` route**: NOT quota-gated (400 "missing auth"/"password auth failed for authenticator") but it is a GENERIC response — identical on a healthy project with NO Data API enabled — so it is NOT a live-compute signal and NOT usable without enabling Data API (enable is 412-gated).
5. **neonauth (Managed Better Auth)**: every route returns 500 (pino/symbol error) — the Better Auth service can be provisioned but broken server-side; cannot mint a JWT.
6. **JWKS registration** `POST /projects/{id}/jwks` (needed to make apiauth/.apirest accept self-signed JWTs): 423 compute-gated.
7. **role password reset** `POST .../roles/{name}/reset_password`: 423. Could not rotate authenticator to match the Data API's cached (stale) authenticator password.
8. **role create**: 423 on main; 404 "no read-write endpoint for branch" on a no-endpoint frozen branch.
9. **endpoint create / start / restart**: 423. **branch create WITH endpoint**: 423 (without endpoint: 201, see above).
10. **Data API enable/config** `POST/PATCH/DELETE /data-api/neondb` on main: 412; on a no-endpoint frozen branch: 500; with an endpoint moved onto the frozen branch: 412. genuinely compute-gated.
11. **branch restore / time-travel** `POST .../branches/{id}/restore`: free tier has ~6h retention so older timestamps are rejected; a self-restore needs `source_timestamp`/`source_lsn` naming. even a valid restore only creates another storage branch; read still gated.
12. **snapshot create**: the real route is `POST /projects/{id}/branches/{branch_id}/snapshot` (the plain `/snapshots` shape is wrong); free plan allows 1 manual snapshot, but restoring one still needs compute.
13. **region-level HTTP SQL** `api.us-east-1.aws.neon.tech/sql` (no cell) and **legacy hostname without cell**: NOT quota-gated but return `password authentication failed` — generic gateway routes that don't reach this tenant's compute. dead ends.
14. **endpoint PATCH branch_id move**: **SUCCEEDED (200)** — control-plane op, not gated. But compute still 402 when connecting (gate is project-wide, not per-endpoint). move it back after testing.
15. **consumption_limits route**: 404 (does not exist on free).

## control-plane ops that DO work while frozen (metadata only)

- `GET /projects/{id}`, `/branches`, `/branches/{id}`, `/endpoints`, `/roles`,
  `/roles/{name}/reveal_password`, `/databases`, `/snapshots`, `/jwks`,
  `/organizations/{org}/consumption`
- `POST /projects/{id}/branches` (no endpoint) — the storage snapshot trick
- `PATCH /projects/{id}/endpoints/{ep}` — settings + branch_id move (200)
- `POST .../endpoints/{ep}/suspend` (200), `POST .../branches/{id}/set_as_default` (200)
- role passwords ARE readable via reveal_password while frozen — but you still can't connect (passwords are live creds, keep them in `.env.local` / vault, never this repo).

## verdict

No read/export path exists while a project is over its compute quota — Neon enforces
the 402 at the proxy before compute starts, and every auth-gated route that bypasses
the proxy gate (apiauth/.apirest) needs a JWKS registration that is itself
compute-gated. The storage-level branch snapshot is the ONLY compute-free data
preservation trick. The realistic export path:

**wait for the next period reset → create a small-CU endpoint on the snapshot branch
(or main) → pg_dump → delete the temp endpoint (or suspend it immediately after).**

If a paid upgrade is ever considered: Launch is usage-based, no monthly minimum,
~$0.106/CU-h — a short dump at 0.25 CU ≈ pennies. flag the payment-method
requirement before recommending (global AGENTS.md rule 12).

## future hints worth a quick re-test when time passes

- neonauth pino bug may be fixed server-side (would unblock Better Auth → mint real
  JWT → Data API/apiauth becomes a live read path even over quota).
- `POST /projects/{id}/branches/{branch_id}/snapshot` (manual snapshot, storage-level)
  was never tried with the correct route shape after the wrong-route 405.
- check `periods[last].period_end` each run — as soon as a NEW period starts, the
  proxy gate lifts and normal psql/pg_dump works again; the branch snapshot is then
  redundant but harmless.

## .env.local (gitignored) — personal values, never commit

```
NEON_ACCOUNT_EMAIL=<mainframe neon profile email>
NEON_PROJECT_ID=<project id>
NEON_ORG_ID=<org id>
NEON_MAIN_BRANCH_ID=<main branch id>
NEON_SNAPSHOT_BRANCH_ID=<snapshot branch id>
NEON_ENDPOINT_ID=<endpoint id>
NEON_BNP_POOLER_DSN=<full pooled connection string incl password>
NEON_AUTHENTICATOR_PASSWORD=<authenticator role password>
```
