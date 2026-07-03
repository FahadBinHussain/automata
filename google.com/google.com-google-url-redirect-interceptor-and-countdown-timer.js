// ==UserScript==
// @name        Google Redirect Timer
// @namespace   Violentmonkey Scripts
// @match       https://www.google.com/url*
// @grant       none
// @version     1.0
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/google.com/google.com-google-url-redirect-interceptor-and-countdown-timer.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/google.com/google.com-google-url-redirect-interceptor-and-countdown-timer.js
// @author      Fahad
// @description Extracts the target URL from google redirects, shows a 3-second timer, and redirects automatically.
// @run-at      document-end
// ==/UserScript==

(function() {
    'use strict';

    // 1. Get the current query parameters
    const params = new URLSearchParams(window.location.search);

    // 2. Extract the target URL.
    // Your example uses 'q', but standard Google links often use 'url'. We check both.
    const target = params.get('q') || params.get('url');

    // If no target URL is found, do nothing and exit.
    if (!target) return;

    // 3. Create the Display Element
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.top = '20px';
    container.style.left = '50%';
    container.style.transform = 'translateX(-50%)';
    container.style.padding = '20px 40px';
    container.style.backgroundColor = '#ffffff';
    container.style.color = '#333';
    container.style.border = '1px solid #ccc';
    container.style.borderRadius = '8px';
    container.style.boxShadow = '0 4px 15px rgba(0,0,0,0.2)';
    container.style.zIndex = '999999';
    container.style.fontFamily = 'Arial, sans-serif';
    container.style.textAlign = 'center';

    // Create text elements
    const title = document.createElement('div');
    title.style.fontSize = '18px';
    title.style.marginBottom = '10px';
    title.innerText = 'Redirecting in...';

    const timerDisplay = document.createElement('div');
    timerDisplay.style.fontSize = '32px';
    timerDisplay.style.fontWeight = 'bold';
    timerDisplay.style.color = '#d93025'; // Google Red

    const destDisplay = document.createElement('div');
    destDisplay.style.fontSize = '12px';
    destDisplay.style.marginTop = '10px';
    destDisplay.style.color = '#666';
    destDisplay.style.maxWidth = '400px';
    destDisplay.style.overflow = 'hidden';
    destDisplay.style.textOverflow = 'ellipsis';
    destDisplay.style.whiteSpace = 'nowrap';
    destDisplay.innerText = `Destination: ${target}`;

    // Append elements
    container.appendChild(title);
    container.appendChild(timerDisplay);
    container.appendChild(destDisplay);
    document.body.appendChild(container);

    // 4. Timer Logic
    let timeLeft = 1;
    timerDisplay.innerText = timeLeft;

    const interval = setInterval(() => {
        timeLeft--;
        timerDisplay.innerText = timeLeft;

        if (timeLeft <= 0) {
            clearInterval(interval);
            // Perform the redirect
            // Using replace() prevents this redirect page from getting stuck in your "Back" button history
            window.location.replace(target);
        }
    }, 1000);

})();
