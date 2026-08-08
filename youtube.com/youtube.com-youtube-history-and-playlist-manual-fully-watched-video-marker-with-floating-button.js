// ==UserScript==
// @name         YouTube History/Playlist: Manual Watched Video Marker
// @namespace    http://tampermonkey.net/
// @version      17.2
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/youtube.com/youtube.com-youtube-history-and-playlist-manual-fully-watched-video-marker-with-floating-button.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/youtube.com/youtube.com-youtube-history-and-playlist-manual-fully-watched-video-marker-with-floating-button.js
// @description  Mark fully watched videos and highlight duplicate 100%-watched entries on YouTube History and Playlists.
// @author       Fahad
// @match        https://www.youtube.com/*
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    const CARD_SELECTOR = [
        'ytd-video-renderer', 'ytd-rich-item-renderer', 'ytd-rich-grid-media',
        'ytd-grid-video-renderer', 'ytd-compact-video-renderer',
        'ytd-playlist-video-renderer', 'yt-lockup-view-model'
    ].join(',');
    const NATIVE_PROGRESS_SELECTOR = [
        'yt-thumbnail-overlay-progress-bar-view-model .ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment',
        'ytd-thumbnail-overlay-resume-playback-renderer #progress'
    ].join(',');
    // The custom tracker bar sets .done (cyan) only when the video actually
    // reached its end. Reading the bar's width instead is unreliable: older
    // tracker builds rounded 99.95% up to a 100% wide bar. When our tracker
    // has data for a video, it wins over YouTube's native bars.
    const CUSTOM_BAR_SELECTOR = '.ytp-thumb-bar';

    const css = `
        .userscript-watched-dimmed { opacity:.45!important; transition:opacity .2s ease!important; }
        .userscript-watched-dimmed:hover { opacity:.75!important; }
        .userscript-watched-dimmed yt-thumbnail-overlay-progress-bar-view-model,
        .userscript-watched-dimmed yt-thumbnail-overlay-progress-bar-view-model *,
        .userscript-watched-dimmed ytd-thumbnail-overlay-resume-playback-renderer,
        .userscript-watched-dimmed ytd-thumbnail-overlay-resume-playback-renderer * {
            opacity:1!important; filter:none!important;
        }
        .userscript-duplicate-watched {
            opacity:1!important; outline:4px solid #ffb300!important;
            outline-offset:3px!important; border-radius:6px!important;
            background:rgba(255,179,0,.12)!important;
        }
        .userscript-duplicate-watched::before {
            content:'DUPLICATE · 100% WATCHED'; display:inline-block; position:relative;
            z-index:2; margin:4px; padding:4px 8px; border-radius:3px;
            background:#ffb300; color:#111; font:700 11px/1.2 Roboto,Arial,sans-serif;
        }
        .userscript-duplicate-current {
            outline-color:#00e5ff!important; box-shadow:0 0 0 6px rgba(0,229,255,.3)!important;
        }
        #yt-manual-filter-btn {
            position:fixed; right:30px; bottom:30px; z-index:99999; padding:15px 20px;
            border:0; border-radius:4px; background:#c00; color:#fff;
            box-shadow:0 4px 10px rgba(0,0,0,.5); cursor:pointer;
            font:700 14px Roboto,Arial,sans-serif; text-transform:uppercase;
        }
        #yt-manual-filter-btn:hover { background:#a00; }
        #yt-duplicate-nav {
            position:fixed; right:30px; bottom:92px; z-index:99999; display:none;
            align-items:center; gap:6px; padding:8px; border:1px solid #555;
            border-radius:6px; background:rgba(20,20,20,.96); color:#fff;
            box-shadow:0 4px 12px rgba(0,0,0,.5); font:500 12px Roboto,Arial,sans-serif;
        }
        #yt-duplicate-nav button {
            min-width:34px; padding:6px 9px; border:0; border-radius:3px;
            background:#3f3f3f; color:#fff; cursor:pointer; font-weight:700;
        }
        #yt-duplicate-nav button:hover { background:#606060; }
        #yt-duplicate-nav-status { min-width:92px; text-align:center; }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).append(style);

    let duplicateEntries = [];
    let duplicateIndex = -1;
    let scanTimer = 0;
    let feedbackTimer = 0;

    function isSupportedPage() {
        const path = location.pathname.replace(/\/+$/, '');
        return path === '/feed/history' || path === '/playlist';
    }

    function getVideoId(card) {
        for (const link of card.querySelectorAll('a[href*="/watch"],a[href*="youtu.be/"]')) {
            try {
                const url = new URL(link.href, location.origin);
                const id = url.hostname === 'youtu.be'
                    ? url.pathname.split('/').filter(Boolean)[0]
                    : url.searchParams.get('v');
                if (id) return id;
            } catch (_) {}
        }
        return null;
    }

    function readPercent(segment) {
        const candidates = [
            segment.style && segment.style.width,
            segment.getAttribute('aria-valuenow'),
            segment.getAttribute('data-progress'),
            segment.getAttribute('data-percent')
        ];
        for (const value of candidates) {
            const match = String(value || '').match(/(\d+(?:\.\d+)?)\s*%?/);
            if (match && Number.isFinite(Number(match[1]))) return Number(match[1]);
        }
        const transform = (segment.getAttribute('style') || '')
            .match(/scaleX\(\s*(\d+(?:\.\d+)?)\s*\)/i);
        if (transform) return Number(transform[1]) * 100;
        const parent = segment.parentElement;
        if (parent) {
            const width = segment.getBoundingClientRect().width;
            const parentWidth = parent.getBoundingClientRect().width;
            if (width > 0 && parentWidth > 0) return width / parentWidth * 100;
        }
        return null;
    }

    function isFullyWatched(card) {
        // When our tracker has data for this video, it is the source of truth:
        // done (cyan) means fully watched, anything else means not, regardless
        // of what YouTube's native bars say.
        const customBar = card.querySelector(CUSTOM_BAR_SELECTOR);
        if (customBar) return customBar.classList.contains('done');
        // No tracker data: fall back to YouTube's native bars, only trusting a
        // segment that is actually full.
        return Array.from(card.querySelectorAll(NATIVE_PROGRESS_SELECTOR)).some((segment) => {
            const percent = readPercent(segment);
            return percent !== null && percent >= 99.99;
        });
    }

    function updateNavigation() {
        const nav = document.getElementById('yt-duplicate-nav');
        const status = document.getElementById('yt-duplicate-nav-status');
        if (!nav || !status) return;
        nav.style.display = duplicateEntries.length ? 'flex' : 'none';
        if (!duplicateEntries.length) {
            duplicateIndex = -1;
            status.textContent = 'No duplicates';
        } else {
            if (duplicateIndex >= duplicateEntries.length) duplicateIndex = 0;
            status.textContent = duplicateIndex < 0
                ? `${duplicateEntries.length} duplicates`
                : `${duplicateIndex + 1} / ${duplicateEntries.length}`;
        }
    }

    function goToDuplicate(direction) {
        if (!duplicateEntries.length) return;
        document.querySelectorAll('.userscript-duplicate-current')
            .forEach((entry) => entry.classList.remove('userscript-duplicate-current'));
        duplicateIndex = duplicateIndex < 0
            ? (direction > 0 ? 0 : duplicateEntries.length - 1)
            : (duplicateIndex + direction + duplicateEntries.length) % duplicateEntries.length;
        const target = duplicateEntries[duplicateIndex];
        target.classList.add('userscript-duplicate-current');
        target.scrollIntoView({ behavior:'smooth', block:'center' });
        updateNavigation();
    }

    function runFilterOnce(showFeedback = true) {
        if (!isSupportedPage()) return;
        const fullyWatched = [];
        const byVideoId = new Map();

        document.querySelectorAll(CARD_SELECTOR).forEach((card) => {
            if (!isFullyWatched(card)) return;
            fullyWatched.push(card);
            const id = getVideoId(card);
            if (!id) return;
            if (!byVideoId.has(id)) byVideoId.set(id, []);
            byVideoId.get(id).push(card);
        });

        const watchedSet = new Set(fullyWatched);
        document.querySelectorAll('.userscript-watched-dimmed').forEach((card) => {
            if (!watchedSet.has(card)) card.classList.remove('userscript-watched-dimmed');
        });
        fullyWatched.forEach((card) => card.classList.add('userscript-watched-dimmed'));

        const duplicates = [];
        byVideoId.forEach((entries) => { if (entries.length > 1) duplicates.push(...entries); });
        const duplicateSet = new Set(duplicates);
        document.querySelectorAll('.userscript-duplicate-watched').forEach((card) => {
            if (!duplicateSet.has(card)) {
                card.classList.remove('userscript-duplicate-watched', 'userscript-duplicate-current');
            }
        });
        duplicates.forEach((card) => card.classList.add('userscript-duplicate-watched'));
        duplicateEntries = duplicates.filter((card) => card.isConnected);
        if (!duplicateEntries.includes(document.querySelector('.userscript-duplicate-current'))) {
            duplicateIndex = -1;
        }
        updateNavigation();

        console.log(`Filter complete. Fully watched: ${fullyWatched.length}; duplicate entries: ${duplicateEntries.length}.`);
        if (showFeedback) {
            const button = document.getElementById('yt-manual-filter-btn');
            if (button) {
                clearTimeout(feedbackTimer);
                button.textContent = `WATCHED ${fullyWatched.length} · DUPES ${duplicateEntries.length}`;
                feedbackTimer = setTimeout(() => { button.textContent = 'MARK WATCHED'; }, 2500);
            }
        }
    }

    function scheduleScan() {
        if (!isSupportedPage()) return;
        clearTimeout(scanTimer);
        scanTimer = setTimeout(() => runFilterOnce(false), 350);
    }

    function createInterface() {
        if (!isSupportedPage() || !document.body) return;
        if (!document.getElementById('yt-manual-filter-btn')) {
            const button = document.createElement('button');
            button.id = 'yt-manual-filter-btn';
            button.type = 'button';
            button.textContent = 'MARK WATCHED';
            button.addEventListener('click', () => runFilterOnce(true));
            document.body.appendChild(button);
        }
        if (!document.getElementById('yt-duplicate-nav')) {
            const nav = document.createElement('div');
            nav.id = 'yt-duplicate-nav';
            nav.setAttribute('role', 'navigation');
            nav.setAttribute('aria-label', 'Duplicate watched video navigation');
            const previous = document.createElement('button');
            previous.type = 'button';
            previous.textContent = '◀';
            previous.title = 'Previous duplicate';
            previous.addEventListener('click', () => goToDuplicate(-1));
            const status = document.createElement('span');
            status.id = 'yt-duplicate-nav-status';
            const next = document.createElement('button');
            next.type = 'button';
            next.textContent = '▶';
            next.title = 'Next duplicate';
            next.addEventListener('click', () => goToDuplicate(1));
            nav.append(previous, status, next);
            document.body.appendChild(nav);
        }
        scheduleScan();
    }

    function removeInterface() {
        clearTimeout(scanTimer);
        document.getElementById('yt-manual-filter-btn')?.remove();
        document.getElementById('yt-duplicate-nav')?.remove();
        document.querySelectorAll('.userscript-watched-dimmed,.userscript-duplicate-watched,.userscript-duplicate-current')
            .forEach((card) => card.classList.remove(
                'userscript-watched-dimmed', 'userscript-duplicate-watched', 'userscript-duplicate-current'
            ));
        duplicateEntries = [];
        duplicateIndex = -1;
    }

    function handlePageChange() {
        if (isSupportedPage()) setTimeout(createInterface, 500);
        else removeInterface();
    }

    const observer = new MutationObserver((mutations) => {
        if (!isSupportedPage()) return;
        if (mutations.some((mutation) =>
            mutation.type === 'childList' ||
            mutation.attributeName === 'style' ||
            mutation.attributeName === 'aria-valuenow'
        )) scheduleScan();
    });
    observer.observe(document.documentElement, {
        childList:true, subtree:true, attributes:true,
        attributeFilter:['style', 'aria-valuenow']
    });

    handlePageChange();
    window.addEventListener('yt-navigate-finish', handlePageChange);
    window.addEventListener('popstate', handlePageChange);
})();
