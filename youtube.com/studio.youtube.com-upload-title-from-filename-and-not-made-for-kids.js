// ==UserScript==
// @name         YouTube Studio Upload - Title From Filename + Not For Kids
// @namespace    http://tampermonkey.net/
// @version      1.2
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/youtube.com/studio.youtube.com-upload-title-from-filename-and-not-made-for-kids.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/youtube.com/studio.youtube.com-upload-title-from-filename-and-not-made-for-kids.js
// @description  Sets draft upload title from full filename and selects "No, it's not made for kids".
// @author       Fahad
// @match        https://studio.youtube.com/channel/*/videos/upload*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const LOG_PREFIX = '[YT Upload Auto Meta]';
    const VIDEO_EXT_RE = /\.(mp4|mov|mkv|webm|avi|wmv|flv|m4v|mpeg|mpg|3gp)$/i;
    let lastAppliedKey = '';

    function isUploadDraftUrl() {
        return (
            location.hostname === 'studio.youtube.com' &&
            /^\/channel\/[^/]+\/videos\/upload$/.test(location.pathname) &&
            new URLSearchParams(location.search).has('udvid')
        );
    }

    function cleanFilename(raw) {
        return (raw || '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function findTextNodeElement(text) {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            if ((node.textContent || '').trim().toLowerCase() === text.toLowerCase()) {
                return node.parentElement;
            }
        }
        return null;
    }

    function getFilenameFromPanel() {
        const label = findTextNodeElement('Filename');
        if (!label) return '';

        let current = label.parentElement;
        for (let depth = 0; current && current !== document.body && depth < 8; depth++) {
            const text = (current.textContent || '').replace(/\s+/g, ' ').trim();
            const match = text.match(/(?:^|\s)Filename\s+(.+)$/i);
            if (match) {
                const value = match[1]
                    .replace(/\s+Video link\s+.*$/i, '')
                    .replace(/\s+Visibility\s+.*$/i, '')
                    .trim();
                if (value && value.toLowerCase() !== 'filename') {
                    return cleanFilename(value);
                }
            }
            current = current.parentElement;
        }

        return '';
    }

    function getTitleTextbox() {
        const titleLabel = findTextNodeElement('Title (required)') || findTextNodeElement('Title');
        const titleContainer = titleLabel && titleLabel.closest('ytcp-social-suggestions-textbox, ytcp-form-input-container, div');
        const scopedTextbox = titleContainer && titleContainer.querySelector('[contenteditable="true"], textarea, input');

        return scopedTextbox || document.querySelector('#title-textarea [contenteditable="true"], ytcp-social-suggestions-textbox [contenteditable="true"]');
    }

    function setNativeValue(el, value) {
        if (!el) return false;

        if (el.isContentEditable) {
            el.focus();
            el.textContent = value;
            el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.blur();
            return true;
        }

        const proto = Object.getPrototypeOf(el);
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
        if (descriptor && descriptor.set) {
            descriptor.set.call(el, value);
        } else {
            el.value = value;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    function selectNotMadeForKids() {
        const directRadio =
            document.querySelector('[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]') ||
            document.querySelector('tp-yt-paper-radio-button[aria-label*="not made for kids" i]') ||
            document.querySelector('paper-radio-button[aria-label*="not made for kids" i]');

        const textRadio = Array.from(document.querySelectorAll('tp-yt-paper-radio-button, paper-radio-button, ytcp-radio-button'))
            .find((el) => /no,\s*it['’]s not made for kids/i.test((el.textContent || '').replace(/\s+/g, ' ')));

        const radio = directRadio || textRadio;
        if (!radio) return false;

        const alreadyChecked = radio.getAttribute('aria-checked') === 'true' || radio.hasAttribute('checked');
        if (!alreadyChecked) {
            radio.scrollIntoView({ block: 'center', inline: 'nearest' });
            radio.click();
            radio.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
    }

    function scrollUploadDialogTowardKidsSection() {
        const kidsHeader = Array.from(document.querySelectorAll('h2, h3, div, span'))
            .find((el) => /is this video made for kids/i.test((el.textContent || '').replace(/\s+/g, ' ')));
        if (kidsHeader) {
            kidsHeader.scrollIntoView({ block: 'center', inline: 'nearest' });
            return;
        }

        const dialog = document.querySelector('ytcp-uploads-dialog');
        const scrollTarget = dialog && (
            dialog.querySelector('#scrollable-content') ||
            dialog.querySelector('tp-yt-paper-dialog-scrollable') ||
            dialog.querySelector('[class*="scroll"]') ||
            dialog.querySelector('[id*="scroll"]')
        );
        if (scrollTarget) {
            scrollTarget.scrollTop = Math.max(scrollTarget.scrollTop, 700);
        }
    }

    function applyAutomation() {
        if (!isUploadDraftUrl()) return;

        const filenameTitle = getFilenameFromPanel();
        const titleTextbox = getTitleTextbox();

        const applyKey = `${new URLSearchParams(location.search).get('udvid')}::${filenameTitle}`;
        if (filenameTitle && titleTextbox && lastAppliedKey !== applyKey) {
            setNativeValue(titleTextbox, filenameTitle);
            lastAppliedKey = applyKey;
            console.log(`${LOG_PREFIX} Title set to filename: ${filenameTitle}`);
        }

        if (selectNotMadeForKids()) {
            console.log(`${LOG_PREFIX} Selected: No, it's not made for kids`);
        } else {
            scrollUploadDialogTowardKidsSection();
        }
    }

    setInterval(applyAutomation, 1000);
    window.addEventListener('yt-navigate-finish', () => setTimeout(applyAutomation, 800));
})();
