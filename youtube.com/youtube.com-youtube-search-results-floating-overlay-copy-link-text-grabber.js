// ==UserScript==
// @name         Context Menu - Copy Link Text (Site Specific)
// @namespace    http://tampermonkey.net/
// @version      1.3
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/youtube.com/youtube.com-youtube-search-results-floating-overlay-copy-link-text-grabber.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/youtube.com/youtube.com-youtube-search-results-floating-overlay-copy-link-text-grabber.js
// @description  Adds a floating "Copy Link Text" button. Currently enabled for YouTube search results.
// @author       Fahad
// @grant        GM_setClipboard
//
// --- ADD SITES HERE ---
// @match        *://www.youtube.com/results*
// @match        *://www.youtube.com/watch*
// ----------------------
// ==/UserScript==

(function() {
    'use strict';

    let menuBtn = null;

    // Helper to remove the button
    const removeBtn = () => {
        if (menuBtn) {
            menuBtn.remove();
            menuBtn = null;
        }
    };

    document.addEventListener('contextmenu', function(e) {
        // 1. Remove existing button if it's there
        removeBtn();

        // 2. Identify if we clicked a link
        const targetLink = e.target.closest('a');
        if (!targetLink) return;

        const linkText = targetLink.innerText.trim();
        if (!linkText) return;

        // 3. Create the button
        menuBtn = document.createElement('div');
        menuBtn.textContent = '📋 Copy Link Text';

        // 4. Style the button
        // We use a dark theme style so it stands out against the white browser menu
        menuBtn.style.cssText = `
            position: absolute;
            z-index: 2147483647;
            background: #222;
            color: #fff;
            padding: 10px 16px;
            font-size: 13px;
            font-family: sans-serif;
            border-radius: 8px;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(0,0,0,0.4);
            border: 1px solid #444;
            white-space: nowrap;
            user-select: none;
            transition: transform 0.1s ease;
        `;

        // 5. Position the button (Offset to the LEFT)
        // If the click is too close to the left edge, it will shift slightly right
        const xPos = e.pageX < 200 ? e.pageX + 20 : e.pageX - 160;
        const yPos = e.pageY;

        menuBtn.style.top = `${yPos}px`;
        menuBtn.style.left = `${xPos}px`;

        // 6. Click Functionality
        menuBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();

            GM_setClipboard(linkText);

            menuBtn.textContent = '✅ Copied!';
            menuBtn.style.background = '#008000';

            setTimeout(removeBtn, 800);
        });

        // Hover effect
        menuBtn.onmouseover = () => menuBtn.style.transform = 'scale(1.05)';
        menuBtn.onmouseout = () => menuBtn.style.transform = 'scale(1.0)';

        document.body.appendChild(menuBtn);
    });

    // Remove button on normal click or scroll
    document.addEventListener('click', (e) => {
        if (menuBtn && !menuBtn.contains(e.target)) removeBtn();
    });
    document.addEventListener('scroll', removeBtn);

})();