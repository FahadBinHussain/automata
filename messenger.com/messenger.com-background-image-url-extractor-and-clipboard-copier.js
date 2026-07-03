// ==UserScript==
// @name         Messenger BG Image URL Extractor
// @namespace    http://tampermonkey.net/
// @version      1.4
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/messenger.com/messenger.com-background-image-url-extractor-and-clipboard-copier.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/messenger.com/messenger.com-background-image-url-extractor-and-clipboard-copier.js
// @description  Extract background-image URLs from Messenger.com dynamically
// @match        https://www.messenger.com/*
// @grant        GM_setClipboard
// ==/UserScript==

(function() {
    'use strict';

    // Create floating button
    const button = document.createElement('button');
    button.textContent = 'Copy BG Image URLs';
    button.style.position = 'fixed';
    button.style.bottom = '20px';
    button.style.right = '20px';
    button.style.zIndex = 9999;
    button.style.padding = '10px 15px';
    button.style.backgroundColor = '#ff99cc';
    button.style.color = '#000';
    button.style.border = 'none';
    button.style.borderRadius = '8px';
    button.style.cursor = 'pointer';
    button.style.fontWeight = 'bold';
    button.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
    document.body.appendChild(button);

    // Extract background-image URL from element
    function getBackgroundImageUrl(el) {
        const bg = window.getComputedStyle(el).getPropertyValue('background-image');
        const match = bg.match(/url\((['"]?)(.*?)\1\)/);
        return match ? match[2] : null;
    }

    // Click event
    button.addEventListener('click', () => {
        const divs = document.querySelectorAll('div');
        const urls = [];

        divs.forEach(div => {
            const url = getBackgroundImageUrl(div);
            if (url && !urls.includes(url)) { // avoid duplicates
                urls.push(url);
            }
        });

        if (urls.length > 0) {
            const allUrls = urls.join('\n');
            if (typeof GM_setClipboard !== 'undefined') {
                GM_setClipboard(allUrls);
            } else {
                navigator.clipboard.writeText(allUrls);
            }
            alert(`Copied ${urls.length} URLs to clipboard!`);
        } else {
            alert('No background images found.');
        }
    });
})();
