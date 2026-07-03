// ==UserScript==
// @name         Discord Auto-Redirect (Bypass "Leaving Discord")
// @namespace    http://tampermonkey.net/
// @version      1.1
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/discord.com/discord-external-link-warning-bypass-and-auto-redirect.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/discord.com/discord-external-link-warning-bypass-and-auto-redirect.js
// @description  Automatically clicks "Visit Site" on the Discord warning modal.
// @author       Fahad
// @match        https://discord.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // Function to handle the clicking logic
    function autoClickVisit() {
        // 1. Find the modal container using the stable data attribute
        const modal = document.querySelector('div[data-mana-component="modal"]');

        if (modal) {
            // 2. Verify this is the "Leaving Discord" modal by checking the header text
            // We verify the header to ensure we don't accidentally click buttons in other types of modals
            const header = modal.querySelector('header h1');
            if (header && header.textContent.includes("Leaving Discord")) {

                // 3. Find the "Visit Site" button
                // We look for all buttons and check their text content to avoid relying on hashed classes
                const buttons = modal.querySelectorAll('button[data-mana-component="button"]');

                for (const btn of buttons) {
                    if (btn.textContent.includes("Visit Site")) {
                        // Click the button
                        btn.click();
                        // Log for debugging
                        console.log('Violentmonkey: Auto-clicked "Visit Site"');
                        return;
                    }
                }
            }
        }
    }

    // 4. Set up a MutationObserver to watch for the modal appearing
    // Discord is a Single Page App, so elements appear dynamically without reloading
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.addedNodes.length) {
                autoClickVisit();
            }
        }
    });

    // Start observing the body for changes
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

})();
