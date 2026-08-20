# WhatsApp Web Automata

Local WhatsApp automation lives here. Account/session ownership lives in
`$env:USERPROFILE\Downloads\mainframe\whatsapp-account.ps1`.

Two backends are available:

| Backend | Script | Browser? |
|---------|--------|----------|
| WA-JS + CDP | `wa-js-bridge.mjs` | Yes (Chrome) |
| Baileys | `baileys-bridge.mjs` | No |

## Baileys (browserless, experimental)

First-time QR login (terminal QR, not Chrome):

```powershell
$env:USERPROFILE\Downloads\mainframe\whatsapp-account.ps1 login-baileys +8801XXXXXXXXX
```

Check connection:

```powershell
$env:USERPROFILE\Downloads\mainframe\whatsapp-account.ps1 run-baileys status
```

Send text (requires `--to`):

```powershell
$env:USERPROFILE\Downloads\mainframe\whatsapp-account.ps1 run-baileys send-text --to +8801YYYYYYYY --text "hi"
```

Send media:

```powershell
$env:USERPROFILE\Downloads\mainframe\whatsapp-account.ps1 run-baileys send-media --to +8801YYYYYYYY --file C:\tmp\image.png --caption "test"
```

Auth is stored under `%APPDATA%\mainframe\accounts\whatsapp\<phone>\baileys-auth`.

## WA-JS + Chrome (existing)

First login:

```powershell
$env:USERPROFILE\Downloads\mainframe\whatsapp-account.ps1 login +8801XXXXXXXXX
```

After the QR session exists, relaunch the profile minimized:

```powershell
$env:USERPROFILE\Downloads\mainframe\whatsapp-account.ps1 launch
```

Commands:

```powershell
$env:USERPROFILE\Downloads\mainframe\whatsapp-account.ps1 run status
$env:USERPROFILE\Downloads\mainframe\whatsapp-account.ps1 run send-text --text "hi"
$env:USERPROFILE\Downloads\mainframe\whatsapp-account.ps1 run send-media --file C:\tmp\image.png --caption "test"
```

## Boundaries

- Baileys uses Linked Devices and is unofficial — ban risk applies.
- WA-JS requires the target chat open in Chrome before sending.
- WhatsApp identities are phone-number based (`+8801XXXXXXXXX`).
- Scripts do not print cookies, browser session files, or chat history by default.
- Use for personal/manual automation. For business inboxes, prefer Meta Cloud API.
