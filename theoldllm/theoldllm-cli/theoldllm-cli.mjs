#!/usr/bin/env node
/**
 * theoldllm-cli.mjs — independent CLI for TheOldLLM chat API
 * Uses Playwright headless browser to bypass Vercel WAF.
 * Token auto-loaded from ~/.config/theoldllm/token.txt
 */

import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

const TOKEN_PATH = join(homedir(), '.config', 'theoldllm', 'token.txt');
const API_URL = 'https://<app-url>/api/aichat';
const ORIGIN = 'https://<app-url>';

function loadToken() {
  if (!existsSync(TOKEN_PATH)) {
    console.error(`Token not found at ${TOKEN_PATH}`);
    process.exit(1);
  }
  return readFileSync(TOKEN_PATH, 'utf-8').trim();
}

function printHelp() {
  console.log(`Usage: node theoldllm-cli.mjs [options] <message>

Options:
  -m, --model <model>     Model to use (default: gpt-5.5)
  -s, --system <prompt>   System prompt
      --no-stream         Wait for full response instead of streaming
      --temp <n>          Temperature (0-2)
      --show-browser      Show browser window (for debugging)
  -h, --help              Show this help

Examples:
  node theoldllm-cli.mjs "hello world"
  node theoldllm-cli.mjs -m claude-4 "explain quantum computing"
  echo "hi" | node theoldllm-cli.mjs`);
}

async function readStdin() {
  return new Promise((resolve) => {
    let input = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', () => resolve(input.trim()));
    process.stdin.on('close', () => resolve(input.trim()));
  });
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    model: 'gpt-5.5',
    message: null,
    stream: true,
    system: '',
    temperature: undefined,
    headless: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-m' || arg === '--model') { options.model = args[++i]; continue; }
    if (arg === '-s' || arg === '--system') { options.system = args[++i]; continue; }
    if (arg === '--no-stream') { options.stream = false; continue; }
    if (arg === '--temp' || arg === '--temperature') { options.temperature = parseFloat(args[++i]); continue; }
    if (arg === '--show-browser') { options.headless = false; continue; }
    if (arg === '-h' || arg === '--help') { printHelp(); process.exit(0); }
    if (!arg.startsWith('-')) { options.message = (options.message ? options.message + ' ' : '') + arg; }
  }

  return options;
}

function extractOpenAIContent(data) {
  // Standard OpenAI SSE/JSON shape
  if (data.choices?.[0]?.delta?.content !== undefined) {
    return data.choices[0].delta.content;
  }
  if (data.choices?.[0]?.message?.content !== undefined) {
    const raw = data.choices[0].message.content;
    if (typeof raw !== 'string') return String(raw);
    // If content is a JSON-stringified blob of streaming lines, extract deltas
    const lines = raw.split('\n').filter(Boolean);
    let out = '';
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === 'delta' && typeof parsed.content === 'string') out += parsed.content;
      } catch { /* ignore */ }
    }
    return out || raw;
  }
  return '';
}

async function run(options) {
  const token = loadToken();
  const browser = await chromium.launch({ headless: options.headless });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.0 Edg/150.0.0.0',
  });
  const page = await context.newPage();

  try {
    await page.goto(ORIGIN, { waitUntil: 'networkidle', timeout: 30000 });

    const threadId = randomUUID();
    const messages = [];
    if (options.system) messages.push({ role: 'system', content: options.system });
    messages.push({ role: 'user', content: options.message });

    const body = {
      model: options.model,
      provider: 'openai',
      messages,
      stream: options.stream,
      threadId,
      sessionId: threadId,
    };
    if (options.temperature !== undefined) body.temperature = options.temperature;

    const response = await page.evaluate(async ({ apiUrl, token, body }) => {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Supabase-Auth': token,
          'Referer': 'https://<app-url>/',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) return { error: true, status: res.status, statusText: res.statusText, body: await res.text() };
      return { error: false, text: await res.text() };
    }, { apiUrl: API_URL, token, body });

    if (response.error) {
      console.error(`HTTP ${response.status} ${response.statusText}`);
      console.error(response.body);
      await browser.close();
      process.exit(1);
    }

    if (options.stream) {
      // SSE format: data: {...}\n\ndata: [DONE]\n
      const lines = response.text.split('\n');
      let printed = false;
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const payload = line.slice(6);
          if (payload === '[DONE]') break;
          try {
            const data = JSON.parse(payload);
            const chunk = extractOpenAIContent(data);
            if (chunk) { process.stdout.write(chunk); printed = true; }
          } catch { /* ignore malformed */ }
        }
      }
      if (printed) process.stdout.write('\n');
    } else {
      // Standard JSON response
      try {
        const data = JSON.parse(response.text);
        const text = extractOpenAIContent(data);
        console.log(text);
      } catch {
        console.log(response.text);
      }
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  const options = parseArgs();

  if (!options.message) {
    if (!process.stdin.isTTY) {
      options.message = await readStdin();
    }
    if (!options.message) {
      console.error('Error: no message provided');
      printHelp();
      process.exit(1);
    }
  }

  await run(options);
}

main();
