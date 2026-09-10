// ==UserScript==
// @name         World Labs 3D Asset Downloader
// @namespace    https://github.com/worldlabs-dl
// @version      4.6
// @description  Download 3D models, gaussian splats, and textures from worldlabs.ai and marble.worldlabs.ai — now captures homepage splats (wlt-ai-cdn.art) after click to explore
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
// @connect      wlt-ai-cdn.art
// @connect      api.worldlabs.ai
// @connect      www.worldlabs.ai
// ==/UserScript==

(function () {
  "use strict";

  const isMarble = location.hostname === "marble.worldlabs.ai";
  const isHome = (location.hostname === "www.worldlabs.ai" || location.hostname === "worldlabs.ai") && (location.pathname === "/" || location.pathname === "");
  const TAG = "[WL-DL]";
  const log = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);
  const err = (...a) => console.error(TAG, ...a);

  log("Script loaded on", location.hostname + location.pathname, { isMarble, isHome });

  // homepage splats — extracted from app/page-9aac0f...js l=[...] 2026-09-04
  // covers the "click to explore" world explorer on /
  const HOMEPAGE_SPLATS = [
    { id: 5, name: "Autumn",       image: "/textures/splats/autumn-prompt-360.webp",       url_100k: "https://wlt-ai-cdn.art/homepage/2026-09-04/models/splats/autumn-100k.spz",       url_500k: "https://wlt-ai-cdn.art/homepage/2026-09-04/models/splats/autumn-500k.spz",       position: [0.5, 0.5, 1],   rotation: [Math.PI, 0, 0], offset: [0, 0, -1],  cameraRadius: 3.5, radius: 350,  duration: 5 },
    { id: 1, name: "Amphitheater", image: "/textures/splats/amphitheater-prompt-360.webp", url_100k: "https://wlt-ai-cdn.art/homepage/2026-09-04/models/splats/amphitheater-100k.spz", url_500k: "https://wlt-ai-cdn.art/homepage/2026-09-04/models/splats/amphitheater-500k.spz", position: [0, -2, 10],  rotation: [Math.PI, 0, 0], offset: [0, 0, -2],  cameraRadius: 8,   radius: 400,  duration: null },
    { id: 2, name: "Town",         image: "/textures/splats/town-prompt-360.webp",         url_100k: "https://wlt-ai-cdn.art/homepage/2026-09-04/models/splats/town-100k.spz",         url_500k: "https://wlt-ai-cdn.art/homepage/2026-09-04/models/splats/town-500k.spz",         position: [-1, 1, 8],   rotation: [Math.PI, 0, 0], offset: [0, 0, -0.5], cameraRadius: 2.5, radius: 1200, duration: 4 },
    { id: 3, name: "Garden",       image: "/textures/splats/garden-prompt-360.webp",       url_100k: "https://wlt-ai-cdn.art/homepage/2026-09-04/models/splats/garden-100k.spz",       url_500k: "https://wlt-ai-cdn.art/homepage/2026-09-04/models/splats/garden-500k.spz",       position: [0, 0, 6],     rotation: [Math.PI, 0, 0], offset: [0, 0, -2],  cameraRadius: 3,   radius: 250,  duration: 5 },
    { id: 4, name: "Bath",         image: "/textures/splats/bath-prompt-360.webp",         url_100k: "https://wlt-ai-cdn.art/homepage/2026-09-04/models/splats/bath-100k.spz",         url_500k: "https://wlt-ai-cdn.art/homepage/2026-09-04/models/splats/bath-500k.spz",         position: [0, 0, 7],     rotation: [Math.PI, 0, 0], offset: [0, 0, -1.5], cameraRadius: 8,   radius: 100,  duration: 5.5 },
    { id: 6, name: "Train",        image: "/textures/splats/anime-train-prompt-360.webp",  url_100k: "https://wlt-ai-cdn.art/homepage/2026-09-04/models/splats/anime-train-100k.spz",  url_500k: "https://wlt-ai-cdn.art/homepage/2026-09-04/models/splats/anime-train-500k.spz",  position: [0, 0, 10],    rotation: [Math.PI, 0, 0], offset: [0, 0, -2],  cameraRadius: 4.5, radius: 400,  duration: null },
  ];
  const HOMEPAGE_EXTRA = [
    { name: "machine", url: "/models/machine.glb", hint: "hero 3d" },
    { name: "hatching", url: "/textures/hatching.webp" },
    { name: "machine-texture", url: "/textures/machine-texture.webp" },
  ];

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
      const res = url.includes("500k") ? "500k" : url.includes("100k") ? "100k" : url.endsWith(".glb") ? "glb" : undefined;
      if (!capturedUrls.has(url)) {
        if (_onFileCaptured) _onFileCaptured(url, name, 0);
        else capturedUrls.set(url, { name, resolution: res });
        if (_refreshPanel) _refreshPanel();
      }
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
      // extract any spz urls hidden in non-JSON text (e.g. streaming) — marble + wlt homepage
      const re = /https:\/\/(?:cdn\.marble\.worldlabs\.ai|wlt-ai-cdn\.art)\/[^"'\s<>]+\.spz/g;
      const reAny = /https:\/\/[^"'\s<>]+\.spz/g;
      let m, cnt = 0;
      for (m of text.matchAll(re)) {
        if (!capturedUrls.has(m[0])) { capturedUrls.set(m[0], { name: m[0].split("/").pop().split("?")[0], fromText: true }); cnt++; }
      }
      for (m of text.matchAll(reAny)) {
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
            if(url.includes('.spz')||url.includes('.ply')||url.includes('.glb')||url.includes('wlt-ai-cdn.art')){
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
              if(u.includes('.spz')||u.includes('.ply')||u.includes('.glb')||u.includes('wlt-ai-cdn.art')){
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
    if (isHome) {
      // homepage has 6 distinct splats (autumn, town, ...) — keep best per splat base, not globally 1
      // base = filename without quality suffix (-100k / -500k) e.g. autumn-100k.spz -> autumn
      const byBase = new Map();
      for (const [url, meta] of spzEntries) {
        const file = url.split("/").pop().split("?")[0]; // autumn-100k.spz
        const base = file.replace(/[-_](100k|500k|150k|200k|3m|full|full_res)\.spz$/i, ".spz").replace(/\.spz$/i, "");
        const key = base.toLowerCase();
        if (!byBase.has(key)) byBase.set(key, []);
        byBase.get(key).push({ url, key: meta.resolution });
      }
      let pruned = 0;
      for (const [base, group] of byBase) {
        if (group.length <= 1) continue;
        const best = pickBest(group);
        if (!best) continue;
        for (const g of group) if (g.url !== best.url) { capturedUrls.delete(g.url); pruned++; }
      }
      if (pruned) log(`prune homepage: kept best per splat, removed ${pruned}`);
      return;
    }
    // marble single-world: keep only the globally best spz (1 spz per scene as user expects: 1 spz +1 json +1 webp = 3 files)
    const best = pickBest(spzEntries.map(([u,m]) => ({ url: u, key: m.resolution })));
    if (!best) return;
    for (const [u] of spzEntries) if (u !== best.url) capturedUrls.delete(u);
  }

  // ── homepage helpers ──
  function homepageBaseForUrl(url) {
    try {
      const file = url.split("/").pop().split("?")[0];
      return file.replace(/[-_](100k|500k|150k|200k|3m|full|full_res)\.spz$/i, "").replace(/\.spz$/i, "") || "home";
    } catch { return "home"; }
  }
  function ensureHomepageEntry(url, resolution) {
    if (capturedUrls.has(url)) return false;
    const base = homepageBaseForUrl(url);
    const is500 = url.includes("500k");
    const res = resolution || (is500 ? "500k" : "100k");
    const name = url.split("/").pop().split("?")[0];
    capturedUrls.set(url, { name, resolution: res, fromHome: true, base });
    log(` + home ${res} -> ${name}`);
    return true;
  }
  function captureHomepageScenes(forceAll = false) {
    if (!isHome) return 0;
    let added = 0;
    // always add the 6 splat urls (both qualities) as discoverable assets — they are static public CDN
    for (const s of HOMEPAGE_SPLATS) {
      if (ensureHomepageEntry(s.url_100k, "100k")) added++;
      if (ensureHomepageEntry(s.url_500k, "500k")) added++;
      // per-splat json + thumbnail (no dedupe collision with marble's per-worldId)
      const safe = sanitizeFilename(s.name);
      const baseKey = `home://${safe.toLowerCase()}`;
      const jsonUrl = `json://home-${safe.toLowerCase()}`;
      if (!capturedUrls.has(jsonUrl)) {
        const stub = {
          position: s.position,
          rotation: s.rotation,
          offset: s.offset,
          cameraRadius: s.cameraRadius,
          radius: s.radius ?? null,
          duration: s.duration ?? null,
        };
        capturedUrls.set(jsonUrl, { name: `${safe}.json`, resolution: "json", isJson: true, jsonData: JSON.stringify(stub, null, 2), fromHome: true });
        added++;
        log(` + home json -> ${safe}.json`);
      }
      if (s.image) {
        const imgUrl = s.image.startsWith("http") ? s.image : new URL(s.image, location.origin).href;
        if (!capturedUrls.has(imgUrl)) {
          const iname = s.image.split("/").pop().split("?")[0] || `${safe}.webp`;
          capturedUrls.set(imgUrl, { name: iname, resolution: "webp", fromHome: true });
          added++;
        }
      }
    }
    // also add hero machine.glb + textures if present on this page
    for (const ex of HOMEPAGE_EXTRA) {
      const href = ex.url.startsWith("http") ? ex.url : new URL(ex.url, location.origin).href;
      if (!capturedUrls.has(href)) {
        const name = ex.url.split("/").pop().split("?")[0];
        const res = ex.url.endsWith(".glb") ? "glb" : "webp";
        capturedUrls.set(href, { name, resolution: res, fromHome: true });
        added++;
      }
    }
    if (added) log(`homepage seed: +${added} (forceAll=${forceAll})`);
    // also scan DOM preload links for wlt-ai-cdn (they may already be captured above but keep for future seasons)
    try {
      const html = document.documentElement.outerHTML;
      const re = /https:\/\/wlt-ai-cdn\.art\/[^"'\s<>]+\.(spz|glb|webp)/g;
      let m, cnt = 0;
      for (m of html.matchAll(re)) {
        if (!capturedUrls.has(m[0])) {
          const isSpz = m[0].endsWith(".spz");
          const res = isSpz ? (m[0].includes("500k") ? "500k" : "100k") : (m[0].endsWith(".glb") ? "glb" : "webp");
          capturedUrls.set(m[0], { name: m[0].split("/").pop().split("?")[0], resolution: res, fromHtml: true });
          cnt++;
        }
      }
      if (cnt) { added += cnt; log(`homepage html scan: +${cnt}`); }
    } catch {}
    return added;
  }

  function onFileCaptured(url, name, size) {
    if (!capturedUrls.has(url)) {
      capturedUrls.set(url, { name, size, fromPage: true });
      refreshPanel();
    }
  }
  _onFileCaptured = onFileCaptured;

  function sanitizeFilename(s) { return String(s).replace(/[^a-z0-9_\-]+/gi, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "world"; }

  // Flat view-config stub for imgvault scene upload. The raw world API object
  // has NO camera fields, so uploading it as the config silently does nothing
  // in the viewer — the stub (minimap_metadata as position) is the file to
  // upload and tweak. Mirrors worldlabs-downloader.mjs --marble behavior.
  function buildViewStub(world) {
    let mmPos = null;
    try {
      const mm = world?.generation_output?.minimap_metadata ?? world?.minimap_metadata;
      const arr = typeof mm === "string" ? JSON.parse(mm) : mm;
      if (Array.isArray(arr) && arr.length === 3 && arr.every((n) => Number.isFinite(n))) mmPos = arr;
    } catch {}
    return {
      position: mmPos || [0, 0, 8],
      rotation: [Math.PI, 0, 0],
      offset: [0, 0, 0],
      cameraRadius: mmPos ? Math.round(Math.hypot(...mmPos) * 10) / 10 : 8,
      radius: null,
      duration: null,
    };
  }

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
    // 1) raw world API dump — reference only, NEVER an upload config
    //    (it has no camera fields; uploading it silently does nothing)
    const safeBase = sanitizeFilename(displayName) || baseName;
    const dumpUrl = `worldjson://${baseName}`;
    if (!capturedUrls.has(dumpUrl)) {
      capturedUrls.set(dumpUrl, { name: `${safeBase}.world.json`, resolution: "worldjson", isJson: true, jsonData: JSON.stringify(world, null, 2), worldId });
      log("  + world dump ->", `${safeBase}.world.json`, "(reference only)");
    }
    // 2) flat view-config stub — upload THIS as the scene config file
    const jsonUrl = `json://${baseName}`;
    if (!capturedUrls.has(jsonUrl)) {
      const stub = buildViewStub(world);
      capturedUrls.set(jsonUrl, { name: `${safeBase}.json`, resolution: "json", isJson: true, jsonData: JSON.stringify(stub, null, 2), worldId });
      log("  + config stub ->", `${safeBase}.json`, "(upload this)");
    }
    // 3) webp thumbnail — prefer rendered thumbnail, NOT cond_image_url
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
      <h3>${isMarble ? "Marble" : isHome ? "Home" : "WorldLabs"} DL</h3>
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
      $("#wl-dl-status").textContent = "No captures yet — " + (isHome ? "click 'Click to explore' or Scan" : isMarble ? "interact or wait for world load" : "scanning...");
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
        : item.name.endsWith(".ply") ? "PLY"
        : item.name.endsWith(".glb") ? "glb"
        : item.name.endsWith(".webp") ? "webp"
        : "other");
      if (!groups[res]) groups[res] = [];
      groups[res].push(item);
    }

    const order = ["full", "full_res", "3M", "500k", "200k", "150k", "100k", "PLY", "glb", "json", "webp", "input", "other"];
    const sorted = Object.entries(groups).sort((a, b) => {
      const ai = order.indexOf(a[0]), bi = order.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    for (const [res, items] of sorted) {
      const sec = document.createElement("div");
      sec.className = "wl-dl-sec";
      const tagCls = ["full", "3M", "full_res"].includes(res) ? "tg-hi" : res === "500k" ? "tg-mid" : res === "PLY" ? "tg-ply" : res === "glb" ? "tg-ply" : (res === "json" ? "tg-mid" : (res === "webp" ? "tg-lo" : "tg-lo"));
      const best = (res === "full" || res === "full_res" || res === "3M") ? " [best quality]" : (res === "json" ? " — scene json" : (res === "webp" ? " — thumbnail" : (res === "glb" ? " — 3d" : "")));
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
        const n = r.name || "";
        const isSpz = n.includes(".spz");
        const isPly = n.includes(".ply");
        const isGlb = n.includes(".glb") && (isHome || n.includes("machine.glb"));
        const isWlt = n.includes("wlt-ai-cdn.art");
        if ((isSpz || isPly || isGlb || isWlt) && !capturedUrls.has(n)) {
          let tag = isSpz ? (n.includes("500k") ? "500k" : n.includes("100k") ? "100k" : "spz") : isGlb ? "glb" : "ply";
          capturedUrls.set(n, { name: n.split("/").pop().split("?")[0], fromPerf: true, resolution: tag });
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
      // generic spz + wlt cdn + marble cdn
      const re = /https:\/\/(?:cdn\.marble\.worldlabs\.ai|wlt-ai-cdn\.art)\/[^"'\s<>]+\.(spz|glb|webp)/g;
      const reAnySpz = /https:\/\/[^"'\s<>]+\.spz/g;
      let m, cnt = 0;
      for (m of fullHtml.matchAll(re)) {
        if (!capturedUrls.has(m[0])) {
          const tag = m[0].includes("500k") ? "500k" : m[0].includes("100k") ? "100k" : m[0].endsWith(".glb") ? "glb" : "webp";
          capturedUrls.set(m[0], { name: m[0].split("/").pop().split("?")[0], fromHtml: true, resolution: tag }); cnt++;
        }
      }
      // fallback any spz on page (covers future CDN rotations)
      for (m of fullHtml.matchAll(reAnySpz)) {
        if (!capturedUrls.has(m[0])) { capturedUrls.set(m[0], { name: m[0].split("/").pop().split("?")[0], fromHtml: true }); cnt++; }
      }
      // also scan all script tag contents for spz_urls dumps + homepage splat array
      for (const s of document.querySelectorAll("script")) {
        const t = s.textContent || "";
        if (!t.includes("spz") && !t.includes("wlt-ai-cdn") && !t.includes("url_100k")) continue;
        for (m of t.matchAll(re)) {
          if (!capturedUrls.has(m[0])) {
            const tag = m[0].includes("500k") ? "500k" : m[0].includes("100k") ? "100k" : m[0].endsWith(".glb") ? "glb" : "webp";
            capturedUrls.set(m[0], { name: m[0].split("/").pop().split("?")[0], fromScript: true, resolution: tag }); cnt++;
          }
        }
        for (m of t.matchAll(reAnySpz)) {
          if (!capturedUrls.has(m[0])) { capturedUrls.set(m[0], { name: m[0].split("/").pop().split("?")[0], fromScript: true }); cnt++; }
        }
        // also look for spz_urls JSON blobs with relative paths — try to extract urls inside object
        const j = t.matchAll(/"spz_urls"\s*:\s*\{[^}]+\}/g);
        for (const jm of j) {
          for (const um of jm[0].matchAll(/https[^"']+\.spz/g)) {
            if (!capturedUrls.has(um[0])) { capturedUrls.set(um[0], { name: um[0].split("/").pop().split("?")[0] }); cnt++; }
          }
        }
        // homepage explorer array: url_100k / url_500k
        if (t.includes("url_100k")) {
          const urls = [...t.matchAll(/https:\/\/wlt-ai-cdn\.art\/[^"'\\s]+\.spz/g)].map(x=>x[0]);
          for (const u of urls) if (!capturedUrls.has(u)) {
            const tag = u.includes("500k") ? "500k" : "100k";
            capturedUrls.set(u, { name: u.split("/").pop().split("?")[0], resolution: tag, fromScript: true }); cnt++;
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

    // 0. Perf + embed fallbacks first (catch already-loaded spz / homepage preloads)
    scanPerformance();
    scanEmbeddedJson();
    // homepage static seed — runs instantly, adds 6*2 spz + 6 json + thumbs
    if (isHome) {
      const hc = captureHomepageScenes();
      if (hc) uiLog(`Homepage seed: +${hc}`);
    }

    // 1. Scan DOM (preload links + machine.glb + textures)
    let domCount = 0;
    for (const el of document.querySelectorAll('link[href], script[src], img[src], a[href]')) {
      const url = el.href || el.src;
      if (!url) continue;
      try {
        const href = new URL(url, location.href).href;
        const lower = href.toLowerCase();
        const isSpz = lower.includes(".spz");
        const isGlb = lower.includes(".glb");
        const isWlt = lower.includes("wlt-ai-cdn.art");
        const ext = new URL(href).pathname.split(".").pop()?.toLowerCase();
        if ((["spz", "glb", "ply"].includes(ext) || isWlt || isSpz) && !capturedUrls.has(href)) {
          const tag = href.includes("500k") ? "500k" : href.includes("100k") ? "100k" : ext === "glb" ? "glb" : ext === "webp" ? "webp" : "other";
          capturedUrls.set(href, { name: href.split("/").pop().split("?")[0], resolution: tag });
          domCount++;
        }
        // also catch wlt thumb textures via img src that may be relative /textures/splats/...
        if (href.includes("/textures/splats/") && href.endsWith(".webp") && !capturedUrls.has(href)) {
          capturedUrls.set(href, { name: href.split("/").pop().split("?")[0], resolution: "webp", fromDom: true });
          domCount++;
        }
      } catch {}
    }
    uiLog(`DOM scan: ${domCount} assets found`);

    // 2. Scan page HTML for CDN URLs (marble + wlt homepage)
    try {
      const html = document.documentElement.outerHTML;
      const patterns = [
        /https?:\/\/cdn\.marble\.worldlabs\.ai\/[^\s"'<>]+\.spz/g,
        /https?:\/\/wlt-ai-cdn\.art\/[^\s"'<>]+\.(spz|glb|webp)/g,
        /https?:\/\/[^\/]+\/models\/machine\.glb/g,
      ];
      let cdnCount = 0;
      for (const re of patterns) {
        for (const m of html.matchAll(re)) {
          if (!capturedUrls.has(m[0])) {
            const tag = m[0].includes("500k") ? "500k" : m[0].includes("100k") ? "100k" : m[0].endsWith(".glb") ? "glb" : "webp";
            capturedUrls.set(m[0], { name: m[0].split("/").pop().split("?")[0], resolution: tag });
            cdnCount++;
          }
        }
      }
      // any .spz fallback
      for (const m of html.matchAll(/https:\/\/[^"'\s<>]+\.spz/g)) {
        if (!capturedUrls.has(m[0])) { capturedUrls.set(m[0], { name: m[0].split("/").pop().split("?")[0] }); cdnCount++; }
      }
      if (cdnCount) uiLog(`HTML CDN scan: ${cdnCount} URLs found`);
    } catch (e) { uiLog(`HTML scan error: ${e.message}`); }

    // 3a. Homepage hint + click-to-explore state logging
    if (isHome) {
      uiLog("Homepage — 6 scenes (Autumn · Amphitheater · Town · Garden · Bath · Train)");
      const btn = document.evaluate(`//button[contains(., 'Click to explore') or contains(., 'click to explore') or contains(., 'Explore')]`, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      if (btn) uiLog("Hint: click 'Click to explore' then view switches load 500k on demand");
    }

    // 3b. Marble: log World ID but DO NOT probe broken 404/403 endpoints.
    if (isMarble) {
      const worldMatch = location.pathname.match(/\/world\/([a-f0-9-]+)/);
      if (worldMatch) {
        const worldId = worldMatch[1];
        uiLog(`World ID: ${worldId}`);
        const og = document.querySelector('meta[property="og:image"]')?.content || "";
        if (og.includes("cdn.marble.worldlabs.ai")) uiLog(`CDN prefix hint: ${og.split("/").slice(0,5).join("/")}`);
      }
    }

    // 4. Scan all script sources for .spz URLs (with timeout guard) — also wlt
    let scriptCount = 0;
    const scripts = [...document.querySelectorAll("script[src]")].slice(0, 20);
    for (const script of scripts) {
      try {
        const res = await fetch(script.src, { signal: AbortSignal.timeout(4000) });
        const text = await res.text();
        const matches = text.matchAll(/["'](https?:\/\/[^"']*\.(spz|ply|glb))["']/g);
        for (const m of matches) {
          if (!capturedUrls.has(m[1])) {
            const tag = m[1].includes("500k") ? "500k" : m[1].includes("100k") ? "100k" : m[1].endsWith(".glb") ? "glb" : "ply";
            capturedUrls.set(m[1], { name: m[1].split("/").pop().split("?")[0], resolution: tag, fromScriptSrc: true });
            scriptCount++;
          }
        }
        // wlt without quotes (webpack chunk may have bare string)
        for (const m of text.matchAll(/https:\/\/wlt-ai-cdn\.art\/[^"'\s<>]+\.(spz|glb|webp)/g)) {
          if (!capturedUrls.has(m[0])) {
            const tag = m[0].includes("500k") ? "500k" : m[0].includes("100k") ? "100k" : m[0].endsWith(".glb") ? "glb" : "webp";
            capturedUrls.set(m[0], { name: m[0].split("/").pop().split("?")[0], resolution: tag, fromScriptSrc: true });
            scriptCount++;
          }
        }
      } catch {}
    }
    if (scriptCount) uiLog(`Script scan: ${scriptCount} assets found`);
    else uiLog(`Script scan: 0 assets found`);

    // 5. Final perf re-scan after fetches + homepage re-seed (handles lazy explore)
    scanPerformance();
    if (isHome) captureHomepageScenes();

    // 6. Enforce single-best spz + ensure 3-file bundle per scene
    pruneToSingleBestSpz();
    // homepage already has per-splat json/webp seeded — skip marble fallback on home to avoid generic world.json clutter
    if (!isHome) {
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

  uiLog("Script initialized. Interceptor: injected" + (isHome ? " — homepage mode" : ""));
  // also show perf immediately
  setTimeout(() => { scanPerformance(); if (isHome) { captureHomepageScenes(); refreshPanel(); } }, 1000);

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
    let homeAdded = 0;
    if (isHome) homeAdded = captureHomepageScenes();
    pruneToSingleBestSpz();
    const totalCount = capturedUrls.size + dbItems.filter(d => !capturedUrls.has(d.url)).length;
    if (totalCount > lastCount || perf || emb || homeAdded) refreshPanel();
  }, 3000);

  // For marble: also try fetching the world page content after a delay
  if (isMarble) {
    setTimeout(() => {
      uiLog("Delayed marble scan...");
      manualScan();
    }, 8000);
    setTimeout(manualScan, 15000);
  }

  // Homepage: hook "Click to explore" — entering the explorer lazy-loads 500k splats
  if (isHome) {
    const hookHomeClick = () => {
      // delegated click listener catches the explore button even if React re-renders it
      document.addEventListener("click", (e) => {
        const t = e.target;
        const btn = t.closest ? t.closest("button, a, [role='button']") : null;
        const txt = ((btn || t)?.textContent || "").trim().toLowerCase();
        if (txt.includes("click to explore") || txt.includes("explore") && btn) {
          // heuristic: any explore-like button on homepage triggers world loading
          const isExploreBtn = txt.includes("click to explore") || (btn && btn.textContent.toLowerCase().includes("click to explore"));
          if (!isExploreBtn && !txt.includes("click to explore")) return;
          uiLog("Click to explore pressed — watching for splat loads…");
          setTimeout(() => { scanPerformance(); captureHomepageScenes(); refreshPanel(); }, 1500);
          setTimeout(manualScan, 4000);
          setTimeout(manualScan, 8000);
        }
      }, true);
      // also MutationObserver for phase change (viewer canvas appears)
      try {
        const obs = new MutationObserver(() => {
          // when explorer canvas or splat viewer mounts, perf entries appear
          if (document.querySelector("canvas")) {
            // debounce
            clearTimeout(window._wlHomeMutTimer);
            window._wlHomeMutTimer = setTimeout(() => { scanPerformance(); captureHomepageScenes(); refreshPanel(); }, 1200);
          }
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
      } catch {}
      uiLog("Homepage hook: watching 'Click to explore'");
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hookHomeClick, { once: true });
    else hookHomeClick();
    // also delayed re-scan in case user already clicked before script init
    setTimeout(manualScan, 8000);
    setTimeout(manualScan, 15000);
  }
})();
