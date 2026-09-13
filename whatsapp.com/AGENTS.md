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

## STT — bengali voice notes (tested 2026-09-07, 6 models)

reality: **no local model got both correct content AND bangla script.** not solved locally.

- closest-to-usable — `faster-whisper large-v3-turbo` on GPU: auto-detect transcribes the full 30s note with correct content, BUT in devanagari script (it detects "hi"). forced `language="bn"` outputs real bangla but truncates/hallucinates (rejected). so: use it only if you transliterate/interpret the devanagari (content is right, script wrong). cpu-only runs were slow + needed `CT2_USE_EXHAUSTIBLE_CPU_MEMORY_POOL=1`.
- rejected, do not retry without new evidence:
  - `openai-whisper small` (local) — mixed-script garbage.
  - `cohere transcribe-03-2026` (API) — no bengali (14 langs only); english gibberish. key vaulted `dashboard.cohere.com` for english only.
  - `qwen3.5-omni-plus` (API) — needs signup + phone-verify + auto-billing toggle. rejected pre-test.
  - `arijitx/wav2vec2-xls-r-300m-bengali` (local, greedy CTC) — real bangla, fast, but broken word-spacing (kenlm won't build here — no cmake/MSVC).
  - `ssshanto/bengali-dialect-whisper-tiny` (local) — bangla but mangles words + cuts off.
  - `bengaliAI/tugstugi_bengaliai-asr_whisper-medium` (local 3GB) — never ran: pagefile/CUDA OOM on 8GB+16GB box.
  - `ai4bharat/indicconformer_stt_bn_hybrid_ctc_rnnt_large` (.nemo, actual bengali SOTA) — BLOCKED: gated (accept only sticks per-account), and config hardcodes their internal `/nlsasfs/...` tokenizer `dir` paths → NeMo `KeyError: 'dir'` at load. weights+vocab are in the archive but repacking is a fragile rabbit hole. skip.

## GPU for python (RTX 5050 8GB) — reusable wiring

- python finds NO `cublas64_12.dll` by default → ctranslate2/torch silently fall back to CPU. fix: `uv --with nvidia-cublas-cu12,nvidia-cudnn-cu12`, then prepend `<site-packages>/nvidia/*/bin` to `os.environ["PATH"]` BEFORE importing faster_whisper/torch. resolve base via `import nvidia; os.path.dirname(nvidia.__path__[0])` then `glob('nvidia/*/bin')` (site.getsitepackages of the ephemeral uv env is wrong).
- torch GPU: `--with "torch==2.8.0+cu128" --extra-index-url https://download.pytorch.org/whl/cu128 --index-strategy unsafe-best-match` → `torch.cuda.is_available()` True.
- after a CUDA OOM the context poisons → next run "unknown error"; kill leaked python procs or run small models on CPU.
- `uv` here has no `--torch-backend`; pin the +cu128 wheel + extra-index-url instead.

## House rules

- gateway ASR (`gemini-3.5-flash` via litellm) is still the primary for clean bangla when the HF space is alive; local is only a fallback.
- never run python with cwd `C:\tmp` — stray `C:\tmp\inspect.py` shadows stdlib `inspect` and breaks torch/pyav. run from the repo dir.
- useful temp scripts > `$env:USERPROFILE\Downloads\automata\whatsapp.com`, one-offs > `C:\tmp`.
- never commit secrets/profiles/media/transcripts unless i explicitly ask.