import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

try {
  for (const line of readFileSync(path.join(import.meta.dirname, ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {}

const DEFAULTS = {
  clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
  email: getDefaultEmail(),
  project: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "<gcp-project-id>",
  redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI || "https://<app>.vercel.app/__/auth/handler",
  origin: process.env.GOOGLE_OAUTH_ORIGIN || "https://<app>.vercel.app",
  port: 9322,
  browserPath: findBrowserPath(),
};

let config;
let profileDir;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  config = {
    ...DEFAULTS,
    ...args,
  };
  if (!config.email) {
    throw new Error(
      "Google account email is required. Run mainframe browserui-account.ps1 use <email>, set MAINFRAME_BROWSERUI_EMAIL, or pass --email.",
    );
  }

  config.email = config.email.trim().toLowerCase();
  const shouldLaunch = args.launch !== false && args.noLaunch !== true;
  const openOnly = args.openOnly === true;
  const keepOpen = args.keepOpen === true;
  const action = String(args.action || "inspect");
  const waitMs = Number(args.waitMs || 15000);
  const connectMs = Number(args.connectMs || 8000);

  profileDir =
    args.profileDir ||
    getMainframeBrowserUiProfileDir(config.email) ||
    path.join(process.cwd(), "cloud-console-chromium-profiles", safeName(config.email));

  const continueUrl = new URL("https://console.cloud.google.com/apis/credentials");
  continueUrl.searchParams.set("project", config.project);

  const chooserUrl = new URL("https://accounts.google.com/AccountChooser");
  chooserUrl.searchParams.set("Email", config.email);
  chooserUrl.searchParams.set("continue", continueUrl.toString());

  const stateFile = path.join(profileDir, "automation-state.json");

  await mkdir(profileDir, { recursive: true });
  await writeFile(
    stateFile,
    JSON.stringify(
      {
        clientId: config.clientId,
        email: config.email,
        project: config.project,
        redirectUri: config.redirectUri,
        origin: config.origin,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  console.log(`Target account: ${config.email}`);
  console.log(`Target project: ${config.project}`);
  console.log(`Profile: ${profileDir}`);
  console.log(shouldLaunch ? "Opening automation browser through Google AccountChooser..." : "Inspecting existing automation browser window...");

  if (!existsSync(config.browserPath)) {
    throw new Error(`Browser executable not found: ${config.browserPath}`);
  }

  if (shouldLaunch) {
    spawn(
      config.browserPath,
      [
        `--remote-debugging-port=${config.port}`,
        `--user-data-dir=${profileDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-domain-reliability",
        "--disable-sync",
        "--disk-cache-size=1",
        "--media-cache-size=1",
        chooserUrl.toString(),
      ],
      {
        detached: true,
        stdio: "ignore",
      },
    ).unref();
  }

  if (openOnly) {
    console.log("Opened. Complete Google login in that window, then run with --no-launch.");
    process.exit(0);
  }

  const browser = await connectToBrowser(config.port, connectMs);
  let shouldCloseBrowser = !keepOpen && (shouldLaunch || args.close === true || action === "apply" || action === "save");
  try {
    const page = await waitForConsoleOrLogin(browser, config, waitMs);

    if (page.status === "login-needed") {
      shouldCloseBrowser = false;
      console.log("");
      console.log("Login still needed or timed out.");
      console.log(`Use ${config.email} in the visible browser window, then rerun:`);
      console.log(commandLine(config));
      process.exitCode = 2;
      await delay(250);
      process.exit(2);
    }

    console.log("");
    console.log("Cloud Console is open in the automation window.");
    console.log(`Action: ${action}`);

    const snapshot =
      action === "open-client"
        ? await openFirebaseClientAndInspect(browser, page.target)
        : action === "apply"
          ? await applyFirebaseClientConfig(browser, page.target)
          : action === "save"
            ? await saveAndVerifyFirebaseClientConfig(browser, page.target)
            : await inspectPage(browser, page.target);
    console.log(JSON.stringify(snapshot, null, 2));

    await writeFile(
      path.join(profileDir, "last-page-snapshot.json"),
      JSON.stringify(snapshot, null, 2),
    );

    console.log("");
    console.log("Snapshot saved.");
  } finally {
    if (shouldCloseBrowser) {
      await closeAutomationBrowser(browser).catch((error) => {
        console.warn(`Could not close automation browser cleanly: ${error.message || error}`);
      });
    }
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  if (out.port) out.port = Number(out.port);
  return out;
}

function safeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function commandLine(cfg) {
  return [
    "node",
    "console.cloud.google.com-firebase-oauth-client-config-automation.mjs",
    "--email",
    cfg.email,
    "--project",
    cfg.project,
    "--redirect-uri",
    cfg.redirectUri,
    "--origin",
    cfg.origin,
    ...(cfg.clientId ? ["--client-id", cfg.clientId] : []),
  ].join(" ");
}

function getDefaultEmail() {
  return (
    process.env.MAINFRAME_BROWSERUI_EMAIL ||
    process.env.GOOGLE_ACCOUNT_EMAIL ||
    getActiveMainframeBrowserUiEmail() ||
    ""
  );
}

function getMainframeBrowserUiRoot() {
  if (!process.env.APPDATA) return null;
  return path.join(process.env.APPDATA, "mainframe", "accounts", "browserui");
}

function getMainframeBrowserUiProfileDir(email) {
  const root = getMainframeBrowserUiRoot();
  if (!root || !email) return null;
  return path.join(root, email.trim().toLowerCase());
}

function getActiveMainframeBrowserUiEmail() {
  const root = getMainframeBrowserUiRoot();
  if (!root) return null;

  const currentPath = path.join(root, "current.json");
  if (!existsSync(currentPath)) return null;

  try {
    const current = JSON.parse(readFileSync(currentPath, "utf8"));
    const email = String(current.email || "").trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
  } catch {
    return null;
  }
}

async function connectToBrowser(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const version = await fetchJson(`http://127.0.0.1:${port}/json/version`);
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      return { port, version, targets };
    } catch (error) {
      lastError = error;
      await delay(500);
    }
  }
  throw new Error(`Could not connect to Edge CDP on port ${port}: ${lastError?.message || lastError}`);
}

function findBrowserPath() {
  const candidates = [
    path.join(process.env.USERPROFILE, "AppData", "Local", "ms-playwright", "chromium-1223", "chrome-win64", "chrome.exe"),
    path.join(process.env.USERPROFILE, "AppData", "Local", "ms-playwright", "chromium-1217", "chrome-win64", "chrome.exe"),
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  return candidates.find((candidate) => existsSync(candidate)) || candidates.at(-1);
}

async function waitForConsoleOrLogin(browser, cfg, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let announcedLogin = false;
  let lastPage = null;
  while (Date.now() < deadline) {
    const targets = await fetchJson(`http://127.0.0.1:${browser.port}/json/list`);
    const page =
      targets.find((target) => target.type === "page" && target.url.includes("console.cloud.google.com")) ||
      targets.find((target) => target.type === "page" && target.url.includes("accounts.google.com")) ||
      targets.find((target) => target.type === "page");
    if (page) lastPage = page;

    if (page?.url?.includes("accounts.google.com")) {
      if (!announcedLogin) {
        console.log("");
        console.log(`Google login page is open for: ${cfg.email}`);
        console.log("Complete login in the visible Edge window, then rerun with --no-launch.");
        announcedLogin = true;
      }
      await delay(1000);
      continue;
    }

    if (page?.url?.includes("console.cloud.google.com")) {
      const client = await CdpClient.connect(page.webSocketDebuggerUrl);
      try {
        await client.send("Runtime.enable");
        await waitForDocument(client);
        const state = await evaluate(client, () => ({
          href: location.href,
          title: document.title,
          bodyText: document.body?.innerText?.slice(0, 4000) || "",
        }));
        await client.close();
        return { status: "console-ready", target: page, state };
      } catch (error) {
        await client.close().catch(() => {});
        throw error;
      }
    }

    await delay(1000);
  }

  return { status: "login-needed", target: lastPage };
}

async function inspectPage(browser, target) {
  const client = await CdpClient.connect(target.webSocketDebuggerUrl);
  try {
    await client.send("Runtime.enable");
    await waitForDocument(client);
    return await evaluate(
      client,
      ({ redirectUri, origin }) => {
        const text = document.body?.innerText || "";
        const controls = Array.from(
          document.querySelectorAll("a,button,[role='button'],input,textarea,[contenteditable='true']"),
        )
          .filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          .slice(0, 120)
          .map((el) => {
            const rect = el.getBoundingClientRect();
            return {
              tag: el.tagName.toLowerCase(),
              role: el.getAttribute("role"),
              type: el.getAttribute("type"),
              text: (el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 160),
              href: el.href || "",
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              w: Math.round(rect.width),
              h: Math.round(rect.height),
            };
          });

        return {
          href: location.href,
          title: document.title,
          hasRedirectUri: text.includes(redirectUri),
          hasOrigin: text.includes(origin),
          visibleTextStart: text.replace(/\s+/g, " ").trim().slice(0, 2000),
          controls,
        };
      },
      { redirectUri: config.redirectUri, origin: config.origin },
    );
  } finally {
    await client.close().catch(() => {});
  }
}

async function openFirebaseClientAndInspect(browser, target) {
  const client = await CdpClient.connect(target.webSocketDebuggerUrl);
  try {
    await client.send("Runtime.enable");
    await waitForDocument(client);
    const href = await evaluate(client, ({ clientId, project }) => {
      if (clientId) {
        const targetProject = project || new URLSearchParams(location.search).get("project") || "";
        const targetHref = `https://console.cloud.google.com/auth/clients/${clientId}?project=${targetProject}`;
        location.href = targetHref;
        return targetHref;
      }

      const links = Array.from(
        document.querySelectorAll("a[href*='/auth/clients/'],a[href*='/apis/credentials/oauthclient/']"),
      );
      const editLink =
        links.find((link) => /edit|client/i.test(link.innerText || link.getAttribute("aria-label") || "")) ||
        links[0];
      if (!editLink) return null;
      location.href = editLink.href;
      return editLink.href;
    }, { clientId: config.clientId, project: config.project });
    if (!href) throw new Error("Could not find an OAuth client link on the credentials page.");
    await waitForUrlOneOf(client, ["/auth/clients/", "/apis/credentials/oauthclient/"]);
    await waitForText(client, "Authorized redirect URIs", 60000);
  } finally {
    await client.close().catch(() => {});
  }

  return inspectPage(browser, target);
}

async function applyFirebaseClientConfig(browser, target) {
  const client = await CdpClient.connect(target.webSocketDebuggerUrl);
  try {
    await client.send("Runtime.enable");
    await waitForDocument(client);
    const href = await evaluate(client, () => location.href);
    if (!href.includes("/auth/clients/") && !href.includes("/apis/credentials/oauthclient/")) {
      throw new Error("The automation browser is not on a Google OAuth client edit page.");
    }

    const result = await evaluate(
      client,
      async ({ origin, redirectUri }) => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const visible = (el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        const textOf = (el) => (el.innerText || el.textContent || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
        const uriInputs = () =>
          Array.from(document.querySelectorAll("input"))
            .filter(visible)
            .filter((input) => input.placeholder === "https://www.example.com" || /^https?:\/\//.test(input.value || ""));
        const addButtons = () =>
          Array.from(document.querySelectorAll("button"))
            .filter(visible)
            .filter((button) => textOf(button) === "Add URI");
        const setInputValue = (input, value) => {
          input.scrollIntoView({ block: "center", inline: "nearest" });
          input.focus();
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
          setter.call(input, value);
          input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          input.blur();
        };
        const waitForBlankInput = async (previousCount) => {
          for (let i = 0; i < 50; i += 1) {
            const blanks = uriInputs().filter((input) => !(input.value || "").trim());
            if (uriInputs().length > previousCount && blanks.length > 0) return blanks.at(-1);
            if (blanks.length > 0) return blanks.at(-1);
            await sleep(100);
          }
          throw new Error("No blank URI input appeared after clicking Add URI.");
        };

        const beforeValues = uriInputs().map((input) => input.value.trim()).filter(Boolean);
        const added = [];

        if (!beforeValues.includes(origin)) {
          const buttons = addButtons();
          if (buttons.length < 1) throw new Error("Could not find Authorized JavaScript origins Add URI button.");
          const count = uriInputs().length;
          buttons[0].scrollIntoView({ block: "center", inline: "nearest" });
          buttons[0].click();
          const input = await waitForBlankInput(count);
          setInputValue(input, origin);
          added.push("origin");
          await sleep(300);
        }

        const valuesAfterOrigin = uriInputs().map((input) => input.value.trim()).filter(Boolean);
        if (!valuesAfterOrigin.includes(redirectUri)) {
          const buttons = addButtons();
          if (buttons.length < 2) throw new Error("Could not find Authorized redirect URIs Add URI button.");
          const count = uriInputs().length;
          buttons[1].scrollIntoView({ block: "center", inline: "nearest" });
          buttons[1].click();
          const input = await waitForBlankInput(count);
          setInputValue(input, redirectUri);
          added.push("redirectUri");
          await sleep(300);
        }

        const saveButton = Array.from(document.querySelectorAll("button"))
          .filter(visible)
          .find((button) => textOf(button) === "Save" && button.type === "submit");
        if (!saveButton) throw new Error("Could not find Save button.");
        saveButton.scrollIntoView({ block: "center", inline: "nearest" });
        await sleep(200);
        saveButton.click();
        await sleep(8000);

        return {
          added,
          values: uriInputs().map((input) => input.value.trim()).filter(Boolean),
          bodyText: document.body?.innerText?.replace(/\s+/g, " ").slice(0, 1200) || "",
        };
      },
      { origin: config.origin, redirectUri: config.redirectUri },
    );

    await writeFile(path.join(profileDir, "last-apply-result.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));

    await client.send("Page.enable");
    await client.send("Page.reload", { ignoreCache: true });
    await waitForText(client, config.origin, 60000);
    await waitForText(client, config.redirectUri, 60000);
  } finally {
    await client.close().catch(() => {});
  }

  await delay(2000);
  return inspectPage(browser, target);
}

async function saveAndVerifyFirebaseClientConfig(browser, target) {
  const client = await CdpClient.connect(target.webSocketDebuggerUrl);
  try {
    await client.send("Runtime.enable");
    await waitForDocument(client);
    const result = await evaluate(
      client,
      async ({ origin, redirectUri }) => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const visible = (el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        const textOf = (el) => (el.innerText || el.textContent || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
        const uriValues = () =>
          Array.from(document.querySelectorAll("input"))
            .filter(visible)
            .map((input) => input.value.trim())
            .filter((value) => /^https?:\/\//.test(value));

        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
        await sleep(300);

        const submitButtons = Array.from(document.querySelectorAll("button[type='submit']"))
          .filter(visible)
          .filter((button) => textOf(button) === "Save");
        const saveButton = submitButtons[0];
        if (!saveButton) {
          throw new Error("Could not find the OAuth form Save submit button.");
        }
        saveButton.scrollIntoView({ block: "center", inline: "nearest" });
        await sleep(200);
        saveButton.click();
        await sleep(7000);

        return {
          hasOrigin: uriValues().includes(origin),
          hasRedirectUri: uriValues().includes(redirectUri),
          values: uriValues(),
          bodyText: document.body?.innerText?.replace(/\s+/g, " ").slice(0, 1200) || "",
        };
      },
      { origin: config.origin, redirectUri: config.redirectUri },
    );

    await writeFile(path.join(profileDir, "last-save-result.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));

    await client.send("Page.enable");
    await client.send("Page.reload", { ignoreCache: true });
    await waitForText(client, config.redirectUri, 60000);
  } finally {
    await client.close().catch(() => {});
  }

  await delay(2000);
  return inspectPage(browser, target);
}

async function waitForUrl(client, needle, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const href = await evaluate(client, () => location.href);
    if (href.includes(needle)) return href;
    await delay(500);
  }
  throw new Error(`Timed out waiting for URL containing ${needle}`);
}

async function waitForUrlOneOf(client, needles, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const href = await evaluate(client, () => location.href);
    if (needles.some((needle) => href.includes(needle))) return href;
    await delay(500);
  }
  throw new Error(`Timed out waiting for URL containing one of: ${needles.join(", ")}`);
}

async function waitForText(client, needle, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await evaluate(client, (value) => document.body?.innerText?.includes(value) || false, needle);
    if (found) return true;
    await delay(500);
  }
  throw new Error(`Timed out waiting for text: ${needle}`);
}

async function waitForDocument(client) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const state = await evaluate(client, () => ({
      readyState: document.readyState,
      hasBody: Boolean(document.body),
      textLength: document.body?.innerText?.length || 0,
    }));
    if (state.hasBody && state.readyState !== "loading") return;
    await delay(500);
  }
  throw new Error("Timed out waiting for page document");
}

async function evaluate(client, fn, arg) {
  const expression = `(${fn.toString()})(${JSON.stringify(arg)})`;
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
  }
  return result.result.value;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.json();
}

async function closeAutomationBrowser(browser) {
  const websocketUrl = browser?.version?.webSocketDebuggerUrl;
  if (!websocketUrl) return;

  const client = await CdpClient.connect(websocketUrl);
  try {
    await client.send("Browser.close");
    console.log("Closed automation browser.");
  } finally {
    await client.close().catch(() => {});
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.opened = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP websocket open timeout")), 10000);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener("error", (event) => {
        clearTimeout(timer);
        reject(new Error(`CDP websocket error: ${event.message || "unknown"}`));
      });
    });
    ws.addEventListener("message", (event) => this.onMessage(event));
  }

  static async connect(url) {
    const client = new CdpClient(new WebSocket(url));
    await client.opened;
    return client;
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 30000);
    });
  }

  onMessage(event) {
    const message = JSON.parse(event.data);
    if (!message.id || !this.pending.has(message.id)) return;
    const pending = this.pending.get(message.id);
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(`${message.error.message || "CDP error"} (${message.error.code})`));
      return;
    }
    pending.resolve(message.result);
  }

  close() {
    this.ws.close();
    return Promise.resolve();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
