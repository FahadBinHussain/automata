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
- STT rejected models list (bengali voice notes; do NOT retry without new evidence):
  - `openai-whisper small` (local, 461MB) — hallucinated mixed-script garbage (bengali audio → random latin/greek/hebrew fragments). weights deleted from `~/.cache/whisper`.
  - `cohere transcribe-03-2026` (API) — bengali not in its 14 languages; output was english-shaped gibberish ("Ojipotumma de Bubonirata..."). API key vaulted at `dashboard.cohere.com` for english audio only.
  - `faster-whisper large-v3-turbo` (local, ctranslate2 int8, cpu) — auto-detect flags bengali as "hi" and transliterates to devanagari; forced `language="bn"` gives real bangla script but loops/hallucinates/truncates (>50% of a 29s note lost). also needs `CT2_USE_EXHAUSTIBLE_CPU_MEMORY_POOL=1` + 2 threads to fit 16GB ram, and dies with `mkl_malloc` when spawned detached. better than the two above but NOT good enough for bengali.
  - `qwen3.5-omni-plus` (alibaba API, AA free-tier top) — rejected pre-test: requires account signup + phone verification + pay-as-you-go auto-billing toggle.
- current best for bengali = AI4Bharat IndicWhisper/IndicConformer (indic-native, untested yet). gateway ASR (`gemini-3.5-flash` via litellm) is the primary when the HF space is alive.
- never run python with cwd `C:\tmp` — stray `C:\tmp\inspect.py` shadows stdlib `inspect` and breaks torch/pyav imports. run from the repo dir instead.
- useful temp scripts > `$env:USERPROFILE\Downloads\automata\whatsapp.com`, one-offs > `C:\tmp`.
- never commit secrets/profiles/media/transcripts unless i explicitly ask.