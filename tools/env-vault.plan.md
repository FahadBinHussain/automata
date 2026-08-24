# secrets: notion → vault migration

## rule

every secret source (notion page, on-disk file) maps to one vault item.
item name = `<owner> / <name>`. owner = the parent page title or entity root.
name = child page title or filename. eg `github.com/FahadBinHussain/kena / .env`.

- text values → notes field
- binary files → base64 custom field, field name = relative filename

## inventory

### repo-owned secret pages (notion child pages)

| owner | page | secrets |
|---|---|---|
| github.com/FahadBinHussain/kena | .env | neon db, google oauth, pusher, jwt |
| github.com/FahadBinHussain/daily-bnp | .env (development) | neon db, google oauth, pixvid, openweather |
| github.com/FahadBinHussain/daily-bnp | .env (production) | neon db, google oauth, pixvid |
| github.com/FahadBinHussain/cse370 | .env (development) | neon db, stripe test keys, pixvid |
| github.com/FahadBinHussain/cse370 | .env (production) | neon db, stripe test keys, pixvid |
| github.com/FahadBinHussain/notion-backup | /settings/secrets/actions | NOTION_TOKEN, x-notion-space-id |
| github.com/FahadBinHussain/touchless-vending-machine | /settings/secrets/actions | FTP_SERVER/USERNAME/PASSWORD |
| github.com/FahadBinHussain/tabsync | /settings/secrets/actions | TABSYNC_EXTENSION_PEM_B64 |
| github.com/FahadBinHussain/FahadBinHussain | /settings/secrets/actions | (code) |
| github.com/FahadBinHussain/picture-in-picture-chrome-extension | /settings/secrets/actions | PICTURE_IN_PICTURE_CHROME_EXTENSION_PEM_B64 |
| github.com/FahadBinHussain/mojify | /settings/secrets/actions | MOJIFY_EXTENSION_PEM_B64 |
| github.com/FahadBinHussain/glitchdraft | /settings/secrets/actions | GLITCHDRAFT_EXTENSION_PEM_B64 |
| github.com/FahadBinHussain/imgvault | /settings/secrets/actions | IMGVAULT_EXTENSION_PEM_B64 |
| github.com/FahadBinHussain/nix | /settings/secrets/actions | GH_PAT, MEGA_EMAIL/PASSWORD, TERABOX_NDUS/JSTOKEN/BROWSER_ID/UPLOAD_ID/REMOTE_DIR, UDROP_KEY1/2, DDOWNLOAD_API_KEY, PRODUCT_ID |
| github.com/FahadBinHussain/imgvault | imgvault.pem | extension signing key (also in IMGVAULT_EXTENSION_PEM_B64) |
| github.com/FahadBinHussain/glitchdraft | glitchdraft.pem | extension signing key |
| github.com/FahadBinHussain/picture-in-picture-chrome-extension | picture-in-picture-chrome-extension.pem | extension signing key |
| github.com/FahadBinHussain/tabsync | tabsync.pem | extension signing key |
| github.com/FahadBinHussain/mojify | mojify.pem | extension signing key |
| github.com/FahadBinHussain/touchless-vending-machine | cpanel secrets | cpanel password + ssh-rsa public key |
| github.com/mshll/repo-size | token for userscript | **live github pat** (ghp_) |

### non-repo secret pages (notion child pages)

| owner | page | secrets |
|---|---|---|
| <example>.com (hostseba) | ssh access | vubon_ssh.ppk private key + passphrase |
| microsoft.com/en-us/windows | microsoft keys | KeysExport.pdf (migration keys) |

### on-disk secret files (not in notion)

| owner | file | secrets |
|---|---|---|
| github.com/FahadBinHussain/dolby-trial-preserve | legacy_re_save/MyKey.pfx | 2.6 KB pfx cert (duplicated in research_archive/) |
| .ssh | id_ed25519_dolby | tailscale ssh private key (rule 7) |
| .ssh | id_ed25519_dolby.pub | public key — keep on disk, safe in git |

### empty / ignored (notion .env pages, 18 total)

lobehub-vercel-template, murmur, touchless-vending-machine, whatsapp-ai-chatbot, vaultwarden-render-template, xenogram, boi, github-profile-trophy, github-readme-streak-stats, github-readme-stats, simple-gemini-wrapper, vubon-skills, bright-hope, vubon-virtuals, daffodil-resource-hub, bazartoday, <example>.com, vubon-ecommerce (mislabeled roadmap)

## migration (one pattern: notion → vault → verify → archive)

for each notion page in inventory:
1. create vault item `<owner> / <name>` (secure note)
2. copy page content: text → notes, file attachments → base64 custom fields
3. verify round-trip (read back, compare)
4. archive notion page (PATCH archived:true)

for on-disk files:
1. create vault item `<owner> / <name>`
2. base64 encode file → custom field
3. delete file from disk (or leave if gitignored + .gitignore entry)

## env-sync.ps1

- no args → scans `<user-home>\Downloads\<repo>` for every repo with a matching vault item `<github.com/FahadBinHussain/<repo> / *`, writes `.env.local` + restores key files
- `-Repo <slug>` → single repo
- `-Env dev|prod` → env variant
- also restores `.ssh` items: `$env:USERPROFILE\.ssh\id_ed25519_dolby`
- also restores non-repo items: `<example>.com / ssh access` → `Downloads\<example>.com\vubon_ssh.ppk`