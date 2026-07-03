// ==UserScript==
// @name         YT-Studio-Utils
// @namespace    http://tampermonkey.net/
// @version      8.1
// @downloadURL  https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/youtube.com/studio.youtube.com-trim-calculator-and-ai-prompt-generator.js
// @updateURL    https://raw.githubusercontent.com/FahadBinHussain/automata/refs/heads/main/youtube.com/studio.youtube.com-trim-calculator-and-ai-prompt-generator.js
// @description  Calculates trim times in the correct hms format and generates an AI prompt.
// @author       Fahad
// @match        https://studio.youtube.com/video/*/edit
// @grant        navigator.clipboard
// ==/UserScript==

(function() {
    'use strict';

    const SCRIPT_ID = 'workflow-helper-box';
    const LOG_PREFIX = '[Workflow Helper]';

    // --- Helper Functions ---

    // *** THIS IS THE UPDATED FUNCTION ***
    function formatTime(totalSeconds) {
        if (totalSeconds === 0) {
            return '0s';
        }

        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = Math.floor(totalSeconds % 60);

        const parts = [];
        if (hours > 0) {
            parts.push(`${hours}h`);
        }
        if (minutes > 0) {
            parts.push(`${minutes}m`);
        }
        if (seconds > 0) {
            parts.push(`${seconds}s`);
        }

        return parts.join('');
    }

    function timeToSeconds(timeStr) {
        if (!timeStr || typeof timeStr !== 'string') return 0;
        const parts = timeStr.split(':').map(Number).reverse(); // [ss, mm, hh]
        return parts[0] + (parts[1] || 0) * 60 + (parts[2] || 0) * 3600;
    }

    // --- Main Function ---
    function buildHelperUI() {
        // 1. Define all elements we need to find on the page
        const timeDisplayElement = document.querySelector('ytcp-video-player-timestamp');
        const videoLinkElement = document.querySelector('span.video-url-fadeable a');

        // 2. If any element isn't loaded yet, or if we already built our box, stop.
        if (!timeDisplayElement || !videoLinkElement || document.getElementById(SCRIPT_ID)) {
            return;
        }

        const durationText = timeDisplayElement.textContent.trim().split('/').pop().trim();
        const totalDurationInSeconds = timeToSeconds(durationText);
        if (isNaN(totalDurationInSeconds) || totalDurationInSeconds <= 0) { return; }

        const videoLink = videoLinkElement.href;
        if (!videoLink) { return; }

        console.log(`${LOG_PREFIX} All required elements found. Building UI...`);

        // --- All data is ready, proceed to build the UI ---
        const startTimeInSeconds = Math.max(0, totalDurationInSeconds - (58 * 60));
        const startTimeFormatted = formatTime(startTimeInSeconds);
        const endTimeFormatted = formatTime(totalDurationInSeconds);
        const aiPromptText = `Given this video’s audio transcription and visual description, generate 5–10 short, fun, clickbaity titles in the same local language as the transcription, add 1–3 fitting emotes in each title 🎉🔥😂. the title must be based on specific fun incidents. the title will consist of two parts if the video is not in english. for example, {local language part | english part}. also explain in short below each title, what part is that title based on from the video. ${videoLink}`;

        const infoBox = document.createElement('div');
        infoBox.id = SCRIPT_ID;
        const title = document.createElement('div');
        title.textContent = 'Workflow Tools';

        const startRow = document.createElement('div');
        startRow.append(createLabel('Start:'), createInput(startTimeFormatted), createCopyButton(startTimeFormatted, 'Copy Start Time'));
        const endRow = document.createElement('div');
        endRow.append(createLabel('End:'), createInput(endTimeFormatted), createCopyButton(endTimeFormatted, 'Copy End Time'));
        const promptRow = document.createElement('div');
        promptRow.append(createLabel('Prompt:'), createTextarea(aiPromptText, 4), createCopyButton(aiPromptText, 'Copy AI Prompt'));

        // Assemble the box
        infoBox.append(title, startRow, endRow, promptRow);

        // Apply all styles
        styleElements(infoBox, title, [startRow, endRow, promptRow]);

        document.body.appendChild(infoBox);

        console.log(`${LOG_PREFIX} SUCCESS! The workflow box has been added to the page.`);
        clearInterval(checkerInterval);
    }

    // --- UI Creation Helper Functions ---
    function createLabel(text){ const l=document.createElement('span');l.textContent=text;return l; }
    function createInput(v,i=''){ const e=document.createElement('input');e.value=v;e.readOnly=true;if(i)e.id=i;return e; }
    function createTextarea(v,r){ const t=document.createElement('textarea');t.value=v;t.rows=r;t.readOnly=true;return t; }
    function createCopyButton(t,i){ const b=document.createElement('button');b.textContent='📋';b.title=i;b.addEventListener('click',()=>{navigator.clipboard.writeText(t).then(()=>{b.textContent='✅';setTimeout(()=>{b.textContent='📋'},1500)})});return b; }
    function styleElements(b,t,r){Object.assign(b.style,{position:'fixed',top:'70px',right:'20px',zIndex:'9999',backgroundColor:'#282828',border:'1px solid #555',borderRadius:'8px',padding:'12px',fontFamily:"'Roboto', Arial, sans-serif",color:'#eee',boxShadow:'0 4px 8px rgba(0,0,0,0.4)',display:'grid',gap:'10px',width:'320px'});Object.assign(t.style,{fontWeight:'bold',textAlign:'center'});r.forEach(rw=>Object.assign(rw.style,{display:'flex',alignItems:'center',gap:'8px'}));const n=b.querySelectorAll("input, textarea");n.forEach(i=>Object.assign(i.style,{flexGrow:'1',backgroundColor:'#1e1e1e',color:'#eee',border:'1px solid #555',borderRadius:'4px',padding:'4px 6px',fontFamily:'monospace',resize:'none'}));const e=b.querySelector("textarea");e&&(e.style.height="70px");const s=b.querySelectorAll("button");s.forEach(o=>Object.assign(o.style,{backgroundColor:'#3e3e3e',color:'#eee',border:'1px solid #555',borderRadius:'4px',cursor:'pointer',padding:'4px 8px',alignSelf:'flex-start'}))}

    // --- Run the Script ---
    const checkerInterval = setInterval(buildHelperUI, 500);

})();
