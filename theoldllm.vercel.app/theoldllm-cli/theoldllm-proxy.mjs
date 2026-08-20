#!/usr/bin/env node
/**
 * theoldllm-proxy.mjs — local OpenAI-compatible HTTP proxy for TheOldLLM
 * Keeps one headless Chromium page warm and adds tool-call support.
 *
 * Flow:
 *   1. Receives OpenAI request with messages + tools
 *   2. Renders the client's tools into a system-prompt block the model can follow
 *   3. Sends to TheOldLLM via warm browser page
 *   4. Parses the model's TOOL_CALL lines back into structured OpenAI tool_calls
 *   5. Returns OpenAI completion shape with finish_reason:"tool" (caller executes tools)
 *   6. On the next turn, accepts role:"tool" messages and renders them back into the prompt
 */

import http from "http";
import { chromium } from "playwright";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

try {
  const p = new URL(".env.local", import.meta.url);
  if (existsSync(p)) for (const l of readFileSync(p, "utf8").split("\n")) {
    const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {}

const TOKEN_PATH = join(homedir(), ".config", "theoldllm", "token.txt");
const PORT = process.env.PORT || 3001;
const ORIGIN = process.env.THEOLDLLM_ORIGIN || "https://<app>.vercel.app";
const API_URL = process.env.THEOLDLLM_API_URL || "https://<app>.vercel.app/api/aichat";

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
  browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-site-isolation-trials",
      "--disable-web-security",
      "--disable-setuid-sandbox",
      "--no-sandbox",
      "--window-size=1280,720",
      "--force-device-scale-factor=1",
    ],
  });
  context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    screen: { width: 1280, height: 720 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.0 Edg/150.0.0.0",
    locale: "en-US",
    timezoneId: "America/New_York",
  });
  warmPage = await context.newPage();
  // strip automation flags before navigating
  await warmPage.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
    window.chrome = { runtime: {} };
    delete navigator.__proto__.webdriver;
  });
  // Vercel WAF checkpoint never reaches networkidle — wait for DOM then sleep
  await warmPage.goto(ORIGIN, { waitUntil: "domcontentloaded", timeout: 30000 });
  // WAF checkpoint may auto-redirect after JS evaluation; give it time
  await warmPage.waitForTimeout(20000);
  const finalUrl = warmPage.url();
  console.log(`[warmup] final url: ${finalUrl}`);
  console.log("[warmup] browser + page ready");
}

function send(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function sendSSE(res, chunk) {
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

// ─── TOOL-CALL PASS-THROUGH HELPERS ────────────────────────────
// Strategy: TheOldLLM is a hosted black box with no native `tools` API,
// so we render the client's tool list into a system-prompt block the
// model can follow, and parse the model's TOOL_CALL lines back into
// OpenAI-shaped `tool_calls`. The client (opencode, etc.) executes the
// tools and sends `role:"tool"` results on the next turn, which we
// re-render into the prompt for the model.

function renderToolSpecs(tools) {
  const lines = [];
  for (const t of tools) {
    const fn = t?.function ?? t;
    if (!fn?.name) continue;
    let line = `- ${fn.name}`;
    if (fn.description) line += `: ${fn.description}`;
    if (fn.parameters) {
      line += `\n  parameters (JSON Schema): ${JSON.stringify(fn.parameters)}`;
    }
    lines.push(line);
  }
  return lines.join("\n");
}

function buildToolPrompt(tools, toolChoice) {
  const specs = renderToolSpecs(tools);
  let prompt = `You have tools available. When a tool is the right way to answer, your ENTIRE response must be one or more TOOL_CALL lines, each on its own line, with NO other text, prose, markdown, code fences, or explanation.\n\nFormat:\nTOOL_CALL: {"name": "<function_name>", "arguments": {<arg_name>: <value>, ...}}\n\nRules:\n- Output ONLY the TOOL_CALL line(s) when calling a tool — absolutely nothing else before or after.\n- Multiple simultaneous tool calls: emit multiple TOOL_CALL lines, one per line.\n- After tool results come back in later turns, answer normally without TOOL_CALL lines.\n- If no tool is needed, answer the user directly without a TOOL_CALL line.\n- All argument values must be valid JSON (strings quoted, numbers bare, booleans true/false, arrays and objects as JSON).\n\nAvailable tools:\n${specs}`;

  if (toolChoice && toolChoice !== "auto") {
    if (toolChoice === "required") {
      prompt += `\n\nIMPORTANT: you MUST call at least one tool in this turn (tool_choice="required").`;
    } else if (typeof toolChoice === "object") {
      const name = toolChoice?.function?.name || toolChoice?.name;
      if (name) {
        prompt += `\n\nIMPORTANT: you MUST call exactly the tool "${name}" in this turn (tool_choice forced). Do not call any other tool.`;
      }
    } else if (toolChoice === "none") {
      prompt += `\n\nIMPORTANT: do NOT call any tool this turn (tool_choice="none"). Answer directly.`;
    }
  }
  return prompt;
}

// Strip TOOL_CALL lines from assistant text so callers that don't ask
// for tools never see raw tool-call markers in the content.
function stripToolCallLines(text) {
  return text.replace(/TOOL_CALL:\s*\{[\s\S]*?\}\n?/g, "").trim();
}

function parseToolCalls(text) {
  const calls = [];
  const regex = /TOOL_CALL:\s*(\{[\s\S]*?\})\s*(?:\n|$)/g;
  let match;
  let idx = 0;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      // Accept both OpenAI names (name/arguments) and legacy (tool/args)
      const name = parsed.name || parsed.tool;
      const args = parsed.arguments ?? parsed.args ?? {};
      if (name) {
        calls.push({
          id: `call_${randomUUID()}`,
          type: "function",
          function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
          _index: idx++,
        });
      }
    } catch {
      // malformed JSON, skip
    }
  }
  return calls;
}

