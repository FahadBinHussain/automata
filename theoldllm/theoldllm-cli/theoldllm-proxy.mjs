#!/usr/bin/env node
/**
 * theoldllm-proxy.mjs — local OpenAI-compatible HTTP proxy for TheOldLLM
 * Keeps one headless Chromium page permanently warm and reuses it.
 * Sends full conversation history so TheOldLLM sees context.
 */

import http from "http";
import { chromium } from "playwright";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

const TOKEN_PATH = join(homedir(), ".config", "theoldllm", "token.txt");
const PORT = process.env.PORT || 3001;
const ORIGIN = "https://<app-url>";
const API_URL = "https://<app-url>/api/aichat";

let token;
try {
  token = readFileSync(TOKEN_PATH, "utf-8").trim();
} catch {
  console.error(`Token not found at ${TOKEN_PATH}`);
  process.exit(1);
}

// Warm browser + permanently warmed page
let browser;
let context;
let warmPage;
let lastThreadId;

async function initBrowser() {
  if (browser) return;
  console.log("[warmup] launching chromium...");
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.0 Edg/150.0.0.0",
  });
  warmPage = await context.newPage();
  await warmPage.goto(ORIGIN, { waitUntil: "networkidle", timeout: 30000 });
  console.log("[warmup] browser + page ready");
}

function send(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function sendSSE(res, chunk) {
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

function extractText(raw) {
  // Try multiple extraction strategies — TheOldLLM wraps responses in various ways
  let text = "";
  const trimmed = raw.trim();

  // Strategy 1: outer OpenAI JSON wrapping inner content
  try {
    const outer = JSON.parse(trimmed);
    const inner = outer.choices?.[0]?.message?.content;
    if (inner) {
      const lines = inner.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "delta" && typeof parsed.content === "string") text += parsed.content;
        } catch { /* not JSON */ }
      }
      if (!text) text = inner;
    }
  } catch {
    // Strategy 2: line-delimited delta JSON
    const lines = trimmed.split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "delta" && typeof parsed.content === "string") text += parsed.content;
      } catch { /* ignore */ }
    }
  }

  return text || trimmed;
}

const server = http.createServer(async (req, res) => {
  const start = Date.now();
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "GET" && (req.url === "/v1/models" || req.url === "/models")) {
    console.log(`  -> 200 (${Date.now() - start}ms)`);
    send(res, 200, {
      object: "list",
      data: [{ id: "gpt-5.5", object: "model", created: 1700000000, owned_by: "theoldllm" }],
    });
    return;
  }

  if (req.method !== "POST" || (req.url !== "/v1/chat/completions" && req.url !== "/chat/completions")) {
    console.log(`  -> 404 (${Date.now() - start}ms)`);
    send(res, 404, { error: { message: "Not found", type: "not_found", code: "not_found" } });
    return;
  }

  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", async () => {
    try {
      const payload = JSON.parse(body);
      const messages = payload.messages || [];
      const model = payload.model || "gpt-5.5";
      const stream = payload.stream === true;

      if (!messages.length) {
        console.log(`  -> 400 (${Date.now() - start}ms) — no messages`);
        send(res, 400, { error: { message: "No messages provided", type: "invalid_request_error", code: "no_messages" } });
        return;
      }

      // Reuse same threadId for continuity — TheOldLLM sees conversation history
      if (!lastThreadId) lastThreadId = randomUUID();

      await initBrowser();

      // Reuse the warm page — NO new page.goto, that's what was eating 15s
      const result = await warmPage.evaluate(async ({ apiUrl, token, body }) => {
        const res = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Supabase-Auth": token,
            "Referer": "https://<app-url>/",
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) return { error: true, status: res.status, text: await res.text() };
        return { error: false, text: await res.text() };
      }, { apiUrl: API_URL, token, body: {
        model,
        provider: "openai",
        messages,
        stream,
        threadId: lastThreadId,
        sessionId: lastThreadId,
      }});

      if (result.error) {
        console.log(`  -> ${result.status} (${Date.now() - start}ms) — upstream error`);
        send(res, result.status, { error: { message: result.text, type: "api_error" } });
        return;
      }

      const id = `chatcmpl-${randomUUID()}`;
      const created = Math.floor(Date.now() / 1000);

      if (stream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        });

        const lines = result.text.split("\n");
        let content = "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") break;
            try {
              const parsed = JSON.parse(data);
              const chunk = parsed.choices?.[0]?.delta?.content ?? "";
              content += chunk;
            } catch { /* ignore */ }
          }
        }

        sendSSE(res, { id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content }, finish_reason: null }] });
        sendSSE(res, { id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
        res.write("data: [DONE]\n\n");
        res.end();
        console.log(`  -> 200 SSE (${Date.now() - start}ms)`);
      } else {
        const text = extractText(result.text);
        console.log(`  -> 200 JSON (${Date.now() - start}ms)`);
        send(res, 200, {
          id, object: "chat.completion", created, model,
          choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      }
    } catch (err) {
      console.error("proxy error:", err);
      console.log(`  -> 500 (${Date.now() - start}ms)`);
      send(res, 500, { error: { message: err.message, type: "api_error", code: "internal_error" } });
    }
  });
});

server.listen(PORT, () => {
  console.log(`theoldllm proxy listening on http://localhost:${PORT}`);
  console.log(`openai endpoint: POST http://localhost:${PORT}/v1/chat/completions`);
  initBrowser().catch((err) => console.error("warmup failed:", err));
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`port ${PORT} is already in use. theoldllm proxy may already be running.`);
    console.error(`try: curl http://localhost:${PORT}/v1/chat/completions`);
    process.exit(1);
  } else {
    console.error("server error:", err);
    process.exit(1);
  }
});
