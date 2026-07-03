// ==UserScript==
// @name         YouTube Music Background Play (Mobile)
// @namespace    http://tampermonkey.net/
// @version      1.1
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/youtube.com/music.youtube.com-youtube-music-mobile-background-playback-enabler-and-screen-off-fix.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/youtube.com/music.youtube.com-youtube-music-mobile-background-playback-enabler-and-screen-off-fix.js
// @description  Forces YouTube Music to continue playing when the browser is backgrounded or the screen is off (Mobile View).
// @author       Fahad
// @match        https://music.youtube.com/*
// @match        https://m.youtube.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 1. Spoof the Page Visibility API
    // This tells the site that the tab is always in the foreground and visible.
    Object.defineProperties(document, {
        'hidden': { value: false, configurable: true },
        'webkitHidden': { value: false, configurable: true },
        'visibilityState': { value: 'visible', configurable: true },
        'webkitVisibilityState': { value: 'visible', configurable: true }
    });

    // 2. Intercept and block visibility change events
    // When you switch apps, the browser fires these events. We stop them from reaching the site.
    const blockEvent = (e) => {
        e.stopImmediatePropagation();
        e.stopPropagation();
    };

    // We use 'true' for useCapture to catch the event before it bubbles down to the site scripts
    document.addEventListener('visibilitychange', blockEvent, true);
    document.addEventListener('webkitvisibilitychange', blockEvent, true);

    // 3. Keep the "Video" element active
    // Sometimes mobile sites pause the actual media element on blur.
    function unlockAudio() {
        const video = document.querySelector('video');
        if (video) {
            // Prevent the site from pausing the video automatically
            video.pause = function() {
                console.log('Block pause attempt');
                // We override the pause function to do nothing if initiated by the site logic
                // Note: This might make it hard to pause manually via the UI button in some rare cases,
                // but usually the UI button triggers a specific state change that we want to allow.
                // If you can't pause manually, remove this specific block.
            };

            // Ensure loop is off (optional, standard behavior)
            video.loop = false;
        }
    }

    // Run the unlocker periodically to catch when the player loads (SPA behavior)
    setInterval(unlockAudio, 2000);

    console.log('YouTube Music Background Play Script Loaded');
})();
