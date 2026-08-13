# YouTube stream automation (local notes)

## Stream watch / recurring checks

- Recurring YouTube channel checks: mainframe GWS profile for `<email>` + this folder's watcher: `youtube.com-stream-watch-codex-automation.mjs` (config: `youtube.com-stream-watch-codex-automation.config.json`, see `.example.json`).
- After a stream is processed, follow the YouTube sub-workflows below: title naming, exact-game detection, public playlist accuracy guardrail, Studio game-title update with reload verification.

## Auto-publish rules

- Never auto-publish adult, dev/coding, unknown, or uncertain streams.
- Safe game streams may be made public only after the dev/adult check passes.

## Notifications

- Notifier: `tools\codex_notify.mjs` (this workspace) or `C:\Users\<user>\Downloads\automata\tools\codex\codex-notify.mjs` → Murmur's queued `/api/automation/notifications` endpoint for Messenger thread `<thread-id>`.
- When Murmur runs on a private HF Space, set `CODEX_NOTIFY_HF_PROFILE` to the owning mainframe HF account email so the notifier reads the HF token at runtime and sends `X-HF-Authorization`.
- If Murmur/env is unavailable, keep messages queued for later flush instead of dropping them.

## Stream cleanup sub-workflows

**1. Unnamed stream titles** — mainframe GWS profile > YouTube channel API > find latest unnamed/generic streams > show clickable video links + current privacy > if asked, make selected streams public > download/extract audio > transcribe with my LiteLLM gateway using `gemini-3.5-flash` by default (no direct Google Gemini API keys or `GEMINI_API_KEY` unless i explicitly ask) > LiteLLM is only for full timestamped transcription, not for choosing moments or writing final titles > save transcript locally > agent reads the transcript, finds specific funny moments, and writes the title options > title prompt/format: "Given this video's saved timestamped transcript and any visual description available, generate 5-10 short, fun, clickbaity titles in the same local language as the transcript, add 1-3 fitting emotes in each title 🎉🔥😂. the title must be based on specific fun incidents. the title will consist of two parts if the video is not in english. for example, {local language part | english part}. under every title, always include timestamp(s) of the exact moment(s) the title is based on plus a short description of what happened there; never return title-only options." > wait for my choice numbers > rename selected videos > report updated links + remaining unnamed count

**2. Stream game detection** — identify exact game names, not category IDs/names like `20` or `Gaming` > assume a stream can contain multiple games > report each game with timestamp/frame evidence > "full stream checked" = full-duration timeline sampling from start to end, dense enough (every 3-5 min for long streams plus near-start/near-end samples) > prefer free/local CLIP image-retrieval using `openai/clip-vit-base-patch32` against official/public reference screenshots > use OCR/menu/HUD/text clues and current web verification > evidence-based candidate retrieval that only covers games in the reference index unless new candidates are researched/downloaded > do not rely on GameNet-1, VideoGameBunny, or hosted/paid VLMs unless explicitly re-tested and approved > warn about bandwidth/storage before building large screenshot indexes

**3. YouTube Studio game-title update** — confirm target account/profile > prefer the durable real-UI updater `C:\Users\<user>\Downloads\automata\youtube.com\studio.youtube.com-game-title-ui-updater.mjs` using the saved mainframe agent-browser profile > try `YOUTUBE_STUDIO_HEADLESS=1` only as a first background attempt (Studio may not render editor headlessly) > use `YOUTUBE_STUDIO_MINIMIZED=1` as the proven low-disruption mode > do not trust direct/internal `metadata_update` shortcuts unless a fresh Studio reload proves category and game title persisted > in Studio, explicitly set Audience/"No, it's not made for kids" when required > set category `Gaming` > choose exact game title option > click real nested Save button > wait for `/youtubei/v1/video_manager/metadata_update` HTTP 200 > verify by reloading each Studio edit page and reading category + game input > public `yt-dlp` may show `Gaming` while still returning `game: null`, so use Studio reload as authoritative verification for the game field

**4. Game playlist accuracy guardrail** — for public game playlists, never add a video to a newly guessed game playlist from a manual visual hunch alone > if CLIP has no reference for the apparent game, or top match is low-confidence/contradicted by contact sheets/OCR/HUD/menu text, mark the stream as `unknown` or `needs review` > research the exact title from current public sources > add official/public reference screenshots to the index > rerun CLIP or compare against the new reference > add the video only after corrected evidence agrees > if a wrong playlist add is discovered, remove the video from the wrong playlist > delete the empty wrong playlist when appropriate > update the local manifest/reference index > report the correction plainly