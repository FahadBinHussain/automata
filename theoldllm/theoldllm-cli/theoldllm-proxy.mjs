#!/usr/bin/env node
/**
 * theoldllm-proxy.mjs — local OpenAI-compatible HTTP proxy for TheOldLLM
 * Runs on port 3001 (or env PORT). Translates OpenAI /v1/chat/completions
 * into headless-browser CLI calls.
 */

import http from "http";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomUUID } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "theoldllm-cli.mjs");
const PORT = process.env.PORT || 3001;

function send(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function sendSSE(res, chunk) {
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
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
      const systemMsg = messages.find((m) => m.role === "system");
      const userMsg = messages.find((m) => m.role === "user");

      if (!userMsg) {
        send(res, 400, { error: { message: "No user message found", type: "invalid_request_error", code: "no_user_message" } });
        return;
      }

      const args = [CLI_PATH];
      if (model) args.push("-m", model);
      if (systemMsg?.content) args.push("-s", systemMsg.content);
      if (!stream) args.push("--no-stream");
      args.push(userMsg.content);

      const proc = spawn(process.execPath, args, {
        cwd: __dirname,
        env: { ...process.env },
      });

      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (data) => { stdout += data; });
      proc.stderr.on("data", (data) => { stderr += data; });

      await new Promise((resolve, reject) => {
        proc.on("close", (code) => {
          if (code !== 0) {
            reject(new Error(`CLI exited ${code}: ${stderr || stdout}`));
          } else {
            resolve();
          }
        });
        proc.on("error", reject);
      });

      const id = `chatcmpl-${randomUUID()}`;
      const created = Math.floor(Date.now() / 1000);

      if (stream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        });

        // Send one delta with the full text
        sendSSE(res, {
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: { content: stdout.trim() }, finish_reason: null }],
        });

        // Send finish
        sendSSE(res, {
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        });

        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        send(res, 200, {
          id,
          object: "chat.completion",
          created,
          model,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: stdout.trim() },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      }
    } catch (err) {
      console.error("proxy error:", err);
      send(res, 500, { error: { message: err.message, type: "api_error", code: "internal_error" } });
    }
  });
});

server.listen(PORT, () => {
  console.log(`theoldllm proxy listening on http://localhost:${PORT}`);
  console.log(`openai endpoint: POST http://localhost:${PORT}/v1/chat/completions`);
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
