// ==UserScript==
// @name         Rehs Galleries - Open Image in New Tab
// @namespace    http://tampermonkey.net/
// @version      1.1
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/rehs.com/rehs.com-open-full-screen-artwork-in-new-tab.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/rehs.com/rehs.com-open-full-screen-artwork-in-new-tab.js
// @description  Adds a button to open the main artwork from rehs.com in a new tab.
// @author       Fahad
// @match        https://rehs.com/*
// @grant        GM_addStyle
// @grant        GM_openInTab
// ==/UserScript==

(function() {
    'use strict';

    // --- 1. Style for our custom button ---
    GM_addStyle(`
        .open-art-btn {
            position: fixed;
            top: 10px;
            right: 10px;
            z-index: 99999; /* Ensure it's on top of everything */
            background-color: #030133; /* Match site's dark blue */
            color: white;
            padding: 12px 18px;
            border: 1px solid white;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
            font-family: sans-serif;
        }

        .open-art-btn:hover {
            background-color: #333;
        }
    `);

    // --- 2. Create and add the button to the page ---
    const button = document.createElement('button');
    button.textContent = 'Open Full Image';
    button.className = 'open-art-btn';
    document.body.appendChild(button);

    // --- 3. Add the click functionality ---
    button.addEventListener('click', () => {
        // This is the specific selector for the "Full Screen Image" link on rehs.com
        const imageLinkElement = document.querySelector('.fl-module-automatic-thumb-fullscreenimage-module a.zoom');

        if (imageLinkElement && imageLinkElement.href) {
            // If we found the link, get its href attribute
            const imageUrl = imageLinkElement.href;
            console.log('Found image URL:', imageUrl);
            // Open the URL in a new tab using Violentmonkey's function
            GM_openInTab(imageUrl, { active: true });
        } else {
            // If the selector didn't find anything, alert the user
            alert('Could not find the full screen image link on this page.');
        }
    });
})();
