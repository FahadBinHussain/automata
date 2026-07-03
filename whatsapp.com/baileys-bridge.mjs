#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import qrcode from "qrcode-terminal";
import pino from "pino";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";

const DEFAULT_AUTH_SUBDIR = "baileys-auth";
const CACHE_FILE = "chat-cache.json";

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
  [".opus", "audio/ogg; codecs=opus"],
  [".wav", "audio/wav"],
  [".pdf", "application/pdf"],
  [".txt", "text/plain"],
]);

function help() {
  return `Baileys bridge for mainframe WhatsApp profiles (no browser).

Usage:
  node baileys-bridge.mjs login [--phone +8801...]
  node baileys-bridge.mjs status
  node baileys-bridge.mjs list-chats [--limit N]
  node baileys-bridge.mjs read-chat --jid +8801...|jid@domain [--count N]
  node baileys-bridge.mjs listen [--json]
  node baileys-bridge.mjs send-text --to +8801... --text "hi"
  node baileys-bridge.mjs send-media --to +8801... --file C:\\tmp\\a.png [--caption "test"]

Environment:
  MAINFRAME_WHATSAPP_PROFILE  Profile directory (auth stored in baileys-auth/)
  MAINFRAME_WHATSAPP_PHONE    Phone metadata (optional)

First-time login prints a QR code in this terminal. Scan it in WhatsApp -> Linked Devices.
Use mainframe's whatsapp-account.ps1 login-baileys for the normal flow.`;
}

