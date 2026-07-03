// ==UserScript==
// @name        7TV Duplicate Emote Detector (with UI)
// @namespace   Violentmonkey Scripts
// @match       https://7tv.io/v3/users/twitch/*
// @grant       GM_addStyle
// @version     1.1
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/7tv.io/7tv.io-user-emote-list-duplicate-detector-with-gui.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/7tv.io/7tv.io-user-emote-list-duplicate-detector-with-gui.js
// @author      Fahad
// @description Detects and displays duplicate emotes in a custom UI on a 7TV user page.
// ==/UserScript==

(function() {
    'use strict';

    /**
     * Injects CSS styles into the page for the notification UI.
     */
    function addStyles() {
        GM_addStyle(`
            #emote-duplicate-checker {
                position: fixed;
                top: 80px;
                left: 50%;
                transform: translateX(-50%);
                width: 90%;
                max-width: 400px;
                background-color: #1a1a1c;
                color: #fff;
                border: 1px solid #3c3c3e;
                border-radius: 8px;
                padding: 15px;
                z-index: 9999;
                font-family: 'Inter', sans-serif;
                box-shadow: 0 4px 12px rgba(0,0,0,0.4);
                font-size: 14px;
                line-height: 1.5;
            }
            #emote-duplicate-checker .checker-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 10px;
                padding-bottom: 5px;
                border-bottom: 1px solid #3c3c3e;
            }
            #emote-duplicate-checker .checker-title {
                font-weight: bold;
                font-size: 16px;
            }
            #emote-duplicate-checker .checker-close-btn {
                background: none;
                border: none;
                color: #aaa;
                font-size: 20px;
                cursor: pointer;
                line-height: 1;
            }
             #emote-duplicate-checker .checker-close-btn:hover {
                color: #fff;
            }
            #emote-duplicate-checker .checker-body ul {
                list-style: none;
                padding: 0;
                margin: 0;
                max-height: 200px;
                overflow-y: auto;
            }
            #emote-duplicate-checker .checker-body li {
                padding: 4px 0;
            }
        `);
    }

    /**
     * Creates and displays the UI element with the results.
     * @param {string[]} duplicates - An array of duplicate emote names.
     */
    function displayResultsUI(duplicates) {
        // Remove any existing checker UI
        const existingChecker = document.getElementById('emote-duplicate-checker');
        if (existingChecker) {
            existingChecker.remove();
        }

        const container = document.createElement('div');
        container.id = 'emote-duplicate-checker';

        let bodyContent;
        if (duplicates.length > 0) {
            bodyContent = `<ul>${duplicates.map(name => `<li>${name}</li>`).join('')}</ul>`;
        } else {
            bodyContent = `<p>No duplicate emotes were found.</p>`;
        }

        container.innerHTML = `
            <div class="checker-header">
                <span class="checker-title">Duplicate Emote Check</span>
                <button class="checker-close-btn" title="Close">&times;</button>
            </div>
            <div class="checker-body">
                ${bodyContent}
            </div>
        `;

        document.body.appendChild(container);

        // Add event listener to the close button
        container.querySelector('.checker-close-btn').addEventListener('click', () => {
            container.remove();
        });
    }

    /**
     * Finds duplicate emote names from the emote list.
     * @param {object[]} emotes - The array of emote objects from the API.
     * @returns {string[]} An array of duplicate names.
     */
    const findDuplicates = (emotes) => {
        const emoteNames = emotes.map(emote => emote.name);
        const seen = new Set();
        const duplicates = new Set();

        for (const name of emoteNames) {
            if (seen.has(name)) {
                duplicates.add(name);
            } else {
                seen.add(name);
            }
        }
        return Array.from(duplicates);
    };

    /**
     * Main function to fetch data and trigger the check.
     */
    const runDuplicateCheck = async () => {
        try {
            // The API is the same as the page URL
            const response = await fetch(window.location.href);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();

            if (data && data.emote_set && data.emote_set.emotes) {
                const duplicates = findDuplicates(data.emote_set.emotes);
                displayResultsUI(duplicates);
            }
        } catch (error) {
            console.error('Error fetching or processing emote data:', error);
            displayResultsUI(["Error: Could not fetch emote data."]);
        }
    };

    // --- Script Entry Point ---

    // Inject the CSS
    addStyles();

    // Run the check once the DOM is ready
    // Using a small delay to ensure the page's JS has likely finished its initial render
    setTimeout(runDuplicateCheck, 1000);

})();
