# Render resource usage (local notes)

reusable script: `C:\Users\<user>\Downloads\automata\render.com\render-quota.ps1`

checks a Render web service's CPU / memory / bandwidth via the DASHBOARD
GraphQL API - the REST API key (rnd_) cannot access metrics; only the
dashboard session idToken works (same auth wall as supabase's /platform/*).

## script

- args: `-ServiceId` (default <service-id> lumen),
  `-Email` (default <user>@example.com - lumen service owner),
  `-Hours` (lookback, default 6), `-RawJson` (dump full json).
- flow: read idToken from vault -> query api.render.com/graphql for
  CPU / MEMORY_RSS / CPU_LIMIT / MEMORY_LIMIT / ENRICHED_BANDWIDTH ->
  print usage vs free-tier limits (CPU 0.1, RAM 512 MB).
- vault item: `dashboard.render.com` -> "Dashboard Session" section, value
  format `<idToken>|<expiresAt>`. requires the Bitwarden vault unlocked.
- the idToken lasts ~8 days and has NO refresh-token mechanism - re-login via
  agent-browser when it expires (steps in the script header).

## reverse-engineered endpoint (2026-08-23, from the dashboard GraphQL bundle)

- `POST https://api.render.com/graphql` with `Authorization: Bearer <idToken>`
  (the REST API key `rnd_` gets HTTP 401 - session-only).
- idToken source: login to dashboard.render.com, read
  `localStorage["render-auth"]` -> `.idToken`. login credentials for
  <user>@example.com are in the vault `dashboard.render.com` item.
- query:
  ```graphql
  query metrics($query: MetricsQueryInput!) {
    metrics(query: $query) {
      series { unit labels { field value } values { time value } }
    }
  }
  ```
  variables.query = `{ filters: [{field:"RESOURCE", values:[<serviceId>]}],
  start, end, name: "<METRIC>", resolution: 3600, parameters: [], aggregateBy: [],
  aggregationMethod: "NONE" }`.
- valid metric names (from the dashboard GraphQL type enum): CPU, CPU_LIMIT,
  CPU_TARGET, MEMORY, MEMORY_LIMIT, MEMORY_RSS, MEMORY_CACHE, MEMORY_TARGET,
  INSTANCES, DISK_USAGE, DISK_CAPACITY, DISK_READ_THROUGHPUT,
  DISK_WRITE_THROUGHPUT, BANDWIDTH, ENRICHED_BANDWIDTH, CONCURRENT_REQUESTS,
  CONNECTIONS_LIMIT, ACTIVE_CONNECTIONS, HTTP_LATENCY, HTTP_REQUESTS, TP_LATENCY.
- units: CPU -> "CPU" (fraction of a core), memory -> "BYTES", bandwidth -> "MB".

## lumen baseline (2026-08-23, free tier oregon)

- CPU usage ~0.0015-0.0016 (1.5% of the 0.1 free limit)
- Memory RSS ~37 MB / 512 MB (7%)
- total memory ~57 MB / 512 MB (11%)
- bandwidth: ~11 MB egress / 7 MB ingress in 6h (no free cap for web services)
- headroom is large - adding quota watchers is trivially safe.

## gotchas

- the idToken expires (~8 days) and Render's dashboard auth has NO refresh
  token - the script throws when expired; re-login via agent-browser and
  update the vault value (there is no browser-free refresh).
- `Invoke-WebRequest -UseBasicParsing` returns `.Content` as a STRING in
  PS7 (not bytes) - don't run it through [Text.Encoding]::GetString (throws).
- `HTTP_LATENCY` / `HTTP_REQUESTS` require aggregationMethod other than NONE
  (400 error) - the script uses NONE which works for CPU/memory/bandwidth.
- <render-acct-a>'s vault item is the FIRST `dashboard.render.com` (username match);
  <render-acct-b> has a different workspace (<render-workspace-b>) than lumen
  (<render-workspace-a>, owned by <render-acct-a>). use <render-acct-a> for lumen.
