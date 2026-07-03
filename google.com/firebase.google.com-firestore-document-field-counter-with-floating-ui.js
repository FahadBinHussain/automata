// ==UserScript==
// @name         Firestore Field Counter & Key Extractor
// @namespace    http://tampermonkey.net/
// @version      1.7
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/google.com/firebase.google.com-firestore-document-field-counter-with-floating-ui.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/google.com/firebase.google.com-firestore-document-field-counter-with-floating-ui.js
// @description  Count fields and documents, number both in-page, and copy field names as CSV
// @author       Fahad
// @match        https://console.firebase.google.com/*project*
// @icon         https://www.gstatic.com/mobilesdk/160503_mobilesdk/logo/2x/firebase_28dp.png
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Configuration
    const TARGET_CLASS = 'database-key-value';
    const UPDATE_INTERVAL_MS = 1000; // Check every 1 second
    const DOC_BADGE_CLASS = 'tm-document-counter-badge';
    const seenDocumentOrder = new Map(); // docId -> stable number across virtualized rerenders
    let lastPathKey = '';

    // Create the display element container
    const counterBox = document.createElement('div');
    counterBox.id = 'firestore-field-counter-ui';
    counterBox.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background-color: #1a73e8;
        color: white;
        padding: 8px 15px;
        border-radius: 24px;
        font-family: 'Roboto', sans-serif;
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 4px 6px rgba(0,0,0,0.3);
        z-index: 9999;
        display: none; /* Hidden by default until we find elements */
        user-select: none;
        transition: transform 0.2s;
        align-items: center;
        gap: 10px;
    `;
    document.body.appendChild(counterBox);

    // Create the text span (Clickable for manual recount)
    const textSpan = document.createElement('span');
    textSpan.title = "Click to force recount";
    textSpan.style.cursor = 'pointer';
    textSpan.onclick = () => {
        updateCount();
        const originalBg = counterBox.style.backgroundColor;
        counterBox.style.backgroundColor = '#1557b0';
        setTimeout(() => counterBox.style.backgroundColor = originalBg, 150);
    };

    // Create the copy button
    const copyBtn = document.createElement('button');
    copyBtn.innerText = "Copy Keys";
    copyBtn.style.cssText = `
        background-color: #ffffff;
        color: #1a73e8;
        border: none;
        border-radius: 12px;
        padding: 4px 10px;
        font-size: 12px;
        font-weight: bold;
        cursor: pointer;
        box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        transition: background-color 0.2s;
    `;
    copyBtn.onmouseenter = () => copyBtn.style.backgroundColor = "#f1f3f4";
    copyBtn.onmouseleave = () => copyBtn.style.backgroundColor = "#ffffff";

    // Copy functionality
    copyBtn.onclick = (e) => {
        e.stopPropagation(); // Prevent triggering the recount click
        const csvString = extractFieldNamesAsCSV();

        navigator.clipboard.writeText(csvString).then(() => {
            const originalText = copyBtn.innerText;
            copyBtn.innerText = "Copied!";
            copyBtn.style.backgroundColor = "#e6f4ea"; // Light green
            copyBtn.style.color = "#137333";

            setTimeout(() => {
                copyBtn.innerText = originalText;
                copyBtn.style.backgroundColor = "#ffffff";
                copyBtn.style.color = "#1a73e8";
            }, 1500);
        }).catch(err => {
            console.error('Failed to copy text: ', err);
            copyBtn.innerText = "Error";
            setTimeout(() => copyBtn.innerText = "Copy Keys", 1500);
        });
    };

    // Append children to container
    counterBox.appendChild(textSpan);
    counterBox.appendChild(copyBtn);

    // Hover effect for the whole box
    counterBox.onmouseenter = () => counterBox.style.transform = "scale(1.02)";
    counterBox.onmouseleave = () => counterBox.style.transform = "scale(1)";

    // Extraction function - UPDATED TO GRAB ONLY FIELD NAMES
    function extractFieldNamesAsCSV() {
        const elements = document.getElementsByClassName(TARGET_CLASS);
        const extractedData =[];

        for (let i = 0; i < elements.length; i++) {
            const el = elements[i];
            let fieldName = "";

            // Attempt 1: Target exactly the element holding the key (Firebase uses .database-key)
            const keyEl = el.querySelector('.database-key, .key, .field-name');

            if (keyEl && keyEl.textContent) {
                fieldName = keyEl.textContent.trim();
            } else {
                // Attempt 2 (Fallback): If standard classes change, strip out everything else
                const clone = el.cloneNode(true);

                // Remove the yellow badge
                const badge = clone.querySelector('.tm-field-counter-badge');
                if (badge) badge.remove();

                // Remove material icons
                const icons = clone.querySelectorAll('mat-icon, .material-icons');
                icons.forEach(icon => icon.remove());

                // Remove values
                const values = clone.querySelectorAll('.database-value, .value');
                values.forEach(v => v.remove());

                // Grab what's left
                fieldName = clone.textContent.replace(/\s+/g, ' ').trim();

                // Final cleanup just in case "arrow_drop_down" snuck through as raw text
                fieldName = fieldName.replace(/^(arrow_drop_down|arrow_right)\s*/g, '').trim();
            }

            // Standard CSV Formatting if the key contains a comma
            if (fieldName.includes(',')) {
                fieldName = `"${fieldName.replace(/"/g, '""')}"`;
            }

            if (fieldName) {
                extractedData.push(fieldName);
            }
        }

        return extractedData.join(', ');
    }

    function getVisibleDocumentRowsFromPanelList() {
        const rows = [...document.querySelectorAll('[data-test-id="panel-list-item"]')];
        return rows
            .map((row) => {
                const labelBtn = row.querySelector('button.item-label-button');
                if (!labelBtn || !labelBtn.offsetParent) return null;
                const actionsBtn = row.querySelector('button.item-actions-button[aria-label]');
                const aria = actionsBtn ? actionsBtn.getAttribute('aria-label') || '' : '';
                const fromAria = aria.replace(/^actions for\s*/i, '').trim();
                const idText = fromAria || (labelBtn.textContent || '').trim();
                if (!idText) return null;
                return { labelBtn, idText };
            })
            .filter(Boolean);
    }

    function currentFirestorePathKey() {
        const hash = window.location.hash || '';
        const marker = '/firestore/data/';
        const idx = hash.indexOf(marker);
        if (idx === -1) return window.location.pathname + hash;
        return hash.slice(0, idx + marker.length);
    }

    function updateDocumentBadges() {
        document.querySelectorAll(`.${DOC_BADGE_CLASS}`).forEach((b) => b.remove());

        // Reset numbering when navigating to a different Firestore data path context.
        const pathKey = currentFirestorePathKey();
        if (pathKey !== lastPathKey) {
            seenDocumentOrder.clear();
            lastPathKey = pathKey;
        }

        const docRows = getVisibleDocumentRowsFromPanelList();

        docRows.forEach(({ labelBtn, idText }) => {
            if (!seenDocumentOrder.has(idText)) {
                seenDocumentOrder.set(idText, seenDocumentOrder.size + 1);
            }
            const docNumber = seenDocumentOrder.get(idText);
            const badge = document.createElement('span');
            badge.className = DOC_BADGE_CLASS;
            badge.innerText = docNumber;
            badge.style.cssText = `
                background-color: #ffca28;
                color: #000;
                font-size: 10px;
                padding: 2px 6px;
                border-radius: 10px;
                margin-right: 8px;
                font-weight: bold;
                user-select: none;
                display: inline-block;
                vertical-align: middle;
                box-shadow: 0 1px 3px rgba(0,0,0,0.2);
            `;

            // Insert inside the label button so it stays inline and never covers text.
            labelBtn.insertBefore(badge, labelBtn.firstChild);
        });

        return seenDocumentOrder.size;
    }

    // Main update function
    function updateCount() {
        const elements = document.getElementsByClassName(TARGET_CLASS);
        const count = elements.length;
        const docCount = updateDocumentBadges();

        for (let i = 0; i < count; i++) {
            const el = elements[i];
            let badge = el.querySelector('.tm-field-counter-badge');

            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'tm-field-counter-badge';
                badge.style.cssText = `
                    background-color: #ffca28;
                    color: #000;
                    font-size: 10px;
                    padding: 2px 6px;
                    border-radius: 10px;
                    margin-right: 8px;
                    font-weight: bold;
                    user-select: none;
                    display: inline-block;
                    vertical-align: middle;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
                `;
                el.insertBefore(badge, el.firstChild);
            }

            if (badge.innerText !== String(i + 1)) {
                badge.innerText = i + 1;
            }
        }

        if (count > 0 || docCount > 0) {
            counterBox.style.display = 'flex';
            textSpan.innerText = `Fields: ${count} | Documents: ${docCount}`;
        } else {
            counterBox.style.display = 'none';
        }
    }

    // Run the updater on an interval
    setInterval(updateCount, UPDATE_INTERVAL_MS);

})();
