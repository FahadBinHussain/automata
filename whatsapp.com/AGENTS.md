# WhatsApp automation (local notes)

helper: `$env:USERPROFILE\Downloads\mainframe\whatsapp-account.ps1`; profiles keyed by phone number, not email

## Account workflow

- `login <phone>` > `wacli auth --store ~/.wacli` (QR opens in a new window).
- `use <phone>` switches profile.
- `run [phone] [wacli args]` proxies to `wacli` (no browser profiles).

## Rules

- never send messages, mark broad chats read, scrape unrelated history, or print cookies unless i explicitly ask.
- for "what did X say": find the chat, read only the latest relevant messages/media, summarize/transcribe only that.
- voice notes: download/decrypt to `C:\tmp`, validate with `ffmpeg`, transcribe via LiteLLM `gemini-3.5-flash` (global AI-stack rule applies — no direct Gemini keys); offline fallback = the verified ct2 local model (see STT section).

## STT — bengali voice notes (verified working local path 2026-09-14, supersedes 2026-09-07 verdicts)

**local champion (verified on our box): the tugstugi/BengaliAI whisper-medium fine-tune, run as ct2 int8 via faster-whisper.**
- this is what the bd community converged on (Bengali.AI Kaggle 1st place; most-downloaded bn model ~1.8k/mo; whisper-transcriber ships it; BengaliLoop baseline 34% WER long-form, 24% with the full recipe).
- our retest (2026-09-14): `SayedShaun/bengali-whisper-medium-ct2`, forced `language="bn"`, CPU int8 → clean complete Bangla-script transcript of the same clip where turbo gave devanagari/truncation. the old "bengaliAI medium rejected (OOM)" was a packaging artifact (transformers fp32), not the model.
- working command (ct2 must be pinned — see gotchas):
  `uv run --no-project --python 3.11 --with faster-whisper --with ctranslate2==4.4.0 --with "setuptools<81" --with soundfile python <script> SayedShaun/bengali-whisper-medium-ct2`
- gotchas that cost an hour each:
  - ctranslate2 4.5+/4.6 on this windows box dies with `mkl_malloc: failed to allocate memory` (hybrid-CPU bug, fails on load AND on beam search; `MKL_DISABLE_FAST_MM=1` doesn't help). pin `ctranslate2==4.4.0` (needs `setuptools<81` for its pkg_resources import).
  - HF anonymous download crawls at ~50KB/s and xet stalls; set `HF_TOKEN` (mainframe hf account) + `HF_HUB_DISABLE_XET=1`.
  - bangla output crashes cp1252 console: set `PYTHONIOENCODING=utf-8` (or redirect to file).
  - NFC-normalize output (precomposed য়/ড়/ঢ় vs nukta — an 18% WER trap in evals).
  - best practice from the DL Sprint 4.0 winning recipe, for longer/messier audio: Silero VAD first (biggest free win), ≤28s chunks, `condition_on_previous_text=False`, strip non-U+0980–09FF, dedupe repeated phrases. for dialect-heavy casual speech try the regional variant `IamSanjid/tugstugi_bengaliai-regional-asr_whisper-medium-ct2`.
  - punctuation add-on: `asr-punct-restore` (adds । , ?), same Kaggle solution.
- alternatives verified by research (not run here): `BuzzASR/bengali` (whisper-large-v3 + native bn tokenizer, MIT, CER 5.5–10 — newest, transformers fp16 needs GPU); `hishab/titu_stt_bn_fastconformer` (~36x faster, same accuracy, but NeMo install + CC-BY-NC); ai4bharat IndicWhisper-bn (MIT, plain transformers, ~20% Vistaar WER).
- cloud: `gemini-3.5-flash` via litellm gateway stays the cleanest bangla + banglish code-switch route (official bn-BD support, free tier) — still primary when the HF space is alive. azure speech F0 (5h/mo free, bn-BD mature) is the best standalone API fallback.

## GPU for python (RTX 5050 8GB) — reusable wiring

- python finds NO `cublas64_12.dll` by default → ctranslate2/torch silently fall back to CPU. fix: `uv --with nvidia-cublas-cu12,nvidia-cudnn-cu12`, then prepend `<site-packages>/nvidia/*/bin` to `os.environ["PATH"]` BEFORE importing faster_whisper/torch. resolve base via `import nvidia; os.path.dirname(nvidia.__path__[0])` then `glob('nvidia/*/bin')` (site.getsitepackages of the ephemeral uv env is wrong).
- torch GPU: `--with "torch==2.8.0+cu128" --extra-index-url https://download.pytorch.org/whl/cu128 --index-strategy unsafe-best-match` → `torch.cuda.is_available()` True.
- after a CUDA OOM the context poisons → next run "unknown error"; kill leaked python procs or run small models on CPU.
- `uv` here has no `--torch-backend`; pin the +cu128 wheel + extra-index-url instead.

## House rules

- gateway ASR (`gemini-3.5-flash` via litellm) is the primary for clean bangla when the HF space is alive; the ct2 local model is a verified offline fallback (and keeps working with no internet).
- never run python with cwd `C:\tmp` — stray `C:\tmp\inspect.py` shadows stdlib `inspect` and breaks torch/pyav. run from the repo dir.
- useful temp scripts > `$env:USERPROFILE\Downloads\automata\whatsapp.com`, one-offs > `C:\tmp`.
- never commit secrets/profiles/media/transcripts unless i explicitly ask.