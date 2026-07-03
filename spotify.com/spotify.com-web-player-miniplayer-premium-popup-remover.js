// ==UserScript==
// @name         Spotify Miniplayer Ultimate Unblocker (V25 - Auto-Pop on Tab Switch)
// @namespace    http://tampermonkey.net/
// @version      25.0
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/spotify.com/spotify.com-web-player-miniplayer-premium-popup-remover.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/spotify.com/spotify.com-web-player-miniplayer-premium-popup-remover.js
// @description  Restores the official "Show on Hover" behavior for controls. Hides Premium text via Opacity. Keeps Art visible. Auto-opens miniplayer when you switch tabs.
// @author       Fahad
// @match        https://open.spotify.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    console.log("Spotify Miniplayer: Hover Effect + Auto-Pop on Tab Switch Enabled");

    const antiPremiumCSS = `
        /* 1. PLAYER CONTAINER */
        [data-testid="pip-hover-element"],
        #document-pip-main-container {
            display: flex !important;
            visibility: visible !important;
            opacity: 1 !important;
            width: 100% !important;
            height: 100% !important;
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            z-index: 1 !important;
        }

        /* 2. CONTROLS (THE HOVER FIX) */
        .encore-over-media-set,
        [data-testid="document-pip-hover-element"] {
            display: flex !important;
            z-index: 99999 !important;
            background: rgba(0,0,0,0.3) !important;
            
            /* Start Invisible */
            opacity: 0 !important;
            /* Add smooth fade animation */
            transition: opacity 0.2s ease-in-out !important;
        }

        /* SHOW CONTROLS WHEN HOVERING THE WINDOW */
        body:hover .encore-over-media-set,
        body:hover [data-testid="document-pip-hover-element"] {
            opacity: 1 !important;
        }

        /* 3. WINDOW SETUP */
        body {
             display: flex !important;
             flex-direction: column !important;
             margin: 0 !important;
             overflow: hidden !important;
        }
    `;

    // JS JANITOR (Unchanged - Keeps Art alive by using opacity hidden on text)
    function startJanitor(doc) {
        const observer = new MutationObserver((mutations) => {
            const xpath = "//*[contains(text(),'You discovered a Premium feature')]";
            const matchingElement = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;

            if (matchingElement) {
                // Find the wrapper holding the text/buttons
                const premiumContentBox = matchingElement.closest('div').parentElement;

                if (premiumContentBox) {
                    // Hide via Opacity (Keeps Art Container Expanded)
                    if (premiumContentBox.style.opacity !== '0') {
                        premiumContentBox.style.opacity = '0';
                        premiumContentBox.style.pointerEvents = 'none';
                    }
                }
            }
        });

        observer.observe(doc.body, { childList: true, subtree: true });
    }

    // --- THE TRAP ---
    if (window.documentPictureInPicture) {
        const originalRequestWindow = window.documentPictureInPicture.requestWindow;

        window.documentPictureInPicture.requestWindow = async function(options) {
            const pipWindow = await originalRequestWindow.call(window.documentPictureInPicture, options);

            const style = pipWindow.document.createElement('style');
            style.textContent = antiPremiumCSS;
            pipWindow.document.head.appendChild(style);

            startJanitor(pipWindow.document);

            return pipWindow;
        };
    }

    // --- AUTO-POP MINIPLAYER ON TAB SWITCH ---
    // Opens the miniplayer automatically when the Spotify tab loses focus (user switches tabs).
    // Closes it when the user comes back to the Spotify tab.
    async function openMiniplayer() {
        if (!window.documentPictureInPicture) return;

        // Already open — do nothing
        if (window.documentPictureInPicture.window) return;

        // Find Spotify's own miniplayer button and click it so Spotify
        // sets up the PiP window with its own content + our CSS trap fires.
        const miniplayerBtn = document.querySelector(
            '[data-testid="pip-toggle-button"], ' +
            '[aria-label="Open miniplayer"], ' +
            '[aria-label="Miniplayer"]'
        );

        if (miniplayerBtn) {
            miniplayerBtn.click();
            console.log("Spotify Miniplayer: Auto-opened on tab switch.");
        } else {
            console.warn("Spotify Miniplayer: Could not find miniplayer button to auto-open.");
        }
    }

    function closeMiniplayer() {
        if (!window.documentPictureInPicture) return;

        const pipWin = window.documentPictureInPicture.window;
        if (pipWin) {
            pipWin.close();
            console.log("Spotify Miniplayer: Auto-closed on tab return.");
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            // User switched away — pop the miniplayer
            openMiniplayer();
        } else {
            // User came back — close the miniplayer
            closeMiniplayer();
        }
    });

})();
