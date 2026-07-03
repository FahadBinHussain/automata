// ==UserScript==
// @name         YT Music History Deleter (Fix)
// @namespace    http://tampermonkey.net/
// @version      1.1
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/youtube.com/music.youtube.com-automated-bulk-history-entry-deleter.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/youtube.com/music.youtube.com-automated-bulk-history-entry-deleter.js
// @description  Automates deleting YouTube Music history using specific aria-labels
// @author       Fahad
// @match        https://music.youtube.com/history
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let isRunning = false;
    const STEP_DELAY = 800; // Increased delay slightly to ensure menu renders

    // --- UI Creation ---
    function createUI() {
        const btn = document.createElement('button');
        btn.id = 'ytm-delete-btn';
        btn.innerText = 'Start Deleting';

        Object.assign(btn.style, {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            zIndex: '9999',
            padding: '12px 24px',
            backgroundColor: '#cc0000',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '14px',
            boxShadow: '0 4px 6px rgba(0,0,0,0.3)'
        });

        btn.onclick = () => {
            if (!isRunning) {
                isRunning = true;
                btn.innerText = 'STOP';
                btn.style.backgroundColor = '#555';
                processDeletion();
            } else {
                isRunning = false;
                btn.innerText = 'Start Deleting';
                btn.style.backgroundColor = '#cc0000';
            }
        };

        document.body.appendChild(btn);
    }

    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // --- Main Logic ---
    async function processDeletion() {
        console.log("Deletion started...");

        while (isRunning) {
            // 1. Find the 3-dot menu button
            // We specifically look for 'ytmusic-responsive-list-item-renderer' (the song row)
            // AND the button with aria-label="Action menu" to avoid the Dislike button
            const menuButton = document.querySelector('ytmusic-responsive-list-item-renderer button[aria-label="Action menu"]');

            if (!menuButton) {
                console.log("No menu buttons found visible. Scrolling...");
                window.scrollTo(0, window.scrollY + 500); // Small scroll
                await wait(1000);

                // If still nothing, maybe end of list
                if (!document.querySelector('ytmusic-responsive-list-item-renderer button[aria-label="Action menu"]')) {
                     // Try one big scroll to be sure
                     window.scrollTo(0, document.body.scrollHeight);
                     await wait(2000);
                     if (!document.querySelector('ytmusic-responsive-list-item-renderer button[aria-label="Action menu"]')) {
                         alert("No more items found!");
                         isRunning = false;
                         break;
                     }
                }
                continue;
            }

            // Click the 3-dot menu
            menuButton.click();
            await wait(STEP_DELAY);

            // 2. Find "Remove from history"
            // Using XPath to match the exact text you provided previously
            const removeButton = document.evaluate(
                "//ytmusic-menu-service-item-renderer//yt-formatted-string[text()='Remove from history']",
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            ).singleNodeValue;

            if (removeButton) {
                // Click the remove button
                removeButton.click();
                // Wait for item to disappear
                await wait(STEP_DELAY);
            } else {
                // If menu opened but text not found (e.g., clicked a playlist header by mistake)
                console.log("Remove button not found in popup. Closing menu.");
                document.body.click(); // Close menu
                await wait(STEP_DELAY);
            }
        }

        // Reset button when stopped
        const btn = document.getElementById('ytm-delete-btn');
        if(btn) {
            btn.innerText = 'Start Deleting';
            btn.style.backgroundColor = '#cc0000';
        }
    }

    // Initialize
    window.addEventListener('load', () => setTimeout(createUI, 1500));
    if(document.readyState === 'complete') setTimeout(createUI, 1500);

})();
