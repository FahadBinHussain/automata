// ==UserScript==
// @name         World Labs 3D Asset Downloader
// @namespace    https://github.com/worldlabs-dl
// @version      4.4
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
  //  PART 1: Page-context interceptor (fixes sandbox vs page window split)
  //  old code used window.fetch in the userscript sandbox (Tampermonkey
  //  isolated world) — page's fetch is a different object so nothing was
  //  captured (DOM 0, HTML CDN 0, API 404/403 via GM without auth).
  //  fix: inject a <script> that patches fetch/XHR in the page itself and
  //  relays via window.postMessage. Page's authenticated fetch (with cookies)
  //  then succeeds and we capture spz_urls without needing our own auth.
  // ══════════════════════════════════════════════════════════════════════════

  // must listen BEFORE injection — injected posts INJECT_READY etc
  const capturedUrls = new Map();
  const worldDataList = [];

  // will be defined later but hoisted for listener
  let _onFileCaptured = null;
  let _onApiData = null;
  let _refreshPanel = null;
  let _uiLog = null;

  window.addEventListener("message", (e) => {
    if (!e.data || e.data.source !== "WL_DL_NET") return;
    // console.debug(TAG, "message", e.data.type);
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
      if (_onApiData) _onApiData(e.data.data);
      else log("early API", e.data.url);
      if (_uiLog) _uiLog(`API: ${String(e.data.url).split("/").pop().slice(0,40)}`);
    }
    if (e.data.type === "API_TEXT") {
      const text = e.data.text || "";
      // extract any spz urls hidden in non-JSON text (e.g. streaming)
      const re = /https:\/\/cdn\.marble\.worldlabs\.ai\/[^"'\s<>]+\.spz/g;
      let m, cnt = 0;
      for (m of text.matchAll(re)) {
        if (!capturedUrls.has(m[0])) { capturedUrls.set(m[0], { name: m[0].split("/").pop().split("?")[0], fromText: true }); cnt++; }
      }
      if (cnt) { if (_refreshPanel) _refreshPanel(); if (_uiLog) _uiLog(`Text scan: ${cnt} spz`); }
    }
  });

  function injectInterceptor() {
    const code = `(function(){
      const TAG='[WL-DL:INJECT]';
      const lg=(...a)=>console.log(TAG,...a);
      lg('inject start', location.hostname+location.pathname);
      try{
        const _fetch=window.fetch.bind(window);
        window.fetch=async function(input, init){
          const url = typeof input==='string' ? input : (input && input.url) || '';
          const res = await _fetch(input, init);
          try{
            if(url.includes('.spz')||url.includes('.ply')){
              window.postMessage({source:'WL_DL_NET', type:'FILE', url}, '*');
            }
            if(url.includes('/api/')&&res.ok){
              const ct=res.headers.get('content-type')||'';
              const clone=res.clone();
              if(ct.includes('json')){
                clone.json().then(d=>{
                  window.postMessage({source:'WL_DL_NET', type:'API', data:d, url}, '*');
                }).catch(()=>{});
              } else {
                clone.text().then(t=>{
                  if(t.includes('spz')||t.includes('generation_output')||t.includes('.spz')){
                    try{ const d=JSON.parse(t); window.postMessage({source:'WL_DL_NET', type:'API', data:d, url}, '*'); }
                    catch{ window.postMessage({source:'WL_DL_NET', type:'API_TEXT', text:t, url}, '*'); }
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
        XMLHttpRequest.prototype.open=function(m,u,...r){ this._wlUrl=u; return oOpen.call(this,m,u,...r); };
        XMLHttpRequest.prototype.send=function(...a){
          this.addEventListener('load', function(){
            const u=this._wlUrl||'';
            try{
              if(u.includes('.spz')||u.includes('.ply')){
                window.postMessage({source:'WL_DL_NET', type:'FILE', url:u}, '*');
              }
              if(u.includes('/api/')&&this.status>=200&&this.status<300){
                const ct=(this.getResponseHeader('content-type')||'');
                if(ct.includes('json')||this.responseText.trim().startsWith('{')){
                  try{ const d=JSON.parse(this.responseText); window.postMessage({source:'WL_DL_NET', type:'API', data:d, url:u}, '*'); }catch{}
                } else if(this.responseText.includes('spz')){
                  window.postMessage({source:'WL_DL_NET', type:'API_TEXT', text:this.responseText, url:u}, '*');
                }
              }
            }catch{}
          });
          return oSend.apply(this,a);
        };
        lg('xhr patched');
      }catch(e){ console.warn(TAG,'xhr patch fail',e.message); }

      // also catch performance entries that slipped through (injected poll)
      window.postMessage({source:'WL_DL_NET', type:'INJECT_READY'}, '*');
    })();`;
    try {
      const s = document.createElement("script");
      s.textContent = code;
      (document.documentElement || document.head || document.body).appendChild(s);
      // keep in DOM briefly so CSP doesn't immediately GC it; remove later
      setTimeout(() => { try{s.remove();}catch{} }, 2000);
      log("Interceptor injected into page");
    } catch (e) { err("inject failed:", e.message); }
  }

  // inject at document-start; if head not ready, wait briefly
  if (document.documentElement) injectInterceptor();
  else document.addEventListener("DOMContentLoaded", injectInterceptor, { once: true });
  // also try again after a tick in case document_start ran before DOM
  setTimeout(() => { if (!document.querySelector('script[data-wl-inject]')) injectInterceptor(); }, 500);

  // ══════════════════════════════════════════════════════════════════════════
  //  PART 2: Legacy SW/XHR/Worker removed — page injection replaces them.
  //  We keep the IndexedDB helpers for cached file fallback, but no longer
  //  register a blob SW (it was blocked by CSP and never reached ready).
  // ══════════════════════════════════════════════════════════════════════════

  let swReady = false;
  log("SW disabled — page fetch interception replaces it");

  // ══════════════════════════════════════════════════════════════════════════
  //  PART 3: Data processing (recursive spz finder)
  // ══════════════════════════════════════════════════════════════════════════

  function collectSpzUrls(obj, out) {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) { for (const v of obj) collectSpzUrls(v, out); return; }
    if (obj.spz_urls && typeof obj.spz_urls === "object") {
      for (const [k, v] of Object.entries(obj.spz_urls)) {
        if (typeof v === "string" && v.includes("http")) out.push({ key: k, url: v });
      }
    }
    // also direct spz link fields
    for (const k of ["ply_url", "rad_url", "mpi_url", "cond_image_url"]) {
      if (typeof obj[k] === "string" && obj[k].includes("http")) {
        // only spz/ply rad should be captured as file; others as aux
        if (k === "ply_url" || k === "rad_url") out.push({ key: k, url: obj[k] });
      }
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") collectSpzUrls(v, out);
    }
  }

  const RANK = { full_res: 0, "3m": 1, full: 1, "500k": 2, "200k": 3, "150k": 4, "100k": 5, ply: 6 };
  function pickBest(found) {
    if (!found || !found.length) return null;
    const uniq = [...new Map(found.map(f => [f.url, f])).values()];
    const spzOnly = uniq.filter(f => f.url.includes(".spz"));
    const pool = spzOnly.length ? spzOnly : uniq;
    pool.sort((a,b) => {
      const ra = RANK[a.key] ?? 99, rb = RANK[b.key] ?? 99;
      if (ra !== rb) return ra - rb;
      return b.url.length - a.url.length;
    });
    return pool[0];
  }

  function pruneToSingleBestSpz() {
    const spzEntries = [...capturedUrls.entries()].filter(([u,m]) => u.includes(".spz") && !m.isJson && m.resolution !== "json" && m.resolution !== "webp" && m.resolution !== "input");
    if (spzEntries.length <= 1) return;
    // keep only the globally best spz (1 spz per scene as user expects: 1 spz +1 json +1 webp = 3 files)
    // if you need multi-asset worlds, switch to per-base pruning below
    const best = pickBest(spzEntries.map(([u,m]) => ({ url: u, key: m.resolution })));
    if (!best) return;
    for (const [u] of spzEntries) if (u !== best.url) capturedUrls.delete(u);
  }

  function onFileCaptured(url, name, size) {
    if (!capturedUrls.has(url)) {
      capturedUrls.set(url, { name, size, fromPage: true });
      refreshPanel();
    }
  }
  _onFileCaptured = onFileCaptured;

  function sanitizeFilename(s) { return String(s).replace(/[^a-z0-9_\-]+/gi, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "world"; }

  const seenWorldIds = new Set();
  function addJsonAndThumbForWorld(world, displayHint) {
    const worldId = world?.id || world?.world_id || world?.generation_output?.world_id || world?.generation_output?.id || null;
    if (worldId && seenWorldIds.has(worldId)) return; // one bundle per world
    if (worldId) seenWorldIds.add(worldId);
    const displayName = world?.generation_output?.display_name || world?.display_name || world?.name || displayHint || "world";
    const baseName = worldId ? `${worldId}` : sanitizeFilename(displayName);
    // only bundle per-world if we have an identifiable world id — prevents
    // nested spz blobs creating extra world.json / input.png duplicates
    if (!worldId) return;
    // 1) json — one per worldId
    const jsonUrl = `json://${baseName}`;
    if (!capturedUrls.has(jsonUrl)) {
      const payload = JSON.stringify(world, null, 2);
      capturedUrls.set(jsonUrl, { name: `${sanitizeFilename(displayName) || baseName}.json`, resolution: "json", isJson: true, jsonData: payload, worldId });
      log("  + json ->", `${sanitizeFilename(displayName)}.json`);
    }
    // 2) webp thumbnail — prefer rendered thumbnail, NOT cond_image_url
    //    cond_image is the input prompt image (95ac6d68_image_prompt_sanitized.png) — keep as secondary only if no thumb
    let thumbUrl = world?.generation_output?.thumbnail_url || world?.thumbnail_url || null;
    if (!thumbUrl) {
      const mpi = world?.generation_output?.mpi_url || world?.mpi_url;
      if (mpi) thumbUrl = `${mpi.replace(/\/$/, "")}/thumbnail_1440.webp`;
    }
    if (!thumbUrl) {
      const og = document.querySelector('meta[property="og:image"]')?.content || "";
      if (og.includes("cdn.marble.worldlabs.ai") && (og.includes(".webp") || og.includes(".png"))) thumbUrl = og.split("?")[0];
    }
    // cond_image as fallback last resort, but mark as input so user knows difference
    let isInput = false;
    if (!thumbUrl) {
      thumbUrl = world?.generation_output?.cond_image_url || world?.cond_image_url || null;
      if (thumbUrl) isInput = true;
    }
    if (thumbUrl && thumbUrl.includes("http") && !capturedUrls.has(thumbUrl)) {
      const tname = thumbUrl.split("/").pop().split("?")[0];
      const wname = tname.includes(".") ? tname : `${sanitizeFilename(displayName)}_thumb.webp`;
      capturedUrls.set(thumbUrl, { name: wname, resolution: isInput ? "input" : "webp", isInput });
      log("  + webp ->", wname, isInput ? "(input)" : "");
    }
  }

  function onApiData(data) {
    try {
      // normalize to world list for per-scene 3-file grouping (spz+json+webp)
      let worlds = [];
      if (Array.isArray(data)) worlds = data;
      else if (data?.data && Array.isArray(data.data)) worlds = data.data;
      else if (data?.worlds && Array.isArray(data.worlds)) worlds = data.worlds;
      else if (data?.world && typeof data.world === "object") worlds = [data.world];
      else if (data?.generation_output || data?.spz_urls || data?.id) worlds = [data];
      else worlds = [data];

      let anySpz = false;
      for (const w of worlds) {
        const found = [];
        collectSpzUrls(w, found);
        if (found.length) {
          anySpz = true;
          const best = pickBest(found);
          if (best && !capturedUrls.has(best.url)) {
            const name = best.url.split("/").pop().split("?")[0];
            capturedUrls.set(best.url, { name, resolution: best.key });
            log(`  + best ${best.key} -> ${name} (from ${found.length} variants)`);
          } else if (best) log(`  = best ${best.key} already captured`);
          addJsonAndThumbForWorld(w);
          const wName = w?.generation_output?.display_name || w?.display_name || w?.name;
          if (wName) worldDataList.push({ name: wName });
        }
      }
      if (anySpz) { pruneToSingleBestSpz(); refreshPanel(); return; }

      // fallback: global recursive scan if per-world didn't hit (e.g. wrapped response)
      const found = [];
      collectSpzUrls(data, found);
      if (found.length) {
        const best = pickBest(found);
        log(`Found ${found.length} urls via global scan, best: ${best?.key}`);
        if (best && !capturedUrls.has(best.url)) {
          capturedUrls.set(best.url, { name: best.url.split("/").pop().split("?")[0], resolution: best.key });
          log("  +", best.key, "->", best.url.split("/").pop());
        }
        pruneToSingleBestSpz();
        // still try to add json/thumb from top-level if it looks like a world
        if (data && typeof data === "object" && (data.id || data.generation_output)) addJsonAndThumbForWorld(data);
        const probe = (o, d=0) => {
          if (!o || d>4) return;
          if (o.display_name || o.name) worldDataList.push({ name: o.display_name || o.name });
          for (const v of Object.values(o)) if (v&&typeof v==='object') probe(v, d+1);
        };
        probe(data);
        refreshPanel();
        return;
      }
      // legacy shape fallback
      const items = Array.isArray(data) ? data : [data];
      for (const w of items) {
        const spzUrls = w?.generation_output?.spz_urls || w?.spz_urls || w?.data?.generation_output?.spz_urls;
        if (spzUrls && typeof spzUrls === "object" && Object.keys(spzUrls).length > 0) {
          log("Found spz_urls (legacy):", Object.keys(spzUrls));
          for (const [key, url] of Object.entries(spzUrls)) {
            if (url && typeof url === "string" && !capturedUrls.has(url)) {
              capturedUrls.set(url, { name: url.split("/").pop().split("?")[0], resolution: key });
              log("  +", key, "->", name);
            }
          }
          const plyUrl = w?.generation_output?.ply_url || w?.ply_url || w?.data?.generation_output?.ply_url;
          if (plyUrl && !capturedUrls.has(plyUrl)) {
            capturedUrls.set(plyUrl, { name: plyUrl.split("/").pop().split("?")[0], resolution: "ply" });
            log("  + PLY fallback:", plyUrl.split("/").pop());
          }
          addJsonAndThumbForWorld(w);
          const worldName = w?.generation_output?.display_name || w?.display_name || w?.data?.display_name || "unknown";
          worldDataList.push({ name: worldName });
          log("World:", worldName);
          refreshPanel();
        }
      }
    } catch (e) { log("onApiData error:", e.message); }
  }
  _onApiData = onApiData;

  // ══════════════════════════════════════════════════════════════════════════
  //  PART 4: IndexedDB retrieval
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
  //  PART 5: Panel UI
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
  // wait for body if document-start
  if (!document.body) {
    new MutationObserver((_, obs) => { if (document.body) { obs.disconnect(); document.body.appendChild(panel); } }).observe(document.documentElement, { childList: true });
  } else document.body.appendChild(panel);

  const $ = (s) => panel.querySelector(s);

  // Debug log panel
  const logLines = [];
  function uiLog(msg) {
    const ts = new Date().toLocaleTimeString();
    logLines.push(`[${ts}] ${msg}`);
    if (logLines.length > 80) logLines.shift();
    const el = $("#wl-dl-log");
    if (el) { el.textContent = logLines.join("\n"); el.scrollTop = el.scrollHeight; }
  }
  _uiLog = uiLog;

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
  //  PART 6: Render & Download
  // ══════════════════════════════════════════════════════════════════════════

  let lastCount = -1;

  async function refreshPanel() {
    // Merge IndexedDB items (kept for backward compat, not required)
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
    if (!container) return;
    container.innerHTML = "";

    if (allItems.length === 0) {
      $("#wl-dl-status").textContent = "No captures yet — " + (isMarble ? "interact or wait for world load" : "scanning...");
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

    const order = ["full", "full_res", "3M", "500k", "200k", "150k", "100k", "PLY", "json", "webp", "input", "other"];
    const sorted = Object.entries(groups).sort((a, b) => {
      const ai = order.indexOf(a[0]), bi = order.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    for (const [res, items] of sorted) {
      const sec = document.createElement("div");
      sec.className = "wl-dl-sec";
      const tagCls = ["full", "3M", "full_res"].includes(res) ? "tg-hi" : res === "500k" ? "tg-mid" : res === "PLY" ? "tg-ply" : (res === "json" ? "tg-mid" : (res === "webp" ? "tg-lo" : "tg-lo"));
      const best = (res === "full" || res === "full_res" || res === "3M") ? " [best quality]" : (res === "json" ? " — scene json" : (res === "webp" ? " — thumbnail" : ""));
      sec.innerHTML = `<div class="wl-dl-sec-t">${res} (${items.length})${best}</div>`;

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

          // json synthetic — no network, just blob from stored string
          if (item.isJson && item.jsonData) {
            const blob = new Blob([item.jsonData], { type: "application/json" });
            await saveBlob(blob, item.name);
            btn.textContent = "OK";
            btn.classList.add("ok");
            uiLog(`Saved json: ${item.name}`);
            return;
          }

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
  _refreshPanel = refreshPanel;

  // ══════════════════════════════════════════════════════════════════════════
  //  PART 7: Manual scan + fallbacks (performance, embedded JSON)
  // ══════════════════════════════════════════════════════════════════════════

  function scanPerformance() {
    try {
      const entries = performance.getEntriesByType("resource") || [];
      let cnt = 0;
      for (const r of entries) {
        if ((r.name.includes(".spz") || r.name.includes(".ply")) && !capturedUrls.has(r.name)) {
          capturedUrls.set(r.name, { name: r.name.split("/").pop().split("?")[0], fromPerf: true });
          cnt++;
        }
      }
      if (cnt) uiLog(`Perf scan: ${cnt} assets`);
      return cnt;
    } catch { return 0; }
  }

  function scanEmbeddedJson() {
    try {
      const fullHtml = document.documentElement.outerHTML;
      const re = /https:\/\/cdn\.marble\.worldlabs\.ai\/[^"'\s<>]+\.spz/g;
      let m, cnt = 0;
      for (m of fullHtml.matchAll(re)) {
        if (!capturedUrls.has(m[0])) { capturedUrls.set(m[0], { name: m[0].split("/").pop().split("?")[0], fromHtml: true }); cnt++; }
      }
      // also scan all script tag contents for spz_urls dumps
      for (const s of document.querySelectorAll("script")) {
        const t = s.textContent || "";
        if (!t.includes("spz")) continue;
        for (m of t.matchAll(re)) {
          if (!capturedUrls.has(m[0])) { capturedUrls.set(m[0], { name: m[0].split("/").pop().split("?")[0], fromScript: true }); cnt++; }
        }
        // also look for spz_urls JSON blobs with relative paths — try to extract urls inside object
        const j = t.matchAll(/"spz_urls"\s*:\s*\{[^}]+\}/g);
        for (const jm of j) {
          for (const um of jm[0].matchAll(/https[^"']+\.spz/g)) {
            if (!capturedUrls.has(um[0])) { capturedUrls.set(um[0], { name: um[0].split("/").pop().split("?")[0] }); cnt++; }
          }
        }
      }
      if (cnt) uiLog(`Embed scan: ${cnt} assets`);
      return cnt;
    } catch (e) { uiLog(`Embed scan error: ${e.message}`); return 0; }
  }

  async function manualScan() {
    uiLog("Manual scan started...");
    const st = $("#wl-dl-status");
    if (st) st.textContent = "Scanning...";

    // 0. Perf + embed fallbacks first (catch already-loaded spz)
    scanPerformance();
    scanEmbeddedJson();

    // 1. Scan DOM
    let domCount = 0;
    for (const el of document.querySelectorAll('link[href], script[src], img[src], a[href]')) {
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

    // 2. Scan page HTML for CDN URLs (already done in embed, but keep log)
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
      if (cdnCount) uiLog(`HTML CDN scan: ${cdnCount} .spz URLs found`);
    } catch (e) { uiLog(`HTML scan error: ${e.message}`); }

    // 3. Marble: log World ID but DO NOT probe broken 404/403 endpoints.
    //    World data is now captured via page fetch interception above.
    if (isMarble) {
      const worldMatch = location.pathname.match(/\/world\/([a-f0-9-]+)/);
      if (worldMatch) {
        const worldId = worldMatch[1];
        uiLog(`World ID: ${worldId}`);
        // hint: actual CDN prefix can be read from og:image meta (public)
        const og = document.querySelector('meta[property="og:image"]')?.content || "";
        if (og.includes("cdn.marble.worldlabs.ai")) uiLog(`CDN prefix hint: ${og.split("/").slice(0,5).join("/")}`);
        // no longer probing https://cdn.marble.../{worldId}/ (S3 403) or
        // unauthed https://api.worldlabs.ai/api/v1/objects/* (403)
        // — interception will fill once the page's authenticated world fetch completes
      }
    }

    // 4. Scan all script sources for .spz URLs (with timeout guard)
    let scriptCount = 0;
    const scripts = [...document.querySelectorAll("script[src]")].slice(0, 20);
    for (const script of scripts) {
      try {
        const res = await fetch(script.src, { signal: AbortSignal.timeout(4000) });
        const text = await res.text();
        const matches = text.matchAll(/["'](https?:\/\/[^"']*\.(spz|ply))["']/g);
        for (const m of matches) {
          if (!capturedUrls.has(m[1])) {
            capturedUrls.set(m[1], { name: m[1].split("/").pop().split("?")[0] });
            scriptCount++;
          }
        }
      } catch {}
    }
    if (scriptCount) uiLog(`Script scan: ${scriptCount} assets found`);
    else uiLog(`Script scan: 0 assets found`);

    // 5. Final perf re-scan after fetches
    scanPerformance();

    // 6. Enforce single-best spz + ensure 3-file bundle per scene
    pruneToSingleBestSpz();
    const hasJson = [...capturedUrls.values()].some(v => v.resolution === "json");
    const hasWebp = [...capturedUrls.values()].some(v => v.resolution === "webp");
    if (capturedUrls.size > 0) {
      if (!hasJson) {
        const wid = location.pathname.match(/\/world\/([a-f0-9-]+)/)?.[1] || "world";
        const title = document.querySelector('meta[property="og:title"]')?.content || document.title || wid;
        const spzList = [...capturedUrls.entries()].filter(([u,m])=> m.resolution && ["full","full_res","3M","500k","150k","100k","200k"].includes(m.resolution)).map(([u])=>u);
        if (spzList.length === 0 && capturedUrls.size>0) {
          for (const [u,m] of capturedUrls) if (u.includes(".spz") && !m.isJson) spzList.push(u);
        }
        const payload = JSON.stringify({ worldId: wid, title, spz_urls: spzList, capturedAt: new Date().toISOString(), source: location.href }, null, 2);
        // use canonical json key so we don't duplicate the API json
        const jUrl = `json://${wid}`;
        if (!capturedUrls.has(jUrl) && !hasJson) {
          capturedUrls.set(jUrl, { name: `${sanitizeFilename(title) || wid}.json`, resolution: "json", isJson: true, jsonData: payload });
          uiLog(`Fallback json: ${sanitizeFilename(title)}.json`);
        }
      }
      if (!hasWebp) {
        const og = document.querySelector('meta[property="og:image"]')?.content || "";
        let thumb = og.includes("cdn.marble.worldlabs.ai") ? og.split("?")[0] : "";
        if (thumb && !capturedUrls.has(thumb)) {
          capturedUrls.set(thumb, { name: thumb.split("/").pop().split("?")[0], resolution: "webp" });
          uiLog(`Fallback webp: ${thumb.split("/").pop()}`);
        }
      }
    }

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
      if (meta.isJson && meta.jsonData) {
        const blob = new Blob([meta.jsonData], { type: "application/json" });
        await saveBlob(blob, meta.name);
        done++;
        uiLog(`Saved json: ${meta.name}`);
      } else {
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
  //  PART 8: Auto-scan on load + periodic refresh
  // ══════════════════════════════════════════════════════════════════════════

  uiLog("Script initialized. Interceptor: injected");
  // also show perf immediately
  setTimeout(scanPerformance, 1000);

  // Wait for DOM then scan
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(manualScan, 2000));
  } else {
    setTimeout(manualScan, 2000);
  }

  // Periodic refresh
  setInterval(async () => {
    const dbItems = await dbGetAll();
    const perf = scanPerformance();
    const emb = scanEmbeddedJson();
    pruneToSingleBestSpz();
    const totalCount = capturedUrls.size + dbItems.filter(d => !capturedUrls.has(d.url)).length;
    if (totalCount > lastCount || perf || emb) refreshPanel();
  }, 3000);

  // For marble: also try fetching the world page content after a delay
  if (isMarble) {
    setTimeout(() => {
      uiLog("Delayed marble scan...");
      manualScan();
    }, 8000);
    setTimeout(manualScan, 15000);
  }
})();
