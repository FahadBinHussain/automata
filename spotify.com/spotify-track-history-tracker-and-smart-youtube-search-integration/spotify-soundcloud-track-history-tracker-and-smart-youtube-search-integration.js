// ==UserScript==
// @name         Spotify/SoundCloud to YouTube (Cloud Sync + Clear + Multi-Artist + Fixes)
// @namespace    http://tampermonkey.net/
// @version      3.5
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/spotify.com/spotify-track-history-tracker-and-smart-youtube-search-integration/spotify-soundcloud-track-history-tracker-and-smart-youtube-search-integration.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/spotify.com/spotify-track-history-tracker-and-smart-youtube-search-integration/spotify-soundcloud-track-history-tracker-and-smart-youtube-search-integration.js
// @description  Adds YouTube buttons on Spotify and SoundCloud, syncs history, forces anonymous requests to fix Google login bugs.
// @author       You
// @match        https://open.spotify.com/*
// @match        https://soundcloud.com/*
// @match        https://www.soundcloud.com/*
// @connect      script.google.com
// @connect      googleusercontent.com
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    // YOUR URL — replace with your Apps Script Web App URL
    // (https://script.google.com/macros/s/.../exec)
    const CLOUD_URL = "YOUR_URL_HERE";

    const YT_BUTTON_CLASS = 'vm-yt-search-btn';
    const PLACEHOLDER_URL = "YOUR_URL_HERE";

    let visitedTracks = new Set();
    // isHistoryLoaded becomes true only after a successful cloud GET.
    // Until then, the script refuses to mark icons as "visited" on click,
    // because cloud is the source of truth and we don't silently fall back
    // to local-only state.
    let isHistoryLoaded = false;
    // isCloudDisabled is true when CLOUD_URL is the placeholder OR when a
    // cloud request has failed. The banner is shown so the user knows.
    let isCloudDisabled = false;
    let debounceTimer = null;
    let fetchRetryTimer = null;

    function isCloudUrlConfigured() {
        return typeof CLOUD_URL === "string" &&
               CLOUD_URL.trim().length > 0 &&
               CLOUD_URL.trim() !== PLACEHOLDER_URL &&
               /^https?:\/\//i.test(CLOUD_URL.trim());
    }

    function showBanner(message, kind) {
        const existing = document.getElementById('vm-cloud-banner');
        if (existing) existing.remove();
        const banner = document.createElement('div');
        banner.id = 'vm-cloud-banner';
        const bg = kind === 'warn' ? '#f59e0b' : '#dc2626';
        banner.style.cssText = [
            'position:fixed', 'top:0', 'left:0', 'right:0',
            'z-index:2147483647', 'padding:10px 14px',
            'background:' + bg, 'color:#fff',
            'font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
            'white-space:pre-wrap', 'word-break:break-word',
            'text-align:left', 'box-shadow:0 2px 8px rgba(0,0,0,0.25)',
            'pointer-events:auto', 'user-select:text',
            'max-height:40vh', 'overflow:auto'
        ].join(';');
        banner.textContent = message;
        document.documentElement.appendChild(banner);
    }

    function clearBanner() {
        const existing = document.getElementById('vm-cloud-banner');
        if (existing) existing.remove();
    }

    function setCloudDisabled(reason) {
        isCloudDisabled = true;
        const msg = reason || "unknown error";
        console.error("[Spotify→YT] cloud sync OFFLINE:", msg);
        showBanner("Spotify→YouTube cloud sync OFFLINE: " + msg +
                   " — clicks won't mark tracks visited. Fix CLOUD_URL or your network. " +
                   "(see browser console for details)",
                   "error");
    }

    function setCloudOnline() {
        isCloudDisabled = false;
        lastCloudError = "";
        clearBanner();
    }

    // Icons
    const ytIconSvg = `<svg role="img" height="16" width="16" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`;
    const visitedIconSvg = `<svg role="img" height="16" width="16" viewBox="0 0 24 24" fill="#E22134"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`;
    const soundCloudExcludedSegments = new Set([
        "charts",
        "discover",
        "feed",
        "for-you",
        "go",
        "library",
        "messages",
        "notifications",
        "pages",
        "premium",
        "search",
        "settings",
        "signin",
        "stream",
        "terms",
        "upload",
        "you"
    ]);

    function cleanText(value) {
        return (value || "").replace(/\s+/g, " ").trim();
    }

    function buildYoutubeUrl(artistName, songName) {
        return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${artistName} ${songName}`.trim())}`;
    }

    function buildTrackId(rawId) {
        return String(rawId || "").replace(/^\/+/, "");
    }

    function updateIcon(buttonElement, trackId) {
        // cloud is source of truth — only mark visited if cloud has loaded
        // AND the id is in the visited set. We never optimistically mark
        // visited from a click; we wait for the POST to ack first.
        if (isHistoryLoaded && trackId && visitedTracks.has(trackId)) {
            buttonElement.innerHTML = visitedIconSvg;
            buttonElement.title = "Visited (Shift+Click to clear)";
            buttonElement.style.color = "#E22134";
        } else {
            buttonElement.innerHTML = ytIconSvg;
            buttonElement.title = isCloudDisabled
                ? "Cloud sync offline — click will open YouTube but won't save"
                : "Search on YouTube";
            buttonElement.style.color = "#b3b3b3";
        }

        const icon = buttonElement.querySelector("svg");
        if (icon) icon.style.pointerEvents = "none";
    }

    function stopHostTrackClick(event, preventDefault = false) {
        if (preventDefault) event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    }

    function shieldYoutubeButton(buttonElement) {
        ["pointerdown", "pointerup", "mousedown", "mouseup", "dblclick"].forEach(eventName => {
            buttonElement.addEventListener(eventName, event => stopHostTrackClick(event), true);
        });
    }

    function createYoutubeButton(trackId, songName, artistNameForSave, ytUrl, spacing = {}) {
        const btn = document.createElement('a');
        btn.className = YT_BUTTON_CLASS;
        btn.href = ytUrl;
        btn.target = '_blank';
        btn.rel = 'noopener noreferrer';
        btn.dataset.trackId = trackId;
        btn.setAttribute("aria-label", "Search on YouTube");

        btn.style.display = "inline-flex";
        btn.style.alignItems = "center";
        btn.style.justifyContent = "center";
        btn.style.background = "transparent";
        btn.style.border = "none";
        btn.style.borderRadius = "50%";
        btn.style.cursor = "pointer";
        btn.style.width = "24px";
        btn.style.minWidth = "24px";
        btn.style.height = "24px";
        btn.style.padding = "0";
        btn.style.marginLeft = spacing.marginLeft || "20px";
        btn.style.marginRight = spacing.marginRight || "10px";
        btn.style.textDecoration = "none";
        btn.style.flexShrink = "0";
        btn.style.position = "relative";
        btn.style.zIndex = "50";
        btn.style.pointerEvents = "auto";
        btn.style.userSelect = "none";
        btn.style.verticalAlign = "middle";

        updateIcon(btn, trackId);
        shieldYoutubeButton(btn);

        btn.onmouseover = () => { if (!visitedTracks.has(trackId)) btn.style.color = "#fff"; };
        btn.onmouseout = () => { btn.style.color = visitedTracks.has(trackId) ? "#E22134" : "#b3b3b3"; };

        btn.onclick = (e) => {
            stopHostTrackClick(e, true);
            // If cloud is down, open YouTube but don't pretend to save.
            if (isCloudDisabled) {
                window.open(ytUrl, '_blank');
                return;
            }
            if (e.shiftKey) {
                if (visitedTracks.has(trackId)) {
                    saveToCloud(trackId, `${artistNameForSave} - ${songName}`, "remove")
                        .then(() => {
                            visitedTracks.delete(trackId);
                            updateIcon(btn, trackId);
                        })
                        .catch(() => { /* banner already shown */ });
                }
                return;
            }

            // Normal click — POST to cloud, only mark visited on success.
            saveToCloud(trackId, `${artistNameForSave} - ${songName}`, "add")
                .then(() => {
                    visitedTracks.add(trackId);
                    updateIcon(btn, trackId);
                })
                .catch(() => { /* banner already shown */ });
            window.open(ytUrl, '_blank');
        };

        return btn;
    }

    function mountSoundCloudListButton(titleLink, buttonElement) {
        buttonElement.style.marginLeft = "0";
        buttonElement.style.marginRight = "6px";

        const parent = titleLink.parentElement;
        if (parent) parent.style.minWidth = "0";

        titleLink.style.minWidth = "0";
        titleLink.style.overflow = "hidden";
        titleLink.style.textOverflow = "ellipsis";
        titleLink.style.whiteSpace = "nowrap";

        if (titleLink.previousElementSibling !== buttonElement) {
            titleLink.insertAdjacentElement("beforebegin", buttonElement);
        }
    }

    function getSoundCloudUrl(href) {
        try {
            const url = new URL(href, location.origin);
            if (url.hostname !== "soundcloud.com" && url.hostname !== "www.soundcloud.com") return null;
            return url;
        } catch (e) {
            return null;
        }
    }

    function getSoundCloudTrackPathFromHref(href) {
        const url = getSoundCloudUrl(href);
        if (!url) return null;

        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length < 2) return null;
        if (soundCloudExcludedSegments.has(parts[0])) return null;
        if (parts.includes("sets")) return null;

        return `/${parts[0]}/${parts[1]}`;
    }

    function getSoundCloudTrackPathFromAnchor(anchor) {
        return getSoundCloudTrackPathFromHref(anchor.getAttribute("href"));
    }

    function getSoundCloudProfilePathFromAnchor(anchor) {
        const url = getSoundCloudUrl(anchor.getAttribute("href"));
        if (!url) return null;

        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length !== 1) return null;
        if (soundCloudExcludedSegments.has(parts[0])) return null;

        return `/${parts[0]}`;
    }

    function titleFromSoundCloudAnchor(anchor) {
        const title = cleanText(anchor.getAttribute("title")) || cleanText(anchor.textContent);
        return title.replace(/^Play\s+/i, "");
    }

    function artistNameFromSoundCloudContainer(container, trackPath) {
        const artistSlug = trackPath.split("/").filter(Boolean)[0];
        const specificArtist = container.querySelector([
            'a.soundTitle__usernameText[href]',
            'a.soundTitle__username[href]',
            'a.trackItem__username[href]',
            'a.compactTrackListItem__user[href]',
            'a[class*="username"][href]'
        ].join(","));

        if (specificArtist) {
            const artistText = cleanText(specificArtist.textContent);
            if (artistText) return artistText;
        }

        const profileAnchor = Array.from(container.querySelectorAll('a[href]')).find(anchor =>
            getSoundCloudProfilePathFromAnchor(anchor) === `/${artistSlug}` && cleanText(anchor.textContent)
        );

        if (profileAnchor) return cleanText(profileAnchor.textContent);

        return artistSlug.replace(/[-_]+/g, " ");
    }

    function fallbackNameFromSlug(slug) {
        return decodeURIComponent(slug || "").replace(/[-_]+/g, " ");
    }

    function findExistingButton(container, trackId) {
        return Array.from(container.querySelectorAll(`.${YT_BUTTON_CLASS}`)).find(button =>
            button.dataset.trackId === trackId
        );
    }

    function getCurrentSource() {
        return location.hostname === "open.spotify.com" ? "spotify" : "soundcloud";
    }

    function fetchHistory() {
        if (!isCloudUrlConfigured()) {
            setCloudDisabled("CLOUD_URL not set (still placeholder)");
            return;
        }
        const separator = CLOUD_URL.includes("?") ? "&" : "?";
        const noCacheUrl = `${CLOUD_URL}${separator}source=${encodeURIComponent(getCurrentSource())}&t=${Date.now()}`;

        GM_xmlhttpRequest({
            method: "GET",
            url: noCacheUrl,
            anonymous: true,
            headers: { "Cache-Control": "no-cache" },
            redirect: "follow",
            timeout: 15000,
            onload: function (response) {
                if (response.status >= 200 && response.status < 300) {
                    const contentType = response.responseHeaders || "";
                    if (/html/i.test(contentType) && !/json/i.test(contentType)) {
                        // Google login wall returns 200 with HTML
                        setCloudDisabled("auth wall (got HTML instead of JSON)");
                        scheduleFetchRetry();
                        return;
                    }
                    try {
                        const ids = JSON.parse(response.responseText);
                        if (!Array.isArray(ids)) {
                            setCloudDisabled("-cloud returned non-array JSON: " +
                                             response.responseText.slice(0, 100));
                            scheduleFetchRetry();
                            return;
                        }
                        visitedTracks = new Set(ids.filter(Boolean).map(String));
                        isHistoryLoaded = true;
                        setCloudOnline();
                        addYoutubeButtons();
                    } catch (parseErr) {
                        setCloudDisabled("bad JSON: " + parseErr.message +
                                         " (first 80: " + response.responseText.slice(0, 80) + ")");
                        scheduleFetchRetry();
                    }
                } else {
                    setCloudDisabled("HTTP " + response.status + " from cloud");
                    scheduleFetchRetry();
                }
            },
            onerror: function (err) {
                setCloudDisabled("network error (" + (err && err.error ? err.error : "unknown") + ")");
                scheduleFetchRetry();
            },
            ontimeout: function () {
                setCloudDisabled("request timed out (15s)");
                scheduleFetchRetry();
            }
        });
    }

    function scheduleFetchRetry() {
        if (fetchRetryTimer) return;
        // exponential-ish backoff: 15s, 30s, 60s, 120s capped
        let attempt = 0;
        const tick = () => {
            fetchRetryTimer = null;
            if (isHistoryLoaded) return;
            attempt++;
            const delay = Math.min(15000 * Math.pow(2, attempt - 1), 120000);
            console.warn("[Spotify→YT] retrying fetch, attempt " + attempt + " in " + (delay/1000) + "s");
            fetchHistory();
            if (!isHistoryLoaded && attempt < 5) {
                fetchRetryTimer = setTimeout(tick, delay);
            }
        };
        fetchRetryTimer = setTimeout(tick, 15000);
    }

    // saveToCloud returns a Promise that resolves on confirmed cloud save and
    // rejects on any failure. The caller must .catch to avoid unhandled rejections.
    function saveToCloud(trackId, songName, action = "add") {
        return new Promise((resolve, reject) => {
            if (!isCloudUrlConfigured()) {
                setCloudDisabled("CLOUD_URL not set (still placeholder)");
                reject(new Error("CLOUD_URL not configured"));
                return;
            }
            GM_xmlhttpRequest({
                method: "POST",
                url: CLOUD_URL,
                anonymous: true,
                data: JSON.stringify({
                    id: trackId,
                    name: songName,
                    action: action,
                    source: getCurrentSource()
                }),
                headers: { "Content-Type": "text/plain" },
                redirect: "follow",
                timeout: 15000,
                onload: function (response) {
                    let parsed = null;
                    try { parsed = JSON.parse(response.responseText); } catch (_) {}
                    const serverErr = parsed && parsed.status === "error";
                    if (response.status >= 200 && response.status < 300 && !serverErr) {
                        setCloudOnline();
                        resolve(parsed || {});
                    } else {
                        const msg = parsed && parsed.message
                            ? parsed.message
                            : "HTTP " + response.status;
                        setCloudDisabled("save failed: " + msg);
                        reject(new Error(msg));
                    }
                },
                onerror: function (err) {
                    setCloudDisabled("save network error (" +
                                     (err && err.error ? err.error : "unknown") + ")");
                    reject(new Error("save network error"));
                },
                ontimeout: function () {
                    setCloudDisabled("save timed out (15s)");
                    reject(new Error("save timeout"));
                }
            });
        });
    }

    function addYoutubeButtons() {
        if (location.hostname === "open.spotify.com") {
            addSpotifyYoutubeButtons();
            return;
        }

        if (location.hostname === "soundcloud.com" || location.hostname === "www.soundcloud.com") {
            addSoundCloudYoutubeButtons();
        }
    }

    function addSpotifyYoutubeButtons() {
        const rows = document.querySelectorAll('div[data-testid="tracklist-row"]');

        rows.forEach(row => {
            const titleColumn = row.querySelector('div[aria-colindex="2"]');
            if (!titleColumn) return;

            const textContainer = Array.from(titleColumn.children).find(child =>
                child.tagName === 'DIV' && !child.classList.contains(YT_BUTTON_CLASS)
            );
            if (textContainer && textContainer.style.flex !== "1 1 0%") {
                textContainer.style.flex = "1";
                textContainer.style.minWidth = "0";
            }

            const titleEl = row.querySelector('a[data-testid="internal-track-link"]');
            if (!titleEl) return;
            const trackHref = titleEl.getAttribute('href');
            const spotifyTrackId = trackHref ? trackHref.split('/').pop() : null;
            const trackId = spotifyTrackId ? buildTrackId(spotifyTrackId) : null;
            if (!trackId) return;

            let btn = row.querySelector(`.${YT_BUTTON_CLASS}`);

            if (btn) {
                updateIcon(btn, trackId);
                if (titleColumn.lastElementChild !== btn) titleColumn.appendChild(btn);
                return;
            }

            const songName = titleEl.innerText.trim();
            const artistEls = row.querySelectorAll('a[href^="/artist/"]');
            let artistList = Array.from(artistEls).map(el => el.innerText.trim());

            if (artistList.length === 0) {
                const pageTitleEl = document.querySelector('[data-encore-id="adaptiveTitle"]');
                if (pageTitleEl) artistList.push(pageTitleEl.innerText.trim());
            }

            const artistNameString = artistList.join(" "); 
            const artistNameForSave = artistList.join(", "); 
            const ytUrl = buildYoutubeUrl(artistNameString, songName);

            btn = createYoutubeButton(trackId, songName, artistNameForSave, ytUrl);

            titleColumn.appendChild(btn);
            titleColumn.style.display = "flex";
            titleColumn.style.alignItems = "center";
        });
    }

    function addSoundCloudYoutubeButtons() {
        addSoundCloudCurrentTrackButton();

        const trackLinks = Array.from(document.querySelectorAll('a[href]')).filter(getSoundCloudTrackPathFromAnchor);
        const containers = new Set();

        trackLinks.forEach(link => {
            const container = link.closest([
                'li.soundList__item',
                '.sound',
                '.trackItem',
                '.compactTrackListItem',
                '.searchList__item',
                '.playableTile',
                '.systemPlaylistTrackList__item',
                '[data-testid*="track"]'
            ].join(",")) || link.parentElement;

            if (container) containers.add(container);
        });

        containers.forEach(container => {
            const titleLink = Array.from(container.querySelectorAll('a[href]')).find(getSoundCloudTrackPathFromAnchor);
            if (!titleLink) return;

            const trackPath = getSoundCloudTrackPathFromAnchor(titleLink);
            if (!trackPath) return;

            const trackId = buildTrackId(trackPath);
            const songName = titleFromSoundCloudAnchor(titleLink);
            if (!songName) return;

            const artistName = artistNameFromSoundCloudContainer(container, trackPath);
            const ytUrl = buildYoutubeUrl(artistName, songName);
            const existingButton = findExistingButton(container, trackId);

            if (existingButton) {
                existingButton.href = ytUrl;
                updateIcon(existingButton, trackId);
                mountSoundCloudListButton(titleLink, existingButton);
                return;
            }

            const btn = createYoutubeButton(trackId, songName, artistName, ytUrl, {
                marginLeft: "8px",
                marginRight: "4px"
            });

            mountSoundCloudListButton(titleLink, btn);
        });
    }

    function addSoundCloudCurrentTrackButton() {
        const trackPath = getSoundCloudTrackPathFromHref(location.href);
        if (!trackPath) return;

        const [artistSlug, trackSlug] = trackPath.split("/").filter(Boolean);
        const titleEl = document.querySelector([
            'h1.soundTitle__title',
            '[data-testid="track-title"]',
            'h1'
        ].join(","));
        if (!titleEl) return;

        const songName = cleanText(titleEl ? titleEl.textContent : "") || fallbackNameFromSlug(trackSlug);
        if (!songName) return;

        const artistAnchor = document.querySelector([
            'a.soundTitle__usernameText[href]',
            'a.soundTitle__username[href]'
        ].join(",")) || Array.from(document.querySelectorAll('a[href]')).find(anchor =>
            getSoundCloudProfilePathFromAnchor(anchor) === `/${artistSlug}`
        );
        const artistName = cleanText(artistAnchor ? artistAnchor.textContent : "") || fallbackNameFromSlug(artistSlug);
        const trackId = buildTrackId(trackPath);
        const ytUrl = buildYoutubeUrl(artistName, songName);
        const mount = titleEl.parentElement || document.body;
        const existingButton = findExistingButton(mount, trackId);

        if (existingButton) {
            existingButton.href = ytUrl;
            updateIcon(existingButton, trackId);
            return;
        }

        const btn = createYoutubeButton(trackId, songName, artistName, ytUrl, {
            marginLeft: "10px",
            marginRight: "0"
        });

        if (titleEl) {
            titleEl.style.display = "inline-flex";
            titleEl.style.alignItems = "center";
            titleEl.insertAdjacentElement("afterend", btn);
        }
    }

    fetchHistory();

    const observer = new MutationObserver((mutations) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => addYoutubeButtons(), 300);
    });

    observer.observe(document.body, { childList: true, subtree: true });

})();
