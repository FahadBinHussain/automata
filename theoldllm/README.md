# theoldllm-cli

Independent CLI for TheOldLLM (`https://<app-url>`) chat API.

Bypasses Vercel WAF by running `fetch()` inside a headless Playwright browser. Token is read from `~/.config/theoldllm/token.txt` at runtime.

## install

```bash
cd theoldllm-cli
npm install
```

Also install Chromium for Playwright (first time only):

```bash
npx playwright install chromium
```

## save your token

Place your JWT at:

```
~/.config/theoldllm/token.txt
```

The token is the `X-Supabase-Auth` value from a logged-in browser session on the site.

## usage

```bash
# basic chat (streaming)
node theoldllm-cli.mjs "hello world"

# choose model + system prompt
node theoldllm-cli.mjs -m gpt-5.5 -s "you are a pirate" "write a haiku"

# non-streaming
node theoldllm-cli.mjs --no-stream "what is 2+2?"

# pipe from stdin
echo "summarize this" | node theoldllm-cli.mjs

# debug: show browser window
node theoldllm-cli.mjs --show-browser "test"
```

## options

| flag | description |
|------|-------------|
| `-m, --model` | model name (default: `gpt-5.5`) |
| `-s, --system` | system prompt |
| `--no-stream` | wait for full response |
| `--temp` | temperature (0-2) |
| `--show-browser` | show browser window for debugging |
| `-h, --help` | show help |

## notes

- each call spins up a headless chromium (~2-3s overhead) because Vercel WAF blocks non-browser requests.
- no custom tool calling — the API only supports its internal `webSearch` tool.
