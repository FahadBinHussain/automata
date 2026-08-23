# Render resource usage (local notes)

reusable script: `C:\Users\<user>\Downloads\automata\render.com\render-quota.ps1`

checks a Render web service's CPU / memory / bandwidth via the DASHBOARD
GraphQL API - the REST API key (rnd_) cannot access metrics. the script logs
in fresh EVERY run via the signIn GraphQL mutation (email+password from the
vault), so there is NO session token to store, refresh, or expire.

## script

- args: `-ServiceId` (default <service-id> lumen),
  `-Email` (default <user>@example.com - lumen service owner),
  `-Hours` (lookback, default 6), `-RawJson` (dump full json).
- flow: read password from the vault item `dashboard.render.com` ->
  signIn mutation -> fresh idToken -> query api.render.com/graphql for
  CPU / MEMORY_RSS / CPU_LIMIT / MEMORY_LIMIT / ENRICHED_BANDWIDTH ->
  print usage vs free-tier limits (CPU 0.1, RAM 512 MB).
- requires the Bitwarden vault unlocked.

## reverse-engineered endpoints (2026-08-23, from the dashboard GraphQL bundle + live traffic)

### signIn (fresh login, no expiry problem)

- `POST https://api.render.com/graphql`
- body: `{"operationName":"signIn","variables":{"email":"...","password":"..."},"query":"mutation signIn($email: String!, $password: String!) { signIn(email: $email, password: $password) { idToken expiresAt user { id email } } }"}`
- NO captcha, NO Content-Type auth header needed - just the JSON body.
- returns `{idToken, expiresAt}` - the idToken is the session bearer for the
  metrics query. each call logs in fresh (email+password from the vault), so
  the 8-day expiry is moot - the script never stores an idToken.

### metrics

- `POST https://api.render.com/graphql` with `Authorization: Bearer <idToken>`
  (the REST API key `rnd_` gets HTTP 401 - session-only).
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

- `Invoke-WebRequest -UseBasicParsing` returns `.Content` as a STRING in
  PS7 (not bytes) - don't run it through [Text.Encoding]::GetString (throws).
- `HTTP_LATENCY` / `HTTP_REQUESTS` require aggregationMethod other than NONE
  (400 error) - the script uses NONE which works for CPU/memory/bandwidth.
- <render-acct-a>'s vault item is the FIRST `dashboard.render.com` (username match);
  <render-acct-b> has a different workspace (<render-workspace-b>) than lumen
  (<render-workspace-a>, owned by <render-acct-a>). use <render-acct-a> for lumen.
- the signIn mutation reads the password from the vault login item - if the
  password changes, update the vault item, no script edit needed.
- the `Dashboard Session` vault section (idToken|expiresAt) is no longer used
  by the script - it was replaced by per-run signIn. it can be removed.
