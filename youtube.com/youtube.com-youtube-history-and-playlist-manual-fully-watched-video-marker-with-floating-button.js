// ==UserScript==
// @name         YouTube History/Playlist: Manual Watched Video Marker
// @namespace    http://tampermonkey.net/
// @version      18.8
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/youtube.com/youtube.com-youtube-history-and-playlist-manual-fully-watched-video-marker-with-floating-button.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/youtube.com/youtube.com-youtube-history-and-playlist-manual-fully-watched-video-marker-with-floating-button.js
// @description  Mark fully watched videos and highlight duplicate 100%-watched entries anywhere on YouTube. Gear button opens settings: duplicate check on/off, watched opacity slider (0-100).
// @author       Fahad
// @match        https://www.youtube.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
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
    // v18.6 settings (GM storage = per-script, so global across YouTube pages):
    // duplicate check on/off + watched opacity 0-100 (default 45). The opacity
    // drives one CSS var that dims the watched cards, the duplicate content,
    // the amber outline and the DUPLICATE badge together - no more hardcoding.
    const SETTINGS_KEY_DUP = 'dup-check-enabled';
    const SETTINGS_KEY_OPACITY = 'watched-opacity';
    let dupCheckEnabled = GM_getValue(SETTINGS_KEY_DUP, true) !== false;
    let watchedOpacityPct = Number(GM_getValue(SETTINGS_KEY_OPACITY, 45));
    if (!Number.isFinite(watchedOpacityPct)) watchedOpacityPct = 45;
    watchedOpacityPct = Math.min(100, Math.max(0, Math.round(watchedOpacityPct)));
    const watchedOpacityVar = (watchedOpacityPct / 100).toString();

    function applyWatchedOpacity() {
        document.documentElement.style.setProperty('--userscript-watched-opacity', (watchedOpacityPct / 100).toString());
        const label = document.getElementById('yt-marker-opacity-value');
        if (label) label.textContent = watchedOpacityPct + '%';
    }

    const css = `
        :root { --userscript-watched-opacity:${watchedOpacityVar}; }
        .userscript-watched-dimmed { opacity:var(--userscript-watched-opacity)!important; transition:opacity .2s ease!important; }
        .userscript-watched-dimmed:hover { opacity:max(var(--userscript-watched-opacity),.75)!important; }
        .userscript-watched-dimmed yt-thumbnail-overlay-progress-bar-view-model,
        .userscript-watched-dimmed yt-thumbnail-overlay-progress-bar-view-model *,
        .userscript-watched-dimmed ytd-thumbnail-overlay-resume-playback-renderer,
        .userscript-watched-dimmed ytd-thumbnail-overlay-resume-playback-renderer * {
            opacity:1!important; filter:none!important;
        }
        /* YouTube hides the native watched bar on hover (re-render + height
           collapse). The width % is inline on the inner elements, so only
           visibility is forced here; the JS hover watcher restores each
           element's real recorded height, keeping YouTube's natural look
           (thin bar when partially watched, full overlay when 100% watched). */
        html ytd-thumbnail:hover yt-thumbnail-overlay-progress-bar-view-model,
        html yt-thumbnail-view-model:hover yt-thumbnail-overlay-progress-bar-view-model,
        html ytd-thumbnail:hover ytd-thumbnail-overlay-resume-playback-renderer,
        html ytd-thumbnail:hover ytd-thumbnail-overlay-resume-playback-renderer #progress,
        html ytd-thumbnail:hover #progress.ytd-thumbnail-overlay-resume-playback-renderer,
        html ytd-thumbnail:hover .ytThumbnailOverlayProgressBarHostWatchedProgressBar,
        html yt-thumbnail-view-model:hover .ytThumbnailOverlayProgressBarHostWatchedProgressBar,
        html ytd-thumbnail:hover .ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment,
        html yt-thumbnail-view-model:hover .ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment {
            display:block!important; visibility:visible!important; opacity:1!important;
            z-index:10000!important; pointer-events:none!important;
        }
        .userscript-duplicate-watched {
            opacity:1!important; outline:4px solid rgba(255,179,0,var(--userscript-watched-opacity))!important;
            outline-offset:3px!important; border-radius:6px!important;
            background:rgba(255,179,0,.12)!important;
        }
        /* v18.4: duplicates are 100% watched too, so their content dims like
           any watched card - but the dim lives on the children, not the card.
           Dimming the card would wash out the amber outline + DUPLICATE badge
           (both paint with the card); the children carry the thumbnail, title
           and metadata, so they take the .45 dim / .75 hover instead.
           v18.5: the outline is dimmed too (rgba .45, .75 on hover) - the
           full-strength amber border was louder than the dimmed card.
           v18.6: no more hardcoded .45 - the slider in the settings panel
           (gear button, bottom-right) sets --userscript-watched-opacity
           0-100; it drives the card dim, duplicate content, outline alpha
           and badge alpha together. Hover always reveals at .75 minimum,
           so a card dimmed to 0 still shows on hover.
           v18.7: the panel was built with innerHTML - YouTube enforces
           Trusted Types, so that assignment throws and the panel never
           appeared (gear button worked, panel didn't). The panel is now
           built with createElement/textContent like the nav widget.
           Never use innerHTML in a YouTube userscript.
           v18.8: the gear button needed two clicks the first time -
           the toggle read the INLINE display ('' at first; the panel
           is hidden by the stylesheet rule, not inline). It now reads
           the computed display, so one click opens it. */
        .userscript-duplicate-watched > * { opacity:var(--userscript-watched-opacity)!important; transition:opacity .2s ease!important; }
        .userscript-duplicate-watched:hover { opacity:1!important; outline-color:rgba(255,179,0,max(var(--userscript-watched-opacity),.75))!important; }
        .userscript-duplicate-watched:hover > * { opacity:max(var(--userscript-watched-opacity),.75)!important; }
        .userscript-duplicate-watched::before {
            content:'DUPLICATE · 100% WATCHED'; display:inline-block; position:relative;
            z-index:2; margin:4px; padding:4px 8px; border-radius:3px;
            background:rgba(255,179,0,var(--userscript-watched-opacity))!important; color:#111; font:700 11px/1.2 Roboto,Arial,sans-serif;
        }
        .userscript-duplicate-watched:hover::before { background:rgba(255,179,0,max(var(--userscript-watched-opacity),.75))!important; }
        .userscript-duplicate-current {
            outline-color:#00e5ff!important; box-shadow:0 0 0 6px rgba(0,229,255,.3)!important;
        }
        .userscript-duplicate-watched.userscript-duplicate-current:hover {
            outline-color:#00e5ff!important;
        }
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
        #yt-marker-settings-btn {
            position:fixed; right:30px; bottom:146px; z-index:99999; width:40px; height:40px;
            border:1px solid #555; border-radius:50%; background:rgba(20,20,20,.96); color:#fff;
            cursor:pointer; font-size:18px; line-height:1; box-shadow:0 4px 12px rgba(0,0,0,.5);
        }
        #yt-marker-settings-btn:hover { background:#333; }
        #yt-marker-settings {
            position:fixed; right:30px; bottom:196px; z-index:99999; width:230px; display:none;
            padding:12px; border:1px solid #555; border-radius:8px; background:rgba(20,20,20,.96);
            color:#fff; box-shadow:0 4px 12px rgba(0,0,0,.5); font:400 13px Roboto,Arial,sans-serif;
        }
        .yt-marker-settings-title { display:flex; justify-content:space-between; align-items:center; font-weight:700; margin-bottom:10px; }
        #yt-marker-settings-close { border:0; background:transparent; color:#aaa; cursor:pointer; font-size:14px; padding:2px 6px; }
        #yt-marker-settings-close:hover { color:#fff; }
        .yt-marker-settings-row { display:flex; justify-content:space-between; align-items:center; margin:8px 0; cursor:pointer; }
        .yt-marker-settings-row input[type="checkbox"] { width:16px; height:16px; cursor:pointer; }
        #yt-marker-opacity-slider { width:100%; cursor:pointer; accent-color:#ffb300; }
        #yt-marker-opacity-value { color:#ffb300; font-weight:700; }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).append(style);

    let duplicateEntries = [];
    let duplicateIndex = -1;
    let scanTimer = 0;
    let hoveredCard = null;
    let hoverRestoreTimer = 0;
    // Video IDs seen as fully watched on this page session. During hover the
    // native bar is hidden, so a re-scan would otherwise un-mark cards that
    // are still watched. Persisting the IDs keeps the dim/duplicate marks on.
    let watchedIds = new Set();
    const barSnapshots = new WeakMap();

    function isSupportedPage() {
        // v18.3: run everywhere, not just /feed/history and /playlist. Home,
        // search, subs, trending, etc. all render the same card types, and the
        // custom .ytp-thumb-bar progress comes from the neon tracker, so dimming
        // fully-watched videos works on every YouTube surface.
        return true;
    }

    // Duplicate detection is a history-page feature: it flags the same fully-
    // watched video listed twice in the history feed. Everywhere else the same
    // video can legitimately appear in several sections (home rows, subs,
    // channel grids), so never mark it as a duplicate outside history.
    function isHistoryPage() {
        return location.pathname.replace(/\/+$/, '') === '/feed/history';
    }

    // YouTube nests card renderers (ytd-rich-item-renderer wraps yt-lockup-view-
    // model on channel/home/search pages), so one thumbnail can match CARD_SELECTOR
    // twice with the same video id. That doubled every mark (dim applied twice,
    // false "duplicate" on a single thumbnail). Only the OUTERMOST matched card
    // per thumbnail should count.
    function isNestedCard(card) {
        return !!(card.parentElement && card.parentElement.closest(CARD_SELECTOR));
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

    // YouTube hides the native watched bar on hover (height:0 on the legacy
    // resume-playback renderer, and the new progress-bar-view-model host gets
    // re-rendered away too). CSS alone can't win against their inline rules,
    // so on hover we force inline styles back onto the bar and re-inject a
    // clone if YouTube removed the element entirely.
    const BAR_FORCE = [
        'yt-thumbnail-overlay-progress-bar-view-model',
        'ytd-thumbnail-overlay-resume-playback-renderer',
        '#progress.ytd-thumbnail-overlay-resume-playback-renderer'
    ].join(',');

    function forceNativeBar(card) {
        const snap = barSnapshots.get(card);
        card.querySelectorAll(BAR_FORCE).forEach((el) => {
            el.style.setProperty('display', 'block', 'important');
            el.style.setProperty('visibility', 'visible', 'important');
            el.style.setProperty('opacity', '1', 'important');
            // Restore the real height captured before hover. YouTube collapses
            // these to 0 on hover; forcing 2px distorted fully-watched videos
            // (their official overlay is the whole thumbnail height).
            const h = snap && snap.heights && snap.heights.get(el);
            if (h) el.style.setProperty('height', h + 'px', 'important');
            el.style.setProperty('z-index', '10000', 'important');
            el.style.setProperty('pointer-events', 'none', 'important');
        });
        card.querySelectorAll('.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment').forEach((el) => {
            el.style.setProperty('display', 'block', 'important');
            el.style.setProperty('visibility', 'visible', 'important');
            el.style.setProperty('opacity', '1', 'important');
            const h = snap && snap.heights && snap.heights.get(el);
            if (h) el.style.setProperty('height', h + 'px', 'important');
        });
        if (card.querySelector(BAR_FORCE)) return;
        // Element was removed from the DOM: re-inject a clone from the last
        // snapshot so the bar keeps showing during hover.
        const host = card.querySelector('ytd-thumbnail, yt-thumbnail-view-model, #thumbnail');
        if (!snap || !host || host.querySelector(':scope > .userscript-native-bar-restore')) return;
        const clone = snap.clone.cloneNode(true);
        clone.classList.add('userscript-native-bar-restore');
        Object.assign(clone.style, {
            position: 'absolute', left: '0', right: '0', bottom: '0',
            zIndex: '10000', pointerEvents: 'none'
        });
        const h = snap.heights && snap.heights.get(snap.original);
        if (h) clone.style.setProperty('height', h + 'px', 'important');
        host.style.position = host.style.position === 'static' ? 'relative' : host.style.position;
        host.appendChild(clone);
    }

    function onCardEnter(card) {
        hoveredCard = card;
        clearTimeout(hoverRestoreTimer);
        hoverRestoreTimer = setTimeout(() => {
            if (hoveredCard && hoveredCard.isConnected) forceNativeBar(hoveredCard);
        }, 80);
    }

    function onCardLeave() {
        hoveredCard = null;
        clearTimeout(hoverRestoreTimer);
        document.querySelectorAll('.userscript-native-bar-restore').forEach((el) => el.remove());
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

    function runFilterOnce() {
        if (!isSupportedPage()) return;
        const fullyWatched = [];
        const byVideoId = new Map();

        document.querySelectorAll(CARD_SELECTOR).forEach((card) => {
            if (isNestedCard(card)) return;
            const native = card.querySelector(NATIVE_PROGRESS_SELECTOR);
            if (native) {
                const heights = new Map();
                card.querySelectorAll(BAR_FORCE + ', .ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment')
                    .forEach((el) => {
                        const h = el.getBoundingClientRect().height;
                        if (h > 0) heights.set(el, h);
                    });
                if (!heights.has(native)) {
                    const h = native.getBoundingClientRect().height;
                    if (h > 0) heights.set(native, h);
                }
                barSnapshots.set(card, { clone: native.cloneNode(true), original: native, heights });
            }
            const id = getVideoId(card);
            // A card whose bar is hidden right now (hover preview) still counts
            // as watched if we detected it earlier on this page.
            if (!isFullyWatched(card) && !(id && watchedIds.has(id))) return;
            if (id) watchedIds.add(id);
            fullyWatched.push(card);
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
        if (isHistoryPage() && dupCheckEnabled) {
            byVideoId.forEach((entries) => { if (entries.length > 1) duplicates.push(...entries); });
        }
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
    }

    function scheduleScan() {
        if (!isSupportedPage()) return;
        clearTimeout(scanTimer);
        scanTimer = setTimeout(() => runFilterOnce(), 350);
    }

    function toggleSettingsPanel() {
        const panel = document.getElementById('yt-marker-settings');
        if (!panel) return;
        panel.style.display = getComputedStyle(panel).display === 'none' ? 'block' : 'none';
    }

    function createInterface() {
        if (!isSupportedPage() || !document.body) return;
        if (isHistoryPage() && !document.getElementById('yt-duplicate-nav')) {
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
        if (!document.getElementById('yt-marker-settings-btn')) {
            const btn = document.createElement('button');
            btn.id = 'yt-marker-settings-btn';
            btn.type = 'button';
            btn.textContent = '\u2699\uFE0F';
            btn.title = 'Watched marker settings';
            btn.addEventListener('click', toggleSettingsPanel);
            document.body.appendChild(btn);
        }
        if (!document.getElementById('yt-marker-settings')) {
            const panel = document.createElement('div');
            panel.id = 'yt-marker-settings';
            const title = document.createElement('div');
            title.className = 'yt-marker-settings-title';
            title.textContent = 'marker settings';
            const close = document.createElement('button');
            close.id = 'yt-marker-settings-close';
            close.type = 'button';
            close.title = 'Close';
            close.textContent = '\u2715';
            close.addEventListener('click', toggleSettingsPanel);
            title.appendChild(close);
            const dupRow = document.createElement('label');
            dupRow.className = 'yt-marker-settings-row';
            const dupLabel = document.createElement('span');
            dupLabel.textContent = 'duplicate check';
            const toggle = document.createElement('input');
            toggle.id = 'yt-marker-dup-toggle';
            toggle.type = 'checkbox';
            toggle.checked = dupCheckEnabled;
            toggle.addEventListener('change', (e) => {
                dupCheckEnabled = e.target.checked;
                GM_setValue(SETTINGS_KEY_DUP, dupCheckEnabled);
                scheduleScan();
            });
            dupRow.append(dupLabel, toggle);
            const opRow = document.createElement('div');
            opRow.className = 'yt-marker-settings-row';
            const opLabel = document.createElement('span');
            opLabel.textContent = 'watched opacity';
            const opValue = document.createElement('span');
            opValue.id = 'yt-marker-opacity-value';
            opValue.textContent = watchedOpacityPct + '%';
            opRow.append(opLabel, opValue);
            const slider = document.createElement('input');
            slider.id = 'yt-marker-opacity-slider';
            slider.type = 'range';
            slider.min = '0';
            slider.max = '100';
            slider.step = '1';
            slider.value = String(watchedOpacityPct);
            slider.addEventListener('input', () => {
                watchedOpacityPct = Number(slider.value);
                applyWatchedOpacity();
            });
            slider.addEventListener('change', () => {
                GM_setValue(SETTINGS_KEY_OPACITY, watchedOpacityPct);
            });
            panel.append(title, dupRow, opRow, slider);
            document.body.appendChild(panel);
        }
        scheduleScan();
    }

    function removeInterface() {
        clearTimeout(scanTimer);
        document.getElementById('yt-duplicate-nav')?.remove();
        document.getElementById('yt-marker-settings-btn')?.remove();
        document.getElementById('yt-marker-settings')?.remove();
        document.querySelectorAll('.userscript-watched-dimmed,.userscript-duplicate-watched,.userscript-duplicate-current')
            .forEach((card) => card.classList.remove(
                'userscript-watched-dimmed', 'userscript-duplicate-watched', 'userscript-duplicate-current'
            ));
        duplicateEntries = [];
        duplicateIndex = -1;
        watchedIds = new Set();
        document.querySelectorAll('.userscript-native-bar-restore').forEach((el) => el.remove());
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
            mutation.attributeName === 'aria-valuenow' ||
            mutation.attributeName === 'class'
        )) {
            // YouTube tracks hover with the ytSpecTouchFeedbackShapeHovered
            // class on the touch-feedback layer; drive the bar force off that
            // instead of mouse events, which lag or fire on the wrong targets.
            const shape = document.querySelector('.ytSpecTouchFeedbackShapeHovered');
            const card = shape ? shape.closest(CARD_SELECTOR) : null;
            if (card && card !== hoveredCard) onCardEnter(card);
            else if (!card && hoveredCard) onCardLeave();
            scheduleScan();
        }
    });
    observer.observe(document.documentElement, {
        childList:true, subtree:true, attributes:true,
        attributeFilter:['style', 'aria-valuenow', 'class']
    });

    handlePageChange();
    window.addEventListener('yt-navigate-finish', handlePageChange);
    window.addEventListener('popstate', handlePageChange);
})();
