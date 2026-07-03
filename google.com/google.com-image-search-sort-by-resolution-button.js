// ==UserScript==
// @name         Google Lens/Search - Sort by Dimension (v2.1 Fix)
// @namespace    http://tampermonkey.net/
// @version      2.1
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/google.com/google.com-image-search-sort-by-resolution-button.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/google.com/google.com-image-search-sort-by-resolution-button.js
// @description  Sorts Google Lens results by resolution (Handles 1,000+ formatting).
// @author       You
// @match        https://www.google.com/search?*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=google.com
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // UI Configuration
    const BUTTON_ID = 'google-dim-sort-btn';
    const BTN_STYLE = `
        position: fixed;
        top: 140px;
        right: 20px;
        z-index: 20000;
        background-color: #303134;
        color: #e8eaed;
        border: 1px solid #5f6368;
        padding: 8px 16px;
        border-radius: 18px;
        font-family: Google Sans, Roboto, Helvetica, Arial, sans-serif;
        font-size: 14px;
        cursor: pointer;
        box-shadow: 0 4px 6px rgba(0,0,0,0.4);
        font-weight: 500;
        user-select: none;
    `;

    // Helper: Parse "1,503x1,126" -> 1692378
    function getResolutionArea(text) {
        if (!text) return 0;
        // Capture groups allowing digits, commas, and dots
        const match = text.match(/([\d,.]+)\s*x\s*([\d,.]+)/);
        if (match) {
            // Remove non-digit characters (commas/dots) to get pure numbers
            const w = parseInt(match[1].replace(/[^\d]/g, ''), 10);
            const h = parseInt(match[2].replace(/[^\d]/g, ''), 10);
            return w * h;
        }
        return 0;
    }

    // Helper: Check if element is a valid dimension label
    function isDimensionSpan(element) {
        if (element.tagName !== 'SPAN') return false;

        // 1. Content Check: Must look like "Number x Number" (allowing commas)
        if (!/[\d,.]+\s*x\s*[\d,.]+/.test(element.textContent)) return false;

        // 2. Style Check: Must match the specific hidden overflow style provided
        const s = element.style;
        return (s.whiteSpace === 'nowrap' && s.textOverflow === 'ellipsis' && s.overflow === 'hidden');
    }

    // Core Logic: Find the Grid Container
    function findGridContainer(allSpans) {
        if (allSpans.length < 2) return null;

        let current = allSpans[0];

        // Walk up DOM tree
        for (let i = 0; i < 25; i++) {
            if (!current.parentElement || current.parentElement === document.body) break;

            const parent = current.parentElement;
            const siblings = parent.children;

            if (siblings.length > 1) {
                for (let sibling of siblings) {
                    if (sibling === current) continue;
                    // Check if a sibling contains a DIFFERENT valid span from our list
                    const hasSpan = allSpans.some(span => span !== allSpans[0] && sibling.contains(span));
                    if (hasSpan) return parent;
                }
            }
            current = parent;
        }
        return null;
    }

    function sortImages() {
        // 1. Find valid spans
        const spans = Array.from(document.querySelectorAll('span')).filter(isDimensionSpan);

        if (spans.length === 0) {
            showToast('No resolution data found yet. Scroll down!');
            return;
        }

        // 2. Find the container
        const container = findGridContainer(spans);
        if (!container) {
            showToast('Could not detect grid structure.');
            return;
        }

        // 3. Map children to resolution
        const children = Array.from(container.children);
        const items = children.map(child => {
            const mySpan = spans.find(s => child.contains(s));
            const area = mySpan ? getResolutionArea(mySpan.textContent) : -1;
            return { element: child, area: area };
        });

        // 4. Sort (Descending)
        items.sort((a, b) => b.area - a.area);

        // 5. Apply
        const frag = document.createDocumentFragment();
        items.forEach(item => frag.appendChild(item.element));
        container.appendChild(frag);

        showToast(`Sorted ${items.filter(i => i.area > 0).length} images!`);
    }

    // Toast Notification
    function showToast(msg) {
        const btn = document.getElementById(BUTTON_ID);
        if(btn) {
            const oldText = btn.innerText;
            btn.innerText = msg;
            setTimeout(() => { btn.innerText = oldText; }, 2500);
        } else {
            console.log('[Sort Script]', msg);
        }
    }

    // Init Button
    function init() {
        if (document.getElementById(BUTTON_ID)) return;

        const btn = document.createElement('button');
        btn.id = BUTTON_ID;
        btn.innerText = 'Sort Res ↧';
        btn.style.cssText = BTN_STYLE;

        btn.onmouseenter = () => btn.style.backgroundColor = '#3c4043';
        btn.onmouseleave = () => btn.style.backgroundColor = '#303134';

        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            sortImages();
        };

        document.body.appendChild(btn);
    }

    init();

    // Observer for lazy loading
    const observer = new MutationObserver(() => {
        if (!document.getElementById(BUTTON_ID)) init();
    });
    observer.observe(document.body, { childList: true, subtree: true });

})();
