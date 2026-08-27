# mega.nz (MEGA upload/download toolchain)

megatools CLI (scoop `megatools`, installed 2026-08-26, v1.11.5) + a vault-backed account helper keyed by email.

## why megatools

- single binary, all needed ops: `put` (upload), `get`/`dl` (download), `ls`, `mkdir`, `rm`, `df`, `export` (file links).
- accepts `-u <email> -p <password>` per invocation -> no config file, no plaintext creds on disk.
- scoop persists a default `mega.ini` at `%USERPROFILE%\scoop\persist\megatools\mega.ini`; we never write creds into it.

## credentials live in the vault (no local state at all)

- MEGA is email+password auth (2FA optional). The helper stores the password in the **Bitwarden vault**
  (item `mega.nz - <email>`, header `[password]`, username = the mega username).
- `run`/`upload` read the password from the vault each time and pass `megatools -u <email> -p <pw> ...` inline.
- **stateless**: the email is always passed explicitly, there is no active-profile/current file, nothing is stored
  under `%APPDATA%\mainframe\accounts\` or anywhere else locally, and no `mega.ini` with a password is ever created.

## usage

```
.\mega-account.ps1 login <email>            # prompts username + hidden password -> vault
.\mega-account.ps1 status <email>           # check vault creds exist
.\mega-account.ps1 run <email> df           # disk usage
.\mega-account.ps1 run <email> ls /         # list root
.\mega-account.ps1 run <email> mkdir /Books
.\mega-account.ps1 upload <email> book.pdf /Books   # upload (run mkdir first - put doesn't auto-create)
.\mega-account.ps1 run <email> export /Books/file.pdf   # get a share link
```

## common ops (megatools reference)

- upload: `megatools -u <email> -p <pw> put --no-progress --path /Remote /local/file`
- download: `megatools -u <email> -p <pw> get --path . /Remote/file`
- download public link (no login needed): `megatools dl <mega.nz link> --path .`
- list: `megatools -u <email> -p <pw> ls -R /folder`
- make dir: `megatools -u <email> -p <pw> mkdir /folder/sub`
- share link: `megatools -u <email> -p <pw> export /folder/file`
- storage: `megatools -u <email> -p <pw> df -h`

## gotchas

- `put` does NOT auto-create the target remote folder - run `mkdir` first or `put` fails.
- `-u`/`-p` are global options, must come before the subcommand: `megatools -u X -p Y put ...`.
- the helper's `run` wraps this via `megatools -u <cfg email> -p <pw> <args...>`.
- 2FA-protected accounts: megatools has no TOTP support. if an account has 2FA on, `run` will fail;
  we'd need the MEGA session cookie / MFA token path instead.
- megatools caches a local filesystem cache keyed by session; a fresh login re-fetches it (slower first `ls`).
- download of huge folders can be slow; prefer `dl` on a share link for one-off grabs.
