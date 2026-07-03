// ==UserScript==
// @name        Mobile Extended Context Menu
// @author       Fahad
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/tools/misc-bookmarklets/mobile-hyperlink-overlay-menu-replacement.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/tools/misc-bookmarklets/mobile-hyperlink-overlay-menu-replacement.js
// @match       *://*/*
// @grant       GM_openInTab
// @grant       GM_setClipboard
// @run-at      document-end
// ==/UserScript==

document.addEventListener('contextmenu', function(e) {
    // 1. Detect if the target is a link (or inside a link)
    let link = e.target.closest('a');
    let linkUrl = link ? link.href : null;

    // 2. If it's NOT a link, do nothing (allow default browser menu)
    if (!linkUrl) {
        return; 
    }

    // 3. Prevent the native mobile menu
    e.preventDefault();
    e.stopPropagation();

    // 4. Clean up any existing custom menus
    const existing = document.getElementById('vm-mobile-menu-overlay');
    if (existing) existing.remove();

    // 5. Create the Overlay (Dimmed Background)
    const overlay = document.createElement('div');
    overlay.id = 'vm-mobile-menu-overlay';
    Object.assign(overlay.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(0,0,0,0.6)',
        zIndex: '999999',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(3px)' // Nice blur effect
    });

    // 6. Create the Menu Box
    const menu = document.createElement('div');
    Object.assign(menu.style, {
        backgroundColor: '#fff',
        borderRadius: '12px',
        padding: '20px',
        width: '85%',
        maxWidth: '320px',
        boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        textAlign: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    });

    // --- Helper to create buttons ---
    function createBtn(text, color, onClick) {
        const btn = document.createElement('button');
        btn.innerText = text;
        Object.assign(btn.style, {
            padding: '14px',
            fontSize: '16px',
            border: 'none',
            borderRadius: '8px',
            backgroundColor: color,
            color: color === '#f0f0f0' ? '#333' : 'white',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'opacity 0.2s'
        });
        
        btn.onclick = onClick;
        // visual touch feedback
        btn.ontouchstart = () => btn.style.opacity = '0.7';
        btn.ontouchend = () => btn.style.opacity = '1';
        return btn;
    }

    // --- Helper for Copy Feedback ---
    function handleCopy(textToCopy, btnElement) {
        GM_setClipboard(textToCopy, 'text');
        
        // Visual feedback
        const originalText = btnElement.innerText;
        btnElement.innerText = "✓ Copied!";
        btnElement.style.backgroundColor = '#28a745'; // Green
        
        // Close menu after a short delay
        setTimeout(() => {
            overlay.remove();
        }, 600);
    }

    // 7. Show URL Preview (truncated)
    const urlText = document.createElement('div');
    urlText.innerText = linkUrl.length > 60 ? linkUrl.substring(0, 57) + '...' : linkUrl;
    Object.assign(urlText.style, {
        fontSize: '11px',
        color: '#888',
        wordBreak: 'break-all',
        marginBottom: '5px',
        padding: '0 5px'
    });
    menu.appendChild(urlText);

    // BUTTON 1: Open in New Tab
    const btnOpen = createBtn('Open in New Tab', '#007bff', () => { // Blue
        GM_openInTab(linkUrl, { active: true });
        overlay.remove();
    });
    menu.appendChild(btnOpen);

    // BUTTON 2: Copy Link Address
    const btnCopyUrl = createBtn('Copy Link Address', '#6c757d', function() { // Grey
        handleCopy(linkUrl, this);
    });
    menu.appendChild(btnCopyUrl);

    // BUTTON 3: Copy Link Text
    // Only show if there is actually text to copy
    const linkText = link.innerText.trim();
    if (linkText.length > 0) {
        const btnCopyText = createBtn('Copy Link Text', '#6c757d', function() { // Grey
            handleCopy(linkText, this);
        });
        menu.appendChild(btnCopyText);
    }

    // BUTTON 4: Cancel
    const btnCancel = createBtn('Cancel', '#f0f0f0', () => { // Light Grey
        overlay.remove();
    });
    menu.appendChild(btnCancel);

    // Assemble
    overlay.appendChild(menu);
    document.body.appendChild(overlay);

    // Close on background tap
    overlay.onclick = function(e) {
        if (e.target === overlay) overlay.remove();
    };
});
