// ==UserScript==
// @name         World Labs 3D Asset Downloader
// @namespace    https://github.com/worldlabs-dl
// @version      4.0
// @description  Download 3D models, gaussian splats, and textures from worldlabs.ai and marble.worldlabs.ai
// @author       fahad
// @match        https://www.worldlabs.ai/*
// @match        https://worldlabs.ai/*
// @match        https://marble.worldlabs.ai/*
// @grant        GM_download
// @grant        GM_addStyle
// @grant        GM_notification
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// @connect      cdn.marble.worldlabs.ai
// @connect      api.worldlabs.ai
// @connect      www.worldlabs.ai
// ==/UserScript==

(function () {
  "use strict";

  const isMarble = location.hostname === "marble.worldlabs.ai";
  const TAG = "[WL-DL]";
  const log = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);
  const err = (...a) => console.error(TAG, ...a);

  log("Script loaded on", location.hostname + location.pathname, { isMarble });

  // ══════════════════════════════════════════════════════════════════════════
  //  PART 1: Service Worker (try blob URL, fallback to inline)
  // ══════════════════════════════════════════════════════════════════════════

  const SW_CODE = `
    self.addEventListener('install', (e) => { self.skipWaiting(); });
    self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

    self.addEventListener('fetch', (event) => {
      const url = event.request.url;
      const isSplat = url.includes('.spz') || url.includes('.ply');
      const isApi = url.includes('/api/') || url.includes('generation_output');

      if (!isSplat && !isApi) return;

      event.respondWith((async () => {
        const response = await fetch(event.request);

        if (isSplat && response.ok) {
          const clone = response.clone();
          clone.arrayBuffer().then(bytes => {
            const name = url.split('/').pop().split('?')[0];
            // Store in IndexedDB
            const req = indexedDB.open('WL_DL', 2);
            req.onupgradeneeded = (e) => {
              const db = e.target.result;
              if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'url' });
            };
            req.onsuccess = (e) => {
              const db = e.target.result;
              if (!db.objectStoreNames.contains('files')) return;
              const tx = db.transaction('files', 'readwrite');
              tx.objectStore('files').put({ url, name, bytes, timestamp: Date.now(), size: bytes.byteLength });
              // Notify all clients
              self.clients.matchAll().then(clients => {
                for (const c of clients) {
                  c.postMessage({ type: 'SW_CAPT', url, name, size: bytes.byteLength });
                }
              });
            };
          }).catch(() => {});
        }

        if (isApi && response.ok) {
          response.clone().json().then(data => {
            self.clients.matchAll().then(clients => {
              for (const c of clients) c.postMessage({ type: 'SW_API', data });
            });
          }).catch(() => {});
        }

        return response;
      })());
    });
  `;

  let swReady = false;

  async function registerSW() {
    if (!('serviceWorker' in navigator)) {
      warn("Service Workers not supported");
      return;
    }
    try {
      const blob = new Blob([SW_CODE], { type: 'application/javascript' });
      const swUrl = URL.createObjectURL(blob);
      log("Registering SW from blob:", swUrl.slice(0, 50) + "...");
      const reg = await navigator.serviceWorker.register(swUrl, { scope: '/' });
      log("SW registered, scope:", reg.scope);
      swReady = true;
      URL.revokeObjectURL(swUrl);

      // Also listen for SW messages
      navigator.serviceWorker.addEventListener('message', (event) => {
        const { type } = event.data || {};
        if (type === 'SW_CAPT') {
          log("SW captured file:", event.data.name, `(${(event.data.size / 1048576).toFixed(1)}MB)`);
          onFileCaptured(event.data.url, event.data.name, event.data.size);
        }
        if (type === 'SW_API') {
          log("SW intercepted API data");
          onApiData(event.data.data);
        }
      });
    } catch (e) {
      err("SW registration failed:", e.message);
      // Try without scope
      try {
        const blob = new Blob([SW_CODE], { type: 'application/javascript' });
        const swUrl = URL.createObjectURL(blob);
        const reg = await navigator.serviceWorker.register(swUrl);
        log("SW registered (no scope), scope:", reg.scope);
        swReady = true;
        URL.revokeObjectURL(swUrl);
      } catch (e2) {
        err("SW retry also failed:", e2.message);
      }
    }
  }

  registerSW();

  // ══════════════════════════════════════════════════════════════════════════
  //  PART 2: Main-thread fetch interception
  // ══════════════════════════════════════════════════════════════════════════

  const capturedUrls = new Map();

  const origFetch = window.fetch?.bind?.(window) || window.fetch;
  if (origFetch) {
    window.fetch = async function (...args) {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
      log("fetch:", url.slice(0, 120));
      const res = await origFetch.apply(this, args);
      try {
        if (url.includes("/api/") && res.ok) {
          const clone = res.clone();
          clone.json().then(d => {
            log("API response from", url.slice(0, 80));
            onApiData(d);
          }).catch(e => log("API json parse failed:", e.message));
        }
        if (url.includes(".spz") || url.includes(".ply")) {
          const name = url.split("/").pop().split("?")[0];
          log("Main-thread captured:", name);
          capturedUrls.set(url, { name });
          refreshPanel();
        }
      } catch (e) { log("fetch interceptor error:", e.message); }
      return res;
    };
    log("Main-thread fetch interceptor installed");
  } else {
    warn("window.fetch not available at script start");
  }

  // Also intercept XMLHttpRequest
  const origXhrOpen = XMLHttpRequest.prototype.open;
  const origXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._wlUrl = url;
    return origXhrOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", function () {
      const url = this._wlUrl || "";
      if (url.includes("/api/") && this.status === 200) {
        try {
          const data = JSON.parse(this.responseText);
          log("XHR API response from", url.slice(0, 80));
          onApiData(data);
        } catch {}
      }
      if (url.includes(".spz") || url.includes(".ply")) {
        const name = url.split("/").pop().split("?")[0];
        log("XHR captured:", name);
        capturedUrls.set(url, { name });
        refreshPanel();
      }
    });
    return origXhrSend.apply(this, args);
  };
  log("XHR interceptor installed");

  // ══════════════════════════════════════════════════════════════════════════
  //  PART 3: Worker constructor interception (catches blob Worker fetches)
  // ══════════════════════════════════════════════════════════════════════════

  const OrigWorker = window.Worker;
  if (OrigWorker) {
    window.Worker = function (url, options) {
      const urlStr = url instanceof URL ? url.href : String(url);
      if (urlStr.startsWith("blob:")) {
        log("Intercepting blob Worker creation:", urlStr.slice(0, 60));
        // We can't modify the blob content, but we can log that a Worker was created
        // The SW should intercept its fetches
      }
      return new OrigWorker(url, options);
    };
    window.Worker.prototype = OrigWorker.prototype;
    log("Worker constructor interceptor installed");
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  PART 4: Data processing
  // ══════════════════════════════════════════════════════════════════════════

  const worldDataList = [];

  function onFileCaptured(url, name, size) {
    if (!capturedUrls.has(url)) {
      capturedUrls.set(url, { name, size, fromSW: true });
      refreshPanel();
    }
  }

  function onApiData(data) {
    try {
      const items = Array.isArray(data) ? data : [data];
      for (const w of items) {
        const spzUrls = w?.generation_output?.spz_urls || w?.spz_urls;
        if (spzUrls && typeof spzUrls === "object" && Object.keys(spzUrls).length > 0) {
          log("Found spz_urls:", Object.keys(spzUrls));
          for (const [key, url] of Object.entries(spzUrls)) {
            if (url && typeof url === "string") {
              const name = url.split("/").pop().split("?")[0];
              capturedUrls.set(url, { name, resolution: key });
              log("  +", key, "->", name);
            }
          }
          const plyUrl = w?.generation_output?.ply_url || w?.ply_url;
          if (plyUrl) {
            capturedUrls.set(plyUrl, { name: plyUrl.split("/").pop().split("?")[0], resolution: "ply" });
            log("  + PLY fallback:", plyUrl.split("/").pop());
          }
          const worldName = w?.generation_output?.display_name || w?.display_name || "unknown";
          worldDataList.push({ name: worldName });
          log("World:", worldName);
          refreshPanel();
        }
      }
    } catch (e) { log("onApiData error:", e.message); }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  PART 5: IndexedDB retrieval
  // ══════════════════════════════════════════════════════════════════════════

  function dbGetAll() {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open('WL_DL', 2);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'url' });
        };
        req.onsuccess = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('files')) { resolve([]); return; }
          const tx = db.transaction('files', 'readonly');
          const get = tx.objectStore('files').getAll();
          get.onsuccess = () => resolve(get.result || []);
          get.onerror = () => resolve([]);
        };
        req.onerror = () => resolve([]);
      } catch { resolve([]); }
    });
  }

  function dbGet(url) {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open('WL_DL', 2);
        req.onsuccess = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('files')) { resolve(null); return; }
          const tx = db.transaction('files', 'readonly');
          const get = tx.objectStore('files').get(url);
          get.onsuccess = () => resolve(get.result || null);
          get.onerror = () => resolve(null);
        };
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }

  async function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  PART 6: Panel UI
  // ══════════════════════════════════════════════════════════════════════════

  GM_addStyle(`
    #wl-dl-panel{position:fixed;bottom:20px;right:20px;z-index:99999;font-family:system-ui,sans-serif;font-size:13px;background:rgba(17,17,17,.94);color:#eee;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.5);backdrop-filter:blur(12px);width:380px;max-height:85vh;overflow:hidden;border:1px solid rgba(255,255,255,.08)}
    #wl-dl-panel.minimized{width:48px;height:48px;border-radius:50%;cursor:pointer;overflow:hidden}
    #wl-dl-panel.minimized #wl-dl-body,#wl-dl-panel.minimized #wl-dl-acts{display:none}
    #wl-dl-panel.minimized #wl-dl-toggle{margin:0;padding:0;width:48px;height:48px;border-radius:50%;font-size:20px;display:flex;align-items:center;justify-content:center}
    #wl-dl-header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.08);cursor:move;user-select:none}
    #wl-dl-header h3{margin:0;font-size:13px;font-weight:600}
    .wl-dl-hdr-btns{display:flex;gap:4px}
    .wl-dl-hdr-btns button{background:none;border:none;color:#888;cursor:pointer;font-size:12px;padding:3px 6px;border-radius:4px}
    .wl-dl-hdr-btns button:hover{background:rgba(255,255,255,.1);color:#fff}
    #wl-dl-body{padding:10px 14px;overflow-y:auto;max-height:55vh}
    #wl-dl-status{font-size:12px;color:#aaa;padding:2px 0 4px}
    #wl-dl-log{font-size:10px;color:#555;max-height:100px;overflow-y:auto;padding:4px 6px;background:rgba(0,0,0,.3);border-radius:4px;margin:4px 0;font-family:monospace;white-space:pre-wrap;word-break:break-all}
    .wl-dl-sec{margin-bottom:8px}
    .wl-dl-sec-t{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#666;margin-bottom:4px;font-weight:600}
    .wl-dl-item{display:flex;align-items:center;padding:4px 8px;margin-bottom:1px;border-radius:4px;transition:background .1s}
    .wl-dl-item:hover{background:rgba(255,255,255,.06)}
    .wl-dl-item .nm{font-size:11px;color:#ccc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}
    .wl-dl-item .tg{font-size:9px;padding:1px 5px;border-radius:3px;margin:0 4px;flex-shrink:0}
    .tg-lo{background:rgba(250,204,21,.15);color:#facc15}
    .tg-mid{background:rgba(96,165,250,.15);color:#60a5fa}
    .tg-hi{background:rgba(74,222,128,.15);color:#4ade80}
    .tg-ply{background:rgba(168,85,247,.15);color:#a855f7}
    .tg-db{background:rgba(251,146,60,.15);color:#fb923c}
    .wl-dl-item .bd{background:rgba(255,255,255,.08);border:none;color:#999;padding:2px 8px;border-radius:3px;font-size:10px;cursor:pointer;transition:all .1s;flex-shrink:0;margin-left:4px}
    .wl-dl-item .bd:hover{background:rgba(255,255,255,.15);color:#fff}
    .wl-dl-item .bd.ok{color:#4ade80}
    #wl-dl-acts{display:flex;gap:6px;padding:6px 14px 10px;border-top:1px solid rgba(255,255,255,.08)}
    #wl-dl-acts button{flex:1;padding:6px;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer}
    #wl-dl-dlall{background:#fff;color:#111}
    #wl-dl-dlall:disabled{opacity:.4;cursor:not-allowed}
    #wl-dl-scan{background:rgba(255,255,255,.08);color:#aaa}
    .wl-dl-prog{height:2px;background:rgba(255,255,255,.1);border-radius:1px;margin-top:6px;overflow:hidden}
    .wl-dl-bar{height:100%;background:#4ade80;border-radius:1px;transition:width .3s;width:0%}
  `);

  const panel = document.createElement("div");
  panel.id = "wl-dl-panel";
  panel.innerHTML = `
    <div id="wl-dl-header">
      <h3>${isMarble ? "Marble" : "WorldLabs"} DL</h3>
      <div class="wl-dl-hdr-btns">
        <button id="wl-dl-clear" title="Clear log">CLR</button>
        <button id="wl-dl-toggle">—</button>
      </div>
    </div>
    <div id="wl-dl-body">
      <div id="wl-dl-status">Initializing...</div>
      <div id="wl-dl-log"></div>
      <div id="wl-dl-assets"></div>
      <div class="wl-dl-prog"><div class="wl-dl-bar" id="wl-dl-bar"></div></div>
    </div>
    <div id="wl-dl-acts">
      <button id="wl-dl-scan">Scan</button>
      <button id="wl-dl-dlall" disabled>Download All</button>
    </div>
  `;
  document.body.appendChild(panel);

  const $ = (s) => panel.querySelector(s);

  // Debug log panel
  const logLines = [];
  function uiLog(msg) {
    const ts = new Date().toLocaleTimeString();
    logLines.push(`[${ts}] ${msg}`);
    if (logLines.length > 50) logLines.shift();
    const el = $("#wl-dl-log");
    if (el) el.textContent = logLines.join("\n");
  }

  // Drag
  let dragging = false, dx = 0, dy = 0;
  $("#wl-dl-header").addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) return;
    dragging = true;
    const r = panel.getBoundingClientRect();
    dx = e.clientX - r.left; dy = e.clientY - r.top;
    panel.style.transition = "none";
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    panel.style.left = (e.clientX - dx) + "px";
    panel.style.top = (e.clientY - dy) + "px";
    panel.style.right = "auto"; panel.style.bottom = "auto";
  });
  document.addEventListener("mouseup", () => { dragging = false; panel.style.transition = ""; });

  $("#wl-dl-toggle").addEventListener("click", () => {
    const m = panel.classList.toggle("minimized");
    $("#wl-dl-toggle").textContent = m ? "3D" : "—";
  });

  $("#wl-dl-clear").addEventListener("click", () => {
    logLines.length = 0;
    $("#wl-dl-log").textContent = "";
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  PART 7: Render & Download
  // ══════════════════════════════════════════════════════════════════════════

  let lastCount = -1;

  async function refreshPanel() {
    // Merge IndexedDB items
    const dbItems = await dbGetAll();
    for (const item of dbItems) {
      if (!capturedUrls.has(item.url)) {
        capturedUrls.set(item.url, { name: item.name, size: item.size, fromDB: true });
      }
    }

    const allItems = [...capturedUrls.entries()].map(([url, meta]) => ({ url, ...meta }));
    if (allItems.length === lastCount) return;
    lastCount = allItems.length;

    uiLog(`Panel refresh: ${allItems.length} items, SW:${swReady}, DB:${dbItems.length}`);

    const container = $("#wl-dl-assets");
    container.innerHTML = "";

    if (allItems.length === 0) {
      $("#wl-dl-status").textContent = "No captures yet — " + (isMarble ? "interact with the world" : "scanning...");
      $("#wl-dl-dlall").disabled = true;
      return;
    }

    // Group by resolution
    const groups = {};
    for (const item of allItems) {
      const res = item.resolution || (item.name.includes("500k") ? "500k"
        : item.name.includes("3m") ? "3M"
        : item.name.includes("full_res") ? "full"
        : item.name.includes("150k") ? "150k"
        : item.name.includes("100k") ? "100k"
        : item.name.endsWith(".ply") ? "PLY" : "other");
      if (!groups[res]) groups[res] = [];
      groups[res].push(item);
    }

    const order = ["full", "3M", "500k", "200k", "150k", "100k", "PLY", "other"];
    const sorted = Object.entries(groups).sort((a, b) => {
      const ai = order.indexOf(a[0]), bi = order.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    for (const [res, items] of sorted) {
      const sec = document.createElement("div");
      sec.className = "wl-dl-sec";
      const tagCls = ["full", "3M"].includes(res) ? "tg-hi" : res === "500k" ? "tg-mid" : res === "PLY" ? "tg-ply" : "tg-lo";
      sec.innerHTML = `<div class="wl-dl-sec-t">${res} (${items.length})</div>`;

      for (const item of items) {
        const row = document.createElement("div");
        row.className = "wl-dl-item";
        const sz = item.size ? ` ${(item.size / 1048576).toFixed(1)}MB` : "";
        const dbTag = item.fromDB || item.fromSW ? `<span class="tg tg-db">bytes</span>` : "";
        row.innerHTML = `
          <span class="nm" title="${item.url}">${item.name}${sz}</span>
          <span class="tg ${tagCls}">${res}</span>
          ${dbTag}
          <button class="bd">Save</button>
        `;
        row.querySelector(".bd").addEventListener("click", async (e) => {
          const btn = e.target;
          btn.textContent = "...";

          // Try DB first
          const rec = await dbGet(item.url);
          if (rec?.bytes) {
            const blob = new Blob([rec.bytes], { type: "application/octet-stream" });
            await saveBlob(blob, item.name);
            btn.textContent = "OK";
            btn.classList.add("ok");
            uiLog(`Saved from DB: ${item.name}`);
            return;
          }

          // Fallback: GM_xmlhttpRequest (bypasses CORS)
          uiLog(`Fetching via GM: ${item.name}...`);
          GM_xmlhttpRequest({
            method: "GET",
            url: item.url,
            responseType: "blob",
            onload: async (resp) => {
              if (resp.status === 200 && resp.response) {
                await saveBlob(resp.response, item.name);
                btn.textContent = "OK";
                btn.classList.add("ok");
                uiLog(`Saved via GM: ${item.name} (${(resp.response.size / 1048576).toFixed(1)}MB)`);
              } else {
                btn.textContent = "ERR";
                uiLog(`GM fetch failed: ${resp.status}`);
              }
            },
            onerror: (e) => {
              btn.textContent = "Open";
              uiLog(`GM error, opening tab`);
              window.open(item.url, "_blank");
            },
          });
        });
        sec.appendChild(row);
      }
      container.appendChild(sec);
    }

    $("#wl-dl-status").textContent = `${allItems.length} files captured`;
    $("#wl-dl-dlall").disabled = false;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  PART 8: Manual scan + probe
  // ══════════════════════════════════════════════════════════════════════════

  async function manualScan() {
    uiLog("Manual scan started...");
    $("#wl-dl-status").textContent = "Scanning...";

    // 1. Scan DOM
    let domCount = 0;
    for (const el of document.querySelectorAll('link[href], script[src], img[src]')) {
      const url = el.href || el.src;
      if (!url) continue;
      try {
        const ext = new URL(url).pathname.split(".").pop()?.toLowerCase();
        if (["spz", "glb", "ply"].includes(ext) && !capturedUrls.has(url)) {
          capturedUrls.set(url, { name: url.split("/").pop().split("?")[0] });
          domCount++;
        }
      } catch {}
    }
    uiLog(`DOM scan: ${domCount} assets found`);

    // 2. Scan page HTML for CDN URLs
    try {
      const html = document.documentElement.outerHTML;
      const cdnMatches = html.matchAll(/https?:\/\/cdn\.marble\.worldlabs\.ai\/[^\s"'<>]+\.spz/g);
      let cdnCount = 0;
      for (const m of cdnMatches) {
        if (!capturedUrls.has(m[0])) {
          const name = m[0].split("/").pop().split("?")[0];
          capturedUrls.set(m[0], { name });
          cdnCount++;
        }
      }
      uiLog(`HTML CDN scan: ${cdnCount} .spz URLs found`);
    } catch (e) { uiLog(`HTML scan error: ${e.message}`); }

    // 3. Try to fetch world page directly and extract URLs
    if (isMarble) {
      const worldMatch = location.pathname.match(/\/world\/([a-f0-9-]+)/);
      if (worldMatch) {
        const worldId = worldMatch[1];
        uiLog(`World ID: ${worldId}`);

        // Probe common CDN paths
        const probes = [
          `https://cdn.marble.worldlabs.ai/${worldId}/`,
        ];
        for (const base of probes) {
          uiLog(`Probing: ${base}`);
          GM_xmlhttpRequest({
            method: "GET",
            url: base,
            onload: (resp) => {
              uiLog(`Probe ${resp.status}: ${resp.responseText?.slice(0, 200) || "empty"}`);
            },
            onerror: (e) => {
              uiLog(`Probe error: ${e}`);
            },
          });
        }

        // Try fetching the world data from the API (may need auth)
        const apiUrls = [
          `https://api.worldlabs.ai/api/v1/objects/${worldId}`,
          `https://api.worldlabs.ai/v1/objects/${worldId}`,
        ];
        for (const apiUrl of apiUrls) {
          GM_xmlhttpRequest({
            method: "GET",
            url: apiUrl,
            headers: { "Accept": "application/json" },
            onload: (resp) => {
              uiLog(`API ${resp.status} from ${apiUrl.split("/").pop()}`);
              if (resp.status === 200) {
                try {
                  const data = JSON.parse(resp.responseText);
                  onApiData(data);
                } catch (e) { uiLog(`API parse error: ${e.message}`); }
              } else {
                uiLog(`Response: ${resp.responseText?.slice(0, 200)}`);
              }
            },
            onerror: (e) => uiLog(`API error: ${e}`),
          });
        }
      }
    }

    // 4. Scan all script sources for .spz URLs
    let scriptCount = 0;
    for (const script of document.querySelectorAll("script[src]")) {
      try {
        const res = await fetch(script.src);
        const text = await res.text();
        const matches = text.matchAll(/["'](https?:\/\/[^"']*\.(spz|ply))["']/g);
        for (const m of matches) {
          if (!capturedUrls.has(m[1])) {
            capturedUrls.set(m[1], { name: m[1].split("/").pop().split("?")[0] });
            scriptCount++;
          }
        }
        // Also look for CDN base patterns
        const cdnMatches = text.matchAll(/cdn\.marble\.worldlabs\.ai[^"'\s]*/g);
        for (const m of cdnMatches) {
          uiLog(`Script CDN ref: ${m[0].slice(0, 100)}`);
        }
      } catch {}
    }
    uiLog(`Script scan: ${scriptCount} assets found`);

    await refreshPanel();
    uiLog("Scan complete. Total captured: " + capturedUrls.size);
  }

  $("#wl-dl-scan").addEventListener("click", manualScan);

  async function downloadAll() {
    const btn = $("#wl-dl-dlall");
    btn.disabled = true;
    btn.textContent = "Saving...";
    const bar = $("#wl-dl-bar");
    let done = 0;
    const total = capturedUrls.size;

    for (const [url, meta] of capturedUrls) {
      // Try DB first
      const rec = await dbGet(url);
      if (rec?.bytes) {
        const blob = new Blob([rec.bytes], { type: "application/octet-stream" });
        await saveBlob(blob, meta.name);
        done++;
        uiLog(`DB saved: ${meta.name}`);
      } else {
        // GM_xmlhttpRequest
        await new Promise((resolve) => {
          GM_xmlhttpRequest({
            method: "GET", url, responseType: "blob",
            onload: async (resp) => {
              if (resp.status === 200 && resp.response) {
                await saveBlob(resp.response, meta.name);
                uiLog(`GM saved: ${meta.name}`);
              }
              done++;
              resolve();
            },
            onerror: () => { done++; resolve(); },
          });
        });
      }
      bar.style.width = Math.round((done / total) * 100) + "%";
      btn.textContent = `${done}/${total}`;
      await new Promise(r => setTimeout(r, 200));
    }
    btn.textContent = "Done";
    GM_notification({ title: "WL-DL", text: `Saved ${total} files`, timeout: 3000 });
  }

  $("#wl-dl-dlall").addEventListener("click", downloadAll);

  // ══════════════════════════════════════════════════════════════════════════
  //  PART 9: Auto-scan on load + periodic refresh
  // ══════════════════════════════════════════════════════════════════════════

  uiLog("Script initialized. SW:" + (swReady ? "ready" : "pending"));

  // Wait for DOM then scan
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(manualScan, 2000));
  } else {
    setTimeout(manualScan, 2000);
  }

  // Periodic refresh
  setInterval(async () => {
    const dbItems = await dbGetAll();
    const totalCount = capturedUrls.size + dbItems.filter(d => !capturedUrls.has(d.url)).length;
    if (totalCount > lastCount) refreshPanel();
  }, 3000);

  // For marble: also try fetching the world page content after a delay
  if (isMarble) {
    setTimeout(() => {
      uiLog("Delayed marble scan...");
      manualScan();
    }, 8000);
  }
})();
