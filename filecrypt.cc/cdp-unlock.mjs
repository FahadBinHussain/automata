// cdp-unlock.mjs — unlock a filecrypt.cc PoW container and print the real host links.
//
// WHY THIS EXISTS
//   unlock-container.ps1 drives agent-browser from PowerShell. two things break that:
//   1. some sessions have no working PowerShell (sandbox dll missing) - the .ps1 cannot run at all
//   2. `agent-browser eval` NEVER RETURNS in an agent shell (global rule 47), so a
//      click-then-poll loop cannot be written against the CLI
//   this script attaches once over CDP and does click -> poll -> extract -> CNL-decrypt.
//
// THE BIG GOTCHA (2026-09-09, B6B1F4A7B2)
//   without Page.bringToFront the tab is backgrounded -> the PoW worker gets throttled
//   (same container took 12s / 81s / 190s across runs) and, worse, it can reach
//   data-state=done and then RESET to idle with every pow_* field EMPTY. no error is
//   shown - the page just sits on "Security Check" forever. the ps1 did this via
//   SetForegroundWindow; over CDP the equivalent is Page.bringToFront. call it before
//   the click and roughly every 30s after (not more - spamming causes blur -> pause).
//   with bringToFront: B6B1F4A7B2 solved in 36s and unlocked first try.
//
// USAGE (all in ONE shell command - backgrounded processes die when the tool call ends)
//   export AGENT_BROWSER_PROFILE='C:\Users\<user>\AppData\Roaming\mainframe\accounts\agent-browser\<email>'
//   export AGENT_BROWSER_EXECUTABLE_PATH='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
//   nohup agent-browser open --init-script ./init-fast-pow.js <CONTAINER_URL> > /c/tmp/fc-open.log 2>&1 &
//   sleep 12
//   nohup agent-browser get cdp-url > /c/tmp/fc-cdp.log 2>&1 &
//   sleep 8
//   node cdp-unlock.mjs "$(tr -d '\r\n' < /c/tmp/fc-cdp.log)" [attemptMaxSec] [attempts] [settleSec]
//
// deps: node 22+ (global fetch + WebSocket), an already-open filecrypt page

import crypto from 'node:crypto';

const browserWs = process.argv[2];
const attemptMax = Number(process.argv[3] || 150);
const attempts = Number(process.argv[4] || 2);
const settleSec = Number(process.argv[5] || 60);

if (!browserWs || !browserWs.startsWith('ws')) {
  console.error('usage: node cdp-unlock.mjs <browserWsUrl> [attemptMaxSec] [attempts] [settleSec]');
  console.error('get the url with: agent-browser get cdp-url');
  process.exit(2);
}

const httpBase = browserWs.replace(/^ws/, 'http').replace(/\/devtools\/browser\/.*$/, '');
const targets = await (await fetch(httpBase + '/json')).json();
const pages = targets.filter((t) => t.type === 'page');
const page = pages.find((t) => (t.url || '').includes('filecrypt')) || pages[0];
if (!page) {
  console.error('no page target. targets=', JSON.stringify(targets.map((t) => ({ type: t.type, url: t.url }))));
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

function cmd(method, params = {}, t = 30000) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('cdp timeout ' + method)); } }, t);
  });
}
async function ev(expr, t) {
  const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, t || 30000);
  const rr = r.result;
  if (!rr) return { __err: JSON.stringify(r) };
  if (rr.exceptionDetails) return { __exc: rr.exceptionDetails.text || JSON.stringify(rr.exceptionDetails) };
  return rr.result?.value;
}
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CNL_JS = "JSON.stringify(Array.from(document.querySelectorAll('form[onsubmit*=\"CNLPOP\"]')).map(f=>f.getAttribute('onsubmit')))";
const EXT_JS = "JSON.stringify(Array.from(document.querySelectorAll('a')).map(a=>a.href).filter(h=>/^https?:\\/\\//i.test(h) && !/filecrypt\\.cc/i.test(h)))";
const LINK_JS = "JSON.stringify(Array.from(document.querySelectorAll('a')).map(a=>a.href).filter(h=>/filecrypt\\.cc\\/Link\\/\\d/i.test(h)))";