// Map a list of OpenAI messages (which may include assistant `tool_calls`
// turns and `role:"tool"` result turns from previous rounds) into a clean
// `{role, content}` array that TheOldLLM can understand. We surface prior
// tool invocations and their results as readable text blocks so the model
// can continue the conversation coherently.
function flattenMessagesForUpstream(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      const lines = m.tool_calls.map((tc) => {
        let argsStr = tc?.function?.arguments || "{}";
        if (typeof argsStr === "string") {
          try { argsStr = JSON.stringify(JSON.parse(argsStr)); } catch { /* keep as-is */ }
        }
        return `TOOL_CALL: {"name": "${tc?.function?.name}", "arguments": ${argsStr}}`;
      });
      const text = [m.content, ...lines].filter(Boolean).join("\n");
      out.push({ role: "assistant", content: text || lines.join("\n") });
    } else if (m.role === "tool") {
      const name = m.name || m.tool_call_id || "tool";
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
      out.push({ role: "user", content: `Tool result (${name}):\n${content}` });
    } else if (m.role === "assistant" && m.content == null && !Array.isArray(m.tool_calls)) {
      out.push({ role: "assistant", content: "" });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

// Normalize a raw upstream response from TheOldLLM into plain assistant text.
// TheOldLLM has been observed returning any of these shapes:
//   (a) OpenAI chat envelope: {"choices":[{"message":{"content":"..."}}]}
//   (b) OpenAI stream chunks back-to-back:
//       data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: {"choices":[{"delta":{"content":" there"}}]}\n\ndata: [DONE]
//   (c) NDJSON of custom deltas: {"type":"delta","content":"hi"}\n{"type":"delta","content":" there"}
//   (d) The custom delta shape embedded inside the envelope's message.content string
//   (e) Plain text as a last resort.
function extractText(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  // Try (a): one OpenAI chat envelope.
  try {
    const outer = JSON.parse(trimmed);
    const inner = typeof outer === "object" && outer.choices?.[0]?.message?.content;
    if (inner && typeof inner === "string") {
      // The inner content may itself be NDJSON-of-deltas (case d).
      const fromInner = parseDeltaBlob(inner);
      return fromInner || inner;
    }
    // Sometimes the envelope itself carries stream-shaped top-level fields.
    const delta = outer.choices?.[0]?.delta?.content;
    if (typeof delta === "string") return delta;
  } catch { /* not a single JSON object, fall through */ }

  // Try (b/c) by splitting the blob into SSE-style or NDJSON lines.
  const fromLines = parseDeltaBlob(trimmed);
  if (fromLines) return fromLines;

  // (e) plain text fallback.
  return trimmed;
}

// Parse a blob that is either a series of SSE `data: {...}` lines or a series
// of bare JSON lines, concatenating any OpenAI `delta.content` or custom
// `{"type":"delta","content":"..."}` deltas. Returns "" if nothing matched.
function parseDeltaBlob(blob) {
  let text = "";
  let sawAnyValid = false;
  const lines = blob.split(/\r?\n/);
  for (let line of lines) {
    if (!line) continue;
    // Strip SSE `data: ` prefix.
    if (line.startsWith("data:")) line = line.slice(5).trim();
    if (!line || line === "[DONE]") continue;
    // Strip surrounding quotes if it's a stringified-JSON leftover.
    try {
      const parsed = JSON.parse(line);
      sawAnyValid = true;
      const delta = parsed?.choices?.[0]?.delta?.content;
      if (typeof delta === "string") text += delta;
      else if (parsed?.type === "delta" && typeof parsed.content === "string") text += parsed.content;
      else if (parsed?.choices?.[0]?.message?.content && typeof parsed.choices[0].message.content === "string") {
        text += parsed.choices[0].message.content;
      }
    } catch { /* not a JSON line — ignore */ }
  }
  return sawAnyValid ? text : "";
}

// ─── SERVER ────────────────────────────────────────────────────

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
      const tools = payload.tools || [];

      if (!messages.length) {
        console.log(`  -> 400 (${Date.now() - start}ms) — no messages`);
        send(res, 400, { error: { message: "No messages provided", type: "invalid_request_error", code: "no_messages" } });
        return;
      }

      if (!lastThreadId) lastThreadId = randomUUID();
      await initBrowser();

      // ── Build the message array we send to TheOldLLM ──────
      // 1. Convert any prior assistant `tool_calls` / `role:"tool"` turns from
      //    the OpenAI history into readable text turns TheOldLLM can understand.
      // 2. If the client passed a `tools` array, inject a tool-using system block.
      const upstreamMessages = flattenMessagesForUpstream(messages);

      const hasClientTools = Array.isArray(tools) && tools.length > 0;
      const toolChoice = payload.tool_choice;
      console.log(`  tools=${tools.length} tool_choice=${JSON.stringify(toolChoice)} stream=${stream} msgs=${messages.length}`);
      if (toolChoice === "none" && !hasClientTools) {
        // nothing to do; model answers normally
      }
      if (hasClientTools && toolChoice !== "none") {
        const toolPrompt = buildToolPrompt(tools, toolChoice);
        const sysIdx = upstreamMessages.findIndex((m) => m.role === "system");
        if (sysIdx >= 0) {
          upstreamMessages[sysIdx] = {
            ...upstreamMessages[sysIdx],
            content: upstreamMessages[sysIdx].content + "\n\n" + toolPrompt,
          };
        } else {
          upstreamMessages.unshift({ role: "system", content: toolPrompt });
        }
      }

      // ── Call TheOldLLM ─────────────────────────────────────
      const result = await warmPage.evaluate(async ({ apiUrl, token, body }) => {
        const res = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Supabase-Auth": token,
            "Referer": ORIGIN + "/",
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) return { error: true, status: res.status, text: await res.text() };
        return { error: false, text: await res.text() };
      }, { apiUrl: API_URL, token, body: {
        model,
        provider: "openai",
        messages: upstreamMessages,
        // Always ask TheOldLLM for a NON-streaming response. We buffer the
        // full output once, then emit our own OpenAI-shaped SSE chunks to
        // the client. This keeps our parsing simple (extractText handles
        // one JSON envelope, not raw SSE lines) and avoids leaking upstream
        // SSE markers (`data:`, `DONE`) back into opencode's chat view.
        stream: false,
        threadId: lastThreadId,
        sessionId: lastThreadId,
      }});

      if (result.error) {
        console.log(`  -> ${result.status} (${Date.now() - start}ms) — upstream error`);
        send(res, result.status, { error: { message: result.text, type: "api_error" } });
        return;
      }

      const rawText = extractText(result.text);
      const toolCalls = hasClientTools ? parseToolCalls(rawText) : [];
      // When tool_calls were emitted, follow OpenAI convention: content is null
      // unless the model produced substantial non-TOOL_CALL prose around them.
      // Stray braces / fragments the model adds around a TOOL_CALL line are
      // treated as noise and dropped so they never leak to the client.
      let cleanContent;
      if (toolCalls.length > 0) {
        const stripped = stripToolCallLines(rawText);
        const meaningful = stripped.replace(/^[{}\s]+|{}\s*$/g, "").trim();
        cleanContent = meaningful.length >= 10 ? meaningful : null;
      } else {
        cleanContent = stripToolCallLines(rawText);
      }

      const id = `chatcmpl-${randomUUID()}`;
      const created = Math.floor(Date.now() / 1000);

      if (toolCalls.length > 0) {
        console.log(`  -> returning ${toolCalls.length} tool_call(s) to client (${Date.now() - start}ms)`);
        const message = {
          role: "assistant",
          content: cleanContent || null,
          tool_calls: toolCalls.map(({ _index, ...tc }) => tc),
        };
        if (stream) {
          res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
          // First chunk carries the tool_calls array (OpenAI streams tool_calls across
          // deltas per-index; sending them in one delta keeps clients simple).
          for (const tc of toolCalls) {
            const { _index, ...tcClean } = tc;
            sendSSE(res, {
              id, object: "chat.completion.chunk", created, model,
              choices: [{
                index: 0,
                delta: { role: "assistant", tool_calls: [{ index: _index, ...tcClean }] },
                finish_reason: null,
              }],
            });
          }
          if (cleanContent) {
            sendSSE(res, { id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content: cleanContent }, finish_reason: null }] });
          }
          sendSSE(res, { id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
          res.write("data: [DONE]\n\n");
          res.end();
        } else {
          send(res, 200, {
            id, object: "chat.completion", created, model,
            choices: [{ index: 0, message, finish_reason: "tool_calls" }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          });
        }
        return;
      }

      // ── No tool calls, return directly ─────────────────────
      if (stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
        sendSSE(res, { id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant", content: cleanContent }, finish_reason: null }] });
        sendSSE(res, { id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
        res.write("data: [DONE]\n\n");
        res.end();
        console.log(`  -> 200 SSE (${Date.now() - start}ms)`);
      } else {
        console.log(`  -> 200 JSON (${Date.now() - start}ms)`);
        send(res, 200, {
          id, object: "chat.completion", created, model,
          choices: [{ index: 0, message: { role: "assistant", content: cleanContent }, finish_reason: "stop" }],
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
