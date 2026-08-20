# theoldllm-cli

Independent CLI for TheOldLLM chat API (app URL from `THEOLDLLM_ORIGIN` env or `.env.local` next to the scripts).

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

### CLI mode

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

### OpenAI-compatible proxy mode

Start the proxy server:

**Option A: Double-click the desktop shortcut**

A shortcut named **"TheOldLLM Proxy"** is on your desktop. Double-click it to start the proxy in a minimized PowerShell window. It will run on `http://localhost:3001`.

**Option B: Run manually from terminal**

```bash
node theoldllm-proxy.mjs
```

This runs an OpenAI-compatible HTTP API on `http://localhost:3001`:

```bash
# test with curl
curl -X POST http://localhost:3001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.5","messages":[{"role":"user","content":"hello"}]}'
```

### opencode integration

Add to `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "theoldllm": {
      "api": "openai",
      "options": {
        "baseURL": "http://localhost:3001",
        "apiKey": "dummy"
      },
      "models": {
        "gpt-5.5": {
          "id": "gpt-5.5",
          "name": "TheOldLLM GPT-5.5",
          "provider": { "api": "openai" },
          "options": {}
        }
      }
    }
  }
}
```

Then in opencode:

1. Start the proxy: `node theoldllm-proxy.mjs` (keep it running)
2. **Restart opencode** (config is not hot-reloaded)
3. Switch model: `/model theoldllm/gpt-5.5`

### MCP tool (alternative)

An MCP server is also included for tool-based access:

```jsonc
{
  "mcp": {
    "theoldllm": {
      "type": "local",
      "command": ["node", "<path-to>/theoldllm-cli/theoldllm-mcp.mjs"],
      "enabled": true
    }
  }
}
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
- the proxy must stay running for opencode to use it as a provider.
