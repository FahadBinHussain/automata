// ==UserScript==
// @name         Facebook Watch Auto-Unmute
// @namespace    https://github.com/FahadBinHussain
// @version      1.5
// @description  Auto-unmute Facebook Watch videos
// @author       Fahad
// @match        https://www.facebook.com/watch/*
// @match        https://www.facebook.com/*/watch/*
// @match        https://www.facebook.com/videos/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  function unmuteAndResume() {
    // Click unmute button if present
    const btn = document.querySelector('[aria-label="Unmute"]');
    if (btn) btn.click();

    // Ensure all videos are playing and unmuted
    document.querySelectorAll('video').forEach((v) => {
      v.muted = false;
      v.volume = 1;
      if (v.paused) v.play().catch(() => {});
    });
  }

  // Wait for player to init
  setTimeout(unmuteAndResume, 2000);
  setTimeout(unmuteAndResume, 3000);

  // Re-unmute on SPA navigation
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(unmuteAndResume, 2000);
    }
  }, 1000);
})();
