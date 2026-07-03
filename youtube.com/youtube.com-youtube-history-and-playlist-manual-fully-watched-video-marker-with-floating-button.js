// ==UserScript==
// @name         YouTube History/Playlist: Manual Watched Video Marker
// @namespace    http://tampermonkey.net/
// @version      16.1
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/youtube.com/youtube.com-youtube-history-and-playlist-manual-fully-watched-video-marker-with-floating-button.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/youtube.com/youtube.com-youtube-history-and-playlist-manual-fully-watched-video-marker-with-floating-button.js
// @description  Click button to mark fully watched videos in gray on History and Playlists using modern YouTube selectors.
// @author       Fahad
// @match        https://www.youtube.com/*
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    // 1. CSS: Dim watched videos without removing them from the page
    const css = `
        /* Gray-out watched videos instead of hiding (safer UX) */
        .userscript-watched-dimmed {
            opacity: 0.45 !important;
            transition: opacity 0.2s ease !important;
        }
        .userscript-watched-dimmed:hover {
            opacity: 0.75 !important;
        }
        /* Keep watched progress bar fully visible even when card is dimmed */
        .userscript-watched-dimmed yt-thumbnail-overlay-progress-bar-view-model,
        .userscript-watched-dimmed yt-thumbnail-overlay-progress-bar-view-model *,
        .userscript-watched-dimmed ytd-thumbnail-overlay-resume-playback-renderer,
        .userscript-watched-dimmed ytd-thumbnail-overlay-resume-playback-renderer * {
            opacity: 1 !important;
            filter: none !important;
        }

        /* The Manual Trigger Button */
        #yt-manual-filter-btn {
            position: fixed;
            bottom: 30px;
            right: 30px;
            z-index: 99999;
            padding: 15px 20px;
            background-color: #cc0000;
            color: white;
            font-family: Roboto, Arial, sans-serif;
            font-size: 14px;
            font-weight: bold;
            text-transform: uppercase;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            box-shadow: 0 4px 10px rgba(0,0,0,0.5);
            transition: background 0.2s;
        }
        #yt-manual-filter-btn:hover { background-color: #aa0000; }
        #yt-manual-filter-btn:active { transform: translateY(2px); }
    `;

    // Inject CSS
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);

    // 2. The marker logic (runs ONLY when clicked)
    function runFilterOnce() {
        console.log(">>> Running Filter on ALL loaded videos... <<<");

        // Primary strategy: detect watched-progress segments directly (new YouTube DOM).
        const watchedSegments = document.querySelectorAll(
            'yt-thumbnail-overlay-progress-bar-view-model .ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment,' +
            'ytd-thumbnail-overlay-resume-playback-renderer #progress'
        );

        if (watchedSegments.length === 0) {
            alert("No videos found. Make sure you are on the History page and videos are loaded.");
            return;
        }

        let markedCount = 0;
        const touched = new Set();

        watchedSegments.forEach((seg) => {
            const styleWidth = seg.style && seg.style.width ? seg.style.width : '';
            const match = styleWidth.match(/(\d+(?:\.\d+)?)%/);
            if (!match) return;
            const progressPercent = parseFloat(match[1]);

            // Only mark truly complete items. Near-complete bars should stay unmarked.
            if (progressPercent < 100) return;

            const container = seg.closest(
                'ytd-video-renderer, ytd-rich-item-renderer, ytd-rich-grid-media, ytd-grid-video-renderer, ' +
                'ytd-compact-video-renderer, ytd-playlist-video-renderer, yt-lockup-view-model'
            );
            if (!container) return;

            if (!touched.has(container)) {
                touched.add(container);
                container.classList.add('userscript-watched-dimmed');
                markedCount++;
            }
        });

        // If a card is no longer fully watched on rerun, restore normal style.
        document.querySelectorAll('.userscript-watched-dimmed').forEach((el) => {
            if (!touched.has(el)) {
                el.classList.remove('userscript-watched-dimmed');
            }
        });

        console.log(`Filter Complete. Marked watched: ${markedCount} / Segments checked: ${watchedSegments.length}`);

        // Update button text briefly to show success
        const btn = document.getElementById('yt-manual-filter-btn');
        if (btn) {
            const originalText = btn.innerText;
            btn.innerText = `MARKED ${markedCount}`;
            setTimeout(() => { btn.innerText = originalText; }, 2000);
        }
    }

    // 3. Create the Button
    function createButton() {
        if (document.getElementById('yt-manual-filter-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'yt-manual-filter-btn';
        btn.innerText = "MARK WATCHED";
        btn.onclick = runFilterOnce;

        console.debug("NeverSeen: Adding manual filter button.");

        document.body.appendChild(btn);
    }

    // Helper: Only keep the button on the History or Playlist pages
    function isSupportedPage() {
        // Use pathname to avoid query params. Handles leading/trailing slashes.
        const path = window.location.pathname.replace(/\/+$/, '');
        return path === '/feed/history' || path === '/playlist';
    }

    // Remove the button if it exists
    function removeButton() {
        const btn = document.getElementById('yt-manual-filter-btn');
        if (btn) btn.remove();
        console.debug("NeverSeen: Removed manual filter button.");
    }

    // Add button after a slight delay to ensure page init, but only on supported pages (History or Playlist)
    function maybeCreateButton() {
        if (isSupportedPage()) {
            setTimeout(createButton, 1500);
        } else {
            removeButton();
        }
    }

    // Initial run
    maybeCreateButton();

    // YouTube is an SPA; hook into navigation events to add/remove the button dynamically
    // 'yt-navigate-finish' is fired by YouTube when client-side navigation completes.
    window.addEventListener('yt-navigate-finish', maybeCreateButton);
    // Fallbacks for browsers or platforms that may not emit the YouTube custom event
    window.addEventListener('popstate', maybeCreateButton);

})();