function parseArgs(argv) {
  const args = {
    command: null,
    phone: process.env.MAINFRAME_WHATSAPP_PHONE || "",
    text: "",
    to: "",
    file: "",
    caption: "",
    fresh: false,
    limit: 15,
    count: 20,
    jid: "",
    json: false,
    timeoutMs: 120_000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      args.command = "help";
    } else if (token === "--phone") {
      args.phone = argv[++i] || "";
    } else if (token.startsWith("--phone=")) {
      args.phone = token.slice("--phone=".length);
    } else if (token === "--text") {
      args.text = argv[++i] || "";
    } else if (token.startsWith("--text=")) {
      args.text = token.slice("--text=".length);
    } else if (token === "--to") {
      args.to = argv[++i] || "";
    } else if (token.startsWith("--to=")) {
      args.to = token.slice("--to=".length);
    } else if (token === "--file") {
      args.file = argv[++i] || "";
    } else if (token.startsWith("--file=")) {
      args.file = token.slice("--file=".length);
    } else if (token === "--caption") {
      args.caption = argv[++i] || "";
    } else if (token.startsWith("--caption=")) {
      args.caption = token.slice("--caption=".length);
    } else if (token === "--timeout-ms") {
      args.timeoutMs = Number(argv[++i]);
    } else if (token.startsWith("--timeout-ms=")) {
      args.timeoutMs = Number(token.slice("--timeout-ms=".length));
    } else if (token === "--limit") {
      args.limit = Number(argv[++i]);
    } else if (token.startsWith("--limit=")) {
      args.limit = Number(token.slice("--limit=".length));
    } else if (token === "--count") {
      args.count = Number(argv[++i]);
    } else if (token.startsWith("--count=")) {
      args.count = Number(token.slice("--count=".length));
    } else if (token === "--jid") {
      args.jid = argv[++i] || "";
    } else if (token.startsWith("--jid=")) {
      args.jid = token.slice("--jid=".length);
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--fresh") {
      args.fresh = true;
    } else if (!args.command) {
      args.command = token;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  args.command ||= "status";
  return args;
}

function resolveAuthDir() {
  const profile = process.env.MAINFRAME_WHATSAPP_PROFILE;
  if (!profile) {
    throw new Error("MAINFRAME_WHATSAPP_PROFILE is required.");
  }
  return join(profile, DEFAULT_AUTH_SUBDIR);
}

async function readAuthRegistration(authDir) {
  try {
    const raw = await readFile(join(authDir, "creds.json"), "utf8");
    const creds = JSON.parse(raw);
    return {
      exists: true,
      registered: Boolean(creds.registered),
      me: creds.me || null,
    };
  } catch {
    return { exists: false, registered: false, me: null };
  }
}

async function resetAuthDir(authDir) {
  await rm(authDir, { recursive: true, force: true });
}

async function ensureLoginAuth(authDir, fresh) {
  if (fresh) {
    await resetAuthDir(authDir);
    return;
  }

  const auth = await readAuthRegistration(authDir);
  if (auth.exists && !auth.registered) {
    console.error("Clearing incomplete Baileys session before login...");
    await resetAuthDir(authDir);
  }
}

function toJid(value) {
  if (!value) {
    throw new Error("--to is required (E.164 phone or WhatsApp JID).");
  }
  const trimmed = value.trim();
  if (trimmed.includes("@")) {
    return trimmed;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (!digits) {
    throw new Error(`Invalid --to value: ${value}`);
  }
  return `${digits}@s.whatsapp.net`;
}

function typeFromMime(mime) {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

async function buildMediaContent(filePath, caption) {
  const absolutePath = resolve(filePath);
  const bytes = await readFile(absolutePath);
  const mime = MIME_BY_EXT.get(extname(absolutePath).toLowerCase()) || "application/octet-stream";
  const kind = typeFromMime(mime);
  const filename = basename(absolutePath);

  if (kind === "image") {
    return { image: bytes, caption: caption || undefined, mimetype: mime };
  }
  if (kind === "video") {
    return {
      video: bytes,
      caption: caption || undefined,
      mimetype: mime,
      gifPlayback: mime === "image/gif",
    };
  }
  if (kind === "audio") {
    return { audio: bytes, mimetype: mime, ptt: mime.includes("ogg") || extname(absolutePath).toLowerCase() === ".opus" };
  }
  return {
    document: bytes,
    mimetype: mime,
    fileName: filename,
    caption: caption || undefined,
  };
}

function printQr(qr) {
  console.error("\nScan this QR in WhatsApp -> Linked Devices:\n");
  qrcode.generate(qr, { small: true });
  console.error("");
}

async function repairCreds(authDir) {
  const p = join(authDir, "creds.json");
  try {
    const raw = await readFile(p, "utf8");
    if (raw.length === 0) {
      await rm(p, { force: true });
      return;
    }
    JSON.parse(raw);
  } catch {
    await rm(p, { force: true });
  }
}

function cachePath(authDir) {
  return join(authDir, CACHE_FILE);
}

async function loadCache(authDir) {
  try {
    const raw = await readFile(cachePath(authDir), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveCache(authDir, data) {
  const p = cachePath(authDir);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(data));
}

async function createSocket(authDir, opts = {}) {
  const { allowQr = false, timeoutMs = 120_000, syncFullHistory = false, settleDelay = 0 } = opts;
  const startedAt = Date.now();

  const connectOnce = async () => {
    await repairCreds(authDir);
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();
    const logger = pino({ level: "silent" });

      let sock;
      const _chats = [];
      const _allMessages = [];
      const _contacts = {};
      let settled = false;

    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for WhatsApp connection."));
      }, Math.max(5_000, timeoutMs - (Date.now() - startedAt)));

      const onUpdate = (update) => {
        if (update.qr) {
          if (allowQr) {
            printQr(update.qr);
          } else {
            cleanup();
            reject(new Error("Session expired or missing. Run login-baileys first."));
          }
          return;
        }

        if (update.connection === "open") {
          settled = true;
          if (settleDelay > 0) {
            const settledTimeout = setTimeout(() => {
              cleanup(); resolve({ sock, update });
            }, settleDelay);
            const origCleanup = cleanup;
            cleanup = () => {
              clearTimeout(settledTimeout);
              clearTimeout(timer);
              sock?.ev.off("connection.update", onUpdate);
            };
          } else {
            cleanup();
            resolve({ sock, update });
          }
          return;
        }

        if (update.connection === "close" && !settled) {
          const statusCode = update.lastDisconnect?.error?.output?.statusCode;
          if (statusCode === DisconnectReason.loggedOut) {
            cleanup();
            reject(new Error("Logged out. Run login-baileys again."));
            return;
          }

          const shouldReconnect =
            statusCode === DisconnectReason.restartRequired ||
            statusCode === DisconnectReason.connectionClosed ||
            (allowQr && statusCode !== DisconnectReason.loggedOut);

          if (shouldReconnect && Date.now() - startedAt < timeoutMs) {
            cleanup();
            resolve({ reconnect: true, statusCode, sock });
            return;
          }

          if (!settled) {
            cleanup();
            reject(
              new Error(
                `WhatsApp connection closed (${statusCode ?? "unknown"}). Run login-baileys again.`,
              ),
            );
          }
        }
      };

      let cleanup = () => {
        clearTimeout(timer);
        sock?.ev.off("connection.update", onUpdate);
      };

      const sockOpts = {
        version,
        auth: state,
        logger,
        browser: syncFullHistory ? ["Mac OS", "Desktop", "14.4.1"] : Browsers.macOS("Mainframe"),
        markOnlineOnConnect: false,
        syncFullHistory: syncFullHistory ?? false,
        generateHighQualityLinkPreview: false,
      };
      if (syncFullHistory) {
        sockOpts.shouldSyncHistoryMessage = () => true;
      }
      sock = makeWASocket(sockOpts);

      sock.ev.on("creds.update", (c) => {
        if (c && typeof c === "object" && Object.keys(c).length > 0) {
          saveCreds(c);
        }
      });
      sock.ev.on("contacts.update", (updates) => {
        for (const u of updates) {
          if (u.id) _contacts[u.id] = { ...(_contacts[u.id] || {}), ...u };
        }
      });
      sock.ev.on("chats.upsert", (chats) => {
        _chats.push(...chats);
        saveCache(authDir, { chats: _chats, messages: _allMessages, contacts: _contacts }).catch(() => {});
      });
      sock.ev.on("chats.update", (updates) => {
        for (const u of updates) {
          const idx = _chats.findIndex((c) => c.id === u.id);
          if (idx >= 0) _chats[idx] = { ..._chats[idx], ...u };
        }
        saveCache(authDir, { chats: _chats, messages: _allMessages, contacts: _contacts }).catch(() => {});
      });
      sock.ev.on("messaging-history.set", ({ chats, messages, contacts }) => {
        if (chats?.length) { _chats.length = 0; _chats.push(...chats); }
        if (messages?.length) { _allMessages.length = 0; _allMessages.push(...messages); }
        if (contacts?.length) {
          for (const c of contacts) {
            if (c.id) _contacts[c.id] = { ...(_contacts[c.id] || {}), ...c };
          }
        }
        saveCache(authDir, { chats: _chats, messages: _allMessages, contacts: _contacts }).catch(() => {});
      });
      sock.ev.on("messaging-history.status", ({ syncType, status }) => {
        if (status === "complete") {
          sock.ev.flush();
        }
      });
      sock.ev.on("connection.update", onUpdate);
    });

    if (result.reconnect) {
      try {
        result.sock?.end(undefined);
      } catch {
        // ignore
      }
      return connectOnce();
    }

    result.sock._chats = _chats;
    result.sock._allMessages = _allMessages;
    result.sock._contacts = _contacts;
    return result.sock;
  };

  return connectOnce();
}

async function withSocket(authDir, fn, options = {}) {
  const sock = await createSocket(authDir, options);
  try {
    return await fn(sock);
  } finally {
    try {
      sock.end(undefined);
    } catch {
      // ignore shutdown errors
    }
  }
}

async function runLogin(authDir, phone, fresh = false) {
  await ensureLoginAuth(authDir, fresh);
  const result = await withSocket(
    authDir,
    async (sock) => ({
      ok: true,
      command: "login",
      phone: phone || null,
      user: sock.user || null,
      authDir,
    }),
    { allowQr: true, syncFullHistory: true, timeoutMs: 300_000 },
  );

  console.log(JSON.stringify(result, null, 2));
}

async function runDebugSocket(authDir) {
  const result = await withSocket(authDir, async (sock) => {
    const keys = Object.getOwnPropertyNames(Object.getPrototypeOf(sock)).concat(Object.keys(sock)).filter(k => !k.startsWith("_") && !k.startsWith("$"));
    return { ok: true, keys, chatsCount: sock._chats?.length || 0, user: sock.user };
  });
  console.log(JSON.stringify(result, null, 2));
}

async function runStatus(authDir) {
  const result = await withSocket(authDir, async (sock) => ({
    ok: true,
    command: "status",
    connected: true,
    user: sock.user || null,
    authDir,
  }));

  console.log(JSON.stringify(result, null, 2));
}

async function runSendText(authDir, to, text) {
  if (!text) {
    throw new Error("send-text requires --text.");
  }

  const jid = toJid(to);
  const result = await withSocket(authDir, async (sock) => {
    const sent = await sock.sendMessage(jid, { text });
    return {
      ok: true,
      command: "send-text",
      to: jid,
      messageId: sent?.key?.id || null,
    };
  });

  console.log(JSON.stringify(result, null, 2));
}

async function runListChats(authDir, limit = 15) {
  const result = await withSocket(authDir, async (sock) => {
    sock.ev.flush();
    let chats = sock._chats || [];
    let contacts = sock._contacts || {};
    if (chats.length === 0) {
      const cache = await loadCache(authDir);
      if (cache?.chats?.length) { chats = cache.chats; contacts = cache.contacts || {}; }
    }
    const items = [];
    for (const chat of chats.slice(0, limit)) {
      const pushName = contacts?.[chat.id]?.notify || null;
      const name = chat.name || pushName || chat.id;
      let lastMsg = null;
      const chatMsgs = chat.messages;
      if (chatMsgs?.length > 0) {
        const m = chatMsgs[0].message || chatMsgs[0];
        lastMsg = {
          text:
            m.conversation ||
            m.extendedTextMessage?.text ||
            m.imageMessage?.caption ||
            null,
          time: formatTs(m.messageTimestamp),
          fromMe: !!chatMsgs[0].key?.fromMe,
        };
      }
      items.push({ id: chat.id, name, unread: chat.unreadCount || 0, lastMessage: lastMsg });
    }
    return { ok: true, chats: items };
  }, { syncFullHistory: true, settleDelay: 12000, timeoutMs: 300000 });
  console.log(JSON.stringify(result, null, 2));
}

function formatTs(ts) {
  if (!ts) return null;
  const n = typeof ts === "object" ? (ts.low || 0) : Number(ts);
  if (!n) return null;
  return new Date(n * 1000).toISOString().replace("T", " ").replace(/\.\d+Z/, "");
}

function extractMessageText(m) {
  const msg = m.message || m;
  return msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || msg.videoMessage?.caption || null;
}

async function runReadChat(authDir, targetJid, count = 20) {
  const jid = targetJid.includes("@") ? targetJid : `${targetJid.replace(/\D/g, "")}@s.whatsapp.net`;
  const result = await withSocket(authDir, async (sock) => {
    sock.ev.flush();
    let chatMsgs = (sock._allMessages || []).filter((m) => m.key?.remoteJid === jid);
    let source = "live";
    if (chatMsgs.length === 0) {
      const cache = await loadCache(authDir);
      const cached = (cache?.messages || []).filter((m) => m.key?.remoteJid === jid);
      if (cached.length > 0) { chatMsgs = cached; source = "cache"; }
    }
    const items = chatMsgs
      .sort((a, b) => {
        const ta = typeof a.messageTimestamp === "object" ? (a.messageTimestamp?.low || 0) : Number(a.messageTimestamp || 0);
        const tb = typeof b.messageTimestamp === "object" ? (b.messageTimestamp?.low || 0) : Number(b.messageTimestamp || 0);
        return tb - ta;
      })
      .slice(0, count)
      .map((m) => ({
        id: m.key?.id,
        fromMe: !!m.key?.fromMe,
        text: extractMessageText(m),
        time: formatTs(m.messageTimestamp),
      }));
    return { ok: true, jid, messages: items, source };
  }, { syncFullHistory: false, timeoutMs: 120000 });
  console.log(JSON.stringify(result, null, 2));
}

async function runListen(authDir, jsonMode = false) {
  const sock = await createSocket(authDir, { syncFullHistory: true, settleDelay: 8000, timeoutMs: 120000 });
  try {
    sock.ev.flush();
    const chats = sock._chats || [];
    if (jsonMode) {
      console.log(JSON.stringify({ ok: true, event: "ready", chats: chats.length }));
    } else {
      console.error(`Connected. ${chats.length} chats loaded. Listening for new messages...`);
    }
    sock.ev.on("messages.upsert", ({ messages, type }) => {
      for (const m of messages) {
        const text =
          m.message?.conversation ||
          m.message?.extendedTextMessage?.text ||
          m.message?.imageMessage?.caption ||
          "";
        const entry = {
          event: "message",
          id: m.key?.id,
          from: m.key?.remoteJid,
          fromMe: !!m.key?.fromMe,
          pushName: m.pushName,
          text,
          time: formatTs(m.messageTimestamp),
          type,
        };
        if (jsonMode) {
          console.log(JSON.stringify(entry));
        } else {
          const dir = entry.fromMe ? "→" : "←";
          const name = entry.pushName || entry.from?.split("@")[0] || "?";
          console.log(`${entry.time || "?"} [${dir}] ${name}: ${text || "(media/other)"}`);
        }
      }
    });
    await new Promise(() => {}); // hang
  } finally {
    try { sock.end(undefined); } catch {}
  }
}

async function runSendMedia(authDir, to, filePath, caption) {
  if (!filePath) {
    throw new Error("send-media requires --file.");
  }

  const jid = toJid(to);
  const content = await buildMediaContent(filePath, caption);
  const result = await withSocket(authDir, async (sock) => {
    const sent = await sock.sendMessage(jid, content);
    return {
      ok: true,
      command: "send-media",
      to: jid,
      file: resolve(filePath),
      messageId: sent?.key?.id || null,
    };
  });

  console.log(JSON.stringify(result, null, 2));
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "help") {
    console.log(help());
    return;
  }

  const authDir = resolveAuthDir();

  switch (args.command) {
    case "login":
      await runLogin(authDir, args.phone, args.fresh);
      return;
    case "status":
      await runStatus(authDir);
      return;
    case "send-text":
      await runSendText(authDir, args.to, args.text);
      return;
    case "list-chats":
      await runListChats(authDir, args.limit);
      return;
    case "read-chat":
      await runReadChat(authDir, args.jid, args.count);
      return;
    case "listen":
      await runListen(authDir, args.json);
      return;
    case "debug-socket":
      await runDebugSocket(authDir);
      return;
    case "send-media":
      await runSendMedia(authDir, args.to, args.file, args.caption);
      return;
    default:
      throw new Error(`Unknown command: ${args.command}`);
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
