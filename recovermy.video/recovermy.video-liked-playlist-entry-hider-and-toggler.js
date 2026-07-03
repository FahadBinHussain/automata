// ==UserScript==
// @name        Toggle Liked Videos on RecoverMy.Video
// @namespace   Violentmonkey Scripts
// @match       https://www.recovermy.video/*
// @grant       none
// @version     4.0
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/recovermy.video/recovermy.video-liked-playlist-entry-hider-and-toggler.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/recovermy.video/recovermy.video-liked-playlist-entry-hider-and-toggler.js
// @author      Fahad
// @description Hides or shows videos from the "Liked videos" playlist using a robust regular expression search.
// ==/UserScript==

(function() {
    'use strict';

    let areLikedVideosHidden = false;
    const BUTTON_ID = 'toggle-liked-videos-btn-final';
    const VIDEO_CONTAINER_SELECTOR = '.row.bg-light.border.mb-3.no-gutters';

    // This is a Regular Expression. It's a flexible way to find text.
    // It looks for "Playlist:", followed by any amount of spaces or line breaks (\s*),
    // followed by "Liked videos". The 'i' at the end makes it case-insensitive.
    const LIKED_VIDEO_REGEX = /Playlist:\s*Liked videos/i;

    /**
     * Finds all video containers and hides/shows the ones matching the search text.
     */
    function toggleLikedVideos() {
        const allVideoContainers = document.querySelectorAll(VIDEO_CONTAINER_SELECTOR);
        if (allVideoContainers.length === 0) {
            console.error("Could not find any video containers.");
            return;
        }

        let modifiedCount = 0;
        const newDisplayStyle = areLikedVideosHidden ? '' : 'none';

        allVideoContainers.forEach(container => {
            // Use the regular expression to test the container's text content.
            // This is much more reliable than a simple string check.
            if (LIKED_VIDEO_REGEX.test(container.textContent)) {
                container.style.display = newDisplayStyle;
                modifiedCount++;
            }
        });

        if (modifiedCount > 0) {
            areLikedVideosHidden = !areLikedVideosHidden;
            updateButtonText();
        } else {
             // If it still fails, this will help us one last time.
             console.warn("Found video containers, but the RegEx did not match any of them. The text might be very different from 'Playlist: Liked videos'.");
        }
    }

    function updateButtonText() {
        const button = document.getElementById(BUTTON_ID);
        if (button) {
            button.textContent = areLikedVideosHidden ? 'Show Liked Videos' : 'Hide Liked Videos';
        }
    }

    function createToggleButton() {
        if (document.getElementById(BUTTON_ID)) {
            return;
        }

        const button = document.createElement('button');
        button.id = BUTTON_ID;
        Object.assign(button.style, {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            zIndex: '10000',
            padding: '10px 15px',
            backgroundColor: '#007bff', // Back to blue
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            fontSize: '14px',
            boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
        });

        button.addEventListener('click', toggleLikedVideos);
        document.body.appendChild(button);
        updateButtonText();
    }

    // Use a MutationObserver to ensure the button is always present,
    // which is essential for dynamic sites.
    const observer = new MutationObserver(() => {
        if (!document.getElementById(BUTTON_ID)) {
            createToggleButton();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Initial creation of the button.
    createToggleButton();
})();