// CNL: AES-128-CBC, key = iv = bytes.fromhex(jk), strip \x00 and \r, split \n
function decryptCnl(jk, crypted) {
  const k = Buffer.from(jk, 'hex');
  const d = crypto.createDecipheriv('aes-128-cbc', k, k);
  return Buffer.concat([d.update(Buffer.from(crypted, 'base64')), d.final()])
    .toString('utf8')
    .replace(/\x00/g, '')
    .replace(/\r/g, '')
    .trim();
}

await cmd('Page.enable');
await cmd('Page.bringToFront');
log('patch:', await ev("String(window.Worker).includes('fastUrl')"));

let unlocked = false;
for (let attempt = 1; attempt <= attempts && !unlocked; attempt++) {
  log(`===== attempt ${attempt}/${attempts} =====`);
  await cmd('Page.bringToFront');
  log('click:', await ev("(function(){var b=document.querySelector('#pow-captcha .pow-captcha__box'); if(!b) return 'no box'; b.click(); return 'clicked';})()"));

  const t0 = Date.now();
  let state = '?';
  let lastFront = Date.now();
  while ((Date.now() - t0) / 1000 < attemptMax) {
    await sleep(3000);
    state = await ev("document.querySelector('#pow-captcha') ? (document.querySelector('#pow-captcha').getAttribute('data-state')||'?') : 'gone'");
    const prog = await ev("document.querySelector('#pow-captcha .pow-captcha__progress i') ? document.querySelector('#pow-captcha .pow-captcha__progress i').style.width : '-'");
    if (Date.now() - lastFront > 30000) { await cmd('Page.bringToFront'); lastFront = Date.now(); }
    log(`t=${((Date.now() - t0) / 1000).toFixed(0)}s state=${state} prog=${prog}`);
    if (state === 'done' || state === 'gone' || state === 'fail' || state === 'idle') break;
  }
  log('pow state:', state);

  const t1 = Date.now();
  while ((Date.now() - t1) / 1000 < settleSec) {
    await sleep(4000);
    const nCnl = JSON.parse((await ev(CNL_JS)) || '[]').length;
    const nExt = JSON.parse((await ev(EXT_JS)) || '[]').length;
    const cap = await ev("!!document.querySelector('#pow-captcha')");
    log(`settle t=${((Date.now() - t1) / 1000).toFixed(0)}s cap=${cap} cnl=${nCnl} ext=${nExt}`);
    if (nCnl > 0 || nExt > 0) { unlocked = true; break; }
    if (Date.now() - lastFront > 30000) { await cmd('Page.bringToFront'); lastFront = Date.now(); }
  }
  if (unlocked) break;
  log('not unlocked - reloading for retry');
  await cmd('Page.reload', { ignoreCache: false });
  await sleep(8000);
  await cmd('Page.bringToFront');
}

log('===== RESULT =====');
log('url      :', await ev('location.href'));
log('hasCaptcha:', await ev("!!document.querySelector('#pow-captcha')"));
log('title    :', await ev("(document.body.innerText||'').replace(/\\s+/g,' ').slice(0,300)"));

const cnlRaw = JSON.parse((await ev(CNL_JS)) || '[]');
const links = [];
for (const s of cnlRaw) {
  const m = s.match(/CNLPOP\('([^']*)',\s*'([^']*)',\s*'([^']*)'/);
  if (!m) continue;
  const [, id, a, b] = m;
  // arg order on the page is (id, jk, crypted, name): jk is the 32-char hex one
  const jk = /^[0-9a-fA-F]{32}$/.test(a) ? a : b;
  const crypted = jk === a ? b : a;
  try {
    const plain = decryptCnl(jk, crypted);
    for (const line of plain.split('\n')) if (line.trim()) links.push({ id, url: line.trim() });
  } catch (e) {
    links.push({ id, error: String(e), jk, crypted });
  }
}

const ext = JSON.parse((await ev(EXT_JS)) || '[]');
const linkPages = JSON.parse((await ev(LINK_JS)) || '[]');

log('CNL blocks:', cnlRaw.length);
log('EXTERNAL  :', JSON.stringify(ext));
log('LINKPAGES :', JSON.stringify(linkPages));

if (links.length) {
  log('--- DECRYPTED HOST LINKS ---');
  for (const l of links) log(l.url);
} else if (!ext.length) {
  log('no links found - container is gated or the host links are on /Link pages');
}

ws.close();
process.exit(links.length || ext.length ? 0 : 1);
