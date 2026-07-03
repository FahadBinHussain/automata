// ==UserScript==
// @name         Replace Plain URLs With Clickable Links
// @namespace    http://tampermonkey.net/
// @version      1.2
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/tools/misc-bookmarklets/universal-plain-text-url-to-clickable-link-converter.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/tools/misc-bookmarklets/universal-plain-text-url-to-clickable-link-converter.js
// @description  Detect and replace plain text URLs with clickable links across all sites
// @author       Fahad
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const urlRegex = /((https?:\/\/|www\.)[^\s<>"']+)/g;

  function replaceTextWithLinks(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const matches = [...node.nodeValue.matchAll(urlRegex)];
      if (matches.length === 0) return;

      const fragment = document.createDocumentFragment();

      for (const match of matches) {
        const url = match[0];
        const link = document.createElement('a');
        link.href = url.startsWith('http') ? url : 'https://' + url;
        link.textContent = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        fragment.appendChild(link);
      }

      node.parentNode.replaceChild(fragment, node);
    } else if (node.nodeType === Node.ELEMENT_NODE && !['A', 'SCRIPT', 'STYLE', 'TEXTAREA'].includes(node.tagName)) {
      Array.from(node.childNodes).forEach(child => replaceTextWithLinks(child));
    }
  }

  const observer = new MutationObserver(() => {
    replaceTextWithLinks(document.body);
  });

  window.addEventListener('load', () => {
    replaceTextWithLinks(document.body);
    observer.observe(document.body, { childList: true, subtree: true });
  });
})();
