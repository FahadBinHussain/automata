# repo-preservation — submit public repos to preservation services

`repo-preserve.ps1 <repository-url>` submits a public Git repository to the
preservation sites configured in the tool: Software Heritage Save Code Now
(Git history) and Internet Archive Save Page Now (the public repository page).
It does not create a local clone or mirror and pushes nowhere else. The script
labels each method and fails loudly if any submission fails. Add future
preservation sites as additional labeled submissions.

capability folder, not a site (user decision 2026-10-05): the tool spans two
hosts (`archive.softwareheritage.org` + `web.archive.org`), so there is no
single site folder to key it on.

## run

```powershell
pwsh .\repo-preserve.ps1 https://github.com/<owner>/<repo>
```

validates the URL is absolute http(s), then:

1. `[Software Heritage]` `POST archive.softwareheritage.org/api/1/origin/save/?visit_type=git&origin_url=<enc>`
   → prints request/task status + status-API URL; throws if `save_request_status`
   is `rejected` (note included).
2. `[Internet Archive / Wayback Machine]` `GET web.archive.org/save/<origin>`
   (follows up to 10 redirects) → prints the result URL.

any failed leg is collected and rethrown as one joined error at the end; both
legs green returns a PSCustomObject (`RepositoryUrl`,
`SoftwareHeritageRequest`, `WaybackSubmission`).

## gotchas

- no auth on either endpoint — both accept anonymous submissions; SWH save can
  be rate-limited/queued, the printed status API URL is the follow-up.
- SWH backend flakiness/rejection is reported as a loud failure, never silently
  skipped; do not turn the per-method `Write-Error` catches into a fallback.
- **run repos SEQUENTIALLY, never in parallel** (hit 2026-10-09): three
  `repo-preserve.ps1` calls fired at once = SWH all accepted (it queues), but
  every Wayback leg came back `429 Too Many Requests`. SPN's per-IP rate limit
  then rejects even single retries for a few minutes. it clears on its own -
  probe with a GET against `web.archive.org/save/<any-url>`: `302` = clear,
  `429` = still limited. the retry itself must stay one URL at a time with
  ~15s spacing (helper used: `C:\tmp\wayback-retry.ps1`, throwaway).
- **`523` does NOT mean "this repo is the problem"** (diagnosed 2026-10-09):
  `playgta5` failed `523 (UNKNOWN)` 9x on both the root and `/tree/main` URLs
  while direct fetches of the same page intermittently returned 200/504.
  run CONTROLS before blaming the target: SPN save of `https://example.com`
  (IA-side health) + a tiny known-good github repo such as
  `octocat/Hello-World` (github→IA health). result that day: example.com OK,
  octocat **also 523** → whole github.com→Wayback path was down/blocked, and
  the first three repos of the same session had gone green ~2h earlier.
  `https://archive.org/wayback/available?url=<origin>` tells you whether any
  snapshot already exists. the 523 response body comes back EMPTY, so it
  gives no reason — controls are the only diagnosis. this is also why
  SPN submissions are saved individually: a broken leg must be retried later
  (delayed background retry beats hammering), never "fixed" by swapping in a
  different URL and calling it preserved.
- **STOP after a few attempts, back off in HOURS** (same episode): 14 rapid
  SPN attempts burned the per-IP limit, and the control then came back
  `429` for plain `example.com` while github was still `523` - two different
  failures stacked. a delayed retry should run a CONTROL FIRST and skip the
  target entirely unless the control is green, otherwise every attempt only
  extends the cooldown.
- the bash tool here strips `$` from inline `pwsh -Command` strings (an
  `$ErrorActionPreference='Stop'` arrives as `Continue=Stop` and dies), so any
  retry/probe with variables goes in a temp `.ps1` run via `-File`.
- history: born as a Software Heritage helper, moved through `tools\` twice
  (`b54b868` in, 2026-10-05 out) — this folder is its home.
