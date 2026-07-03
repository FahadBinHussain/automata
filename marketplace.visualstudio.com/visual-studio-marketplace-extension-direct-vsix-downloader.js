// ==UserScript==
// @name         VS Code Archive (.zip) Downloader
// @namespace    http://tampermonkey.net/
// @version      1.0
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/marketplace.visualstudio.com/visual-studio-marketplace-extension-direct-vsix-downloader.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/marketplace.visualstudio.com/visual-studio-marketplace-extension-direct-vsix-downloader.js
// @description  Adds a floating menu to download portable .zip/.tar.gz archives of older VS Code versions directly from the release notes.
// @author       Fahad
// @match        https://code.visualstudio.com/updates/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=visualstudio.com
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 1. Extract major/minor version from the URL (e.g., "v1_85" -> "1", "85")
    const urlMatch = window.location.pathname.match(/\/updates\/v(\d+)_(\d+)/);
    if (!urlMatch) return; // Exit if not on a specific update page

    const major = urlMatch[1];
    const minor = urlMatch[2];

    // 2. Scan the page text to find the highest patch version (e.g., finding 1.85.2)
    const pageText = document.body.innerText;
    const versionRegex = new RegExp(`\\b${major}\\.${minor}\\.(\\d+)\\b`, 'g');

    let maxPatch = 0;
    let match;
    while ((match = versionRegex.exec(pageText)) !== null) {
        const patchNum = parseInt(match[1], 10);
        if (patchNum > maxPatch) {
            maxPatch = patchNum;
        }
    }

    // The auto-detected exact version
    let currentVersion = `${major}.${minor}.${maxPatch}`;

    // 3. Create the Floating UI Container
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.bottom = '20px';
    container.style.right = '20px';
    container.style.backgroundColor = '#1e1e1e'; // VS Code Dark Theme color
    container.style.color = '#cccccc';
    container.style.padding = '15px';
    container.style.borderRadius = '8px';
    container.style.boxShadow = '0 4px 15px rgba(0,0,0,0.5)';
    container.style.zIndex = '999999';
    container.style.fontFamily = 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif';
    container.style.width = '220px';
    container.style.border = '1px solid #444';

    // Title
    const title = document.createElement('h3');
    title.innerText = 'VS Code .zip Downloader';
    title.style.margin = '0 0 10px 0';
    title.style.fontSize = '14px';
    title.style.color = '#ffffff';
    container.appendChild(title);

    // Version Input Box (so you can edit it manually if needed)
    const versionWrapper = document.createElement('div');
    versionWrapper.style.marginBottom = '12px';
    versionWrapper.innerHTML = `<label style="font-size: 12px; margin-right: 5px;">Version:</label>`;

    const versionInput = document.createElement('input');
    versionInput.type = 'text';
    versionInput.value = currentVersion;
    versionInput.style.width = '70px';
    versionInput.style.padding = '3px 5px';
    versionInput.style.backgroundColor = '#3c3c3c';
    versionInput.style.color = '#fff';
    versionInput.style.border = '1px solid #666';
    versionInput.style.borderRadius = '3px';
    versionInput.style.outline = 'none';
    versionWrapper.appendChild(versionInput);
    container.appendChild(versionWrapper);

    // Button Generator
    const createBtn = (label, platform) => {
        const btn = document.createElement('a');
        btn.innerText = label;
        btn.style.display = 'block';
        btn.style.backgroundColor = '#007acc'; // VS Code Blue
        btn.style.color = '#ffffff';
        btn.style.textAlign = 'center';
        btn.style.padding = '7px';
        btn.style.marginTop = '8px';
        btn.style.borderRadius = '4px';
        btn.style.textDecoration = 'none';
        btn.style.fontSize = '12px';
        btn.style.fontWeight = 'bold';
        btn.style.cursor = 'pointer';
        btn.style.transition = 'background-color 0.2s';

        btn.onmouseover = () => btn.style.backgroundColor = '#005f9e';
        btn.onmouseout = () => btn.style.backgroundColor = '#007acc';

        // Dynamically fetch from the input value when clicked
        btn.onclick = (e) => {
            e.preventDefault();
            const v = versionInput.value.trim();
            window.location.href = `https://update.code.visualstudio.com/${v}/${platform}/stable`;
        };

        return btn;
    };

    // Append standard archive format buttons
    container.appendChild(createBtn('Windows x64 (.zip)', 'win32-x64-archive'));
    container.appendChild(createBtn('Windows x86 (.zip)', 'win32-archive'));
    container.appendChild(createBtn('Windows ARM64 (.zip)', 'win32-arm64-archive'));
    container.appendChild(createBtn('macOS Universal (.zip)', 'darwin-universal'));
    container.appendChild(createBtn('Linux x64 (.tar.gz)', 'linux-x64'));

    // Close Button (X)
    const closeBtn = document.createElement('span');
    closeBtn.innerText = '✖';
    closeBtn.style.position = 'absolute';
    closeBtn.style.top = '10px';
    closeBtn.style.right = '12px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.fontSize = '14px';
    closeBtn.style.color = '#888';
    closeBtn.onmouseover = () => closeBtn.style.color = '#fff';
    closeBtn.onmouseout = () => closeBtn.style.color = '#888';
    closeBtn.onclick = () => container.remove();
    container.appendChild(closeBtn);

    // Inject into the page
    document.body.appendChild(container);

})();