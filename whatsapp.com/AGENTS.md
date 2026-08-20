# WhatsApp automation (local notes)

helper: `$env:USERPROFILE\Downloads\mainframe\whatsapp-account.ps1`; profiles keyed by phone number, not email

## Account workflow

- `login <phone>` > `wacli auth --store ~/.wacli` (QR opens in a new window).
- `use <phone>` switches profile.
- `run [phone] [wacli args]` proxies to `wacli` (no browser profiles).

## Rules

- never send messages, mark broad chats read, scrape unrelated history, or print cookies unless i explicitly ask.
- for "what did X say": find the chat, read only the latest relevant messages/media, summarize/transcribe only that.
- voice notes: download/decrypt to `C:\tmp`, validate with `ffmpeg`, transcribe via LiteLLM `gemini-3.5-flash` (global AI-stack rule applies — no direct Gemini keys).
- useful temp scripts > `$env:USERPROFILE\Downloads\automata\whatsapp.com`, one-offs > `C:\tmp`.
- never commit secrets/profiles/media/transcripts unless i explicitly ask.