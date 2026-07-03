// ==UserScript==
// @name        Discord Responsive Inbox
// @namespace   Violentmonkey Scripts
// @match       https://discord.com/*
// @grant       none
// @version     1.0
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/discord.com/discord-responsive-popout-menu-patch.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/discord.com/discord-responsive-popout-menu-patch.js
// @author      Fahad
// @description Makes the Discord inbox/recent mentions popout responsive to window size.
// ==/UserScript==

(function() {
    'use strict';

    // The CSS to inject
    const responsiveCss = `
        /* Target the Inbox/Recent Mentions Popout */
        /* We use partial attribute selectors to catch hashed classes */
        div[class*="recentMentionsPopout_"],
        div[class*="messagesPopout_"], 
        div[role="dialog"][aria-label="Inbox"],
        div[role="dialog"][aria-label="Recent Mentions"] {
            width: auto !important;
            max-width: 95vw !important;
            min-width: 300px !important;
        }

        /* Adjust the internal container if necessary */
        div[class*="recentMentionsPopout_"] .scroller-1JbKsb, /* Legacy fallback */
        div[class*="messagesPopout_"] > div {
             max-width: 100% !important;
        }
        
        /* Media Query for Small Screens / Split View */
        @media (max-width: 600px) {
            div[class*="layer_"] {
                /* Center the layer on small screens if Discord's positioning gets weird */
                max-width: 100% !important;
                left: 0 !important;
                right: 0 !important;
                display: flex;
                justify-content: center;
            }

            div[class*="recentMentionsPopout_"],
            div[class*="messagesPopout_"],
            div[role="dialog"][aria-label="Inbox"] {
                width: 100% !important;
                max-height: 80vh !important;
                margin: 10px;
                box-shadow: 0 0 10px rgba(0,0,0,0.5);
            }
        }
    `;

    // Function to inject styles
    function addGlobalStyle(css) {
        const head = document.getElementsByTagName('head')[0];
        if (!head) { return; }
        const style = document.createElement('style');
        style.type = 'text/css';
        style.innerHTML = css;
        head.appendChild(style);
        console.log('[Discord Responsive Inbox] Styles injected.');
    }

    // Inject immediately
    addGlobalStyle(responsiveCss);

})();
