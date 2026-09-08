// ==UserScript==
// @name         Meshy GLB Downloader
// @namespace    https://github.com/meshy-dl
// @version      2.0
// @description  Download GLB models, previews and textures from meshy.ai — marble-style panel with motion, grouping, and bulk save
// @author       fahad
// @match        *://*.meshy.ai/*
// @grant        GM_download
// @grant        GM_addStyle
// @grant        GM_notification
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// @connect      *.meshy.ai
// @connect      *.amazonaws.com
// @connect      meshy.ai
// ==/UserScript==

(function () {
  "use strict";

  const TAG = "[MESHY-DL]";
  const log = (...a) => console.log(TAG, ...a);

  log("Script loaded on", location.hostname + location.pathname);

  // ══════════════════════════════════════════════════════════════════════════
  //  PART 1: Page-context interceptor (fixes sandbox split)
  //  same as marble: patch fetch/XHR inside the page and relay via postMessage
  // ══════════════════════════════════════════════════════════════════════════

  const capturedUrls = new Map();
  let _onFileCaptured = null;
  let _onApiData = null;
  let _refreshPanel = null;
  let _uiLog = null;

  window.addEventListener("message", (e) => {
    if (!e.data || e.data.source !== "MESHY_DL_NET") return;
    if (e.data.type === "INJECT_READY" && _uiLog) _uiLog("Interceptor ready (page)");
    if (e.data.type === "FILE") {
      const url = e.data.url;
      const name = url.split("/").pop().split("?")[0];
      if (_onFileCaptured) _onFileCaptured(url, name, 0);
      else { if (!capturedUrls.has(url)) capturedUrls.set(url, { name }); if (_refreshPanel) _refreshPanel(); }
      if (_uiLog) _uiLog(`File: ${name.slice(0, 44)}`);
      log("page file:", name);
    }
    if (e.data.type === "API") {
      if (_onApiData) _onApiData(e.data.data, e.data.url);
      else log("early API", e.data.url);
      if (_uiLog) _uiLog(`API: ${String(e.data.url).split("/").pop().slice(0,40)}`);
    }
    if (e.data.type === "API_TEXT") {
      const text = e.data.text || "";
      const re = /https?:\/\/[^"'\s<>]+\.glb(\?[^"'\s<>]*)?/g;
      let m, cnt = 0;
      for (m of text.matchAll(re)) {
        const clean = m[0].replace(/\\u0026/g, "&");
        if (!capturedUrls.has(clean)) { capturedUrls.set(clean, { name: clean.split("/").pop().split("?")[0], fromText: true }); cnt++; }
      }
      if (cnt) { if (_refreshPanel) _refreshPanel(); if (_uiLog) _uiLog(`Text scan: ${cnt} glb`); }
    }
  });

  function injectInterceptor() {
    const code = `(function(){
      const TAG='[MESHY-DL:INJECT]';
      const lg=(...a)=>console.log(TAG,...a);
      lg('inject start', location.hostname+location.pathname);
      try{
        const _fetch=window.fetch.bind(window);
        window.fetch=async function(input, init){
          const url = typeof input==='string' ? input : (input && input.url) || '';
          const res = await _fetch(input, init);
          try{
            if(url.includes('.glb')||url.includes('.gltf')||url.includes('.usdz')){
              window.postMessage({source:'MESHY_DL_NET', type:'FILE', url}, '*');
            }
            if((url.includes('/api/')||url.includes('/web/v2/tasks')||url.includes('/tasks/'))&&res.ok){
              const ct=res.headers.get('content-type')||'';
              const clone=res.clone();
              if(ct.includes('json')){
                clone.json().then(d=>{
                  window.postMessage({source:'MESHY_DL_NET', type:'API', data:d, url}, '*');
                }).catch(()=>{});
              } else {
                clone.text().then(t=>{
                  if(t.includes('.glb')||t.includes('modelUrl')||t.includes('model_url')){
                    try{ const d=JSON.parse(t); window.postMessage({source:'MESHY_DL_NET', type:'API', data:d, url}, '*'); }
                    catch{ window.postMessage({source:'MESHY_DL_NET', type:'API_TEXT', text:t, url}, '*'); }
                  }
                }).catch(()=>{});
              }
            }
          }catch(e){ lg('fetch wrap', e.message); }
          return res;
        };
        lg('fetch patched');
      }catch(e){ console.warn(TAG,'fetch patch fail',e.message); }

      try{
        const oOpen=XMLHttpRequest.prototype.open, oSend=XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open=function(m,u,...r){ this._meshyUrl=u; return oOpen.call(this,m,u,...r); };
        XMLHttpRequest.prototype.send=function(...a){
          this.addEventListener('load', function(){
            const u=this._meshyUrl||'';
            try{
              if(u.includes('.glb')||u.includes('.gltf')){
                window.postMessage({source:'MESHY_DL_NET', type:'FILE', url:u}, '*');
              }
              if((u.includes('/api/')||u.includes('/tasks'))&&this.status>=200&&this.status<300){
                const ct=(this.getResponseHeader('content-type')||'');
                if(ct.includes('json')||this.responseText.trim().startsWith('{')){
                  try{ const d=JSON.parse(this.responseText); window.postMessage({source:'MESHY_DL_NET', type:'API', data:d, url:u}, '*'); }catch{}
                } else if(this.responseText.includes('.glb')){
                  window.postMessage({source:'MESHY_DL_NET', type:'API_TEXT', text:this.responseText, url:u}, '*');
                }
              }
            }catch{}
          });
          return oSend.apply(this,a);
        };
        lg('xhr patched');
      }catch(e){ console.warn(TAG,'xhr patch fail',e.message); }

      window.postMessage({source:'MESHY_DL_NET', type:'INJECT_READY'}, '*');
    })();`;
    try {
      const s = document.createElement("script");
      s.textContent = code;
      (document.documentElement || document.head || document.body).appendChild(s);
      setTimeout(() => { try{s.remove();}catch{} }, 2000);
      log("Interceptor injected into page");
    } catch (e) { console.error(TAG, "inject failed:", e.message); }
  }

  if (document.documentElement) injectInterceptor();
  else document.addEventListener("DOMContentLoaded", injectInterceptor, { once: true });
  setTimeout(() => injectInterceptor(), 500);

  // ══════════════════════════════════════════════════════════════════════════
  //  PART 2: Data processing — recursive glb finder
  // ══════════════════════════════════════════════════════════════════════════

  function findModelUrls(obj, out = []) {
    if (!obj) return out;
    if (typeof obj === "string") {
      const re = /https?:\/\/[^ \n\r"']+\.glb(\?[^ \n\r"']*)?/g;
      let m;
      for (m of obj.matchAll(re)) out.push(m[0].replace(/\\u0026/g, "&"));
      return out;
    }
    if (Array.isArray(obj)) { obj.forEach(i => findModelUrls(i, out)); return out; }
    if (typeof obj === "object") {
      for (const k in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
        const v = obj[k];
        const lk = k.toLowerCase();
        if ((lk.includes("modelurl") || lk === "glb_url" || lk === "url") && typeof v === "string" && v.includes(".glb")) {
          out.push(v.replace(/\\u0026/g, "&"));
        } else if (typeof v === "string" && v.includes(".glb") && v.startsWith("http")) {
          out.push(v.replace(/\\u0026/g, "&"));
        } else {
          findModelUrls(v, out);
        }
      }
    }
    return out;
  }

  function sanitizeFilename(s) { return String(s).replace(/[^a-z0-9_\-]+/gi, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "model"; }

  function extTag(url, meta) {
    if (meta && meta.resolution) return meta.resolution;
    const base = (url.split("/").pop() || "").split("?")[0].toLowerCase();
    if (base.endsWith(".glb")) return "glb";
    if (base.endsWith(".gltf")) return "gltf";
    if (base.endsWith(".usdz")) return "usdz";
    if (base.endsWith(".png") || base.endsWith(".jpg") || base.endsWith(".webp")) return "preview";
    if (base.endsWith(".json")) return "json";
    return "other";
  }

  // capture preview + json alongside glb
  function addAuxForTask(task) {
    const meta = task || {};
    const title = meta.prompt || meta.name || meta.display_name || meta.title || "";
    // preview images
    const preview = meta.thumbnail_url || meta.preview_url || meta.image_url || meta.rendered_image || null;
    if (preview && typeof preview === "string" && preview.startsWith("http") && !capturedUrls.has(preview)) {
      const name = preview.split("/").pop().split("?")[0] || `${sanitizeFilename(title) || "preview"}.jpg`;
      capturedUrls.set(preview, { name, resolution: "preview" });
      log(" + preview ->", name);
    }
    // also try pbr / texture urls if present
    for (const k of ["pbr_url", "texture_url", "albedo_url"]) {
      if (typeof meta[k] === "string" && meta[k].startsWith("http") && !capturedUrls.has(meta[k])) {
        capturedUrls.set(meta[k], { name: meta[k].split("/").pop().split("?")[0], resolution: "texture" });
      }
    }
  }

  function onFileCaptured(url, name) {
    if (!capturedUrls.has(url)) {
      const tag = extTag(url, null);
      capturedUrls.set(url, { name, resolution: tag, fromPage: true });
      refreshPanel();
    }
  }
  _onFileCaptured = onFileCaptured;

  function onApiData(data, srcUrl) {
    try {
      const urls = findModelUrls(data);
      let added = 0;
      for (const u of urls) {
        if (!capturedUrls.has(u)) {
          const name = u.split("/").pop().split("?")[0];
          capturedUrls.set(u, { name, resolution: "glb" });
          added++;
          log(" + glb", name, "via", String(srcUrl).split("/").pop());
        }
      }
      // also catch auxiliary assets per-task
      const tasks = Array.isArray(data) ? data : (data?.data && Array.isArray(data.data) ? data.data : (data?.result ? [data.result] : [data]));
      for (const t of tasks) {
        if (t && typeof t === "object") addAuxForTask(t);
        // nested
        if (t?.task && typeof t.task === "object") addAuxForTask(t.task);
        if (t?.model && typeof t.model === "object") addAuxForTask(t.model);
      }
      if (added || urls.length) refreshPanel();
    } catch (e) { log("onApiData error:", e.message); }
  }
  _onApiData = onApiData;

  // ══════════════════════════════════════════════════════════════════════════
  //  PART 3: IndexedDB + save helpers (parity with marble)
  // ══════════════════════════════════════════════════════════════════════════

  function dbGetAll() {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open('MESHY_DL', 1);
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
        const req = indexedDB.open('MESHY_DL', 1);
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
  //  PART 4: Panel UI — marble parity with motion (no static icons)
  // ══════════════════════════════════════════════════════════════════════════

  GM_addStyle(`
    @keyframes meshFadeIn { from { opacity:0; transform: translateY(8px) scale(.98); } to { opacity:1; transform: translateY(0) scale(1); } }
    @keyframes meshPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }
    @keyframes meshShimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
    @keyframes meshSpin { to { transform: rotate(360deg); } }
    #meshy-dl-panel{position:fixed;bottom:20px;right:20px;z-index:99999;font-family:system-ui,-apple-system,sans-serif;font-size:13px;background:rgba(14,16,22,.96);color:#e8eefc;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.55),0 0 0 1px rgba(124,140,255,.12);backdrop-filter:blur(16px);width:390px;max-height:86vh;overflow:hidden;border:1px solid rgba(255,255,255,.06);animation:meshFadeIn .35s cubic-bezier(.16,1,.3,1)}
    #meshy-dl-panel.minimized{width:54px;height:54px;border-radius:50%;cursor:pointer;overflow:hidden}
    #meshy-dl-panel.minimized #meshy-dl-body,#meshy-dl-panel.minimized #meshy-dl-acts{display:none}
    #meshy-dl-panel.minimized #meshy-dl-header{padding:0;justify-content:center;height:54px;border:none}
    #meshy-dl-panel.minimized #meshy-dl-toggle{margin:0;width:54px;height:54px;border-radius:50%;font-size:22px;display:flex;align-items:center;justify-content:center;animation:meshPulse 2.2s ease-in-out infinite}
    #meshy-dl-header{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.07);cursor:move;user-select:none;background:linear-gradient(135deg, rgba(124,140,255,.10), rgba(56,189,248,.08))}
    #meshy-dl-title{display:flex;align-items:center;gap:8px;font-weight:700;font-size:13px;letter-spacing:.01em}
    #meshy-dl-title .ico{width:20px;height:20px;display:inline-grid;place-items:center;background:linear-gradient(135deg,#7c8cff,#38bdf8);border-radius:6px;font-size:12px;animation:meshPulse 3s ease-in-out infinite}
    #meshy-dl-subtitle{font-size:10px;color:#8b9bb4;font-weight:500;margin-top:1px}
    .meshy-hdr-btns{display:flex;gap:4px}
    .meshy-hdr-btns button{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.06);color:#9fb0cc;cursor:pointer;font-size:11px;padding:5px 8px;border-radius:7px;transition:all .15s}
    .meshy-hdr-btns button:hover{background:rgba(124,140,255,.18);color:#fff;border-color:rgba(124,140,255,.3);transform:translateY(-1px)}
    #meshy-dl-body{padding:10px 14px;overflow-y:auto;max-height:56vh;scrollbar-width:thin;scrollbar-color:rgba(124,140,255,.3) transparent}
    #meshy-dl-status{font-size:12px;color:#9fb0cc;padding:3px 0 6px;display:flex;align-items:center;gap:6px}
    #meshy-dl-status .dot{width:7px;height:7px;border-radius:50%;background:#34d399;box-shadow:0 0 8px rgba(52,211,153,.6);flex-shrink:0}
    #meshy-dl-status .dot.idle{background:#64748b;box-shadow:none}
    #meshy-dl-log{font-size:10px;color:#6b7a99;max-height:110px;overflow-y:auto;padding:6px 8px;background:rgba(0,0,0,.28);border-radius:8px;margin:6px 0;font-family:ui-monospace,monospace;white-space:pre-wrap;word-break:break-all;border:1px solid rgba(255,255,255,.04)}
    .meshy-sec{margin-bottom:10px;animation:meshFadeIn .3s ease}
    .meshy-sec-t{font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:#7c8cff;margin-bottom:6px;font-weight:700;display:flex;align-items:center;gap:6px}
    .meshy-sec-t .cnt{font-size:9px;background:rgba(124,140,255,.15);color:#a5b4fc;padding:1px 6px;border-radius:20px;font-weight:700}
    .meshy-item{display:flex;align-items:center;gap:6px;padding:7px 8px;margin-bottom:2px;border-radius:8px;transition:all .14s;background:rgba(255,255,255,.02);border:1px solid transparent}
    .meshy-item:hover{background:rgba(124,140,255,.08);border-color:rgba(124,140,255,.15);transform:translateX(2px)}
    .meshy-item .nm{font-size:11px;color:#d6e2ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}
    .meshy-item .tg{font-size:9px;padding:2px 7px;border-radius:20px;flex-shrink:0;font-weight:700;letter-spacing:.03em}
    .tg-glb{background:linear-gradient(135deg,rgba(124,140,255,.18),rgba(56,189,248,.15));color:#a5b4fc;border:1px solid rgba(124,140,255,.2)}
    .tg-preview{background:rgba(251,191,36,.14);color:#fde68a;border:1px solid rgba(251,191,36,.2)}
    .tg-texture{background:rgba(52,211,153,.14);color:#6ee7b7;border:1px solid rgba(52,211,153,.2)}
    .tg-other{background:rgba(255,255,255,.06);color:#9fb0cc}
    .meshy-item .bd{background:#fff;color:#0f172a;border:none;padding:5px 10px;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;transition:all .15s;flex-shrink:0;box-shadow:0 2px 8px rgba(0,0,0,.15)}
    .meshy-item .bd:hover{background:#eef2ff;transform:translateY(-1px);box-shadow:0 4px 12px rgba(124,140,255,.25)}
    .meshy-item .bd:active{transform:scale(.97)}
    .meshy-item .bd.ok{background:#ecfdf5;color:#065f46}
    .meshy-item .bd2{background:rgba(255,255,255,.06);color:#cbd5e1;border:1px solid rgba(255,255,255,.06);padding:5px 8px;border-radius:7px;font-size:11px;cursor:pointer;flex-shrink:0;transition:all .15s}
    .meshy-item .bd2:hover{background:rgba(255,255,255,.10);color:#fff}
    #meshy-dl-acts{display:flex;gap:8px;padding:10px 14px;border-top:1px solid rgba(255,255,255,.06);background:rgba(0,0,0,.12)}
    #meshy-dl-acts button{flex:1;padding:9px;border:none;border-radius:9px;font-size:12px;font-weight:700;cursor:pointer;transition:all .15s}
    #meshy-dl-dlall{background:linear-gradient(135deg,#7c8cff,#38bdf8);color:#fff;box-shadow:0 4px 14px rgba(124,140,255,.35);position:relative;overflow:hidden}
    #meshy-dl-dlall::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent);background-size:200% 100%;animation:meshShimmer 2.5s infinite;opacity:0;transition:opacity .2s}
    #meshy-dl-dlall:hover::after{opacity:1}
    #meshy-dl-dlall:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(124,140,255,.45)}
    #meshy-dl-dlall:active{transform:scale(.98)}
    #meshy-dl-dlall:disabled{opacity:.4;cursor:not-allowed;transform:none;box-shadow:none}
    #meshy-dl-dlall:disabled::after{display:none}
    #meshy-dl-scan{background:rgba(255,255,255,.07);color:#cbd5e1;border:1px solid rgba(255,255,255,.06)}
    #meshy-dl-scan:hover{background:rgba(255,255,255,.11);color:#fff;transform:translateY(-1px)}
    .meshy-prog{height:3px;background:rgba(255,255,255,.08);border-radius:20px;margin-top:8px;overflow:hidden}
    .meshy-bar{height:100%;background:linear-gradient(90deg,#7c8cff,#38bdf8);border-radius:20px;transition:width .35s cubic-bezier(.16,1,.3,1);width:0%}
    .meshy-empty{padding:18px 10px;text-align:center;color:#64748b;font-size:12px}
    .meshy-empty .big{font-size:22px;margin-bottom:6px;display:block;animation:meshPulse 2.5s ease-in-out infinite}
  `);

  const panel = document.createElement("div");
  panel.id = "meshy-dl-panel";
  panel.innerHTML = `
    <div id="meshy-dl-header">
      <div id="meshy-dl-title"><span class="ico">◈</span><span><div>Meshy DL</div><div id="meshy-dl-subtitle">glb auto-capture</div></span></div>
      <div class="meshy-hdr-btns">
        <button id="meshy-dl-clear" title="Clear log">CLR</button>
        <button id="meshy-dl-toggle" title="Minimize">—</button>
      </div>
    </div>
    <div id="meshy-dl-body">
      <div id="meshy-dl-status"><span class="dot idle" id="meshy-dl-dot"></span><span id="meshy-dl-status-t">Initializing…</span></div>
      <div id="meshy-dl-log"></div>
      <div id="meshy-dl-assets"></div>
      <div class="meshy-prog"><div class="meshy-bar" id="meshy-dl-bar"></div></div>
    </div>
    <div id="meshy-dl-acts">
      <button id="meshy-dl-scan">◎ Scan</button>
      <button id="meshy-dl-dlall" disabled>⬇ Download All</button>
    </div>
  `;
  if (!document.body) {
    new MutationObserver((_, obs) => { if (document.body) { obs.disconnect(); document.body.appendChild(panel); } }).observe(document.documentElement, { childList: true });
  } else document.body.appendChild(panel);

  const $ = (s) => panel.querySelector(s);

  const logLines = [];
  function uiLog(msg) {
    const ts = new Date().toLocaleTimeString();
    logLines.push(`[${ts}] ${msg}`);
    if (logLines.length > 80) logLines.shift();
    const el = $("#meshy-dl-log");
    if (el) { el.textContent = logLines.join("\n"); el.scrollTop = el.scrollHeight; }
  }
  _uiLog = uiLog;

  function setStatus(text, live) {
    const t = $("#meshy-dl-status-t");
    const dot = $("#meshy-dl-dot");
    if (t) t.textContent = text;
    if (dot) { dot.classList.toggle("idle", !live); }
  }

  // Drag
  let dragging = false, dx = 0, dy = 0;
  $("#meshy-dl-header").addEventListener("mousedown", (e) => {
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

  $("#meshy-dl-toggle").addEventListener("click", () => {
    const m = panel.classList.toggle("minimized");
    $("#meshy-dl-toggle").textContent = m ? "◈" : "—";
  });
  $("#meshy-dl-clear").addEventListener("click", () => {
    logLines.length = 0;
    $("#meshy-dl-log").textContent = "";
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  PART 5: Render & Download
  // ══════════════════════════════════════════════════════════════════════════

  let lastCount = -1;

  async function refreshPanel() {
    const dbItems = await dbGetAll();
    for (const item of dbItems) {
      if (!capturedUrls.has(item.url)) {
        capturedUrls.set(item.url, { name: item.name, size: item.size, fromDB: true });
      }
    }
    const allItems = [...capturedUrls.entries()].map(([url, meta]) => ({ url, ...meta }));
    if (allItems.length === lastCount) return;
    lastCount = allItems.length;

    uiLog(`Panel: ${allItems.length} items, DB:${dbItems.length}`);
    setStatus(allItems.length ? `${allItems.length} files captured` : "No captures yet — interact or wait for task load", !!allItems.length);

    const container = $("#meshy-dl-assets");
    if (!container) return;
    container.innerHTML = "";

    if (allItems.length === 0) {
      container.innerHTML = `<div class="meshy-empty"><span class="big">◈</span>no glb yet<br><span style="font-size:10px;opacity:.6">open a task, generate or click Scan</span></div>`;
      $("#meshy-dl-dlall").disabled = true;
      return;
    }

    const groups = {};
    for (const item of allItems) {
      const res = extTag(item.url, item);
      if (!groups[res]) groups[res] = [];
      groups[res].push(item);
    }
    const order = ["glb", "gltf", "usdz", "preview", "texture", "json", "other"];
    const sorted = Object.entries(groups).sort((a, b) => {
      const ai = order.indexOf(a[0]), bi = order.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    for (const [res, items] of sorted) {
      const sec = document.createElement("div");
      sec.className = "meshy-sec";
      const tagCls = res === "glb" ? "tg-glb" : res === "preview" ? "tg-preview" : res === "texture" ? "tg-texture" : "tg-other";
      const label = res === "glb" ? "glb — 3d model" : res === "preview" ? "preview — thumbnail" : res;
      sec.innerHTML = `<div class="meshy-sec-t">${label} <span class="cnt">${items.length}</span></div>`;

      for (const item of items) {
        const row = document.createElement("div");
        row.className = "meshy-item";
        const dbTag = item.fromDB ? `<span class="tg tg-other" style="font-size:8px">db</span>` : "";
        row.innerHTML = `
          <span class="nm" title="${item.url}">${item.name}</span>
          <span class="tg ${tagCls}">${res}</span>
          ${dbTag}
          <button class="bd2" title="Copy link">⧉</button>
          <button class="bd">Save</button>
        `;
        const saveBtn = row.querySelector(".bd");
        const copyBtn = row.querySelector(".bd2");
        copyBtn.addEventListener("click", async () => {
          try { await navigator.clipboard.writeText(item.url); copyBtn.textContent = "✓"; setTimeout(()=> copyBtn.textContent="⧉", 1200); uiLog("Copied: " + item.name); } catch { window.open(item.url, "_blank"); }
        });
        saveBtn.addEventListener("click", async (e) => {
          const btn = e.target;
          btn.textContent = "…";
          const rec = await dbGet(item.url);
          if (rec?.bytes) {
            const blob = new Blob([rec.bytes], { type: "application/octet-stream" });
            await saveBlob(blob, item.name);
            btn.textContent = "OK"; btn.classList.add("ok"); uiLog(`Saved from DB: ${item.name}`); return;
          }
          uiLog(`Fetching via GM: ${item.name}…`);
          GM_xmlhttpRequest({
            method: "GET",
            url: item.url,
            responseType: "blob",
            onload: async (resp) => {
              if (resp.status === 200 && resp.response) {
                await saveBlob(resp.response, item.name);
                btn.textContent = "OK"; btn.classList.add("ok");
                uiLog(`Saved: ${item.name} (${(resp.response.size/1048576).toFixed(1)}MB)`);
              } else { btn.textContent = "ERR"; uiLog(`GM fetch failed: ${resp.status}`); }
            },
            onerror: () => { btn.textContent = "Open"; uiLog(`GM error, opening tab`); window.open(item.url, "_blank"); },
          });
        });
        sec.appendChild(row);
      }
      container.appendChild(sec);
    }
    $("#meshy-dl-dlall").disabled = false;
  }
  _refreshPanel = refreshPanel;

  // ══════════════════════════════════════════════════════════════════════════
  //  PART 6: Scan fallbacks (performance, embedded JSON, DOM)
  // ══════════════════════════════════════════════════════════════════════════

  function scanPerformance() {
    try {
      const entries = performance.getEntriesByType("resource") || [];
      let cnt = 0;
      for (const r of entries) {
        if (r.name.includes(".glb") && !capturedUrls.has(r.name)) {
          capturedUrls.set(r.name, { name: r.name.split("/").pop().split("?")[0], resolution: "glb", fromPerf: true });
          cnt++;
        }
      }
      if (cnt) uiLog(`Perf scan: ${cnt} glb`);
      return cnt;
    } catch { return 0; }
  }

  function scanEmbeddedJson() {
    try {
      const html = document.documentElement.outerHTML;
      const re = /https?:\/\/[^"'\s<>]+\.glb(\?[^"'\s<>]*)?/g;
      let m, cnt = 0;
      for (m of html.matchAll(re)) {
        const clean = m[0].replace(/\\u0026/g, "&");
        if (!capturedUrls.has(clean)) { capturedUrls.set(clean, { name: clean.split("/").pop().split("?")[0], resolution: "glb", fromHtml: true }); cnt++; }
      }
      for (const s of document.querySelectorAll("script")) {
        const t = s.textContent || "";
        if (!t.includes(".glb") && !t.includes("modelUrl")) continue;
        for (m of t.matchAll(re)) {
          const clean = m[0].replace(/\\u0026/g, "&");
          if (!capturedUrls.has(clean)) { capturedUrls.set(clean, { name: clean.split("/").pop().split("?")[0], resolution: "glb", fromScript: true }); cnt++; }
        }
        const urls = findModelUrls(t);
        for (const u of urls) if (!capturedUrls.has(u)) { capturedUrls.set(u, { name: u.split("/").pop().split("?")[0], resolution: "glb" }); cnt++; }
      }
      if (cnt) uiLog(`Embed scan: ${cnt} assets`);
      return cnt;
    } catch (e) { uiLog(`Embed scan error: ${e.message}`); return 0; }
  }

  async function manualScan() {
    uiLog("Manual scan started…");
    setStatus("Scanning…", true);
    scanPerformance();
    scanEmbeddedJson();

    let domCount = 0;
    for (const el of document.querySelectorAll('link[href], script[src], img[src], a[href], model-viewer[src]')) {
      const url = el.href || el.src || el.getAttribute("src");
      if (!url) continue;
      try {
        const u = new URL(url, location.href).href;
        if (u.includes(".glb") && !capturedUrls.has(u)) {
          capturedUrls.set(u, { name: u.split("/").pop().split("?")[0], resolution: "glb" });
          domCount++;
        }
      } catch {}
    }
    if (domCount) uiLog(`DOM scan: ${domCount} glb`);

    // scan globals
    try {
      const g = window.__INITIAL_STATE__ || window.__STATE__ || window.appState || window.__APP_STATE__ || window.__NEXT_DATA__;
      if (g) {
        const urls = findModelUrls(g);
        let gc = 0;
        for (const u of urls) if (!capturedUrls.has(u)) { capturedUrls.set(u, { name: u.split("/").pop().split("?")[0], resolution: "glb" }); gc++; }
        if (gc) uiLog(`Global scan: ${gc} glb`);
      }
    } catch {}

    // fetch visible task ids from URL and DOM hints
    try {
      const hints = [...document.documentElement.innerHTML.matchAll(/https?:\/\/[^"'\s<>]+\.glb/g)].map(m=>m[0]);
      let hc = 0;
      for (const h of hints) {
        const clean = h.replace(/\\u0026/g, "&");
        if (!capturedUrls.has(clean)) { capturedUrls.set(clean, { name: clean.split("/").pop().split("?")[0], resolution: "glb", fromHtml: true }); hc++; }
      }
      if (hc) uiLog(`HTML CDN scan: ${hc} glb`);
    } catch {}

    scanPerformance();
    await refreshPanel();
    uiLog("Scan complete. Total: " + capturedUrls.size);
    setStatus(capturedUrls.size ? `${capturedUrls.size} files captured` : "No glb found — try opening a task", !!capturedUrls.size);
  }

  $("#meshy-dl-scan").addEventListener("click", manualScan);

  async function downloadAll() {
    const btn = $("#meshy-dl-dlall");
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = "Saving…";
    const bar = $("#meshy-dl-bar");
    let done = 0;
    const total = capturedUrls.size;
    for (const [url, meta] of capturedUrls) {
      const rec = await dbGet(url);
      if (rec?.bytes) {
        const blob = new Blob([rec.bytes], { type: "application/octet-stream" });
        await saveBlob(blob, meta.name);
        done++;
        uiLog(`DB saved: ${meta.name}`);
      } else {
        await new Promise((resolve) => {
          GM_xmlhttpRequest({
            method: "GET", url, responseType: "blob",
            onload: async (resp) => {
              if (resp.status === 200 && resp.response) {
                await saveBlob(resp.response, meta.name);
                uiLog(`GM saved: ${meta.name}`);
              } else uiLog(`GM failed ${resp.status}: ${meta.name}`);
              done++; resolve();
            },
            onerror: () => { done++; uiLog(`GM error: ${meta.name}`); resolve(); },
          });
        });
      }
      bar.style.width = Math.round((done / total) * 100) + "%";
      btn.textContent = `${done}/${total}`;
      await new Promise(r => setTimeout(r, 200));
    }
    btn.textContent = "Done ✓";
    setTimeout(()=> { btn.textContent = orig; btn.disabled = false; bar.style.width = "0%"; }, 1800);
    GM_notification({ title: "Meshy DL", text: `Saved ${total} files`, timeout: 3000 });
  }

  $("#meshy-dl-dlall").addEventListener("click", downloadAll);

  // ══════════════════════════════════════════════════════════════════════════
  //  PART 7: Auto-scan on load + periodic refresh
  // ══════════════════════════════════════════════════════════════════════════

  uiLog("Script initialized. Interceptor: injected");
  setTimeout(scanPerformance, 1000);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(manualScan, 2000));
  } else {
    setTimeout(manualScan, 2000);
  }

  setInterval(async () => {
    const dbItems = await dbGetAll();
    const perf = scanPerformance();
    const emb = scanEmbeddedJson();
    const totalCount = capturedUrls.size + dbItems.filter(d => !capturedUrls.has(d.url)).length;
    if (totalCount > lastCount || perf || emb) refreshPanel();
  }, 3000);

  setTimeout(() => { uiLog("Delayed scan…"); manualScan(); }, 8000);

})();
