#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

const DEFAULT_PORT = Number(process.env.MAINFRAME_WHATSAPP_PORT || 9231);
const DEFAULT_WAJS_PATH =
  process.env.WA_JS_BUNDLE ||
  "C:\\Users\\<user>\\Downloads\\mojify\\extension\\vendor\\wppconnect-wa.js";

const MIME_BY_EXT = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".mov", "video/quicktime"],
  [".mp3", "audio/mpeg"],
  [".ogg", "audio/ogg"],
  [".wav", "audio/wav"],
  [".pdf", "application/pdf"],
  [".txt", "text/plain"],
]);

function help() {
  return `WA-JS bridge for an already-open WhatsApp Web tab.

Usage:
  node wa-js-bridge.mjs status [--port 9231]
  node wa-js-bridge.mjs active-chat [--port 9231]
  node wa-js-bridge.mjs send-text --text "hi" [--port 9231]
  node wa-js-bridge.mjs send-media --file C:\\tmp\\a.png [--caption "test"] [--port 9231]

The target Chrome/Edge instance must be launched with --remote-debugging-port.
Use mainframe's whatsapp-account.ps1 helper for the normal flow.`;
}

function parseArgs(argv) {
  const args = {
    command: null,
    port: DEFAULT_PORT,
    targetHost: "web.whatsapp.com",
    wajsPath: DEFAULT_WAJS_PATH,
    text: "",
    file: "",
    caption: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      args.command = "help";
    } else if (token === "--port") {
      args.port = Number(argv[++i]);
    } else if (token.startsWith("--port=")) {
      args.port = Number(token.slice("--port=".length));
    } else if (token === "--target-host") {
      args.targetHost = argv[++i];
    } else if (token === "--wa-js") {
      args.wajsPath = argv[++i];
    } else if (token === "--text") {
      args.text = argv[++i] || "";
    } else if (token.startsWith("--text=")) {
      args.text = token.slice("--text=".length);
    } else if (token === "--file") {
      args.file = argv[++i] || "";
    } else if (token.startsWith("--file=")) {
      args.file = token.slice("--file=".length);
    } else if (token === "--caption") {
      args.caption = argv[++i] || "";
    } else if (token.startsWith("--caption=")) {
      args.caption = token.slice("--caption=".length);
    } else if (!args.command) {
      args.command = token;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  args.command ||= "status";
  if (!Number.isFinite(args.port) || args.port <= 0) {
    throw new Error(`Invalid --port value: ${args.port}`);
  }
  return args;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return response.json();
}

async function findWhatsAppTarget(port, targetHost) {
  const targets = await fetchJson(`http://127.0.0.1:${port}/json`);
  const pages = targets.filter((target) => target.type === "page");
  const target = pages.find((page) => String(page.url || "").includes(targetHost));

  if (!target?.webSocketDebuggerUrl) {
    const openUrls = pages.map((page) => page.url).filter(Boolean).slice(0, 5);
    throw new Error(
      [
        `No ${targetHost} tab found on Chrome DevTools port ${port}.`,
        "Open WhatsApp Web through mainframe first, then open the target chat.",
        openUrls.length ? `Open page sample: ${openUrls.join(" | ")}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  return target;
}

class CdpClient {
  constructor(webSocketDebuggerUrl) {
    this.url = webSocketDebuggerUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.socket = null;
  }

  async connect() {
    if (typeof WebSocket === "undefined") {
      throw new Error("This Node.js build has no global WebSocket. Use a current Node.js release.");
    }

    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", (event) => {
      const payload = JSON.parse(event.data);
      if (!payload.id || !this.pending.has(payload.id)) {
        return;
      }

      const { resolve: resolveMessage, reject } = this.pending.get(payload.id);
      this.pending.delete(payload.id);
      if (payload.error) {
        reject(new Error(payload.error.message || JSON.stringify(payload.error)));
      } else {
        resolveMessage(payload.result);
      }
    });

    await new Promise((resolveSocket, rejectSocket) => {
      this.socket.addEventListener("open", resolveSocket, { once: true });
      this.socket.addEventListener(
        "error",
        () => rejectSocket(new Error("Unable to connect to Chrome DevTools WebSocket.")),
        { once: true },
      );
    });

    await this.send("Runtime.enable");
    await this.send("Page.enable");
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;

    const promise = new Promise((resolveMessage, reject) => {
      this.pending.set(id, { resolve: resolveMessage, reject });
    });

    this.socket.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });

    if (result.exceptionDetails) {
      const text =
        result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text ||
        "Evaluation failed in WhatsApp Web.";
      throw new Error(text);
    }

    return result.result?.value;
  }

  close() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.close();
    }
  }
}

function callExpression(fn, ...args) {
  return `(${fn.toString()})(${args.map((arg) => JSON.stringify(arg)).join(",")})`;
}

function statusScript() {
  function serializeChatId(chat) {
    const id = chat?.id || chat;
    if (!id) return null;
    if (typeof id === "string") return id;
    return id._serialized || id.serialized || id.user || null;
  }

  function safeActiveChat() {
    try {
      return window.WPP?.chat?.getActiveChat?.() || null;
    } catch {
      return null;
    }
  }

  const activeChat = safeActiveChat();
  const title =
    activeChat?.formattedTitle ||
    activeChat?.name ||
    activeChat?.contact?.formattedName ||
    activeChat?.contact?.pushname ||
    activeChat?.contact?.name ||
    null;

  return {
    href: location.href,
    hasWPP: Boolean(window.WPP),
    wppVersion: window.WPP?.version || window.WPP?.VERSION || null,
    hasChatApi: Boolean(window.WPP?.chat),
    hasSendText: typeof window.WPP?.chat?.sendTextMessage === "function",
    hasSendFile: typeof window.WPP?.chat?.sendFileMessage === "function",
    activeChatId: serializeChatId(activeChat),
    activeChatTitle: title,
  };
}

function waitForWppScript() {
  function serializeChatId(chat) {
    const id = chat?.id || chat;
    if (!id) return null;
    if (typeof id === "string") return id;
    return id._serialized || id.serialized || id.user || null;
  }

  function snapshot() {
    let activeChat = null;
    try {
      activeChat = window.WPP?.chat?.getActiveChat?.() || null;
    } catch {
      activeChat = null;
    }

    return {
      hasWPP: Boolean(window.WPP),
      hasChatApi: Boolean(window.WPP?.chat),
      hasSendText: typeof window.WPP?.chat?.sendTextMessage === "function",
      hasSendFile: typeof window.WPP?.chat?.sendFileMessage === "function",
      activeChatId: serializeChatId(activeChat),
    };
  }

  return new Promise((resolve) => {
    let tries = 0;
    const tick = () => {
      const current = snapshot();
      if (current.hasChatApi || tries >= 80) {
        resolve(current);
        return;
      }
      tries += 1;
      setTimeout(tick, 250);
    };
    tick();
  });
}

async function ensureWpp(client, wajsPath) {
  const initial = await client.evaluate(callExpression(statusScript));
  if (initial?.hasChatApi && (initial.hasSendText || initial.hasSendFile)) {
    return initial;
  }

  const source = await readFile(wajsPath, "utf8");
  await client.evaluate(`${source}\n//# sourceURL=mainframe-wa-js/wppconnect-wa.js`);

  const loaded = await client.evaluate(callExpression(waitForWppScript));
  if (!loaded?.hasChatApi) {
    throw new Error("WA-JS injected, but WPP.chat did not become available.");
  }
  return loaded;
}

function sendTextScript(text) {
  function serializeChatId(chat) {
    const id = chat?.id || chat;
    if (!id) return null;
    if (typeof id === "string") return id;
    return id._serialized || id.serialized || id.user || null;
  }

  return (async () => {
    const activeChat = window.WPP?.chat?.getActiveChat?.() || null;
    const chatId = serializeChatId(activeChat);
    if (!chatId) {
      return { ok: false, error: "Open a WhatsApp chat first." };
    }

    if (typeof window.WPP?.chat?.sendTextMessage !== "function") {
      return { ok: false, error: "WPP.chat.sendTextMessage is unavailable." };
    }

    const result = await window.WPP.chat.sendTextMessage(chatId, text, {
      waitForAck: false,
      createChat: false,
    });

    return {
      ok: true,
      chatId,
      method: "WPP.chat.sendTextMessage",
      resultType: typeof result,
      resultId: result?.id?._serialized || result?.id || null,
    };
  })();
}

function sendMediaScript(filePayload) {
  function serializeChatId(chat) {
    const id = chat?.id || chat;
    if (!id) return null;
    if (typeof id === "string") return id;
    return id._serialized || id.serialized || id.user || null;
  }

  return (async () => {
    const activeChat = window.WPP?.chat?.getActiveChat?.() || null;
    const chatId = serializeChatId(activeChat);
    if (!chatId) {
      return { ok: false, error: "Open a WhatsApp chat first." };
    }

    if (typeof window.WPP?.chat?.sendFileMessage !== "function") {
      return { ok: false, error: "WPP.chat.sendFileMessage is unavailable." };
    }

    const result = await window.WPP.chat.sendFileMessage(chatId, filePayload.dataUrl, {
      type: filePayload.type,
      filename: filePayload.filename,
      mimetype: filePayload.mime,
      caption: filePayload.caption || undefined,
      waitForAck: false,
    });

    return {
      ok: true,
      chatId,
      method: "WPP.chat.sendFileMessage",
      type: filePayload.type,
      filename: filePayload.filename,
      resultType: typeof result,
      resultId: result?.id?._serialized || result?.id || null,
    };
  })();
}

function typeFromMime(mime) {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

async function buildFilePayload(filePath, caption) {
  const absolutePath = resolve(filePath);
  const bytes = await readFile(absolutePath);
  const mime = MIME_BY_EXT.get(extname(absolutePath).toLowerCase()) || "application/octet-stream";
  return {
    filename: basename(absolutePath),
    mime,
    type: typeFromMime(mime),
    caption,
    dataUrl: `data:${mime};base64,${bytes.toString("base64")}`,
  };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "help") {
    console.log(help());
    return;
  }

  const target = await findWhatsAppTarget(args.port, args.targetHost);
  const client = new CdpClient(target.webSocketDebuggerUrl);

  try {
    await client.connect();
    await ensureWpp(client, args.wajsPath);

    if (args.command === "status") {
      console.log(JSON.stringify(await client.evaluate(callExpression(statusScript)), null, 2));
      return;
    }

    if (args.command === "active-chat") {
      const status = await client.evaluate(callExpression(statusScript));
      if (!status.activeChatId) {
        throw new Error("No active chat. Open a WhatsApp chat first.");
      }
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    if (args.command === "send-text") {
      if (!args.text) {
        throw new Error("send-text requires --text.");
      }
      const result = await client.evaluate(callExpression(sendTextScript, args.text));
      console.log(JSON.stringify(result, null, 2));
      if (!result?.ok) process.exitCode = 2;
      return;
    }

    if (args.command === "send-media") {
      if (!args.file) {
        throw new Error("send-media requires --file.");
      }
      const payload = await buildFilePayload(args.file, args.caption);
      const result = await client.evaluate(callExpression(sendMediaScript, payload));
      console.log(JSON.stringify(result, null, 2));
      if (!result?.ok) process.exitCode = 2;
      return;
    }

    throw new Error(`Unknown command: ${args.command}`);
  } finally {
    client.close();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
