// ==UserScript==
// @name         ebanglalibrary.com Scraper
// @namespace    http://tampermonkey.net/violentmonkey/
// @version      1.7
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/ebanglalibrary.com/script.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/ebanglalibrary.com/script.js
// @description  Adds buttons to copy content, removing "Bookmark" at the end, and adds a newline to the paste.
// @author       Fahad
// @match        *://ebanglalibrary.com/*
// @match        *://www.ebanglalibrary.com/*
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    console.log('[Copy Content Script v1.7] Executing...');

    // --- Configuration for Target Elements and Button Labels ---
    const targets = [
        {
            id: 'ftwp-postcontent',
            selectorType: 'id',
            buttonLabel: 'Copy #ftwp-postcontent',
            buttonId: 'gm-copy-ftwp-button'
        },
        {
            selector: '.entry-content.ld-visible.ld-tab-content',
            selectorType: 'querySelector',
            buttonLabel: 'Copy .entry-content',
            buttonId: 'gm-copy-entry-content-button'
        }
    ];

    const TEXT_TO_REMOVE_FROM_END = "Bookmark";

    // --- General Styling (applied once) ---
    try {
        GM_addStyle(`
            .gm-copy-content-button {
                position: fixed;
                padding: 10px 15px;
                background-color: #007bff;
                color: white;
                border: none;
                border-radius: 5px;
                cursor: pointer;
                z-index: 2147483646;
                font-size: 14px;
                box-shadow: 0 2px 5px rgba(0,0,0,0.2);
                transition: background-color 0.3s ease;
                margin-bottom: 5px;
            }
            .gm-copy-content-button:hover {
                background-color: #0056b3;
            }
            .gm-copy-content-button.gm-copied {
                background-color: #28a745;
            }
            .gm-copy-content-button.gm-error {
                background-color: #dc3545;
            }
            #gm-copy-ftwp-button {
                bottom: 20px;
                right: 20px;
            }
            #gm-copy-entry-content-button {
                bottom: 75px;
                right: 20px;
            }
        `);
    } catch (e) {
        console.error('[Copy Content Script] Error adding style:', e);
    }

    // --- Function to create and add a copy button ---
    function createCopyButton(targetConfig) {
        const copyButton = document.createElement('button');
        copyButton.id = targetConfig.buttonId;
        copyButton.textContent = targetConfig.buttonLabel;
        copyButton.classList.add('gm-copy-content-button');

        copyButton.addEventListener('click', function() {
            console.log(`[Copy Content Script] Button '${targetConfig.buttonLabel}' clicked.`);
            let targetElement;

            if (targetConfig.selectorType === 'id') {
                targetElement = document.getElementById(targetConfig.id);
            } else if (targetConfig.selectorType === 'querySelector') {
                targetElement = document.querySelector(targetConfig.selector);
            }

            if (targetElement) {
                let contentToCopy = targetElement.innerText;

                // Check if content is not null and has more than just whitespace
                if (contentToCopy && contentToCopy.trim() !== "") {
                    contentToCopy = contentToCopy.replace(/\r\n/g, '\n'); // Normalize line breaks

                    // Remove "Bookmark" from the end
                    let trimmedContentForBookmarkCheck = contentToCopy.trimRight();
                    if (trimmedContentForBookmarkCheck.endsWith(TEXT_TO_REMOVE_FROM_END)) {
                        contentToCopy = trimmedContentForBookmarkCheck.substring(0, trimmedContentForBookmarkCheck.length - TEXT_TO_REMOVE_FROM_END.length);
                        contentToCopy = contentToCopy.trimRight(); // Trim again after removing "Bookmark"
                    } else {
                         contentToCopy = trimmedContentForBookmarkCheck; // Use the right-trimmed version
                    }

                    // --- MODIFICATION START: Ensure a newline at the end of non-empty content ---
                    // First, trim the content to remove any existing leading/trailing whitespace or multiple newlines
                    contentToCopy = contentToCopy.trim();

                    // If, after trimming, the content is not empty and doesn't already end with a newline, add one.
                    if (contentToCopy !== "" && !contentToCopy.endsWith('\n')) {
                        contentToCopy += '\n';
                    }
                    // --- MODIFICATION END ---

                    try {
                        // Pass the processed content (which now has a trailing newline if it wasn't empty)
                        GM_setClipboard(contentToCopy);
                        this.textContent = 'Copied!';
                        this.classList.add('gm-copied');
                        this.classList.remove('gm-error');
                        console.log(`[Copy Content Script] Content from '${targetConfig.selector || targetConfig.id}' (using innerText) copied.`);
                    } catch (e) {
                        this.textContent = 'Copy Failed';
                        this.classList.add('gm-error');
                        this.classList.remove('gm-copied');
                        console.error('[Copy Content Script] Error using GM_setClipboard:', e);
                        alert('Could not copy to clipboard. Check browser console (F12) for errors.');
                    }
                } else { // Element found, but innerText is empty or only whitespace
                    this.textContent = 'Content Empty';
                    this.classList.add('gm-error');
                    this.classList.remove('gm-copied');
                    console.warn(`[Copy Content Script] Element '${targetConfig.selector || targetConfig.id}' found, but its innerText is empty or whitespace.`);
                    // Optionally, you could copy a single newline if the original content was just whitespace
                    // and you still want a newline. But for now, "Content Empty" is clearer.
                    // if (contentToCopy && contentToCopy.trim() === "" && contentToCopy.length > 0) {
                    //     GM_setClipboard('\n'); // Copy just a newline if it was all whitespace
                    // }
                }
            } else {
                this.textContent = 'Element Not Found!';
                this.classList.add('gm-error');
                this.classList.remove('gm-copied');
                console.error(`[Copy Content Script] Element '${targetConfig.selector || targetConfig.id}' not found on the page.`);
            }

            setTimeout(() => {
                this.textContent = targetConfig.buttonLabel;
                this.classList.remove('gm-copied', 'gm-error');
            }, 3000);
        });

        return copyButton;
    }

    // --- Add buttons to the page ---
    function addButtonsWhenReady() {
        if (document.body) {
            targets.forEach(targetConfig => {
                const button = createCopyButton(targetConfig);
                document.body.appendChild(button);
                console.log(`[Copy Content Script] Button for '${targetConfig.buttonLabel}' added to page.`);
            });
        } else {
            console.warn('[Copy Content Script] Document.body not ready, waiting for DOMContentLoaded.');
            window.addEventListener('DOMContentLoaded', addButtonsWhenReady);
        }
    }

    if (document.readyState === 'interactive' || document.readyState === 'complete') {
        addButtonsWhenReady();
    } else {
        window.addEventListener('DOMContentLoaded', addButtonsWhenReady);
    }

})();
