#!/usr/bin/env node
/**
 * theoldllm-mcp.mjs — MCP server wrapper for TheOldLLM CLI
 * Exposes a single `chat` tool that runs the headless Playwright CLI.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "theoldllm-cli.mjs");

const server = new Server(
  { name: "theoldllm", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "chat",
      description: "Send a chat message to TheOldLLM (https://<app-url>). Useful for web-search-enabled answers, coding help, or general conversation. Use when the user asks to use TheOldLLM or when web search is needed.",
      inputSchema: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The user message to send",
          },
          model: {
            type: "string",
            description: "Model name (default: gpt-5.5)",
            default: "gpt-5.5",
          },
          system: {
            type: "string",
            description: "Optional system prompt",
            default: "",
          },
          stream: {
            type: "boolean",
            description: "Whether to stream the response",
            default: true,
          },
        },
        required: ["message"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { message, model = "gpt-5.5", system = "", stream = true } = request.params.arguments;

  const args = [CLI_PATH];
  if (model) args.push("-m", model);
  if (system) args.push("-s", system);
  if (!stream) args.push("--no-stream");
  args.push(message);

  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, args, {
      cwd: __dirname,
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => { stdout += data; });
    proc.stderr.on("data", (data) => { stderr += data; });

    proc.on("close", (code) => {
      if (code !== 0) {
        resolve({
          content: [
            {
              type: "text",
              text: `TheOldLLM CLI exited with code ${code}. stderr: ${stderr || "(none)"}`,
            },
          ],
          isError: true,
        });
      } else {
        resolve({
          content: [{ type: "text", text: stdout.trim() }],
        });
      }
    });

    proc.on("error", (err) => {
      resolve({
        content: [{ type: "text", text: `Failed to spawn TheOldLLM CLI: ${err.message}` }],
        isError: true,
      });
    });
  });
});

const transport = new StdioServerTransport();
await server.connect(transport);
