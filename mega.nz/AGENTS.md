# mega.nz (MEGA upload/download toolchain)

megatools CLI (scoop `megatools`, installed 2026-08-26, v1.11.5) + a mainframe-style account helper keyed by email.

## why megatools

- single binary, all needed ops: `put` (upload), `get`/`dl` (download), `ls`, `mkdir`, `rm`, `df`, `export` (file links).
- supports `--config <path>` per invocation -> clean per-account profiles (megatools normally reads one global `mega.ini`).
- scoop persists `mega.ini` at `%USERPROFILE%\scoop\persist\megatools\mega.ini` (the default config; we don't rely on it).

## account helper

`mega-account.ps1` — mainframe-contract style (`login/use/current/list/status/status-all/path/env/run` + `upload`), profiles keyed by email:

```
%APPDATA%\mainframe\accounts\mega\<email>\mega.ini     <- username + password (megatools format)
%APPDATA%\mainframe\accounts\mega\<email>\profile.json <- metadata
%APPDATA%\mainframe\accounts\mega\current.json         <- active profile
```

`login <email>` prompts for username + password (hidden), writes `[Login] Username/Password` into the profile's `mega.ini`, and sets it active. password sits plaintext in that profile dir (megatools requires it in config or `-p`); it's personal state under `%APPDATA%`, never committed.

## usage

```
.\mega-account.ps1 login <email>            # first-time setup
.\mega-account.ps1 status-all               # see configured profiles (* = active)
.\mega-account.ps1 use <email>              # switch active
.\mega-account.ps1 run df                   # disk usage on active
.\mega-account.ps1 run ls /                 # list root
.\mega-account.ps1 upload book.pdf /Books   # upload to remote folder (auto-mkdir? no - create first)
.\mega-account.ps1 run mkdir /Books
.\mega-account.ps1 run export /Books/file.pdf   # get a share link
```

`run`/`upload` use the active profile unless an explicit `<email>` is passed first.

## common ops (megatools reference)

- upload: `megatools --config <ini> put --no-progress --path /Remote /local/file`
- download: `megatools --config <ini> get --path . /Remote/file`
- download public link (no login needed): `megatools dl <mega.nz link> --path .`
- list: `megatools ls -R /folder`
- make dir: `megatools mkdir /folder/sub`
- share link: `megatools export /folder/file`
- storage: `megatools df -h`

## gotchas

- `put` does NOT auto-create the target remote folder - run `mkdir` first or `put` fails.
- `--config` must be given BEFORE the subcommand (global option), e.g. `megatools --config <ini> put ...`.
- the helper's `run` wraps this via `megatools --config <cfg> <args...>`.
- 2FA-protected accounts: megatools has no TOTP support in config; login would need the MEGA session cookie / MFA token. if `ahmedtouhid8` has 2FA on, expect `run` to fail - we'd need a different auth path (or 2FA off / MFA token).
- megatools caches a local filesystem cache keyed by session; a fresh login re-fetches it (slower first `ls`).
- download of huge folders can be slow; prefer `dl` on a share link for one-off grabs.
