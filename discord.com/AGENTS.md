# discord.com automation

## channel scraping as a USER (not a bot)

tool: `scoop install discordchatexporter` (extras bucket, v2.48), CLI `DiscordChatExporter.exe`.

### commands
- list servers: `DiscordChatExporter.exe gather-guilds -t <token>`
- list channels: `DiscordChatExporter.exe gather-channels -g <guildId> -t <token>`
- export channel: `DiscordChatExporter.exe export-guild -t <token> -g <guildId> -c <channelId> -f Html -o <dir>`

### vault accounts
discord accounts live in the vault, keyed by bare-handle names with uri=discord.com/login
(symmetric since 2026-08-30). account list + which one is used for scraping stays out of this
repo — it's personal data. resolve via `bw list items` (uri=discord.com/login).

### getting a token
login via mainframe agent-browser detached workflow (rule 27) -> discord.com/login ->
after 2FA, read localStorage.token.

### gotchas hit 2026-08-30
1. **vault TOTP secret can be STALE** - generated codes get "Invalid"; use a backup code from the item notes instead (format `abcd-efgh`)
2. **discord rate-limits MFA attempts** with a "Slow down! Are you sure?" confirm modal and keeps the submit button in Loading - wait it out, don't spam clicks
3. **MFA flow**: needs clicking "Verify with something else" then "Use your authenticator app" / "Use a backup code" - these are DIV role=button elements, not `<button>`; code input is `input[autocomplete=one-time-code]` (id `_r_e_`, maxlength 6)
4. **login form has a saved-account picker** ("Choose an account") - click the account then its "Log in" (email field may be EMPTY - refill the account email + password from the vault)
5. **eval with inline arrows/quotes in agent-browser breaks** - write JS to a temp file and eval the file path; read screenshots via `opencode run -m opencode/mimo-v2.5-free -f <png>`

### token storage
Save to the account's vault notes under a `[discord token]` header (symmetric with other vault items).

### ToS risk
this is a self-bot (user account token used outside official client) - ban risk. user aware, uses it anyway.
