// ==UserScript==
// @name         Spotify/SoundCloud to YouTube (Cloud Sync + Clear + Multi-Artist + Fixes)
// @namespace    http://tampermonkey.net/
// @version      3.3
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

    // YOUR URL
    const CLOUD_URL = "YOUR_URL_HERE";

    const YT_BUTTON_CLASS = 'vm-yt-search-btn';
    let visitedTracks = new Set();
    let isHistoryLoaded = false;
    let debounceTimer = null;

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
        if (isHistoryLoaded && trackId && visitedTracks.has(trackId)) {
            buttonElement.innerHTML = visitedIconSvg;
            buttonElement.title = "Visited (Shift+Click to clear)";
            buttonElement.style.color = "#E22134";
        } else {
            buttonElement.innerHTML = ytIconSvg;
            buttonElement.title = "Search on YouTube";
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
            if (e.shiftKey) {
                if (visitedTracks.has(trackId)) {
                    visitedTracks.delete(trackId);
                    updateIcon(btn, trackId);
                    saveToCloud(trackId, `${artistNameForSave} - ${songName}`, "remove");
                }
            } else {
                if (!visitedTracks.has(trackId)) {
                    visitedTracks.add(trackId);
                    updateIcon(btn, trackId);
                    saveToCloud(trackId, `${artistNameForSave} - ${songName}`, "add");
                } else {
                    saveToCloud(trackId, `${artistNameForSave} - ${songName}`, "add");
                }
                window.open(ytUrl, '_blank');
            }
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
        const separator = CLOUD_URL.includes("?") ? "&" : "?";
        const noCacheUrl = `${CLOUD_URL}${separator}source=${encodeURIComponent(getCurrentSource())}&t=${Date.now()}`;
        
        GM_xmlhttpRequest({
            method: "GET",
            url: noCacheUrl,
            anonymous: true, // <--- THE MAGIC FIX: Prevents Google from seeing PC 2's logged-in accounts
            headers: { "Cache-Control": "no-cache" },
            redirect: "follow",
            onload: function(response) {
                try {
                    const ids = JSON.parse(response.responseText);
                    visitedTracks = new Set(ids);
                    isHistoryLoaded = true;
                    addYoutubeButtons();
                } catch (e) {
                    console.error("Cloud Error: Still getting HTML.");
                    console.error("Response:", response.responseText.substring(0, 150));
                }
            }
        });
    }

    function saveToCloud(trackId, songName, action = "add") {
        GM_xmlhttpRequest({
            method: "POST",
            url: CLOUD_URL,
            anonymous: true, // <--- THE MAGIC FIX applied here too
            data: JSON.stringify({
                id: trackId,
                name: songName,
                action: action,
                source: getCurrentSource()
            }),
            headers: { "Content-Type": "text/plain" },
            redirect: "follow",
            onload: function(response) {}
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
