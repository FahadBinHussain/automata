# mega.nz (MEGA upload/download toolchain)

megatools CLI (scoop `megatools`, installed 2026-08-26, v1.11.5) + a vault-backed account helper keyed by email.

## why megatools

- single binary, all needed ops: `put` (upload), `get`/`dl` (download), `ls`, `mkdir`, `rm`, `df`, `export` (file links).
- accepts `-u <email> -p <password>` per invocation -> no config file, no plaintext creds on disk.
- scoop persists a default `mega.ini` at `%USERPROFILE%\scoop\persist\megatools\mega.ini`; we never write creds into it.

## credentials live in the vault (no local state at all)

- MEGA is email+password auth (2FA optional). The helper stores the password in the **Bitwarden vault**
  (item `mega.nz - <email>`).
- password lookup order: notes `[password]` header first, then fall back to the item's `login.password`
  field (existing items like `ahmedtouhid88` keep it in login.password). `Read-VaultSecret` only reads
  notes, so the helper has its own login.password fallback via `bw list items`.
- `run`/`upload` read the password from the vault each time and pass `megatools <subcommand> -u <email> -p <pw> ...`.
- **stateless**: the email is always passed explicitly, there is no active-profile/current file, nothing is stored
  under `%APPDATA%\mainframe\accounts\` or anywhere else locally, and no `mega.ini` with a password is ever created.

## megatools arg order (IMPORTANT)

- `-u`/`-p` are **subcommand options in this Windows build** - they go AFTER the subcommand:
  `megatools df -u <email> -p <pw>` / `megatools put -u <email> -p <pw> --path /Root file.pdf`.
  `megatools -u ... -p ... df` prints top-level usage instead of running. the helper's `run`/`upload`
  place them correctly.

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

- upload: `megatools put -u <email> -p <pw> --no-progress --path /Root /local/file`
- download: `megatools get -u <email> -p <pw> --path . /Root/file`
- download public link (no login needed): `megatools dl <mega.nz link> --path .`
- list: `megatools ls -u <email> -p <pw> -R /folder`
- make dir: `megatools mkdir -u <email> -p <pw> /folder/sub`
- share link: `megatools export -u <email> -p <pw> /folder/file`
- storage: `megatools df -u <email> -p <pw>`

## gotchas

- `put` does NOT auto-create the target remote folder - run `mkdir` first or `put` fails.
- **cannot upload to `/` toplevel** - use `/Root` (or a subfolder of it) as the remote path.
- `-u`/`-p` are subcommand options: `megatools <subcommand> -u X -p Y ...`, not before the subcommand.
- the helper's `run`/`upload` already place `-u`/`-p` after the subcommand.
- 2FA-protected accounts: megatools has no TOTP support. if an account has 2FA on, `run` will fail;
  we'd need the MEGA session cookie / MFA token path instead.
- megatools caches a local filesystem cache keyed by session; a fresh login re-fetches it (slower first `ls`).
- download of huge folders can be slow; prefer `dl` on a share link for one-off grabs.
