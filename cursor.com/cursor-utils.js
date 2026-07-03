// ==UserScript==
// @name         Cursor Usage Event Counter & Auto Rows (v0.17 - All Models with 30d Selection)
// @namespace    http://tampermonkey.net/
// @version      0.17
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/cursor.com/cursor-utils.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/cursor.com/cursor-utils.js
// @description  Selects 30d view, counts successful & errored events across all pages, sets rows to 500.
// @author       Fahad
// @match        https://www.cursor.com/dashboard?tab=usage
// @match        *://*/*dashboard*tab=usage*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    console.log('[Usage Counter] Script starting (v0.17 - All Models with 30d Selection)...');

    const ERRORED_KIND_TEXT = "Errored, Not Charged";
    const DISPLAY_ELEMENT_ID = 'userscript-usage-counter';
    const NOTIFICATION_ELEMENT_ID = 'userscript-row-notification';
    const TARGET_ROWS_PER_PAGE_VALUE = "500";
    let rowsPerPageSetAttempted = false;
    let timeRangeSetAttempted = false;
    
    // Pagination state variables
    let globalModelCounts = {};
    let currentPage = 1;
    let totalPages = 1;
    let paginationInProgress = false;
    let paginationCompleted = false;
    let lastNavigationTime = 0;
    const PAGINATION_COOLDOWN = 2000; // 2 seconds between page navigations to avoid rate limiting
    const PAGINATION_STATUS_ID = 'userscript-pagination-status';

    function createOrUpdateDisplay(modelCounts, paginationInfo) {
        console.log('[Usage Counter] createOrUpdateDisplay called with modelCounts:', modelCounts);
        let display = document.getElementById(DISPLAY_ELEMENT_ID);
        if (!document.body) { // Guard against body not being ready
            console.error("[Usage Counter] Document body not found in createOrUpdateDisplay. Aborting display update.");
            return null;
        }
        if (!display) {
            console.log('[Usage Counter] Creating display element.');
            display = document.createElement('div');
            display.id = DISPLAY_ELEMENT_ID;
            display.style.position = 'fixed';
            display.style.top = '120px';
            display.style.right = '20px';
            display.style.padding = '10px 15px';
            display.style.backgroundColor = 'rgba(50, 50, 50, 0.9)';
            display.style.color = '#e0e0e0';
            display.style.border = '1px solid #777';
            display.style.borderRadius = '5px';
            display.style.zIndex = '10001';
            display.style.fontSize = '14px';
            display.style.fontFamily = 'Arial, sans-serif';
            display.style.lineHeight = '1.6';
            display.style.maxHeight = '70vh';
            display.style.overflowY = 'auto';
            try {
                document.body.appendChild(display);
                console.log('[Usage Counter] Display element appended to body.');
            } catch (e) {
                console.error('[Usage Counter] Error appending display element to body:', e);
                return null;
            }
        }

        let htmlContent = '<h3 style="margin-top:0;margin-bottom:10px;border-bottom:1px solid #555;padding-bottom:5px;">Usage Counts</h3>';
        
        // Add pagination info if available
        if (paginationInfo) {
            htmlContent += `<div style="margin-bottom:10px;font-size:12px;color:#aaa;">
                ${paginationInfo}
            </div>`;
        }
        
        // Calculate totals
        let totalSuccessful = 0;
        let totalErrored = 0;
        
        // Sort models alphabetically
        const sortedModels = Object.keys(modelCounts).sort();
        
        sortedModels.forEach(model => {
            const counts = modelCounts[model];
            totalSuccessful += counts.successful;
            totalErrored += counts.errored;
            const modelTotal = counts.successful + counts.errored;
            
            htmlContent += `<div style="margin-bottom:8px;padding-bottom:5px;border-bottom:1px dotted #444;">
                <strong>${model}</strong><br>
                <span style="color:#7fff7f">Successful: ${counts.successful}</span><br>
                <span style="color:#ff7f7f">Errored: ${counts.errored}</span><br>
                <span>Total: ${modelTotal}</span>
            </div>`;
        });
        
        // Add overall totals at the bottom
        const overallTotal = totalSuccessful + totalErrored;
        htmlContent += `<div style="margin-top:10px;padding-top:5px;border-top:2px solid #555;">
            <strong>OVERALL TOTALS</strong><br>
            <span style="color:#7fff7f">Successful: ${totalSuccessful}</span><br>
            <span style="color:#ff7f7f">Errored: ${totalErrored}</span><br>
            <span>Total: ${overallTotal}</span>
        </div>`;
        
        display.innerHTML = htmlContent;
        return display;
    }

    function showTemporaryNotification(message) {
        if (!document.body) {
            console.error("[Usage Counter] Document body not found in showTemporaryNotification. Aborting notification.");
            return;
        }
        
        let notification = document.getElementById(NOTIFICATION_ELEMENT_ID);
        if (!notification) {
            notification = document.createElement('div');
            notification.id = NOTIFICATION_ELEMENT_ID;
            notification.style.position = 'fixed';
            notification.style.top = '70px';
            notification.style.right = '20px';
            notification.style.padding = '10px 15px';
            notification.style.backgroundColor = 'rgba(40, 167, 69, 0.9)';
            notification.style.color = 'white';
            notification.style.border = '1px solid #28a745';
            notification.style.borderRadius = '5px';
            notification.style.zIndex = '10002';
            notification.style.fontSize = '14px';
            notification.style.fontFamily = 'Arial, sans-serif';
            notification.style.transition = 'opacity 0.5s ease-in-out';
            notification.style.opacity = '0';
            document.body.appendChild(notification);
        }

        notification.textContent = message;
        notification.style.display = 'block';
        
        // Fade in
        setTimeout(() => {
            notification.style.opacity = '1';
        }, 10);
        
        // Fade out and hide after delay
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                notification.style.display = 'none';
            }, 500);
        }, 3000);
        
        console.log('[Usage Counter] Notification shown:', message);
    }

    function showPaginationStatus(message, isProcessing = false) {
        if (!document.body) {
            console.error("[Usage Counter] Document body not found in showPaginationStatus. Aborting.");
            return;
        }
        
        let statusElement = document.getElementById(PAGINATION_STATUS_ID);
        if (!statusElement) {
            statusElement = document.createElement('div');
            statusElement.id = PAGINATION_STATUS_ID;
            statusElement.style.position = 'fixed';
            statusElement.style.top = '95px';
            statusElement.style.right = '20px';
            statusElement.style.padding = '5px 10px';
            statusElement.style.backgroundColor = 'rgba(0, 123, 255, 0.9)';
            statusElement.style.color = 'white';
            statusElement.style.border = '1px solid #0056b3';
            statusElement.style.borderRadius = '5px';
            statusElement.style.zIndex = '10003';
            statusElement.style.fontSize = '12px';
            statusElement.style.fontFamily = 'Arial, sans-serif';
            document.body.appendChild(statusElement);
        }

        if (isProcessing) {
            statusElement.innerHTML = `${message} <span class="spinner" style="display:inline-block;width:10px;height:10px;border:2px solid #fff;border-radius:50%;border-top-color:transparent;animation:spin 1s linear infinite;"></span>`;
            statusElement.style.display = 'block';
            
            // Add the animation if it doesn't exist
            if (!document.getElementById('pagination-spinner-style')) {
                const style = document.createElement('style');
                style.id = 'pagination-spinner-style';
                style.textContent = `@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`;
                document.head.appendChild(style);
            }
        } else {
            statusElement.textContent = message;
            statusElement.style.display = 'block';
        }
    }

    function hidePaginationStatus() {
        const statusElement = document.getElementById(PAGINATION_STATUS_ID);
        if (statusElement) {
            statusElement.style.display = 'none';
        }
    }

    function isLikelyUsagePage() {
        // Check URL first - most reliable method
        if (typeof window !== 'undefined' && window.location && window.location.href) {
            if (window.location.href.includes("cursor.com/dashboard") && 
                (window.location.search.includes("tab=usage") || 
                 window.location.pathname.includes("/usage"))) {
                console.log('[Usage Counter] isLikelyUsagePage: true (URL match).');
                return true;
            }
        }
        
        // Content-based checks as fallback
        try {
            // Check for table headers or content that would indicate usage page
            const usageIndicators = [
                'table:has(th:contains("Date"))',
                'table:has(th:contains("Kind"))',
                'table:has(th:contains("Model"))',
                'div:contains("Usage")',
                'h1:contains("Usage")',
                'div:contains("API Calls")'
            ];
            
            for (const selector of usageIndicators) {
                try {
                    const elements = document.querySelectorAll(selector);
                    if (elements && elements.length > 0) {
                        console.log(`[Usage Counter] isLikelyUsagePage: true (found ${elements.length} elements matching "${selector}").`);
                        return true;
                    }
                } catch (selectorError) {
                    // Some browsers might not support complex selectors
                    console.log(`[Usage Counter] Selector error for "${selector}":`, selectorError);
                }
            }
            
            // Look for model-related text on the page
            const textNodes = document.querySelectorAll('body *');
            for (const node of textNodes) {
                if (node.textContent && (
                    node.textContent.includes("claude") || 
                    node.textContent.includes("gpt") ||
                    node.textContent.includes("llama") ||
                    node.textContent.includes("gemini"))) {
                    console.log('[Usage Counter] isLikelyUsagePage: true (found model name in page content).');
                    return true;
                }
            }
        } catch (e) {
            console.error('[Usage Counter] Error in content-based page detection:', e);
        }
        
        console.log('[Usage Counter] isLikelyUsagePage: false (no indicators found).');
        return false;
    }

    function select30DayTimeRange() {
        try {
            console.log('[Usage Counter] Attempting to select 30d time range...');
            
            // Find the 30d button using the provided selector
            const buttonSelector = 'button.rounded.px-3.py-2.text-sm.bg-brand-dashboard-card.text-white, button:contains("30d")';
            let timeRangeButton = null;
            
            // Try different methods to find the button
            const possibleButtons = document.querySelectorAll('button');
            for (const button of possibleButtons) {
                if (button.textContent && button.textContent.trim() === '30d') {
                    timeRangeButton = button;
                    console.log('[Usage Counter] Found 30d button by text content');
                    break;
                }
                
                if (button.classList.contains('rounded') && 
                    button.classList.contains('px-3') && 
                    button.classList.contains('py-2') && 
                    button.classList.contains('text-sm') && 
                    button.classList.contains('bg-brand-dashboard-card') && 
                    button.classList.contains('text-white')) {
                    
                    if (button.textContent && button.textContent.trim() === '30d') {
                        timeRangeButton = button;
                        console.log('[Usage Counter] Found 30d button by class and text');
                        break;
                    }
                }
            }
            
            if (!timeRangeButton) {
                // Try a more generic approach
                const allButtons = Array.from(document.querySelectorAll('button')).filter(btn => 
                    btn.textContent && btn.textContent.trim() === '30d'
                );
                
                if (allButtons.length > 0) {
                    timeRangeButton = allButtons[0];
                    console.log('[Usage Counter] Found 30d button using generic approach');
                }
            }
            
            if (!timeRangeButton) {
                console.log('[Usage Counter] 30d button not found.');
                return Promise.resolve(false);
            }
            
            // Check if the button is already selected (might have different styling)
            const isAlreadySelected = timeRangeButton.classList.contains('bg-brand-primary') || 
                                     timeRangeButton.classList.contains('bg-blue-500') ||
                                     timeRangeButton.getAttribute('aria-selected') === 'true';
            
            if (isAlreadySelected) {
                console.log('[Usage Counter] 30d time range already selected.');
                showTemporaryNotification('30d time range already selected');
                return Promise.resolve(true);
            }
            
            // Click the button
            timeRangeButton.click();
            showTemporaryNotification('Selected 30d time range');
            console.log('[Usage Counter] Clicked 30d button.');
            
            // Return a promise that resolves after a delay to allow the UI to update
            return new Promise(resolve => setTimeout(() => resolve(true), 1000));
        } catch (e) {
            console.error("[Usage Counter] Error selecting 30d time range:", e);
            return Promise.resolve(false);
        }
    }

    function autoSetRowsPerPage() {
        try {
            console.log('[Usage Counter] Attempting to set rows per page to', TARGET_ROWS_PER_PAGE_VALUE, 'using <select> logic.');
            const selectElementSelector = 'select.bg-transparent.border.border-brand-borders.dark\\:border-brand-neutrals-800.rounded.text-xs.px-2.py-1';
            let selectElement = document.querySelector(selectElementSelector);

            if (!selectElement) {
                // Try fallback selectors
                const fallbackSelectors = [
                    'select[aria-label="Rows per page"]',
                    'select.text-xs',
                    'select[class*="text-xs"]',
                    'select'
                ];
                
                for (const selector of fallbackSelectors) {
                    selectElement = document.querySelector(selector);
                    if (selectElement) {
                        console.log(`[Usage Counter] Found rows per page <select> using fallback selector: ${selector}`);
                        break;
                    }
                }
            }

            if (!selectElement) {
                console.log('[Usage Counter] Rows per page <select> element not found even with fallback.');
                return Promise.resolve(false);
            }
            
            if (selectElement.value === TARGET_ROWS_PER_PAGE_VALUE) {
                console.log(`[Usage Counter] Rows per page already set to ${TARGET_ROWS_PER_PAGE_VALUE}.`);
                showTemporaryNotification(`Rows per page already set to ${TARGET_ROWS_PER_PAGE_VALUE}`);
                return Promise.resolve(true);
            }
            
            const targetOption = Array.from(selectElement.options).find(option => option.value === TARGET_ROWS_PER_PAGE_VALUE);
            if (!targetOption) {
                console.log(`[Usage Counter] Option for ${TARGET_ROWS_PER_PAGE_VALUE} rows not found in select element.`);
                return Promise.resolve(false);
            }
            
            selectElement.value = TARGET_ROWS_PER_PAGE_VALUE;
            selectElement.dispatchEvent(new Event('change', { bubbles: true }));
            selectElement.dispatchEvent(new Event('input', { bubbles: true }));
            showTemporaryNotification(`Rows per page set to ${TARGET_ROWS_PER_PAGE_VALUE}!`);
            return new Promise(resolve => setTimeout(() => resolve(true), 300));
        } catch (e) {
            console.error("[Usage Counter] CRITICAL ERROR in autoSetRowsPerPage:", e);
            return Promise.resolve(false); // Resolve false on error
        }
    }

    function detectPagination() {
        try {
            console.log('[Usage Counter] Detecting pagination information.');
            
            // Reset current page if needed
            currentPage = 1;
            totalPages = 1;
            
            // Look for page indicator text (e.g., "Page 1 of 2")
            const pageIndicators = Array.from(document.querySelectorAll('*')).filter(el => 
                el.textContent && /Page\s+\d+\s+of\s+\d+/i.test(el.textContent.trim())
            );
            
            if (pageIndicators.length > 0) {
                const pageText = pageIndicators[0].textContent.trim();
                const match = pageText.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
                
                if (match && match.length >= 3) {
                    currentPage = parseInt(match[1], 10);
                    totalPages = parseInt(match[2], 10);
                    console.log(`[Usage Counter] Pagination detected: Page ${currentPage} of ${totalPages}`);
                    return true;
                }
            }
            
            // If no page indicator text, check for navigation buttons
            const nextPageButton = document.querySelector('button svg.lucide-chevron-right, svg.lucide.lucide-chevron-right');
            if (nextPageButton) {
                console.log('[Usage Counter] Next page button found, indicating multiple pages.');
                // If there's a next button but no indicator text, assume at least 2 pages
                totalPages = Math.max(2, totalPages);
                return true;
            }
            
            console.log('[Usage Counter] No pagination detected, assuming single page.');
            return false;
        } catch (e) {
            console.error("[Usage Counter] Error detecting pagination:", e);
            return false;
        }
    }

    function navigateToNextPage() {
        try {
            console.log(`[Usage Counter] Attempting to navigate from page ${currentPage} to next page...`);
            
            // Prevent navigation if cooling down
            const now = Date.now();
            if (now - lastNavigationTime < PAGINATION_COOLDOWN) {
                console.log('[Usage Counter] Navigation on cooldown. Waiting...');
                return false;
            }
            
            // Check if we're already on the last page
            if (currentPage >= totalPages) {
                console.log('[Usage Counter] Already on the last page. No navigation needed.');
                return false;
            }
            
            // Find and click the next page button
            const nextPageButton = document.querySelector('button svg.lucide-chevron-right, svg.lucide.lucide-chevron-right');
            if (!nextPageButton) {
                console.error('[Usage Counter] Next page button not found.');
                return false;
            }
            
            // Get the actual button element (may be parent of the SVG)
            const buttonElement = nextPageButton.closest('button') || nextPageButton.parentElement;
            if (!buttonElement || buttonElement.disabled) {
                console.error('[Usage Counter] Next page button is disabled or not found.');
                return false;
            }
            
            // Click the button
            buttonElement.click();
            lastNavigationTime = now;
            currentPage++;
            
            console.log(`[Usage Counter] Navigated to page ${currentPage} of ${totalPages}`);
            showPaginationStatus(`Navigating to page ${currentPage}...`, true);
            
            return true;
        } catch (e) {
            console.error("[Usage Counter] Error navigating to next page:", e);
            return false;
        }
    }

    function mergeCounts(existingCounts, newCounts) {
        const mergedCounts = {...existingCounts};
        
        // Add all models from newCounts
        for (const model in newCounts) {
            if (!mergedCounts[model]) {
                mergedCounts[model] = { successful: 0, errored: 0 };
            }
            
            mergedCounts[model].successful += newCounts[model].successful;
            mergedCounts[model].errored += newCounts[model].errored;
        }
        
        return mergedCounts;
    }

    function performCount(isPageNavigation = false) {
        console.log('[Usage Counter] Performing actual event count (All Models v0.17).');
        // Initialize an object to store counts for each model
        let modelCounts = {};

        try {
            // Find all table rows or elements that might contain usage data
            const tableRows = document.querySelectorAll('tr, div[role="row"]');
            console.log(`[Usage Counter] Found ${tableRows.length} potential table rows.`);
            
            if (tableRows.length === 0) {
                // Try a more generic approach to find potential model cells
                const allPossibleElements = document.querySelectorAll('body *');
                const potentialModelCells = Array.from(allPossibleElements).filter(el => {
                    if (!el || !el.textContent) return false;
                    const text = el.textContent.trim();
                    // Pattern matching for common model names
                    return (
                        text.includes("claude") || 
                        text.includes("gpt") || 
                        text.includes("llama") ||
                        text.includes("gemini") ||
                        text.includes("mistral") ||
                        text.includes("anthropic")
                    );
                });
                
                console.log(`[Usage Counter] No table rows found. Found ${potentialModelCells.length} potential model cells via text content search.`);
                
                // Process each potential model cell
                potentialModelCells.forEach((modelCell, index) => {
                    try {
                        if (!modelCell.textContent) return;
                        
                        const modelName = modelCell.textContent.trim();
                        let kindText = "";
                        
                        // Look for kind information in parent elements or siblings
                        const parentElement = modelCell.parentElement;
                        if (parentElement) {
                            const allCellsInRow = parentElement.querySelectorAll('*');
                            for (const cell of allCellsInRow) {
                                if (cell.textContent && cell.textContent.trim() === ERRORED_KIND_TEXT) {
                                    kindText = ERRORED_KIND_TEXT;
                                    break;
                                }
                            }
                        }
                        
                        // Initialize model entry if not exists
                        if (!modelCounts[modelName]) {
                            modelCounts[modelName] = { successful: 0, errored: 0 };
                        }
                        
                        // Count based on kind
                        if (kindText === ERRORED_KIND_TEXT) {
                            modelCounts[modelName].errored++;
                        } else {
                            modelCounts[modelName].successful++;
                        }
                    } catch (e) {
                        console.error(`[Usage Counter] Error processing potential model cell ${index}:`, e);
                    }
                });
            } else {
                // Process each table row
                tableRows.forEach((row, index) => {
                    try {
                        // Skip header rows (they usually have th elements)
                        if (row.querySelector('th')) {
                            return;
                        }
                        
                        // Get all cells in the row
                        const cells = row.querySelectorAll('td, div[role="cell"]');
                        if (!cells || cells.length < 3) return;
                        
                        let modelName = "";
                        let kindText = "";
                        
                        // Try to identify model and kind cells
                        // In most tables: Date | Kind | Model | ...
                        for (let i = 0; i < cells.length; i++) {
                            const cell = cells[i];
                            if (!cell || !cell.textContent) continue;
                            
                            const cellText = cell.textContent.trim();
                            
                            // Look for model name patterns
                            if (cellText.includes("claude") || 
                                cellText.includes("gpt") || 
                                cellText.includes("llama") || 
                                cellText.includes("gemini") ||
                                cellText.includes("mistral")) {
                                modelName = cellText;
                            }
                            
                            // Check if this is a kind cell with error status
                            if (cellText === ERRORED_KIND_TEXT) {
                                kindText = ERRORED_KIND_TEXT;
                            }
                        }
                        
                        if (modelName) {
                            // Initialize model entry if not exists
                            if (!modelCounts[modelName]) {
                                modelCounts[modelName] = { successful: 0, errored: 0 };
                            }
                            
                            // Count based on kind
                            if (kindText === ERRORED_KIND_TEXT) {
                                modelCounts[modelName].errored++;
                            } else {
                                modelCounts[modelName].successful++;
                            }
                        }
                    } catch (e) {
                        console.error(`[Usage Counter] Error processing table row ${index}:`, e);
                    }
                });
            }
        } catch (e) {
            console.error("[Usage Counter] CRITICAL ERROR in performCount's main try block:", e);
            // In case of a major error, try to display something to indicate script ran but failed counting
            createOrUpdateDisplay({ "ERROR": { successful: -1, errored: -1 } });
            return; // Stop further processing in performCount
        }
        
        // If no models were found, show error message
        if (Object.keys(modelCounts).length === 0) {
            modelCounts["No Models Found"] = { successful: 0, errored: 0 };
        }
        
        console.log('[Usage Counter] Page model counts:', modelCounts);
        
        // If this is coming from a page navigation during pagination, merge with global counts
        if (isPageNavigation) {
            globalModelCounts = mergeCounts(globalModelCounts, modelCounts);
            
            // Handle pagination progress
            const paginationInfo = `Scanned ${currentPage} of ${totalPages} pages`;
            console.log(`[Usage Counter] ${paginationInfo}`);
            
            if (currentPage < totalPages) {
                // Continue to next page after a short delay
                setTimeout(() => {
                    if (navigateToNextPage()) {
                        // Wait for page to load before counting the next page
                        setTimeout(() => {
                            performCount(true);
                        }, 1500);
                    } else {
                        paginationInProgress = false;
                        paginationCompleted = true;
                        hidePaginationStatus();
                        showTemporaryNotification("Pagination complete!");
                        
                        // Final display update with complete data
                        try {
                            const paginationInfo = `Data from all ${totalPages} pages`;
                            const display = createOrUpdateDisplay(globalModelCounts, paginationInfo);
                            if (display) {
                                display.style.display = 'block';
                            }
                        } catch (e) {
                            console.error("[Usage Counter] Error updating final display after pagination:", e);
                        }
                    }
                }, PAGINATION_COOLDOWN);
                
                // Update display with current progress
                try {
                    const display = createOrUpdateDisplay(globalModelCounts, paginationInfo);
                    if (display) {
                        display.style.display = 'block';
                    }
                } catch (e) {
                    console.error("[Usage Counter] Error updating display during pagination:", e);
                }
                
                return;
            } else {
                // Pagination is complete
                paginationInProgress = false;
                paginationCompleted = true;
                hidePaginationStatus();
                showTemporaryNotification("Pagination complete!");
                
                // Final display update with complete data
                try {
                    const paginationInfo = `Data from all ${totalPages} pages`;
                    const display = createOrUpdateDisplay(globalModelCounts, paginationInfo);
                    if (display) {
                        display.style.display = 'block';
                    }
                } catch (e) {
                    console.error("[Usage Counter] Error updating final display after pagination:", e);
                }
            }
        } else {
            // Fresh count, not from pagination
            globalModelCounts = modelCounts;
            
            // Check for pagination
            if (detectPagination() && totalPages > 1 && !paginationInProgress && !paginationCompleted) {
                console.log(`[Usage Counter] Starting one-time pagination process for ${totalPages} pages`);
                paginationInProgress = true;
                showPaginationStatus(`Starting pagination scan (page 1 of ${totalPages})...`, true);
                
                // If we're already on page 1, start navigating to page 2
                if (currentPage === 1) {
                    setTimeout(() => {
                        if (navigateToNextPage()) {
                            // Wait for page to load before counting
                            setTimeout(() => {
                                performCount(true);
                            }, 1500);
                        } else {
                            paginationInProgress = false;
                            paginationCompleted = true;
                            hidePaginationStatus();
                            
                            // Final display update for single page
                            try {
                                const paginationInfo = `Data from page ${currentPage}`;
                                const display = createOrUpdateDisplay(globalModelCounts, paginationInfo);
                                if (display) {
                                    display.style.display = 'block';
                                }
                            } catch (e) {
                                console.error("[Usage Counter] Error updating display after single page:", e);
                            }
                        }
                    }, 500);
                }
            } else if (paginationCompleted) {
                // If pagination already completed, just show data without updating
                try {
                    const paginationInfo = `Data from all ${totalPages} pages`;
                    const display = createOrUpdateDisplay(globalModelCounts, paginationInfo);
                    if (display) {
                        display.style.display = 'block';
                    }
                } catch (e) {
                    console.error("[Usage Counter] Error showing existing data:", e);
                }
            } else {
                // No pagination needed, just update display with current page data
                try {
                    const paginationInfo = totalPages > 1 ? `Data from page ${currentPage}` : null;
                    const display = createOrUpdateDisplay(globalModelCounts, paginationInfo);
                    if (display) {
                        display.style.display = 'block';
                    } else {
                        console.error("[Usage Counter] createOrUpdateDisplay returned null after counts. Display not shown.");
                    }
                } catch (e) {
                    console.error("[Usage Counter] Error calling createOrUpdateDisplay or setting display to block (after counts):", e);
                }
            }
        }
    }

    function countEvents() {
        console.log('[Usage Counter] countEvents called.');
        try {
            if (!isLikelyUsagePage()) {
                console.log('[Usage Counter] Not on usage page, hiding display if it exists.');
                const display = document.getElementById(DISPLAY_ELEMENT_ID);
                if (display) {
                    display.style.display = 'none';
                }
                hidePaginationStatus();
                return;
            }
            
            // Don't start a new count if pagination is in progress
            if (paginationInProgress) {
                console.log('[Usage Counter] Pagination in progress, skipping new count.');
                return;
            }
            
            // Don't restart if pagination is already completed
            if (paginationCompleted) {
                console.log('[Usage Counter] Pagination already completed, skipping new count.');
                return;
            }
            
            // First set the time range to 30d if not attempted yet
            if (!timeRangeSetAttempted) {
                select30DayTimeRange().then(timeRangeSuccess => {
                    timeRangeSetAttempted = true;
                    console.log("[Usage Counter] select30DayTimeRange promise resolved. Success:", timeRangeSuccess);
                    
                    // After setting time range, set rows per page
                    if (!rowsPerPageSetAttempted) {
                        // Add a slight delay to allow UI to update after time range change
                        setTimeout(() => {
                            autoSetRowsPerPage().then(rowsSuccess => {
                                rowsPerPageSetAttempted = true;
                                console.log("[Usage Counter] autoSetRowsPerPage promise resolved. Success:", rowsSuccess);
                                
                                // Finally perform the count after both settings are applied
                                setTimeout(() => { 
                                    try { 
                                        performCount(); 
                                    } catch(e) { 
                                        console.error("Error in performCount after settings:", e); 
                                        createOrUpdateDisplay({ "ERROR": { successful: -1, errored: -1 } });
                                    }
                                }, rowsSuccess ? 500 : 0);
                            }).catch(err => {
                                console.error("[Usage Counter] Error in autoSetRowsPerPage promise:", err);
                                rowsPerPageSetAttempted = true;
                                performCount();
                            });
                        }, 1000);
                    } else {
                        // If rows already set, just perform count
                        setTimeout(() => performCount(), 500);
                    }
                }).catch(err => {
                    console.error("[Usage Counter] Error in select30DayTimeRange promise:", err);
                    timeRangeSetAttempted = true;
                    
                    // Continue with rows per page setting even if time range fails
                    if (!rowsPerPageSetAttempted) {
                        autoSetRowsPerPage().then(success => {
                            rowsPerPageSetAttempted = true;
                            setTimeout(() => performCount(), success ? 500 : 0);
                        }).catch(() => {
                            rowsPerPageSetAttempted = true;
                            performCount();
                        });
                    } else {
                        performCount();
                    }
                });
            } else if (!rowsPerPageSetAttempted) {
                // If time range already set but rows not yet set
                autoSetRowsPerPage().then(success => {
                    rowsPerPageSetAttempted = true;
                    setTimeout(() => { 
                        try { 
                            performCount(); 
                        } catch(e) { 
                            console.error("Error in performCount from timeout:", e); 
                            createOrUpdateDisplay({ "ERROR": { successful: -1, errored: -1 } });
                        }
                    }, success ? 500 : 0);
                }).catch(err => {
                    console.error("[Usage Counter] Error in autoSetRowsPerPage promise:", err);
                    rowsPerPageSetAttempted = true;
                    try { 
                        performCount(); 
                    } catch(e) { 
                        console.error("Error in performCount from catch:", e); 
                        createOrUpdateDisplay({ "ERROR": { successful: -1, errored: -1 } });
                    }
                });
            } else {
                // Both settings already attempted, just perform count
                try { 
                    performCount(); 
                } catch(e) { 
                    console.error("Error in performCount (direct call):", e); 
                    createOrUpdateDisplay({ "ERROR": { successful: -1, errored: -1 } });
                }
            }
        } catch (e) {
            console.error("[Usage Counter] CRITICAL ERROR in countEvents function:", e);
            try { 
                createOrUpdateDisplay({ "ERROR": { successful: -1, errored: -1 } }); 
            } catch (e2) { 
                console.error("Error trying to show error display:", e2); 
            }
        }
    }

    // Initial run and interval
    try {
        console.log("[Usage Counter] Setting up initial timers.");
        setTimeout(() => {
            console.log('[Usage Counter] Initial countEvents timeout triggered.');
            countEvents();
        }, 2000); // Slightly longer initial delay

        // Much less frequent interval just to keep the display updated if needed
        setInterval(() => {
            // Only update the display if we're on the usage page
            if (isLikelyUsagePage()) {
                const display = document.getElementById(DISPLAY_ELEMENT_ID);
                if (display) {
                    display.style.display = 'block';
                }
            }
        }, 30000); // Check every 30 seconds if display should be visible
    } catch (e) {
        console.error("[Usage Counter] CRITICAL ERROR setting up initial timers:", e);
    }

    console.log('[Usage Counter] Script loaded and initial timers set (v0.17 - All Models with 30d Selection).');
})();