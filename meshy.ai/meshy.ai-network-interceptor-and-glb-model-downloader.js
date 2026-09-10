// ==UserScript==
// @name         Meshy GLB Downloader
// @namespace    https://github.com/meshy-dl
// @version      2.4
// @description  Download GLB/FBX/OBJ/STL/MESHY models, previews and textures from meshy.ai — marble-style panel with motion, grouping, and bulk save (icon drag + fix minimize/maximize)
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
      let name = url.split("/").pop().split("?")[0];
      // ?download=glb urls have no extension — name them properly
      if (url.includes("?download=")) {
        const fmt = (url.match(/[?&]download=([^&]+)/) || [])[1] || "glb";
        const slug = location.pathname.split("/").pop().split("?")[0].split("-")[0] || "model";
        name = `${sanitizeFilename(slug) || "model"}.${fmt}`;
      } else if (!name.includes(".")) name = name + ".bin";
      if (_onFileCaptured) _onFileCaptured(url, name, 0);
      else { if (!capturedUrls.has(url)) capturedUrls.set(url, { name }); if (_refreshPanel) _refreshPanel(); }
      if (_uiLog) _uiLog(`File: ${name.slice(0, 44)}`);
      log("page file:", name, url);
    }
    if (e.data.type === "API") {
      if (_onApiData) _onApiData(e.data.data, e.data.url);
      else log("early API", e.data.url, e.data.data);
      if (_uiLog) _uiLog(`API: ${String(e.data.url).split("/").pop().slice(0,50)} — ${Array.isArray(e.data.data) ? e.data.data.length + " items" : typeof e.data.data}`);
    }
    if (e.data.type === "API_TEXT") {
      const text = e.data.text || "";
      // catch glb, meshy, download=, cdn-models, assets.meshy
      const re = /https?:\/\/[^"'\s<>]+(?:\.glb|\.meshy|\?download=[a-z0-9]+|\/cdn-models\/[^"'\s<>]+|\/cdn-images\/[^"'\s<>]+\.(png|jpg|webp))(\?[^"'\s<>]*)?/gi;
      let m, cnt = 0;
      for (m of text.matchAll(re)) {
        const clean = m[0].replace(/\\u0026/g, "&").replace(/\\u002F/g, "/");
        let name = clean.split("/").pop().split("?")[0];
        if (clean.includes("?download=")) {
          const fmt = (clean.match(/[?&]download=([^&]+)/) || [])[1] || "glb";
          name = `${sanitizeFilename(location.pathname.split("/").pop().split("-")[0] || "model")}.${fmt}`;
        }
        if (!capturedUrls.has(clean)) {
          const tag = clean.includes("cdn-images") ? "preview" : (clean.includes(".meshy") ? "meshy" : "glb");
          capturedUrls.set(clean, { name, resolution: tag, fromText: true });
          cnt++;
        }
      }
      if (cnt) { if (_refreshPanel) _refreshPanel(); if (_uiLog) _uiLog(`Text scan: ${cnt} assets`); }
    }
  });

  // sanitize early for the message handler
  function sanitizeFilename(s) { return String(s).replace(/[^a-z0-9_\-]+/gi, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "model"; }

  function injectInterceptor() {
    // catch: .glb .meshy ?download= cdn-models assets.meshy modelUrl — unconditional JSON sniff
    const code = `(function(){
      const TAG='[MESHY-DL:INJECT]';
      const lg=(...a)=>console.log(TAG,...a);
      const isModelUrl = (u) => u && (u.includes('.glb')||u.includes('.meshy')||u.includes('download=')||u.includes('cdn-models')||u.includes('assets.meshy')||u.includes('cdn-images'));
      const isJsonHint = (t) => t && (t.includes('modelUrl')||t.includes('model_url')||t.includes('.glb')||t.includes('.meshy')||t.includes('download')||t.includes('cdn-models')||t.includes('previewImage'));
      lg('inject start', location.hostname+location.pathname);
      try{
        const _fetch=window.fetch.bind(window);
        window.fetch=async function(input, init){
          const url = typeof input==='string' ? input : (input && input.url) || '';
          const res = await _fetch(input, init);
          try{
            if(isModelUrl(url)){
              window.postMessage({source:'MESHY_DL_NET', type:'FILE', url}, '*');
            }
            if(res.ok){
              const ct=res.headers.get('content-type')||'';
              const clone=res.clone();
              if(ct.includes('json') || url.includes('/public/v2/') || url.includes('/api/') || url.includes('/tasks/')){
                clone.json().then(d=>{
                  const s=JSON.stringify(d);
                  if(isJsonHint(s) || isModelUrl(url)) window.postMessage({source:'MESHY_DL_NET', type:'API', data:d, url}, '*');
                  else if(url.includes('/public/v2/')) window.postMessage({source:'MESHY_DL_NET', type:'API', data:d, url}, '*');
                }).catch(()=>{
                  clone.text().then(t=>{
                    if(isJsonHint(t)||isModelUrl(t)){
                      try{ const d=JSON.parse(t); window.postMessage({source:'MESHY_DL_NET', type:'API', data:d, url}, '*'); }
                      catch{ window.postMessage({source:'MESHY_DL_NET', type:'API_TEXT', text:t, url}, '*'); }
                    }
                  }).catch(()=>{});
                });
              } else {
                clone.text().then(t=>{
                  if(isJsonHint(t)||isModelUrl(t)){
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
              if(isModelUrl(u)){
                window.postMessage({source:'MESHY_DL_NET', type:'FILE', url:u}, '*');
              }
              if(this.status>=200&&this.status<300){
                const ct=(this.getResponseHeader('content-type')||'');
                const txt=this.responseText||'';
                if(ct.includes('json')||txt.trim().startsWith('{')||txt.trim().startsWith('[')){
                  try{ const d=JSON.parse(txt); const s=JSON.stringify(d); if(isJsonHint(s)||isModelUrl(u)) window.postMessage({source:'MESHY_DL_NET', type:'API', data:d, url:u}, '*'); }catch{
                    if(isJsonHint(txt)||isModelUrl(txt)) window.postMessage({source:'MESHY_DL_NET', type:'API_TEXT', text:txt, url:u}, '*');
                  }
                } else if(isJsonHint(txt)||isModelUrl(txt)){
                  window.postMessage({source:'MESHY_DL_NET', type:'API_TEXT', text:txt, url:u}, '*');
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
      // glb, meshy, ?download=, cdn-models/assets
      const re = /https?:\/\/[^ \n\r"']+(?:\.glb|\.meshy|\?download=[a-z0-9_\-]+|cdn-models\/[^ \n\r"']+|assets\.meshy\.ai\/[^ \n\r"']+)(?:\?[^ \n\r"']*)?/gi;
      let m;
      for (m of obj.matchAll(re)) {
        let u = m[0].replace(/\\u0026/g, "&").replace(/\\u002F/g, "/");
        // trim trailing punctuation from JSON escaping
        u = u.replace(/[",\\]+$/, "");
        out.push(u);
      }
      // also catch contentUrl download links embedded as strings
      const dlRe = /https?:\/\/[^"'\s<>]+\?download=[a-z0-9_\-]+/gi;
      for (m of obj.matchAll(dlRe)) out.push(m[0].replace(/\\u0026/g, "&"));
      return out;
    }
    if (Array.isArray(obj)) { obj.forEach(i => findModelUrls(i, out)); return out; }
    if (typeof obj === "object") {
      for (const k in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
        const v = obj[k];
        const lk = k.toLowerCase();
        const isModelKey = lk.includes("modelurl") || lk === "glb_url" || lk === "contenturl" || lk === "model_url" || lk === "quadjsonurl" || lk === "base_model_url";
        if (isModelKey && typeof v === "string" && v.startsWith("http")) {
          out.push(v.replace(/\\u0026/g, "&").replace(/\\u002F/g, "/"));
        } else if (typeof v === "string" && v.startsWith("http") && (v.includes(".glb") || v.includes(".meshy") || v.includes("?download=") || v.includes("cdn-models") || v.includes("assets.meshy"))) {
          out.push(v.replace(/\\u0026/g, "&").replace(/\\u002F/g, "/"));
        } else if (typeof v === "string" && v.includes("http") && v.includes("cdn-images") && v.includes("preview")) {
          // preview images alongside models — also useful
          out.push(v.replace(/\\u0026/g, "&"));
        } else {
          findModelUrls(v, out);
        }
      }
    }
    return out;
  }

  // sanitize already defined above for early handler — keep alias if needed
  // function sanitizeFilename(s) { ... } — defined at top

  function extTag(url, meta) {
    if (meta && meta.resolution) return meta.resolution;
    if (url.includes("?download=")) {
      const fmt = (url.match(/[?&]download=([^&]+)/) || [])[1] || "";
      if (fmt) return fmt.toLowerCase(); // glb, fbx, obj, stl, usdz
    }
    const base = (url.split("/").pop() || "").split("?")[0].toLowerCase();
    if (base.endsWith(".glb")) return "glb";
    if (base.endsWith(".meshy")) return "meshy";
    if (base.endsWith(".gltf")) return "gltf";
    if (base.endsWith(".usdz")) return "usdz";
    if (base.endsWith(".fbx")) return "fbx";
    if (base.endsWith(".obj")) return "obj";
    if (base.endsWith(".stl")) return "stl";
    if (base.endsWith(".png") || base.endsWith(".jpg") || base.endsWith(".jpeg") || base.endsWith(".webp")) return "preview";
    if (base.endsWith(".json")) return "json";
    if (url.includes("cdn-models") || url.includes("assets.meshy")) return "meshy";
    return "other";
  }

  // capture preview + json alongside glb (handles both camelCase and snake_case + showcase shape)
  function addAuxForTask(task) {
    const meta = task || {};
    const title = meta.prompt || meta.name || meta.display_name || meta.title || meta.objectPrompt || meta.slug || "";
    const candidates = [
      meta.thumbnailUrl, meta.thumbnail_url, meta.previewImage, meta.preview_image, meta.previewImageUrl,
      meta.preview_url, meta.image_url, meta.rendered_image, meta.thumbnailNoBgUrl, meta.solidThumbnailUrl,
      meta.coverPortrait, meta.ssrPosterUrl, meta.previewLogoImage
    ];
    for (const preview of candidates) {
      if (preview && typeof preview === "string" && preview.startsWith("http") && !capturedUrls.has(preview)) {
        let name = preview.split("/").pop().split("?")[0];
        if (!name || !name.includes(".")) name = `${sanitizeFilename(title) || "preview"}_preview.png`;
        capturedUrls.set(preview, { name, resolution: "preview" });
        log(" + preview ->", name);
      }
    }
    // texture maps
    const texKeys = ["pbr_url", "texture_url", "albedo_url", "colorMapUrl", "metallicMapUrl", "roughnessMapUrl", "normalMapUrl"];
    for (const k of texKeys) {
      if (typeof meta[k] === "string" && meta[k].startsWith("http") && !capturedUrls.has(meta[k])) {
        capturedUrls.set(meta[k], { name: meta[k].split("/").pop().split("?")[0], resolution: "texture" });
      }
    }
    // showcase textureUrls array
    if (Array.isArray(meta.textureUrls)) {
      for (const tu of meta.textureUrls) {
        for (const v of Object.values(tu)) if (typeof v === "string" && v.startsWith("http") && !capturedUrls.has(v)) {
          capturedUrls.set(v, { name: v.split("/").pop().split("?")[0], resolution: "texture" });
        }
      }
    }
    // model.json / quad json
    for (const k of ["quadJsonUrl", "quad_json_url", "modelJsonUrl", "quadJson"]) {
      if (typeof meta[k] === "string" && meta[k].startsWith("http") && !capturedUrls.has(meta[k])) {
        capturedUrls.set(meta[k], { name: meta[k].split("/").pop().split("?")[0] || "model.json", resolution: "json" });
      }
    }
    // base modelUrl if .meshy/.glb
    if (typeof meta.modelUrl === "string" && meta.modelUrl.startsWith("http") && !capturedUrls.has(meta.modelUrl)) {
      let name = meta.modelUrl.split("/").pop().split("?")[0] || `${sanitizeFilename(title) || "model"}.meshy`;
      capturedUrls.set(meta.modelUrl, { name, resolution: extTag(meta.modelUrl, null) });
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
      const rawUrls = findModelUrls(data);
      // de-dupe raw
      const urls = Array.from(new Set(rawUrls));
      let added = 0;
      for (const u of urls) {
        if (!capturedUrls.has(u)) {
          let name = u.split("/").pop().split("?")[0];
          if (!name || name.includes("3d-models")) {
            // fallback for ?download= links: use slug + format
            const fmt = (u.match(/[?&]download=([^&]+)/) || [])[1] || extTag(u, null) || "glb";
            const slug = (() => {
              try { const p = new URL(u).pathname.split("/").pop() || location.pathname.split("/").pop() || "model"; return p.split("?")[0].split("-")[0]; } catch { return "model"; }
            })();
            name = `${sanitizeFilename(slug) || "model"}.${fmt}`;
            if (name.startsWith(".")) name = "model." + fmt;
          }
          if (u.includes("?download=") && !name.includes(".")) {
            const fmt = (u.match(/[?&]download=([^&]+)/) || [])[1] || "glb";
            name = name + "." + fmt;
          }
          const tag = extTag(u, null);
          capturedUrls.set(u, { name, resolution: tag });
          added++;
          log(" +", tag, name, "via", String(srcUrl).split("/").slice(-2).join("/"));
        }
      }
      // also catch auxiliary assets per-task
      const tasks = Array.isArray(data) ? data : (data?.data && Array.isArray(data.data) ? data.data : (data?.result ? [data.result] : [data]));
      for (const t of tasks) {
        if (t && typeof t === "object") {
          addAuxForTask(t);
          // nested common shapes
          if (t?.task && typeof t.task === "object") addAuxForTask(t.task);
          if (t?.model && typeof t.model === "object") addAuxForTask(t.model);
          if (t?.showcase && typeof t.showcase === "object") addAuxForTask(t.showcase);
          // legacy showcase-data shape: keys with showcase-data
          for (const v of Object.values(t)) if (v && typeof v === "object" && (v.modelUrl || v.previewImage || v.textureUrls)) addAuxForTask(v);
        }
      }
      // also add explicit download links for showcase pages (they may not be in JSON stringify path)
      try {
        const s = JSON.stringify(data);
        const dlRe = /https?:\/\/[^"']+\?download=(glb|fbx|obj|stl|usdz|gltf)/gi;
        let m;
        for (m of s.matchAll(dlRe)) {
          const u = m[0].replace(/\\u0026/g, "&");
          if (!capturedUrls.has(u)) {
            const fmt = m[1].toLowerCase();
            const slug = location.pathname.split("/").pop().split("?")[0].split("-").slice(0,2).join("-") || "model";
            const name = `${sanitizeFilename(slug) || "model"}.${fmt}`;
            capturedUrls.set(u, { name, resolution: fmt });
            added++;
          }
        }
      } catch {}
      if (added || urls.length) refreshPanel();
      if (added) uiLog(`API captured ${added} new (${urls.length} total) from ${String(srcUrl).split("/").pop().slice(0,30)}`);
    } catch (e) { log("onApiData error:", e.message); uiLog("API parse err: " + e.message); }
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
    #meshy-dl-panel{position:fixed;bottom:20px;right:20px;z-index:99999;font-family:system-ui,-apple-system,sans-serif;font-size:13px;background:rgba(14,16,22,.96);color:#e8eefc;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.55),0 0 0 1px rgba(124,140,255,.12);backdrop-filter:blur(16px);width:390px;max-height:86vh;overflow:hidden;border:1px solid rgba(255,255,255,.06);animation:meshFadeIn .35s cubic-bezier(.16,1,.3,1);transition:width .2s ease,height .2s ease,border-radius .2s ease}
    #meshy-dl-panel.minimized{width:54px;height:54px;border-radius:50%;cursor:grab;overflow:hidden;box-shadow:0 6px 20px rgba(0,0,0,.45);animation:meshFadeIn .35s cubic-bezier(.16,1,.3,1), meshBob 2.8s ease-in-out infinite}
    #meshy-dl-panel.minimized:active{cursor:grabbing}
    #meshy-dl-panel.minimized:hover{transform:scale(1.06)}
    #meshy-dl-panel.minimized #meshy-dl-body,#meshy-dl-panel.minimized #meshy-dl-acts{display:none}
    #meshy-dl-panel.minimized #meshy-dl-header{padding:0;justify-content:center;align-items:center;height:54px;width:54px;border:none;cursor:grab;background:transparent}
    #meshy-dl-panel.minimized #meshy-dl-header:active{cursor:grabbing}
    #meshy-dl-panel.minimized #meshy-dl-title{display:none}
    #meshy-dl-panel.minimized #meshy-dl-clear{display:none}
    #meshy-dl-panel.minimized .meshy-hdr-btns{width:54px;height:54px;display:flex;align-items:center;justify-content:center;gap:0}
    #meshy-dl-panel.minimized #meshy-dl-toggle{margin:0;width:54px;height:54px;border-radius:50%;font-size:20px;display:flex;align-items:center;justify-content:center;animation:meshPulse 2.2s ease-in-out infinite, meshSpin 3s linear infinite;cursor:grab;background:none;border:none}
    #meshy-dl-panel.minimized #meshy-dl-toggle:active{cursor:grabbing}
    #meshy-dl-panel.minimized #meshy-dl-toggle:hover{background:rgba(124,140,255,.12);animation-play-state:paused}
    @keyframes meshBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
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

  // Drag — expanded: header drag (not buttons). minimized: whole circle + icon drag, click vs drag distinguished via dragMoved
  let dragging = false, dx = 0, dy = 0, dragMoved = false;
  function startDrag(e) {
    const isMin = panel.classList.contains("minimized");
    if (!isMin && e.target.closest("button")) return;
    dragging = true; dragMoved = false;
    const r = panel.getBoundingClientRect();
    dx = e.clientX - r.left; dy = e.clientY - r.top;
    panel.style.transition = "none";
    e.preventDefault();
  }
  $("#meshy-dl-header").addEventListener("mousedown", startDrag);
  panel.addEventListener("mousedown", (e) => {
    if (!panel.classList.contains("minimized")) return;
    if (e.target === panel || e.target.closest("button") || e.target.closest("#meshy-dl-header")) startDrag(e);
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    dragMoved = true;
    panel.style.left = (e.clientX - dx) + "px";
    panel.style.top = (e.clientY - dy) + "px";
    panel.style.right = "auto"; panel.style.bottom = "auto";
  });
  document.addEventListener("mouseup", () => {
    if (dragging) setTimeout(() => dragMoved = false, 100);
    dragging = false; panel.style.transition = "";
  });

  function setMinimized(min) {
    const isMin = panel.classList.toggle("minimized", min);
    const btn = $("#meshy-dl-toggle");
    if (btn) btn.textContent = isMin ? "◈" : "—";
    log(isMin ? "minimized" : "restored");
    if (_uiLog) _uiLog(isMin ? "Minimized → click circle to restore" : "Restored");
    return isMin;
  }
  $("#meshy-dl-toggle").addEventListener("click", (e) => {
    if (dragMoved) { e.preventDefault(); e.stopPropagation(); return; }
    e.preventDefault(); e.stopPropagation();
    setMinimized(!panel.classList.contains("minimized"));
  });
  panel.addEventListener("click", (e) => {
    if (!panel.classList.contains("minimized")) return;
    if (dragMoved) return;
    if (e.target.closest("#meshy-dl-toggle")) return; // button already handled
    setMinimized(false);
  });
  $("#meshy-dl-header").addEventListener("dblclick", (e) => {
    if (e.target.closest("button")) return;
    if (panel.classList.contains("minimized")) return;
    setMinimized(true);
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
    const order = ["glb", "meshy", "fbx", "obj", "stl", "gltf", "usdz", "preview", "texture", "json", "other"];
    const sorted = Object.entries(groups).sort((a, b) => {
      const ai = order.indexOf(a[0]), bi = order.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    for (const [res, items] of sorted) {
      const sec = document.createElement("div");
      sec.className = "meshy-sec";
      const tagCls = (res === "glb" || res === "meshy" || ["fbx","obj","stl","gltf","usdz"].includes(res)) ? "tg-glb" : res === "preview" ? "tg-preview" : res === "texture" ? "tg-texture" : "tg-other";
      const labelMap = { glb:"glb — 3d model", meshy:"meshy — native", fbx:"fbx", obj:"obj", stl:"stl", gltf:"gltf", usdz:"usdz", preview:"preview — thumbnail", texture:"texture — pbr", json:"json" };
      const label = labelMap[res] || res;
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
        const isModel = r.name.includes(".glb") || r.name.includes(".meshy") || r.name.includes("?download=") || r.name.includes("cdn-models") || r.name.includes("assets.meshy");
        if (isModel && !capturedUrls.has(r.name)) {
          const tag = extTag(r.name, null);
          let name = r.name.split("/").pop().split("?")[0];
          if (!name || name.includes("-")) name = r.name.split("/").pop().split("?")[0] || "model." + tag;
          capturedUrls.set(r.name, { name, resolution: tag, fromPerf: true });
          cnt++;
        }
      }
      if (cnt) uiLog(`Perf scan: ${cnt} assets`);
      return cnt;
    } catch { return 0; }
  }

  function scanEmbeddedJson() {
    try {
      const html = document.documentElement.outerHTML;
      // comprehensive regex: glb, meshy, download=, cdn-models
      const re = /https?:\/\/[^"'\s<>]+(?:\.glb|\.meshy|\?download=[a-z0-9_\-]+|cdn-models\/[^"'\s<>]+|assets\.meshy\.ai\/[^"'\s<>]+)(?:\?[^"'\s<>]*)?/gi;
      let m, cnt = 0;
      for (m of html.matchAll(re)) {
        const clean = m[0].replace(/\\u0026/g, "&").replace(/\\u002F/g, "/");
        let name = clean.split("/").pop().split("?")[0];
        if (clean.includes("?download=")) {
          const fmt = (clean.match(/[?&]download=([^&]+)/) || [])[1] || "glb";
          name = `${sanitizeFilename(location.pathname.split("/").pop().split("-")[0] || "model")}.${fmt}`;
        }
        if (!capturedUrls.has(clean)) { capturedUrls.set(clean, { name, resolution: extTag(clean, null), fromHtml: true }); cnt++; }
      }
      // ld+json explicit encodings
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const j = JSON.parse(s.textContent);
          const hits = findModelUrls(j);
          for (const u of hits) if (!capturedUrls.has(u)) {
            const tag = extTag(u, null);
            let name = u.split("/").pop().split("?")[0];
            if (u.includes("?download=")) {
              const fmt = (u.match(/[?&]download=([^&]+)/) || [])[1] || tag;
              name = `${sanitizeFilename(location.pathname.split("/").pop().split("-")[0] || "model")}.${fmt}`;
            }
            capturedUrls.set(u, { name, resolution: tag, fromLd: true }); cnt++;
          }
          // direct encoding array
          if (j.encoding && Array.isArray(j.encoding)) {
            for (const enc of j.encoding) if (enc.contentUrl && !capturedUrls.has(enc.contentUrl)) {
              const fmt = (enc.encodingFormat || enc.name || "glb").toLowerCase().replace(/.*\//, "");
              const mapped = enc.contentUrl;
              // ensure fmt matches url param
              let name = mapped.split("/").pop().split("?")[0];
              if (mapped.includes("?download=")) {
                const f = (mapped.match(/[?&]download=([^&]+)/) || [])[1] || fmt;
                name = `${sanitizeFilename(location.pathname.split("/").pop().split("-")[0] || "model")}.${f}`;
              }
              capturedUrls.set(mapped, { name, resolution: extTag(mapped, null) }); cnt++;
            }
          }
        } catch {}
      }
      for (const s of document.querySelectorAll("script")) {
        const t = s.textContent || "";
        if (!t.includes(".glb") && !t.includes(".meshy") && !t.includes("modelUrl") && !t.includes("download") && !t.includes("cdn-models")) continue;
        for (m of t.matchAll(re)) {
          const clean = m[0].replace(/\\u0026/g, "&").replace(/\\u002F/g, "/");
          let name = clean.split("/").pop().split("?")[0];
          if (clean.includes("?download=")) {
            const fmt = (clean.match(/[?&]download=([^&]+)/) || [])[1] || "glb";
            name = `${sanitizeFilename(location.pathname.split("/").pop().split("-")[0] || "model")}.${fmt}`;
          }
          if (!capturedUrls.has(clean)) { capturedUrls.set(clean, { name, resolution: extTag(clean, null), fromScript: true }); cnt++; }
        }
        const urls = findModelUrls(t);
        for (const u of urls) if (!capturedUrls.has(u)) {
          let name = u.split("/").pop().split("?")[0];
          if (u.includes("?download=")) {
            const fmt = (u.match(/[?&]download=([^&]+)/) || [])[1] || extTag(u, null);
            name = `${sanitizeFilename(location.pathname.split("/").pop().split("-")[0] || "model")}.${fmt}`;
          }
          capturedUrls.set(u, { name, resolution: extTag(u, null) }); cnt++;
        }
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
        const isModel = u.includes(".glb") || u.includes(".meshy") || u.includes("?download=") || u.includes("cdn-models") || u.includes("assets.meshy");
        if (isModel && !capturedUrls.has(u)) {
          const tag = extTag(u, null);
          let name = u.split("/").pop().split("?")[0];
          if (u.includes("?download=")) {
            const fmt = (u.match(/[?&]download=([^&]+)/) || [])[1] || tag;
            name = `${sanitizeFilename(location.pathname.split("/").pop().split("-")[0] || "model")}.${fmt}`;
          }
          capturedUrls.set(u, { name, resolution: tag });
          domCount++;
        }
      } catch {}
    }
    if (domCount) uiLog(`DOM scan: ${domCount} assets`);

    // scan globals (__NEXT_DATA__ holds fallback for showcase pages)
    try {
      const globals = [window.__INITIAL_STATE__, window.__STATE__, window.appState, window.__APP_STATE__, window.__NEXT_DATA__];
      // also try to parse __next_f pushed data from script tags (fallback data is in self.__next_f)
      // we already scan script contents, but also check next data object
      for (const g of globals) if (g) {
        const urls = findModelUrls(g);
        let gc = 0;
        for (const u of urls) if (!capturedUrls.has(u)) {
          const tag = extTag(u, null);
          let name = u.split("/").pop().split("?")[0];
          if (u.includes("?download=")) {
            const fmt = (u.match(/[?&]download=([^&]+)/) || [])[1] || tag;
            name = `${sanitizeFilename(location.pathname.split("/").pop().split("-")[0] || "model")}.${fmt}`;
          }
          capturedUrls.set(u, { name, resolution: tag }); gc++;
        }
        if (gc) uiLog(`Global scan: ${gc} assets`);
      }
    } catch {}

    // direct download links for showcase: always synthesize from current URL if on 3d-models page
    try {
      const isShowcase = location.pathname.includes("/3d-models/");
      if (isShowcase) {
        const base = location.href.split("?")[0];
        const fmts = ["glb", "fbx", "obj", "stl", "usdz"];
        let sc = 0;
        for (const fmt of fmts) {
          const dl = `${base}?download=${fmt}`;
          if (!capturedUrls.has(dl)) {
            const slug = location.pathname.split("/").pop().split("?")[0].split("-")[0] || "model";
            const name = `${sanitizeFilename(slug) || "model"}.${fmt}`;
            // we add as hint — will be validated on click via GM fetch (server returns file or 404 if not owned)
            capturedUrls.set(dl, { name, resolution: fmt, isDownloadHint: true });
            sc++;
          }
        }
        if (sc) uiLog(`Showcase direct links: ${sc} (glb/fbx/obj/stl/usdz)`);
      }
    } catch {}

    // fetch visible task ids from URL and DOM hints — broadened
    try {
      const hints = [...document.documentElement.innerHTML.matchAll(/https?:\/\/[^"'\s<>]+(?:\.glb|\.meshy|\?download=[a-z0-9]+)/gi)].map(m=>m[0]);
      let hc = 0;
      for (const h of hints) {
        const clean = h.replace(/\\u0026/g, "&").replace(/\\u002F/g, "/");
        if (!capturedUrls.has(clean)) {
          const tag = extTag(clean, null);
          let name = clean.split("/").pop().split("?")[0];
          if (clean.includes("?download=")) {
            const fmt = (clean.match(/[?&]download=([^&]+)/) || [])[1] || tag;
            name = `${sanitizeFilename(location.pathname.split("/").pop().split("-")[0] || "model")}.${fmt}`;
          }
          capturedUrls.set(clean, { name, resolution: tag, fromHtml: true }); hc++;
        }
      }
      if (hc) uiLog(`HTML CDN scan: ${hc} assets`);
    } catch {}

    // also pull from JSON-LD encodings if present
    try {
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        const j = JSON.parse(s.textContent);
        if (j.encoding) {
          let jc = 0;
          for (const enc of j.encoding) if (enc.contentUrl && !capturedUrls.has(enc.contentUrl)) {
            const tag = extTag(enc.contentUrl, null);
            let name = enc.contentUrl.split("/").pop().split("?")[0];
            if (enc.contentUrl.includes("?download=")) {
              const fmt = (enc.contentUrl.match(/[?&]download=([^&]+)/) || [])[1] || tag;
              name = `${sanitizeFilename(location.pathname.split("/").pop().split("-")[0] || "model")}.${fmt}`;
            }
            capturedUrls.set(enc.contentUrl, { name, resolution: tag }); jc++;
          }
          if (jc) uiLog(`LD+JSON: ${jc} encodings`);
        }
      }
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
