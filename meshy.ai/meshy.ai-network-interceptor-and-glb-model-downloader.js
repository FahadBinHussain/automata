// ==UserScript==
// @name         Meshy GLB Auto-Downloader (v3)
// @namespace    http://tampermonkey.net/
// @version      1.2
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/meshy.ai/meshy.ai-network-interceptor-and-glb-model-downloader.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/meshy.ai/meshy.ai-network-interceptor-and-glb-model-downloader.js
// @description  Adds a Download GLB button with correct filenames when Meshy API returns modelUrl (intercepts fetch + XHR)
// @match        *://*.meshy.ai/*
// @grant        none
// @author      Fahad
// @run-at       document-start
// ==/UserScript==

(function(){
  'use strict';

  // Recursively search an object/array/string for .glb URLs
  function findModelUrls(obj, out = []) {
    if (!obj) return out;
    if (typeof obj === 'string') {
      if (/https?:\/\/[^ \n\r"]+\.glb(\?|$)/.test(obj)) out.push(obj.replace(/\\u0026/g, '&'));
      return out;
    }
    if (Array.isArray(obj)) {
      obj.forEach(i => findModelUrls(i, out));
      return out;
    }
    if (typeof obj === 'object') {
      for (const k in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
        const v = obj[k];
        if (k.toLowerCase().includes('modelurl') && typeof v === 'string' && v.includes('.glb')) {
          out.push(v.replace(/\\u0026/g, '&'));
        } else {
          findModelUrls(v, out);
        }
      }
    }
    return out;
  }

  // Create/update floating button + list
  function addDownloadButton(urls) {
    if (!urls || urls.length === 0) return;
    urls = Array.from(new Set(urls)); // dedupe

    let container = document.getElementById('glb-download-btn-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'glb-download-btn-container';
      container.style.position = 'fixed';
      container.style.bottom = '20px';
      container.style.right = '20px';
      container.style.zIndex = '999999';
      container.style.fontFamily = 'system-ui, Arial, sans-serif';
      container.innerHTML = `
        <button id="glb-download-btn">⬇ Download GLB</button>
        <div id="glb-download-list" style="display:none; margin-top:8px; max-width:360px;"></div>
      `;
      document.body.appendChild(container);

      const btn = document.getElementById('glb-download-btn');
      Object.assign(btn.style, {
        padding: '10px 14px', borderRadius: '8px', border: 'none',
        background: '#1f7fff', color: '#fff', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
      });
      btn.onclick = () => {
        const list = document.getElementById('glb-download-list');
        list.style.display = list.style.display === 'none' ? 'block' : 'none';
      };
    }

    const list = document.getElementById('glb-download-list');
    list.innerHTML = '';
    urls.forEach((u) => {
        const row = document.createElement('div');
        row.style.marginTop = '6px';

        // Extract the filename from the URL
        let filename = u.split('/').pop().split('?')[0];

        const a = document.createElement('a');
        a.href = u.replace(/\\u0026/g, '&');
        a.target = '_blank';
        a.rel = 'noreferrer noopener';
        a.download = filename;
        a.innerText = `Save ${filename}`;
        Object.assign(a.style, {display:'inline-block', padding:'6px 8px', background:'#fff', color:'#000', borderRadius:'6px', textDecoration:'none', marginRight:'6px'});

        const direct = document.createElement('button');
        direct.innerText = 'Auto';
        Object.assign(direct.style, {padding:'6px 8px', borderRadius:'6px', border:'1px solid rgba(0,0,0,0.08)', cursor:'pointer'});
        direct.onclick = () => {
            const link = document.createElement('a');
            link.href = u;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
        };

        row.appendChild(a);
        row.appendChild(direct);
        list.appendChild(row);
    });
  }

  // Intercept fetch
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    return origFetch.apply(this, args).then(async res => {
      try {
        const requestUrl = (args && args[0]) ? (args[0].url || args[0]) : '';
        const isTaskEndpoint = typeof requestUrl === 'string' && requestUrl.includes('/web/v2/tasks/');
        const contentType = res.headers && res.headers.get ? (res.headers.get('content-type') || '') : '';
        if (isTaskEndpoint || contentType.includes('application/json')) {
          const cloned = res.clone();
          const json = await cloned.json().catch(() => null);
          if (json) {
            const urls = findModelUrls(json);
            if (urls.length) {
              console.log('[Meshy GLB Downloader] found model urls (fetch):', urls);
              addDownloadButton(urls);
            }
          }
        }
      } catch (e) { console.error('[Meshy GLB Downloader] fetch hook error', e); }
      return res;
    });
  };

  // Intercept XHR
  (function(){
    const X = window.XMLHttpRequest;
    const origOpen = X.prototype.open;
    const origSend = X.prototype.send;
    X.prototype.open = function(method, url) {
      this._url = url;
      return origOpen.apply(this, arguments);
    };
    X.prototype.send = function(body) {
      this.addEventListener('load', function() {
        try {
          if (!this._url) return;
          if (!this._url.includes('/web/v2/tasks/')) return;
          const txt = this.responseText;
          if (!txt) return;
          let json = null;
          try { json = JSON.parse(txt); } catch(e) { return; }
          const urls = findModelUrls(json);
          if (urls.length) {
            console.log('[Meshy GLB Downloader] found model urls (XHR):', urls);
            addDownloadButton(urls);
          }
        } catch (e) { console.error('[Meshy GLB Downloader] XHR hook error', e); }
      });
      return origSend.apply(this, arguments);
    };
  })();

  // Scan global objects in case state already present
  const scanGlobals = () => {
    try {
      const g = window.__INITIAL_STATE__ || window.__STATE__ || window.appState || window.__APP_STATE__;
      if (g) {
        const urls = findModelUrls(g);
        if (urls.length) addDownloadButton(urls);
      }
    } catch(e){}
  };
  setTimeout(scanGlobals, 1500);
  setTimeout(scanGlobals, 5000);
  setTimeout(scanGlobals, 10000);

})();
