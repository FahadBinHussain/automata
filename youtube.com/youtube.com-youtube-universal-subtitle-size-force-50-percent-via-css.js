// ==UserScript==
// @name        YouTube Subtitles 50% (Mobile/Desktop)
// @namespace   Violentmonkey Scripts
// @match       *://www.youtube.com/*
// @match       *://m.youtube.com/*
// @grant       GM_addStyle
// @version     1.0
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/youtube.com/youtube.com-youtube-universal-subtitle-size-force-50-percent-via-css.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/youtube.com/youtube.com-youtube-universal-subtitle-size-force-50-percent-via-css.js
// @author      Fahad
// @description Forces YouTube subtitles to be 50% of their default size.
// ==/UserScript==

(function() {
    'use strict';

    // We use GM_addStyle to inject CSS that overrides YouTube's inline styles.
    // We use !important to ensure this setting takes priority over YouTube's automatic sizing.

    GM_addStyle(`
        /* Target the specific text segments of the subtitles */
        .ytp-caption-segment {
            font-size: 50% !important;
            line-height: normal !important;
        }

        /* Optional: Adjust the window/background if it looks too bulky */
        .caption-window {
            margin-bottom: 10px !important;
        }
    `);

})();
