# Render resource usage (local notes)

reusable script: `C:\Users\<user>\Downloads\automata\render.com\render-quota.ps1`

checks a Render web service's CPU / memory / bandwidth via the DASHBOARD
GraphQL API - the REST API key (rnd_) cannot access metrics. the script logs
in fresh EVERY run via the signIn GraphQL mutation (email+password from the
vault), so there is NO session token to store, refresh, or expire.

## script

- args: `-ServiceId` (default from env/.env.local), `-Email` (service owner,
  default from env/.env.local), `-Hours` (lookback, default 6), `-RawJson`
  (dump full json).
- flow: read password from the vault item `dashboard.render.com` ->
  signIn mutation -> fresh idToken -> query api.render.com/graphql for
  CPU / MEMORY_RSS / CPU_LIMIT / MEMORY_LIMIT / ENRICHED_BANDWIDTH ->
  print usage vs free-tier limits (CPU 0.1, RAM 512 MB).
- requires the Bitwarden vault unlocked.

## reverse-engineered endpoints

### signIn (fresh login, no expiry problem)

- `POST https://api.render.com/graphql`
- body: `{"operationName":"signIn","variables":{"email":"...","password":"..."},"query":"mutation signIn($email: String!, $password: String!) { signIn(email: $email, password: $password) { idToken expiresAt user { id email } } }"}`
- NO captcha, NO Content-Type auth header needed - just the JSON body.
- returns `{idToken, expiresAt}` - the idToken is the session bearer for the
  metrics query. each call logs in fresh (email+password from the vault), so
  token expiry is moot - the script never stores an idToken.

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

## gotchas

- `Invoke-WebRequest -UseBasicParsing` returns `.Content` as a STRING in
  PS7 (not bytes) - don't run it through [Text.Encoding]::GetString (throws).
- `HTTP_LATENCY` / `HTTP_REQUESTS` require aggregationMethod other than NONE
  (400 error) - the script uses NONE which works for CPU/memory/bandwidth.
- pick the vault login whose workspace owns the target service; a different
  account can have a different workspace than the service owner.
- the signIn mutation reads the password from the vault login item - if the
  password changes, update the vault item, no script edit needed.
