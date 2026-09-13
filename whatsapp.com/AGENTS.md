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
  - `faster-whisper large-v3-turbo` (local) — **best complete+accurate for bengali so far**: on GPU (cuda/float16) it transcribes the full 30s note correctly in ~10s. catch: auto-detect writes bengali in devanagari script (detects "hi"); forced `language="bn"` gives bangla script but truncates. usable output, wrong script. cpu-only runs were slow + needed `CT2_USE_EXHAUSTIBLE_CPU_MEMORY_POOL=1`; prefer GPU.
  - `arijitx/wav2vec2-xls-r-300m-bengali` (local, GPU, greedy CTC) — real bangla script, ~1s/note, but broken word-spacing (no kenlm; kenlm won't build here — no cmake/MSVC).
  - `ssshanto/bengali-dialect-whisper-tiny` (local) — bangla script but mangles words + cuts off; worse than turbo. reject.
  - `bengaliAI/tugstugi_bengaliai-asr_whisper-medium` (local, 3GB) — never ran: pagefile/CUDA OOM on this 8GB+16GB box. reject.
  - `ai4bharat/indicconformer_stt_bn_hybrid_ctc_rnnt_large` (.nemo, the actual bengali SOTA) — **BLOCKED**: gated (accepted as `algojectt`, not `fahadbinhussain`), and even after download the config hardcodes their internal NFS `tokenizer.langs.*.dir` paths → NeMo raises `KeyError: 'dir'` at load before inference. weights+vocab ARE in the archive but repacking the multilingual tokenizer is a fragile rabbit hole. not worth it local.
  - `qwen3.5-omni-plus` (alibaba API, AA free-tier top) — rejected pre-test: requires account signup + phone verification + pay-as-you-go auto-billing toggle.
- GPU-for-python on this box (RTX 5050 8GB): the python stack finds NO `cublas64_12.dll` by default → ctranslate2/torch silently fall back to cpu. fix: `uv --with nvidia-cublas-cu12,nvidia-cudnn-cu12`, then prepend every `<site-packages>/nvidia/*/bin` to `os.environ["PATH"]` BEFORE importing faster_whisper/torch (site.getsitepackages of the ephemeral uv env is wrong — resolve via `import nvidia; os.path.dirname(nvidia.__path__[0])` then glob `nvidia/*/bin`). torch needs `--with "torch==2.8.0+cu128" --extra-index-url https://download.pytorch.org/whl/cu128` + `--index-strategy unsafe-best-match`; `torch.cuda.is_available()` then True. after a CUDA OOM the context can be poisoned → "unknown error" on next run: kill leaked python procs, or just run cpu for small models.
- verdict: for a one-off "what did X say" on a bengali voice note, use `faster-whisper large-v3-turbo` on GPU and transliterate/interpret the devanagari (content is correct). clean bangla-script automatic bengali ASR still needs the gateway (`gemini-3.5-flash` via litellm) or the cloud conformer — not solved locally.
- never run python with cwd `C:\tmp` — stray `C:\tmp\inspect.py` shadows stdlib `inspect` and breaks torch/pyav imports. run from the repo dir instead.
- useful temp scripts > `$env:USERPROFILE\Downloads\automata\whatsapp.com`, one-offs > `C:\tmp`.
- never commit secrets/profiles/media/transcripts unless i explicitly ask.