// ==UserScript==
// @name         YouTube Studio Game Title Internal Updater
// @namespace    http://tampermonkey.net/
// @version      0.1
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/youtube.com/studio.youtube.com-game-title-internal-updater.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/youtube.com/studio.youtube.com-game-title-internal-updater.js
// @description  Captures and applies exact YouTube Studio game title KG entity ids through Studio's internal metadata endpoint.
// @author       Fahad
// @match        https://studio.youtube.com/video/*/edit*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const SCRIPT_ID = 'yt-game-title-internal-updater';
    const STORAGE_KEY = 'yt-game-title-internal-updater-v1';
    const LOG_PREFIX = '[YT Game Title Updater]';
    const KG_ENTITY_RE = /^\/g\/[A-Za-z0-9_/-]+$/;
    const DEFAULT_STATE = {
        dryRun: true,
        mappings: {},
        lastCapture: null,
        lastShape: null,
        logs: []
    };

    function nowIso() {
        return new Date().toISOString();
    }

    function safeParseJson(text) {
        if (!text || typeof text !== 'string') return null;
        try {
            return JSON.parse(text);
        } catch (_) {
            return null;
        }
    }

    function loadState() {
        const parsed = safeParseJson(localStorage.getItem(STORAGE_KEY));
        return Object.assign({}, DEFAULT_STATE, parsed || {}, {
            mappings: Object.assign({}, DEFAULT_STATE.mappings, parsed && parsed.mappings ? parsed.mappings : {}),
            logs: Array.isArray(parsed && parsed.logs) ? parsed.logs.slice(-80) : []
        });
    }

    let state = loadState();

    function saveState() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }

    function appendLog(message, level = 'info') {
        const entry = { time: nowIso(), level, message };
        state.logs.push(entry);
        state.logs = state.logs.slice(-80);
        saveState();
        console[level === 'error' ? 'error' : 'log'](`${LOG_PREFIX} ${message}`);
        render();
    }

    function normalizeGameName(value) {
        return (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function getVideoIdFromUrl() {
        const match = location.pathname.match(/^\/video\/([^/]+)\/edit/);
        return match ? decodeURIComponent(match[1]) : '';
    }

    function getYtcfg(key) {
        return window.ytcfg && typeof window.ytcfg.get === 'function'
            ? window.ytcfg.get(key)
            : undefined;
    }

    function getInnertubeContext() {
        return getYtcfg('INNERTUBE_CONTEXT') || {};
    }

    function getInnertubeApiKey() {
        return getYtcfg('INNERTUBE_API_KEY') || getYtcfg('innertubeApiKey') || '';
    }

    function getCookieValue(name) {
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = document.cookie.match(new RegExp(`(?:^|; )${escapedName}=([^;]*)`));
        return match ? decodeURIComponent(match[1]) : '';
    }

    function getSapisidCookie() {
        const candidates = ['SAPISID', '__Secure-3PAPISID', '__Secure-1PAPISID'];
        for (const name of candidates) {
            const value = getCookieValue(name);
            if (value) {
                return { name, value };
            }
        }
        return null;
    }

    async function sha1Hex(value) {
        const bytes = new TextEncoder().encode(value);
        const digest = await crypto.subtle.digest('SHA-1', bytes);
        return Array.from(new Uint8Array(digest))
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('');
    }

    async function buildAuthorizationHeader() {
        const cookie = getSapisidCookie();
        if (!cookie) {
            return null;
        }

        const timestamp = Math.floor(Date.now() / 1000);
        const origin = location.origin;
        const hash = await sha1Hex(`${timestamp} ${cookie.value} ${origin}`);
        return {
            value: `SAPISIDHASH ${timestamp}_${hash}`,
            cookieName: cookie.name
        };
    }

    function findGameTitleNode(value) {
        if (!value || typeof value !== 'object') return null;
        if (value.gameTitle && value.gameTitle.newKgEntityId) {
            return { path: 'gameTitle', node: value.gameTitle };
        }
        if (value.metadata && value.metadata.gameTitle && value.metadata.gameTitle.newKgEntityId) {
            return { path: 'metadata.gameTitle', node: value.metadata.gameTitle };
        }

        for (const key of Object.keys(value)) {
            const child = value[key];
            if (child && typeof child === 'object') {
                const found = findGameTitleNode(child);
                if (found) return found;
            }
        }

        return null;
    }

    function sanitizeUrl(url) {
        try {
            const parsed = new URL(url, location.origin);
            parsed.searchParams.delete('key');
            parsed.searchParams.delete('prettyPrint');
            return parsed.toString();
        } catch (_) {
            return String(url || '').replace(/([?&]key=)[^&]+/i, '$1<redacted>');
        }
    }

    function getRequestBodyText(input, init) {
        if (init && typeof init.body === 'string') return init.body;
        if (typeof input === 'object' && input && typeof input.body === 'string') return input.body;
        return '';
    }

    function captureMetadataUpdate(url, bodyText) {
        if (!String(url || '').includes('/youtubei/v1/video_manager/metadata_update')) return;

        const payload = safeParseJson(bodyText);
        if (!payload) return;

        const found = findGameTitleNode(payload);
        if (!found) {
            appendLog('Saw metadata_update request, but no gameTitle field was present.');
            return;
        }

        const kgEntityId = found.node.newKgEntityId;
        if (!KG_ENTITY_RE.test(kgEntityId)) {
            appendLog(`Saw gameTitle value but it did not look like a KG entity id: ${kgEntityId}`, 'error');
            return;
        }

        state.lastCapture = {
            capturedAt: nowIso(),
            url: sanitizeUrl(url),
            videoId: payload.encryptedVideoId || getVideoIdFromUrl(),
            kgEntityId,
            path: found.path
        };
        state.lastShape = {
            path: found.path,
            hasVideoReadMask: Boolean(payload.videoReadMask),
            videoReadMask: payload.videoReadMask || null
        };
        saveState();

        const nameInput = document.querySelector(`#${SCRIPT_ID}-game-name`);
        const displayName = nameInput ? nameInput.value.replace(/\s+/g, ' ').trim() : '';
        if (displayName) {
            saveMapping(displayName, kgEntityId, false);
        }

        appendLog(`Captured game entity id ${kgEntityId} from Studio metadata_update.`);
    }

    function installRequestProbe() {
        if (window.__ytGameTitleUpdaterProbeInstalled) return;
        window.__ytGameTitleUpdaterProbeInstalled = true;

        const originalFetch = window.fetch;
        window.fetch = function(input, init) {
            const url = typeof input === 'string' ? input : input && input.url;
            const bodyText = getRequestBodyText(input, init);
            captureMetadataUpdate(url, bodyText);
            return originalFetch.apply(this, arguments);
        };

        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function(method, url) {
            this.__ytGameTitleUpdaterUrl = url;
            return originalOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function(body) {
            captureMetadataUpdate(this.__ytGameTitleUpdaterUrl, typeof body === 'string' ? body : '');
            return originalSend.apply(this, arguments);
        };

        appendLog('Request probe installed. Save a game title in Studio once to capture its /g/... id.');
    }

    function saveMapping(displayName, kgEntityId, shouldLog = true) {
        const normalized = normalizeGameName(displayName);
        if (!normalized) {
            appendLog('Game name is empty, so no mapping was saved.', 'error');
            return false;
        }
        if (!KG_ENTITY_RE.test(kgEntityId)) {
            appendLog('KG entity id must look like /g/xxxxxxxx.', 'error');
            return false;
        }

        state.mappings[normalized] = {
            displayName: displayName.replace(/\s+/g, ' ').trim(),
            kgEntityId,
            savedAt: nowIso()
        };
        saveState();
        if (shouldLog) appendLog(`Saved mapping: ${displayName} -> ${kgEntityId}.`);
        return true;
    }

    function buildMetadataPayload(videoId, kgEntityId) {
        const payload = {
            context: getInnertubeContext(),
            encryptedVideoId: videoId
        };

        if (state.lastShape && state.lastShape.hasVideoReadMask && state.lastShape.videoReadMask) {
            payload.videoReadMask = state.lastShape.videoReadMask;
        }

        const path = state.lastShape && state.lastShape.path ? state.lastShape.path : 'gameTitle';
        if (path === 'metadata.gameTitle') {
            payload.metadata = { gameTitle: { newKgEntityId: kgEntityId } };
        } else {
            payload.gameTitle = { newKgEntityId: kgEntityId };
        }

        return payload;
    }

    function buildHeaders(auth) {
        const headers = {
            'content-type': 'application/json',
            authorization: auth.value,
            'x-origin': location.origin
        };

        const visitorId = getYtcfg('VISITOR_DATA');
        const clientName = getYtcfg('INNERTUBE_CONTEXT_CLIENT_NAME');
        const clientVersion = getYtcfg('INNERTUBE_CONTEXT_CLIENT_VERSION');
        const authUser = getYtcfg('SESSION_INDEX');

        if (visitorId) headers['x-goog-visitor-id'] = visitorId;
        if (clientName) headers['x-youtube-client-name'] = String(clientName);
        if (clientVersion) headers['x-youtube-client-version'] = String(clientVersion);
        if (authUser !== undefined && authUser !== null && authUser !== '') headers['x-goog-authuser'] = String(authUser);

        return headers;
    }

    async function updateGameTitle(videoId, kgEntityId, options = {}) {
        const dryRun = options.dryRun !== undefined ? Boolean(options.dryRun) : state.dryRun;
        if (!videoId) throw new Error('Missing video id.');
        if (!KG_ENTITY_RE.test(kgEntityId)) throw new Error('KG entity id must look like /g/xxxxxxxx.');

        const apiKey = getInnertubeApiKey();
        if (!apiKey) throw new Error('Could not read INNERTUBE_API_KEY from Studio page config.');

        const auth = await buildAuthorizationHeader();
        if (!auth) throw new Error('Could not read a SAPISID-family cookie from this Studio page.');

        const endpoint = `https://studio.youtube.com/youtubei/v1/video_manager/metadata_update?alt=json&key=${encodeURIComponent(apiKey)}`;
        const payload = buildMetadataPayload(videoId, kgEntityId);

        if (dryRun) {
            appendLog(`Dry run ready for ${videoId} -> ${kgEntityId}. Auth source: ${auth.cookieName}.`);
            return { dryRun: true, payload };
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            credentials: 'include',
            headers: buildHeaders(auth),
            body: JSON.stringify(payload)
        });

        const responseText = await response.text();
        const responseJson = safeParseJson(responseText);

        if (!response.ok) {
            const message = responseJson && responseJson.error && responseJson.error.message
                ? responseJson.error.message
                : responseText.slice(0, 220);
            throw new Error(`metadata_update failed with HTTP ${response.status}: ${message}`);
        }

        appendLog(`Updated game title for ${videoId} -> ${kgEntityId}.`);
        return responseJson || { ok: true };
    }

    function getDiagnostics() {
        return {
            videoId: getVideoIdFromUrl(),
            hasYtcfg: Boolean(window.ytcfg && typeof window.ytcfg.get === 'function'),
            hasInnertubeApiKey: Boolean(getInnertubeApiKey()),
            hasInnertubeContext: Boolean(getInnertubeContext()),
            hasSapisidFamilyCookie: Boolean(getSapisidCookie()),
            lastCapture: state.lastCapture,
            mappingCount: Object.keys(state.mappings).length
        };
    }

    function createEl(tag, attrs = {}, children = []) {
        const el = document.createElement(tag);
        Object.entries(attrs).forEach(([key, value]) => {
            if (key === 'style') Object.assign(el.style, value);
            else if (key === 'text') el.textContent = value;
            else if (key === 'html') el.innerHTML = value;
            else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
            else if (value === null || value === undefined || value === false) return;
            else el.setAttribute(key, value);
        });
        for (const child of children) {
            if (typeof child === 'string') el.appendChild(document.createTextNode(child));
            else if (child) el.appendChild(child);
        }
        return el;
    }

    function getMappedKgForInput() {
        const nameInput = document.querySelector(`#${SCRIPT_ID}-game-name`);
        const kgInput = document.querySelector(`#${SCRIPT_ID}-kg-id`);
        const directKg = kgInput ? kgInput.value.trim() : '';
        if (directKg) return directKg;

        const key = normalizeGameName(nameInput ? nameInput.value : '');
        return state.mappings[key] ? state.mappings[key].kgEntityId : '';
    }

    function syncDryRunFromUi() {
        const dryRunInput = document.querySelector(`#${SCRIPT_ID}-dry-run`);
        if (dryRunInput) {
            state.dryRun = Boolean(dryRunInput.checked);
            saveState();
        }
    }

    async function handleUpdateClick() {
        syncDryRunFromUi();
        const videoInput = document.querySelector(`#${SCRIPT_ID}-video-id`);
        const kgEntityId = getMappedKgForInput();
        const videoId = videoInput ? videoInput.value.trim() : getVideoIdFromUrl();

        try {
            await updateGameTitle(videoId, kgEntityId, { dryRun: state.dryRun });
        } catch (error) {
            appendLog(error.message || String(error), 'error');
        }
    }

    function handleSaveMappingClick() {
        const nameInput = document.querySelector(`#${SCRIPT_ID}-game-name`);
        const kgInput = document.querySelector(`#${SCRIPT_ID}-kg-id`);
        saveMapping(nameInput ? nameInput.value : '', kgInput ? kgInput.value.trim() : '');
        render();
    }

    function handleUseLastCaptureClick() {
        if (!state.lastCapture || !state.lastCapture.kgEntityId) {
            appendLog('No captured game entity id yet.', 'error');
            return;
        }
        const kgInput = document.querySelector(`#${SCRIPT_ID}-kg-id`);
        if (kgInput) kgInput.value = state.lastCapture.kgEntityId;
        appendLog(`Loaded last captured id into the form: ${state.lastCapture.kgEntityId}.`);
    }

    function renderMappings() {
        const entries = Object.values(state.mappings)
            .sort((a, b) => a.displayName.localeCompare(b.displayName));
        if (!entries.length) {
            return createEl('div', { text: 'No saved game mappings yet.', style: { color: '#b8b8b8' } });
        }

        return createEl('div', { style: { display: 'grid', gap: '4px', maxHeight: '80px', overflow: 'auto' } },
            entries.map((entry) => createEl('button', {
                type: 'button',
                text: `${entry.displayName}  ${entry.kgEntityId}`,
                title: 'Fill this mapping',
                onclick: () => {
                    const nameInput = document.querySelector(`#${SCRIPT_ID}-game-name`);
                    const kgInput = document.querySelector(`#${SCRIPT_ID}-kg-id`);
                    if (nameInput) nameInput.value = entry.displayName;
                    if (kgInput) kgInput.value = entry.kgEntityId;
                },
                style: {
                    background: '#252525',
                    color: '#e9e9e9',
                    border: '1px solid #555',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '11px',
                    padding: '4px',
                    textAlign: 'left'
                }
            }))
        );
    }

    function renderLogs() {
        const rows = state.logs.slice(-6).reverse();
        if (!rows.length) return 'No events yet.';
        return rows.map((row) => `${row.time.slice(11, 19)} ${row.level.toUpperCase()}: ${row.message}`).join('\n');
    }

    function render() {
        const root = document.getElementById(SCRIPT_ID);
        if (!root) return;

        const diagnostics = getDiagnostics();
        const lastCaptureText = state.lastCapture
            ? `${state.lastCapture.kgEntityId} at ${state.lastCapture.capturedAt.slice(11, 19)}`
            : 'none';

        root.querySelector(`#${SCRIPT_ID}-status`).textContent = [
            `ytcfg: ${diagnostics.hasYtcfg ? 'yes' : 'no'}`,
            `api key: ${diagnostics.hasInnertubeApiKey ? 'yes' : 'no'}`,
            `auth cookie: ${diagnostics.hasSapisidFamilyCookie ? 'yes' : 'no'}`,
            `last capture: ${lastCaptureText}`
        ].join(' | ');

        root.querySelector(`#${SCRIPT_ID}-mappings`).replaceChildren(renderMappings());
        root.querySelector(`#${SCRIPT_ID}-logs`).textContent = renderLogs();
    }

    function buildUi() {
        if (document.getElementById(SCRIPT_ID)) return;

        const root = createEl('div', {
            id: SCRIPT_ID,
            style: {
                position: 'fixed',
                top: '72px',
                right: '20px',
                zIndex: '99999',
                width: '380px',
                background: '#202124',
                color: '#f1f3f4',
                border: '1px solid #5f6368',
                borderRadius: '8px',
                boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
                fontFamily: 'Roboto, Arial, sans-serif',
                fontSize: '12px',
                padding: '12px',
                display: 'grid',
                gap: '8px'
            }
        });

        const title = createEl('div', {
            text: 'Studio Game Title Internal',
            style: { fontWeight: '700', fontSize: '14px' }
        });
        const status = createEl('div', {
            id: `${SCRIPT_ID}-status`,
            style: { color: '#c8c8c8', lineHeight: '1.35' }
        });

        const videoInput = createInput(`${SCRIPT_ID}-video-id`, getVideoIdFromUrl(), 'Video id');
        const gameInput = createInput(`${SCRIPT_ID}-game-name`, '', 'Game name for local mapping, for example Valorant');
        const kgInput = createInput(`${SCRIPT_ID}-kg-id`, state.lastCapture ? state.lastCapture.kgEntityId : '', 'KG entity id, for example /g/11gfhqhs78');

        const dryRun = createEl('label', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
            createEl('input', {
                id: `${SCRIPT_ID}-dry-run`,
                type: 'checkbox',
                checked: state.dryRun ? 'checked' : null,
                onchange: syncDryRunFromUi
            }),
            createEl('span', { text: 'Dry run first' })
        ]);

        root.append(
            title,
            status,
            labeled('Video', videoInput),
            labeled('Game name', gameInput),
            labeled('KG entity id', kgInput),
            createEl('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, [
                actionButton('Use capture', handleUseLastCaptureClick),
                actionButton('Save mapping', handleSaveMappingClick),
                actionButton('Update current', handleUpdateClick)
            ]),
            dryRun,
            createEl('div', { text: 'Saved mappings', style: { fontWeight: '600', marginTop: '4px' } }),
            createEl('div', { id: `${SCRIPT_ID}-mappings` }),
            createEl('pre', {
                id: `${SCRIPT_ID}-logs`,
                style: {
                    margin: '0',
                    padding: '8px',
                    background: '#111',
                    color: '#dfe1e5',
                    borderRadius: '4px',
                    maxHeight: '120px',
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap'
                }
            })
        );

        document.body.appendChild(root);
        render();
    }

    function createInput(id, value, placeholder) {
        return createEl('input', {
            id,
            value,
            placeholder,
            style: {
                width: '100%',
                boxSizing: 'border-box',
                background: '#111',
                color: '#f1f3f4',
                border: '1px solid #5f6368',
                borderRadius: '4px',
                padding: '6px'
            }
        });
    }

    function labeled(label, control) {
        return createEl('label', { style: { display: 'grid', gap: '3px' } }, [
            createEl('span', { text: label, style: { color: '#d2d2d2', fontWeight: '600' } }),
            control
        ]);
    }

    function actionButton(text, onclick) {
        return createEl('button', {
            type: 'button',
            text,
            onclick,
            style: {
                background: '#3c4043',
                color: '#f1f3f4',
                border: '1px solid #70757a',
                borderRadius: '4px',
                cursor: 'pointer',
                padding: '6px 8px'
            }
        });
    }

    installRequestProbe();
    setInterval(buildUi, 800);
    window.addEventListener('yt-navigate-finish', () => setTimeout(buildUi, 800));

    window.ytStudioGameTitleUpdater = {
        getDiagnostics,
        getState: () => JSON.parse(JSON.stringify(state)),
        saveMapping,
        updateGameTitle,
        updateCurrentVideo: (kgEntityId, options = {}) => updateGameTitle(getVideoIdFromUrl(), kgEntityId, options)
    };
})();
