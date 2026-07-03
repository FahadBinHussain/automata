// ==UserScript==
// @name         Google AI Studio - Fast Delete & Stop
// @namespace    http://tampermonkey.net/
// @version      4.1
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/google.com/aistudio.google.com-google-ai-studio-bulk-file-delete-automation-with-stop-control.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/google.com/aistudio.google.com-google-ai-studio-bulk-file-delete-automation-with-stop-control.js
// @description  Turbo delete with stop button for AI Studio files
// @author       Fahad
// @match        https://aistudio.google.com/app/apps/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let isRunning = false;
    const APP_URL_RE = /^\/app\/apps\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // Helper to wait for a specific time
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    function isAllowedAppUrl() {
        const params = new URLSearchParams(window.location.search);
        return (
            window.location.hostname === 'aistudio.google.com' &&
            APP_URL_RE.test(window.location.pathname) &&
            params.get('showPreview') === 'true' &&
            params.get('showAssistant') === 'true'
        );
    }

    async function toggleProcess() {
        if (!isAllowedAppUrl()) return;

        const mainBtn = document.getElementById('floating-delete-btn');

        if (isRunning) {
            isRunning = false;
            mainBtn.innerText = 'Stopping...';
            return;
        }

        const nodes = document.querySelectorAll('mat-tree-node');
        if (nodes.length === 0) {
            alert("No files found.");
            return;
        }

        if (!confirm(`Start fast deletion of ${nodes.length} items?`)) return;

        isRunning = true;
        updateButtonStyle(true);

        while (isRunning) {
            const currentNodes = document.querySelectorAll('mat-tree-node');
            if (currentNodes.length === 0) break;

            const targetNode = currentNodes[0];
            const menuBtn = targetNode.querySelector('button.node-settings-button');

            if (menuBtn) {
                // 1. Open Menu
                menuBtn.click();
                await sleep(150); // Fast wait for menu

                if (!isRunning) break;

                // 2. Click Delete Option
                const deleteOption = Array.from(document.querySelectorAll('.mat-mdc-menu-item'))
                                          .find(el => el.textContent.includes('Delete'));

                if (deleteOption) {
                    deleteOption.click();
                    await sleep(250); // Fast wait for dialog

                    if (!isRunning) break;

                    // 3. Confirm Delete in Dialog
                    const confirmBtn = Array.from(document.querySelectorAll('mat-dialog-container button, .mat-mdc-dialog-actions button'))
                                            .find(el => el.textContent.trim().toLowerCase() === 'delete');

                    if (confirmBtn) {
                        confirmBtn.click();
                        await sleep(400); // Wait for API response/refresh
                    }
                } else {
                    // Fallback: If it's a folder or something else, try clicking away to close menu
                    document.body.click();
                    break;
                }
            } else {
                break;
            }
        }

        isRunning = false;
        updateButtonStyle(false);
        if (document.querySelectorAll('mat-tree-node').length === 0) {
            alert("Done!");
        }
    }

    function updateButtonStyle(active) {
        const btn = document.getElementById('floating-delete-btn');
        if (active) {
            btn.innerText = '⏹️ STOP DELETION';
            btn.style.backgroundColor = '#000000';
            btn.style.borderColor = '#ff0000';
        } else {
            btn.innerText = '🗑️ DELETE ALL FILES';
            btn.style.backgroundColor = '#d93025';
            btn.style.borderColor = 'white';
        }
    }

    function createFloatingButton() {
        if (!isAllowedAppUrl()) return;
        if (document.getElementById('floating-delete-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'floating-delete-btn';
        btn.innerText = '🗑️ DELETE ALL FILES';
        btn.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 99999;
            background-color: #d93025;
            color: white;
            border: 2px solid white;
            border-radius: 8px;
            padding: 12px 20px;
            font-weight: bold;
            font-family: sans-serif;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
            font-size: 14px;
            transition: all 0.2s;
        `;

        btn.onclick = (e) => {
            e.preventDefault();
            toggleProcess();
        };

        document.body.appendChild(btn);
    }

    function syncFloatingButton() {
        const btn = document.getElementById('floating-delete-btn');
        if (!isAllowedAppUrl()) {
            isRunning = false;
            if (btn) btn.remove();
            return;
        }

        createFloatingButton();
    }

    setInterval(syncFloatingButton, 1000);
})();
