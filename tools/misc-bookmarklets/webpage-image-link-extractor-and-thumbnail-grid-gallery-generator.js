// ==UserScript==
// @name         Webpage Image Link Extractor + Modern Gallery
// @namespace    https://automata.local/userscripts
// @version      2.1.1
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/tools/misc-bookmarklets/webpage-image-link-extractor-and-thumbnail-grid-gallery-generator.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/tools/misc-bookmarklets/webpage-image-link-extractor-and-thumbnail-grid-gallery-generator.js
// @description  Extract image URLs from open-directory pages and show them in a modern gallery + full viewer.
// @author       fahad
// @match        *://*/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const OVERLAY_ID = "image-link-gallery-overlay-v2";
  const EXT_RE = /\.(jpe?g|png|gif|webp|bmp|tiff?|avif|svg)(?:[?#].*)?$/i;
  const DATE_RE = /(\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}|\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}|\d{1,2}-[A-Za-z]{3}-\d{4}|[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}|\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/;
  const SIZE_RE = /(\d+(?:\.\d+)?\s?(?:B|KB|MB|GB|TB))/i;

  const hasClipboardGrant = typeof GM_setClipboard === "function";

  function isLikelyImageUrl(url) {
    return typeof url === "string" && EXT_RE.test(url);
  }

  function toAbsolute(url) {
    try {
      return new URL(url, location.href).href;
    } catch {
      return null;
    }
  }

  function normalizeUrl(url) {
    if (!url) return null;
    const absolute = toAbsolute(url.trim());
    if (!absolute || absolute.startsWith("data:")) return null;
    return absolute;
  }

  function parseSrcset(srcset) {
    if (!srcset) return [];
    return srcset
      .split(",")
      .map((part) => part.trim().split(/\s+/)[0])
      .filter(Boolean);
  }

  function readFilename(url) {
    try {
      const path = new URL(url).pathname;
      return decodeURIComponent(path.split("/").pop() || "image");
    } catch {
      return "image";
    }
  }

  function extractDateAndSize(text) {
    const clean = (text || "").replace(/\s+/g, " ").trim();
    const date = clean.match(DATE_RE)?.[0] || "-";
    const size = clean.match(SIZE_RE)?.[0] || "-";
    return { date, size };
  }

  function collectImageItems() {
    const map = new Map();

    function upsert(url, meta) {
      if (!url || !isLikelyImageUrl(url)) return;
      const existing = map.get(url);
      if (!existing) {
        map.set(url, {
          url,
          host: new URL(url).host,
          title: meta.title || readFilename(url),
          date: meta.date || "-",
          size: meta.size || "-",
        });
        return;
      }
      if (existing.title === readFilename(url) && meta.title) existing.title = meta.title;
      if (existing.date === "-" && meta.date && meta.date !== "-") existing.date = meta.date;
      if (existing.size === "-" && meta.size && meta.size !== "-") existing.size = meta.size;
    }

    document.querySelectorAll("a[href]").forEach((a) => {
      const url = normalizeUrl(a.getAttribute("href"));
      if (!url) return;
      const contextText = (a.closest("tr")?.textContent || a.parentElement?.textContent || "").trim();
      const parsed = extractDateAndSize(contextText);
      upsert(url, {
        title: (a.textContent || "").trim(),
        date: parsed.date,
        size: parsed.size,
      });
    });

    document.querySelectorAll("img[src],img[data-src],img[srcset],img[data-srcset],source[srcset]").forEach((el) => {
      [
        el.getAttribute("src"),
        el.getAttribute("data-src"),
        ...parseSrcset(el.getAttribute("srcset")),
        ...parseSrcset(el.getAttribute("data-srcset")),
      ]
        .map(normalizeUrl)
        .filter(Boolean)
        .forEach((url) => {
          upsert(url, {
            title: el.getAttribute("alt") || el.getAttribute("title") || readFilename(url),
            date: "-",
            size: "-",
          });
        });
    });

    document.querySelectorAll("[style]").forEach((el) => {
      const style = el.getAttribute("style") || "";
      const matches = style.match(/url\((['"]?)(.*?)\1\)/gi) || [];
      matches.forEach((m) => {
        const inner = m.replace(/^url\((['"]?)/i, "").replace(/\1\)$/i, "").trim();
        const url = normalizeUrl(inner);
        upsert(url, { title: readFilename(url || ""), date: "-", size: "-" });
      });
    });

    return [...map.values()].sort((a, b) => a.url.localeCompare(b.url));
  }

  function isOpenDirectoryPage() {
    const title = (document.title || "").toLowerCase();
    const h1 = (document.querySelector("h1")?.textContent || "").toLowerCase();
    const bodyText = (document.body?.textContent || "").toLowerCase();
    const pathLooksDirectory = location.pathname.endsWith("/") || !location.pathname.includes(".");
    const links = [...document.querySelectorAll("a[href]")];
    const nonAssetScripts = document.querySelectorAll("script[src]").length;
    const formsCount = document.querySelectorAll("form").length;
    const appShellSignals =
      document.querySelectorAll("[id*='app'], [class*='app'], [data-reactroot], [ng-version], [data-v-app]").length > 0;

    // Specific check for Apache-style directory listings
    if ((title.includes("index of") || h1.includes("index of")) && bodyText.includes("name") && bodyText.includes("last modified") && bodyText.includes("size") && bodyText.includes("description") && bodyText.includes("parent directory")) {
      return true;
    }

    const titleOrHeaderLooksLikeIndex = Boolean(
      title.includes("index of") ||
      h1.includes("index of") ||
      title.includes("directory listing") ||
      h1.includes("directory listing")
    );

    const apacheLike = !!document.querySelector("pre a[href], table tr td a[href], table a[href]");
    const parentLink = links.some((a) => {
      const t = (a.textContent || "").trim().toLowerCase();
      const href = (a.getAttribute("href") || "").trim();
      return t === "parent directory" || href === "../" || href === "..";
    });
    const relativeDirLikeLinks = links.filter((a) => {
      const href = (a.getAttribute("href") || "").trim();
      if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) return false;
      if (/^https?:\/\//i.test(href)) return false;
      return href.endsWith("/") || href === "../" || EXT_RE.test(href);
    }).length;
    const ratio = links.length ? relativeDirLikeLinks / links.length : 0;

    const nginxLike = bodyText.includes("nginx") && titleOrHeaderLooksLikeIndex;
    const caddyLike = title.includes("file browser") || h1.includes("file browser");

    let score = 0;
    if (pathLooksDirectory) score += 1;
    if (titleOrHeaderLooksLikeIndex) score += 3;
    if (apacheLike) score += 2;
    if (parentLink) score += 2;
    if (ratio >= 0.6 && links.length >= 8) score += 2;
    if (nginxLike || caddyLike) score += 2;

    // Penalize pages that look like full web apps rather than plain directory listings.
    if (nonAssetScripts >= 4) score -= 2;
    if (formsCount >= 2) score -= 1;
    if (appShellSignals) score -= 2;

    return score >= 4;
  }

  function copyText(text) {
    if (hasClipboardGrant) {
      GM_setClipboard(text, "text");
      return Promise.resolve();
    }
    return navigator.clipboard.writeText(text);
  }

  function buildUI(items) {
    const old = document.getElementById(OVERLAY_ID);
    if (old) old.remove();

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.tabIndex = -1;
    overlay.innerHTML = `
      <style>
        #${OVERLAY_ID} {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          background: radial-gradient(circle at top left, #2f4460 0%, #151a26 40%, #0a0c12 100%);
          color: #eef3ff;
          font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
          display: flex;
          flex-direction: column;
        }
        #${OVERLAY_ID} * { box-sizing: border-box; }
        #${OVERLAY_ID} .topbar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 10px;
          padding: 12px 14px;
          border-bottom: 1px solid rgba(255,255,255,.14);
          background: rgba(12,16,25,.76);
          backdrop-filter: blur(8px);
        }
        #${OVERLAY_ID} .title { font-size: 14px; font-weight: 700; }
        #${OVERLAY_ID} .meta { font-size: 12px; color: #b8c5de; }
        #${OVERLAY_ID} .grow { flex: 1; }
        #${OVERLAY_ID} input {
          min-width: 240px;
          color: #fff;
          background: rgba(255,255,255,.08);
          border: 1px solid rgba(255,255,255,.2);
          border-radius: 10px;
          padding: 8px 10px;
        }
        #${OVERLAY_ID} button {
          border: 1px solid rgba(255,255,255,.2);
          background: rgba(255,255,255,.08);
          color: #fff;
          border-radius: 10px;
          padding: 8px 11px;
          cursor: pointer;
        }
        #${OVERLAY_ID} button:hover { background: rgba(255,255,255,.16); }
        #${OVERLAY_ID} .grid {
          padding: 14px;
          overflow: auto;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 12px;
        }
        #${OVERLAY_ID} .card {
          background: rgba(255,255,255,.07);
          border: 1px solid rgba(255,255,255,.12);
          border-radius: 12px;
          overflow: hidden;
          min-height: 228px;
          display: flex;
          flex-direction: column;
        }
        #${OVERLAY_ID} .thumb-btn {
          border: 0;
          border-radius: 0;
          background: transparent;
          padding: 0;
          margin: 0;
        }
        #${OVERLAY_ID} .thumb {
          width: 100%;
          height: 145px;
          object-fit: cover;
          display: block;
          background: #1b2331;
        }
        #${OVERLAY_ID} .url, #${OVERLAY_ID} .sub {
          padding: 0 8px;
          white-space: nowrap;
          text-overflow: ellipsis;
          overflow: hidden;
        }
        #${OVERLAY_ID} .url { font-size: 11px; color: #dbe4f5; margin-top: 8px; }
        #${OVERLAY_ID} .sub { font-size: 11px; color: #9eb0ce; margin-top: 4px; }
        #${OVERLAY_ID} .actions {
          margin-top: auto;
          padding: 8px;
          display: flex;
          gap: 6px;
        }
        #${OVERLAY_ID} .actions button { flex: 1; font-size: 11px; padding: 6px; border-radius: 8px; }
        #${OVERLAY_ID} .empty { color: #b8c4d7; text-align: center; padding: 48px 16px; }

        #${OVERLAY_ID} .viewer {
          position: fixed;
          inset: 0;
          display: none;
          flex-direction: column;
          background: rgba(2,4,8,.88);
          backdrop-filter: blur(8px);
        }
        #${OVERLAY_ID} .viewer.is-open { display: flex; }
        #${OVERLAY_ID} .viewer-top {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 14px;
          border-bottom: 1px solid rgba(255,255,255,.12);
          background: rgba(10,12,19,.74);
        }
        #${OVERLAY_ID} .viewer-title-wrap { min-width: 0; }
        #${OVERLAY_ID} .viewer-title {
          font-size: 15px;
          font-weight: 700;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 60vw;
        }
        #${OVERLAY_ID} .viewer-meta { font-size: 12px; color: #b4c0d8; }
        #${OVERLAY_ID} .viewer-stage {
          position: relative;
          flex: 1;
          display: grid;
          place-items: center;
          padding: 20px;
        }
        #${OVERLAY_ID} .viewer-image {
          max-width: min(94vw, 1600px);
          max-height: 72vh;
          border-radius: 12px;
          box-shadow: 0 24px 80px rgba(0,0,0,.58);
          background: #12192a;
        }
        #${OVERLAY_ID} .nav {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          width: 46px;
          height: 46px;
          border-radius: 999px;
          font-size: 22px;
          line-height: 1;
          display: grid;
          place-items: center;
        }
        #${OVERLAY_ID} .nav.prev { left: 16px; }
        #${OVERLAY_ID} .nav.next { right: 16px; }
        #${OVERLAY_ID} .filmstrip {
          border-top: 1px solid rgba(255,255,255,.12);
          padding: 10px;
          display: grid;
          grid-auto-flow: column;
          grid-auto-columns: 88px;
          gap: 8px;
          overflow-x: auto;
          background: rgba(10,12,19,.74);
        }
        #${OVERLAY_ID} .film-btn {
          padding: 0;
          border-radius: 8px;
          overflow: hidden;
          border: 2px solid transparent;
          background: #182033;
        }
        #${OVERLAY_ID} .film-btn.active { border-color: #6bb2ff; }
        #${OVERLAY_ID} .film-btn img {
          width: 100%;
          height: 62px;
          object-fit: cover;
          display: block;
        }
        #${OVERLAY_ID} .kbd {
          font-size: 11px;
          color: #9eb0ce;
          white-space: nowrap;
        }
      </style>

      <div class="topbar">
        <div>
          <div class="title">Image Directory Gallery</div>
          <div class="meta" id="ilgMeta"></div>
        </div>
        <div class="grow"></div>
        <input id="ilgFilter" placeholder="Filter by title, URL or host" />
        <button id="ilgCopyAll">Copy All URLs</button>
        <button id="ilgClose">Close</button>
      </div>

      <div class="grid" id="ilgGrid"></div>

      <div class="viewer" id="ilgViewer">
        <div class="viewer-top">
          <button id="ilgViewerClose">Close</button>
          <button id="ilgPrevTop">Prev</button>
          <button id="ilgNextTop">Next</button>
          <button id="ilgCopyCurrent">Copy URL</button>
          <a id="ilgDownload" download><button type="button">Download</button></a>
          <div class="viewer-title-wrap grow">
            <div class="viewer-title" id="ilgViewerTitle"></div>
            <div class="viewer-meta" id="ilgViewerMeta"></div>
          </div>
          <div class="kbd">Keys: Left/Right, Home/End, Esc</div>
        </div>
        <div class="viewer-stage" id="ilgViewerStage">
          <button class="nav prev" id="ilgPrev" aria-label="Previous">&#8249;</button>
          <img class="viewer-image" id="ilgViewerImg" alt="full image preview" />
          <button class="nav next" id="ilgNext" aria-label="Next">&#8250;</button>
        </div>
        <div class="filmstrip" id="ilgFilmstrip"></div>
      </div>
    `;

    const grid = overlay.querySelector("#ilgGrid");
    const meta = overlay.querySelector("#ilgMeta");
    const filter = overlay.querySelector("#ilgFilter");
    const viewer = overlay.querySelector("#ilgViewer");
    const viewerImg = overlay.querySelector("#ilgViewerImg");
    const viewerTitle = overlay.querySelector("#ilgViewerTitle");
    const viewerMeta = overlay.querySelector("#ilgViewerMeta");
    const filmstrip = overlay.querySelector("#ilgFilmstrip");
    const downloadLink = overlay.querySelector("#ilgDownload");

    let filtered = items;
    let currentIndex = -1;
    let currentResolution = "-";

    function applyFilter() {
      const q = (filter.value || "").toLowerCase().trim();
      filtered = !q
        ? items
        : items.filter((i) => {
            return (
              i.url.toLowerCase().includes(q) ||
              i.host.toLowerCase().includes(q) ||
              (i.title || "").toLowerCase().includes(q)
            );
          });
      meta.textContent = `${filtered.length} visible of ${items.length} images`;
    }

    function renderGrid() {
      grid.innerHTML = "";
      if (!filtered.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "No image URLs match your filter.";
        grid.appendChild(empty);
        return;
      }

      filtered.forEach((item, idx) => {
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = `
          <button type="button" class="thumb-btn" data-open-index="${idx}">
            <img class="thumb" src="${item.url}" loading="lazy" alt="${item.title || "thumbnail"}" />
          </button>
          <div class="url" title="${item.title}">${item.title || readFilename(item.url)}</div>
          <div class="sub" title="${item.url}">${item.url}</div>
          <div class="actions">
            <button type="button" data-copy="${item.url}">Copy URL</button>
            <button type="button" data-open-index="${idx}">Preview</button>
          </div>
        `;
        grid.appendChild(card);
      });
    }

    function renderFilmstrip() {
      filmstrip.innerHTML = "";
      filtered.forEach((item, idx) => {
        const b = document.createElement("button");
        b.className = `film-btn${idx === currentIndex ? " active" : ""}`;
        b.type = "button";
        b.setAttribute("data-open-index", String(idx));
        b.innerHTML = `<img src="${item.url}" loading="lazy" alt="${item.title || "thumb"}"/>`;
        filmstrip.appendChild(b);
      });
      const active = filmstrip.querySelector(".film-btn.active");
      active?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }

    function updateViewerMeta(item) {
      const indexLabel = `${currentIndex + 1} / ${filtered.length}`;
      viewerTitle.textContent = item.title || readFilename(item.url);
      viewerMeta.textContent = `${indexLabel}  |  ${item.host}  |  ${item.date}  |  ${item.size}  |  ${currentResolution}`;
      downloadLink.href = item.url;
      downloadLink.download = item.title || readFilename(item.url);
    }

    function showAt(index) {
      if (!filtered.length) return;
      currentIndex = (index + filtered.length) % filtered.length;
      const item = filtered[currentIndex];
      currentResolution = "Loading...";
      updateViewerMeta(item);
      viewerImg.src = item.url;
      viewer.classList.add("is-open");
      renderFilmstrip();
    }

    function closeViewer() {
      viewer.classList.remove("is-open");
      viewerImg.removeAttribute("src");
      currentIndex = -1;
      currentResolution = "-";
    }

    function next() {
      if (currentIndex < 0) return;
      showAt(currentIndex + 1);
    }

    function prev() {
      if (currentIndex < 0) return;
      showAt(currentIndex - 1);
    }

    viewerImg.addEventListener("load", () => {
      currentResolution = `${viewerImg.naturalWidth}x${viewerImg.naturalHeight}`;
      if (currentIndex >= 0 && filtered[currentIndex]) updateViewerMeta(filtered[currentIndex]);
    });

    overlay.addEventListener("click", async (e) => {
      const copyButton = e.target.closest("button[data-copy]");
      if (copyButton) {
        const url = copyButton.getAttribute("data-copy") || "";
        try {
          await copyText(url);
          copyButton.textContent = "Copied";
          setTimeout(() => (copyButton.textContent = "Copy URL"), 900);
        } catch {
          copyButton.textContent = "Copy failed";
        }
        return;
      }

      const openBtn = e.target.closest("button[data-open-index]");
      if (openBtn) {
        showAt(Number(openBtn.getAttribute("data-open-index")) || 0);
      }

      if (e.target.id === "ilgViewerClose") closeViewer();
      if (e.target.id === "ilgNext" || e.target.id === "ilgNextTop") next();
      if (e.target.id === "ilgPrev" || e.target.id === "ilgPrevTop") prev();
      if (e.target.id === "ilgCopyCurrent" && currentIndex >= 0) {
        try {
          await copyText(filtered[currentIndex].url);
        } catch {
          // ignore
        }
      }
      if (e.target.id === "ilgViewerStage") next();
    });

    overlay.querySelector("#ilgCopyAll").addEventListener("click", async () => {
      try {
        await copyText(filtered.map((i) => i.url).join("\n"));
      } catch {
        // ignore
      }
    });

    overlay.querySelector("#ilgClose").addEventListener("click", () => overlay.remove());

    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (viewer.classList.contains("is-open")) closeViewer();
        else overlay.remove();
        return;
      }
      if (!viewer.classList.contains("is-open")) return;
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "Home") showAt(0);
      if (e.key === "End") showAt(filtered.length - 1);
    });

    filter.addEventListener("input", () => {
      applyFilter();
      renderGrid();
      if (viewer.classList.contains("is-open")) {
        if (!filtered.length) closeViewer();
        else showAt(Math.min(currentIndex, filtered.length - 1));
      }
    });

    document.documentElement.appendChild(overlay);
    applyFilter();
    renderGrid();
    filter.focus();
    overlay.focus();
  }

  function run() {
    if (!isOpenDirectoryPage()) return;
    const items = collectImageItems();
    if (!items.length) return; // No images, no button

    // Create a button to activate the gallery
    const button = document.createElement('button');
    button.textContent = 'Show Image Gallery';
    button.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 10000;
      padding: 10px 15px;
      background-color: #007bff;
      color: white;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      font-family: Arial, sans-serif;
      font-size: 14px;
    `;
    button.addEventListener('click', () => {
      button.remove();
      buildUI(items);
    });
    document.body.appendChild(button);
  }

  window.addEventListener("keydown", (e) => {
    if (e.altKey && e.shiftKey && e.key.toLowerCase() === "g") {
      e.preventDefault();
      run();
    }
  });

  if (document.readyState === "complete" || document.readyState === "interactive") {
    run();
  } else {
    window.addEventListener("DOMContentLoaded", run, { once: true });
  }
})();
