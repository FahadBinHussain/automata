// ==UserScript==
// @name         YouTube Playlist Sorter
// @namespace    http://tampermonkey.net/
// @version      1.4
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/youtube.com/youtube.com-playlist-auto-expander-and-view-count-sorter.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/youtube.com/youtube.com-playlist-auto-expander-and-view-count-sorter.js
// @description  DEBUG VERSION: Tries repeatedly to find the container and adds a red border for visual confirmation.
// @author       Fahad
// @match        https://www.youtube.com/playlist*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // --- Configuration ---
    const BUTTON_TEXT = 'Sort by Views';
    const SORTING_TEXT = 'Sorting...';
    const DONE_TEXT = 'Sorted!';
    const CONSOLE_PREFIX = '[YT Sorter Debug]:';
    const TARGET_SELECTOR = '.page-header-view-model-wiz__scroll-container';

    let attempts = 0;
    const maxAttempts = 20; // Try for 20 seconds

    console.log(`${CONSOLE_PREFIX} Script loaded. Will start trying to find the container.`);

    function findAndAddButton() {
        attempts++;

        if (document.getElementById('sort-by-views-btn')) {
            console.log(`${CONSOLE_PREFIX} Button already exists. Stopping checks.`);
            return true; // Stop polling
        }

        console.log(`${CONSOLE_PREFIX} Attempt #${attempts}: Searching for container with selector: "${TARGET_SELECTOR}"`);
        const container = document.querySelector(TARGET_SELECTOR);

        if (container) {
            console.log(`${CONSOLE_PREFIX} SUCCESS! Found the container element.`);

            // --- VISUAL DEBUG STEP ---
            // Add a red border to prove we found the right element.
            container.style.border = '3px solid red';
            console.log(`${CONSOLE_PREFIX} Added a red border to the container for visual confirmation.`);

            // Now, add the button
            const sortButton = document.createElement('button');
            sortButton.id = 'sort-by-views-btn';
            sortButton.textContent = BUTTON_TEXT;

            Object.assign(sortButton.style, {
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                color: '#f1f1f1',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '18px',
                padding: '8px 16px',
                margin: '0 0 0 16px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '500',
                alignSelf: 'center',
                flexShrink: '0'
            });

            if (getComputedStyle(container).display === 'flex') {
                 container.style.alignItems = 'center';
            }

            container.appendChild(sortButton);
            console.log(`${CONSOLE_PREFIX} Successfully added the sort button to the UI.`);

            sortButton.addEventListener('click', async (event) => {
                event.stopPropagation();
                sortButton.textContent = SORTING_TEXT;
                sortButton.disabled = true;

                await loadAllVideos();
                sortPlaylistByViews();

                sortButton.textContent = DONE_TEXT;
                setTimeout(() => {
                    sortButton.textContent = BUTTON_TEXT;
                    sortButton.disabled = false;
                }, 3000);
            });

            return true; // Stop polling
        }

        if (attempts >= maxAttempts) {
            console.error(`${CONSOLE_PREFIX} FAILED. Stopped after ${maxAttempts} attempts. The container element was never found. YouTube may have updated its UI.`);
            return true; // Stop polling
        }

        return false; // Continue polling
    }

    // --- Polling Interval ---
    const pollingInterval = setInterval(() => {
        if (findAndAddButton()) {
            clearInterval(pollingInterval);
        }
    }, 1000);

    // The rest of the functions (loadAllVideos, parseViews, sortPlaylistByViews) are unchanged
    // but are included here for completeness.

    async function loadAllVideos() { /* ... function code from previous version ... */ }
    function parseViews(viewString) { /* ... function code from previous version ... */ }
    function sortPlaylistByViews() { /* ... function code from previous version ... */ }

    async function loadAllVideos() {
        console.log(`${CONSOLE_PREFIX} Starting to scroll and load all videos.`);
        const scrollableElement = document.documentElement;
        const videoList = document.querySelector('ytd-playlist-video-list-renderer');
        if (!videoList) { console.error(`${CONSOLE_PREFIX} Could not find the video list.`); return; }
        let lastVideoCount = 0, retries = 0, maxRetries = 3;
        while (retries < maxRetries) {
            scrollableElement.scrollTop = scrollableElement.scrollHeight;
            await new Promise(resolve => setTimeout(resolve, 1500));
            const currentVideoCount = videoList.querySelectorAll("ytd-playlist-video-renderer").length;
            if (currentVideoCount > lastVideoCount) {
                lastVideoCount = currentVideoCount; retries = 0;
                console.log(`${CONSOLE_PREFIX} Loaded ${currentVideoCount} videos...`);
            } else {
                retries++;
            }
        }
        console.log(`${CONSOLE_PREFIX} Scrolling finished.`);
    }

    function parseViews(viewString) {
        if (!viewString) return 0;
        const text = viewString.toLowerCase().replace(/,/g, '').replace(/\s*views?/, '').trim();
        let number = parseFloat(text);
        if (isNaN(number)) return 0;
        if (text.includes('k')) number *= 1e3;
        if (text.includes('m')) number *= 1e6;
        if (text.includes('b')) number *= 1e9;
        return number;
    }

    function sortPlaylistByViews() {
        const playlistContainer = document.querySelector("#contents.ytd-playlist-video-list-renderer");
        if (!playlistContainer) { console.error(`${CONSOLE_PREFIX} Could not find playlist container to sort.`); return; }
        const videos = Array.from(playlistContainer.querySelectorAll("ytd-playlist-video-renderer"));
        console.log(`${CONSOLE_PREFIX} Found ${videos.length} videos to sort.`);
        const videoData = videos.map(video => {
            const viewElement = video.querySelector("#metadata #video-info span:first-of-type");
            const viewsText = viewElement ? viewElement.textContent : '0';
            return { element: video, views: parseViews(viewsText) };
        });
        videoData.sort((a, b) => b.views - a.views);
        videoData.forEach(data => playlistContainer.appendChild(data.element));
        console.log(`${CONSOLE_PREFIX} Sorting complete.`);
    }

})();
