// ==UserScript==
// @name         Rokomari Ripper
// @namespace    http://tampermonkey.net/ (or your preferred namespace)
// @version      1.4.1
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/rokomari.com/userscript/RokomariScraper.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/rokomari.com/userscript/RokomariScraper.js
// @description  Extracts product title, summary, main image, and list images (forcing 1104X1581 size) from Rokomari product/book pages and displays them in an overlay with copy buttons.
// @author       Fahad
// @match        *://*.rokomari.com/book/*
// @match        *://*.rokomari.com/product/*
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // --- Configuration ---
    const config = {
        selectors: {
            product: {
                title: '.mb-0.title, .details-book-main__title, .product-title__title', // Existing selectors for product pages
                summary: '.details-ql-editor.ql-editor.summary, .details-book-additional__content-pane', // Existing selectors
                listImagesContainer: 'li.js--list-img', // Selector for the list items containing background images
            },
            book: {
                title: '.detailsBookContainer_bookName__pLCtW',
                summary: '.productSummary_summeryText__Pd_tX',
                specificationSummary: '.productSpecification_tableBody__z2UzC', // <<< CORRECTED SELECTOR
                mainImage: '.lookInside_imageContainer__A2WcA img',
                listImages: '.bookImageThumbs_bookImageThumb__368gC img', // Selector for the list <img> tags
            }
        },
        targetDimensions: '260X372', // <<< The desired dimensions
        overlayId: 'vm-product-info-extractor-overlay',
        styleId: 'vm-product-info-styles',
        pageTypeIndicatorId: 'vm-page-type-indicator',
        regex: {
            backgroundImageUrl: /background-image:\s*url\(['"]?(.*?)['"]?\)/,
            dimensionPart: /(\/(?:ProductNew\d+|product|book|Content)\/)\d+X\d+(\/.*)/i // Made more generic for /ProductNew.../ or /product/ or /book/ or /Content/ paths
        }
    };

    // --- Styles ---
    const styles = `
        #${config.overlayId} {
            position: fixed; top: 20px; right: 20px; width: 400px; max-height: 90vh; overflow-y: auto;
            background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 6px; padding: 18px;
            box-shadow: 0 6px 18px rgba(0,0,0,0.25); z-index: 10001; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
            font-size: 14px; line-height: 1.5; color: #212529; scrollbar-width: thin; scrollbar-color: #adb5bd #f8f9fa;
        }
        #${config.overlayId}::-webkit-scrollbar { width: 8px; }
        #${config.overlayId}::-webkit-scrollbar-track { background: #f8f9fa; border-radius: 6px; }
        #${config.overlayId}::-webkit-scrollbar-thumb { background-color: #adb5bd; border-radius: 6px; border: 2px solid #f8f9fa; }
        #${config.overlayId} * { box-sizing: border-box; }
        #${config.overlayId} h3 { margin-top: 0; margin-bottom: 15px; font-size: 18px; border-bottom: 1px solid #dee2e6; padding-bottom: 8px; color: #343a40; }
        #${config.overlayId} .pde-section { margin-bottom: 18px; }
        #${config.overlayId} .pde-label { display: block; font-weight: bold; margin-bottom: 5px; color: #495057; }
        #${config.overlayId} .pde-content-text { margin-top: 3px; max-height: 160px; overflow-y: auto; background-color: #fff; border: 1px solid #ced4da; padding: 8px; border-radius: 4px; white-space: pre-wrap; font-size: 13px; color: #343a40; }
        #${config.overlayId} .pde-content-url { font-size: 11px; color: #6c757d; word-break: break-all; margin-top: 4px; display: block; background: #e9ecef; padding: 3px 5px; border-radius: 3px; }
        #${config.overlayId} .pde-url-list-text { font-family: monospace; font-size: 11px; line-height: 1.4; color: #343a40; background-color: #fff; border: 1px solid #ced4da; padding: 8px; border-radius: 4px; margin-top: 10px; max-height: 150px; overflow-y: auto; white-space: pre; word-break: break-all; }
        #${config.overlayId} .pde-image-preview { display: block; max-width: 120px; max-height: 120px; margin-top: 5px; border: 1px solid #ced4da; cursor: pointer; background-color: white; object-fit: contain; border-radius: 3px; }
        #${config.overlayId} .pde-image-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
        #${config.overlayId} .pde-list-image-item img { width: 65px; height: 65px; object-fit: contain; border: 1px solid #ced4da; background-color: white; cursor: pointer; border-radius: 3px; transition: transform 0.2s ease; }
        #${config.overlayId} .pde-list-image-item img:hover { transform: scale(1.05); border-color: #86b7fe; }
        #${config.overlayId} .pde-copy-button { margin-left: 8px; font-size: 11px; padding: 3px 6px; cursor: pointer; border-radius: 4px; border: 1px solid #adb5bd; background-color: #e9ecef; color: #495057; vertical-align: middle; transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease; }
        #${config.overlayId} .pde-copy-button:hover { background-color: #ced4da; border-color: #6c757d; }
        #${config.overlayId} .pde-copy-button.success { background-color: #d1e7dd; border-color: #a3cfbb; color: #0f5132; }
        #${config.overlayId} .pde-copy-button.error { background-color: #f8d7da; border-color: #f1aeb5; color: #842029; }
        #${config.overlayId} .pde-copy-all-button { display: inline-block; margin-top: 10px; margin-right: 8px; font-size: 11px; padding: 3px 6px; cursor: pointer; border-radius: 4px; border: 1px solid #adb5bd; background-color: #e9ecef; }
        #${config.overlayId} .pde-close-button { position: absolute; top: 8px; right: 12px; background: none; border: none; font-size: 26px; font-weight: bold; color: #6c757d; cursor: pointer; padding: 0 5px; line-height: 1; transition: color 0.2s ease; }
        #${config.overlayId} .pde-close-button:hover { color: #343a40; }
        #${config.pageTypeIndicatorId} {
            font-size: 11px;
            color: #6c757d;
            background-color: #e9ecef;
            padding: 2px 6px;
            border-radius: 3px;
            margin-bottom: 10px;
            display: inline-block;
            float: right; /* Position it nicely */
            margin-top: 3px;
        }
    `;

    // --- Helper Functions ---

    function getPageType() {
        const href = window.location.href.toLowerCase();
        if (href.includes('/book/')) return 'book';
        if (href.includes('/product/')) return 'product';
        console.warn("[Product Extractor] Unknown page type for URL:", href);
        return 'product'; // Default to product if unknown, or handle error
    }

    function modifyUrlToTargetDimensions(url) {
        if (!url || typeof url !== 'string') {
            return url;
        }
        try {
            const match = url.match(config.regex.dimensionPart);
            if (match && match[1] && match[2]) {
                const currentDimensionInUrl = url.substring(url.indexOf(match[1]) + match[1].length, url.indexOf(match[2]));
                if (currentDimensionInUrl.toUpperCase() === config.targetDimensions.toUpperCase()) {
                    return url;
                }

                const baseUrlPart = url.substring(0, url.indexOf(match[1]));
                const modifiedUrl = baseUrlPart +
                                  match[1] +
                                  config.targetDimensions +
                                  match[2];
                console.log(`[Product Extractor] Rewriting URL: ${url} -> ${modifiedUrl}`);
                return modifiedUrl;
            }
        } catch (e) {
            console.error(`[Product Extractor] Error modifying URL "${url}":`, e);
        }
        return url;
    }

    function getElementText(selector) {
        try {
            const selectors = selector.split(',').map(s => s.trim()).filter(s => s);
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el) return el.textContent.trim();
            }
            return null;
        } catch (e) {
            console.error(`[Product Extractor] Error finding text for selector "${selector}":`, e);
            return null;
        }
    }

    function getBackgroundImageUrl(element) {
        if (!element) return null;
        try {
            const style = element.getAttribute('style');
            if (style) {
                const match = style.match(config.regex.backgroundImageUrl);
                if (match && match[1]) {
                    let tempEl = document.createElement('textarea');
                    tempEl.innerHTML = match[1];
                    return tempEl.value;
                }
            }
        } catch (e) {
            console.error("[Product Extractor] Error getting background image URL:", e);
        }
        return null;
    }

    function findFirstStyledBackgroundUrl() {
        try {
            const elementsWithStyle = document.querySelectorAll('*[style]');
            let bestCandidate = null;
            for (let el of elementsWithStyle) {
                const url = getBackgroundImageUrl(el);
                if (url && !url.includes('/icon/') && !url.includes('/avatar/') && !url.toLowerCase().endsWith('.gif')) {
                    if (url.includes('ProductNew') || url.includes('/product/') || url.includes('ds.rokomari.store')) {
                        if (!bestCandidate || (url.includes('X') && (!bestCandidate.includes('X') || parseInt(url.split('X')[0].split('/').pop()) > parseInt(bestCandidate.split('X')[0].split('/').pop())))) {
                             bestCandidate = url;
                        } else if (!bestCandidate) {
                            bestCandidate = url;
                        }
                    }
                }
            }
            if (bestCandidate) return new URL(bestCandidate, document.baseURI).href;

            for (let el of elementsWithStyle) {
                const url = getBackgroundImageUrl(el);
                if (url) return new URL(url, document.baseURI).href;
            }
        } catch (e) {
            console.error("[Product Extractor] Error searching for styled background URL:", e);
        }
        return null;
    }

    function extractMainImageUrl(pageType, currentSelectorsConfig) {
        let rawUrl = null;
        if (pageType === 'book' && currentSelectorsConfig.mainImage) {
            try {
                const imgEl = document.querySelector(currentSelectorsConfig.mainImage);
                if (imgEl) {
                    rawUrl = imgEl.src || imgEl.dataset.src;
                     // For book pages, check if src is a data URI (placeholder for lazy loading)
                    if (rawUrl && rawUrl.startsWith('data:image/')) {
                        // Attempt to get a 'data-src' or 'data-original' or similar if it's a common lazy-load pattern
                        const lazyLoadAttributes = ['data-src', 'data-original', 'data-lazy-src'];
                        for (const attr of lazyLoadAttributes) {
                            const lazySrc = imgEl.getAttribute(attr);
                            if (lazySrc && !lazySrc.startsWith('data:image/')) {
                                rawUrl = lazySrc;
                                console.log(`[Product Extractor] Used lazy load attribute '${attr}' for book main image: ${rawUrl}`);
                                break;
                            }
                        }
                    }
                }
            } catch (e) {
                console.error("[Product Extractor] Error extracting book main image via <img>:", e);
            }
        }

        if (!rawUrl || pageType === 'product') { // Fallback for product or if book img extraction failed
            rawUrl = findFirstStyledBackgroundUrl();
        }

        return rawUrl ? new URL(rawUrl, document.baseURI).href : null;
    }

    function extractListImageUrls(pageType, currentSelectorsConfig) {
        const urls = new Set();
        if (pageType === 'book' && currentSelectorsConfig.listImages) {
            try {
                document.querySelectorAll(currentSelectorsConfig.listImages).forEach(imgEl => {
                    let url = imgEl.src || imgEl.dataset.src;
                     if (url && url.startsWith('data:image/')) {
                        const lazyLoadAttributes = ['data-src', 'data-original', 'data-lazy-src'];
                        for (const attr of lazyLoadAttributes) {
                            const lazySrc = imgEl.getAttribute(attr);
                            if (lazySrc && !lazySrc.startsWith('data:image/')) {
                                url = lazySrc;
                                console.log(`[Product Extractor] Used lazy load attribute '${attr}' for book list image: ${url}`);
                                break;
                            }
                        }
                    }
                    if (url && !url.startsWith('data:image/')) { // Ensure it's not a data URI after attempting lazy load
                        urls.add(new URL(url, document.baseURI).href);
                    }
                });
            } catch (e) {
                console.error(`[Product Extractor] Error extracting book list images for selector "${currentSelectorsConfig.listImages}":`, e);
            }
        } else if (pageType === 'product' && currentSelectorsConfig.listImagesContainer) {
            try {
                const listItems = document.querySelectorAll(currentSelectorsConfig.listImagesContainer);
                listItems.forEach(item => {
                    let url = getBackgroundImageUrl(item);
                    if (!url && item.children.length > 0) {
                       for(let child of item.children) {
                           url = getBackgroundImageUrl(child);
                           if (url) break;
                       }
                    }
                    if (!url) {
                         const imgTag = item.querySelector('img');
                         if (imgTag) {
                              url = imgTag.src || imgTag.dataset.src;
                         }
                    }
                    if (url && !url.startsWith('data:image/')) {
                        urls.add(new URL(url, document.baseURI).href);
                    }
                });
            } catch (e) {
                console.error(`[Product Extractor] Error extracting product list images for selector "${currentSelectorsConfig.listImagesContainer}":`, e);
            }
        }
        return Array.from(urls);
    }


    function copyText(text, buttonElement) {
         if (!text && typeof text !== 'string') {
            if (text === null || typeof text === 'undefined') {
                buttonElement.textContent = 'No Data!';
                buttonElement.classList.add('error');
                setTimeout(() => {
                    buttonElement.textContent = buttonElement.dataset.originalText || 'Copy';
                    buttonElement.classList.remove('error');
                }, 1500);
                return;
            }
        }
        buttonElement.dataset.originalText = buttonElement.textContent;
        try {
            GM_setClipboard(text);
            buttonElement.textContent = 'Copied!';
            buttonElement.classList.add('success');
            buttonElement.classList.remove('error');
            setTimeout(() => {
                buttonElement.textContent = buttonElement.dataset.originalText;
                buttonElement.classList.remove('success');
            }, 1500);
        } catch (err) {
            console.error('[Product Extractor] Failed to copy text using GM_setClipboard: ', err);
            buttonElement.textContent = 'Failed!';
            buttonElement.classList.add('error');
            buttonElement.classList.remove('success');
             setTimeout(() => {
                buttonElement.textContent = buttonElement.dataset.originalText;
                buttonElement.classList.remove('error');
            }, 2000);
        }
    }

    // --- Main Function to Extract and Display ---
    async function extractAndShowProductInfo() {
        console.log("[Product Extractor] Starting extraction...");

        const existingBox = document.getElementById(config.overlayId);
        if (existingBox) existingBox.remove();
        const existingStyle = document.getElementById(config.styleId);
        if (existingStyle) existingStyle.remove();

        GM_addStyle(styles);

        const pageType = getPageType();
        const currentSelectors = config.selectors[pageType] || config.selectors.product;
        console.log(`[Product Extractor] Detected page type: ${pageType}`);

        if (pageType === 'book') {
            try {
                const specButtonSelector = 'button.productSpecificationSummary_btn__LyYiW:nth-of-type(2)';
                const specButton = document.querySelector(specButtonSelector);
                if (specButton) {
                    console.log("[Product Extractor] Found specification button, clicking...");
                    specButton.click();
                    await new Promise(resolve => setTimeout(resolve, 500)); // Wait for content to load
                    console.log("[Product Extractor] Waited for specifications to load.");
                } else {
                    console.warn("[Product Extractor] Specification button not found with selector:", specButtonSelector);
                }
            } catch (e) {
                console.error("[Product Extractor] Error clicking specification button:", e);
            }
        }

        const title = getElementText(currentSelectors.title);
        const summary = getElementText(currentSelectors.summary);
        let specificationSummary = null;
        if (pageType === 'book' && currentSelectors.specificationSummary) {
            specificationSummary = getElementText(currentSelectors.specificationSummary);
        }
        const rawMainImageUrl = extractMainImageUrl(pageType, currentSelectors);
        const rawListImageUrls = extractListImageUrls(pageType, currentSelectors);

        const mainImageUrl = modifyUrlToTargetDimensions(rawMainImageUrl);
        const listImageUrls = rawListImageUrls.map(url => modifyUrlToTargetDimensions(url));
        const uniqueListImageUrls = Array.from(new Set(listImageUrls));

        console.log("[Product Extractor] Title:", title);
        console.log("[Product Extractor] Summary:", summary ? summary.substring(0, 100) + '...' : null);
        if (pageType === 'book') {
            console.log("[Product Extractor] Specification Summary:", specificationSummary ? specificationSummary.substring(0, 100) + '...' : null);
        }
        console.log("[Product Extractor] Main Image URL (Raw):", rawMainImageUrl);
        console.log("[Product Extractor] Main Image URL (Modified):", mainImageUrl);
        console.log("[Product Extractor] List Image URLs (Raw):", rawListImageUrls);
        console.log("[Product Extractor] List Image URLs (Modified & Unique):", uniqueListImageUrls);

        if (!title && !summary && !mainImageUrl && uniqueListImageUrls.length === 0 && (pageType !== 'book' || !specificationSummary)) {
            alert(`[Product Extractor] Could not find Title, Summary, Main Image URL, List Image URLs, or Specification Summary for this ${pageType} page using the current selectors. Please check console for errors.`);
            console.warn("[Product Extractor] No data found.");
            return;
        }

        const overlay = document.createElement('div');
        overlay.id = config.overlayId;

        const closeButton = document.createElement('button');
        closeButton.textContent = '×';
        closeButton.className = 'pde-close-button';
        closeButton.title = 'Close';
        closeButton.onclick = () => overlay.remove();
        overlay.appendChild(closeButton);

        const heading = document.createElement('h3');
        heading.textContent = 'Product Details';
        overlay.appendChild(heading);

        const pageTypeIndicator = document.createElement('span');
        pageTypeIndicator.id = config.pageTypeIndicatorId;
        pageTypeIndicator.textContent = `Type: ${pageType.charAt(0).toUpperCase() + pageType.slice(1)}`;
        heading.parentNode.insertBefore(pageTypeIndicator, heading.nextSibling);

        function addSection(label, data, { isUrl = false, isList = false, allowCopy = true, copyLabel = 'Copy' } = {}) {
            if ((data === null || data === undefined) || (isList && (!data || data.length === 0))) {
                 const p = document.createElement('p');
                 p.innerHTML = `<strong class="pde-label">${label}:</strong> <em style="color:#6c757d;">Not Found</em>`;
                 p.className = 'pde-section';
                 overlay.appendChild(p);
                 return;
            }

            const sectionDiv = document.createElement('div');
            sectionDiv.className = 'pde-section';

            const labelSpan = document.createElement('span');
            labelSpan.textContent = `${label}:`;
            labelSpan.className = 'pde-label';
            sectionDiv.appendChild(labelSpan);

            let textToCopy = data;
            if (isList) {
                textToCopy = data.join('\n');
            }

            if (allowCopy && (typeof textToCopy === 'string' && textToCopy.length > 0) && !isList) {
                 const copyBtn = document.createElement('button');
                 copyBtn.textContent = copyLabel;
                 copyBtn.className = 'pde-copy-button';
                 copyBtn.onclick = () => copyText(textToCopy, copyBtn);
                 labelSpan.appendChild(copyBtn);
            }

            if (isList) {
                const listDiv = document.createElement('div');
                listDiv.className = 'pde-image-list';
                data.forEach(url => {
                    const itemDiv = document.createElement('div');
                    itemDiv.className = 'pde-list-image-item';
                    const img = document.createElement('img');
                    img.src = url;
                    img.alt = 'List image thumbnail';
                    img.title = `Click to open: ${url}`;
                    img.onclick = () => window.open(url, '_blank');
                    img.onerror = function() { this.style.display='none'; }; // Hide broken list images
                    itemDiv.appendChild(img);
                    listDiv.appendChild(itemDiv);
                });
                sectionDiv.appendChild(listDiv);

                if (data.length > 0) {
                    const urlListTextArea = document.createElement('textarea');
                    urlListTextArea.className = 'pde-url-list-text';
                    urlListTextArea.readOnly = true;
                    urlListTextArea.value = data.join('\n');
                    sectionDiv.appendChild(urlListTextArea);

                    if (allowCopy) {
                         const copyAllBtn = document.createElement('button');
                         copyAllBtn.textContent = 'Copy All List URLs';
                         copyAllBtn.className = 'pde-copy-all-button pde-copy-button';
                         copyAllBtn.onclick = () => copyText(textToCopy, copyAllBtn);
                         sectionDiv.appendChild(copyAllBtn);
                    }
                }

            } else if (isUrl) {
                const img = document.createElement('img');
                img.src = data;
                img.className = 'pde-image-preview';
                img.alt = 'Main image preview';
                img.title = `Click to open: ${data}`;
                img.onerror = function() {
                    this.alt = 'Image not found';
                    this.style.display = 'none';
                    const errorMsg = document.createElement('em');
                    errorMsg.textContent = ' (Preview not available)';
                    errorMsg.style.fontSize = '11px';
                    errorMsg.style.color = '#dc3545';
                    if(this.nextSibling && this.nextSibling.classList.contains('pde-content-url')) {
                        this.nextSibling.parentNode.insertBefore(errorMsg, this.nextSibling.nextSibling);
                    } else {
                        this.parentNode.appendChild(errorMsg);
                    }
                };
                img.onclick = () => window.open(data, '_blank');
                sectionDiv.appendChild(img);

                const urlText = document.createElement('span');
                urlText.textContent = data;
                urlText.className = 'pde-content-url';
                sectionDiv.appendChild(urlText);

            } else {
                const textDiv = document.createElement('div');
                textDiv.textContent = data;
                textDiv.className = 'pde-content-text';
                sectionDiv.appendChild(textDiv);
            }
            overlay.appendChild(sectionDiv);
        }

        addSection('Title', title, { allowCopy: true, copyLabel: 'Copy' });
        addSection('Summary', summary, { allowCopy: true, copyLabel: 'Copy' });
        if (pageType === 'book') {
            addSection('Specification', specificationSummary, { allowCopy: true, copyLabel: 'Copy' });
        }
        addSection('Main Image', mainImageUrl, { isUrl: true, allowCopy: true, copyLabel: 'Copy URL' });
        addSection('Other Images', uniqueListImageUrls, { isList: true, allowCopy: true });

        document.body.appendChild(overlay);
        console.log("[Product Extractor] Overlay displayed.");
    }

    // --- Register Menu Command ---
    GM_registerMenuCommand('Extract Product Details (1104X1581)', extractAndShowProductInfo, 'p');
    console.log("[Product Extractor] Script loaded. Use Alt+Shift+P or the Tampermonkey/Violentmonkey menu to run.");

})();
