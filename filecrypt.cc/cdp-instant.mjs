// cdp-instant.mjs — INSTANT filecrypt.cc PoW bypass (deepseek-style).
// click -> challenge harvested in-page -> PoW solved OFFLINE via pow.py (1-12s, not 7m)
// -> page auto-submits itself -> CNL decrypted. total ~10-20s on a fresh target.
//
// WHY FRESH TARGET: reusing a target across attempts re-gates (stale worker/challenge
// state). always Target.createTarget per container. verified 2026-09-11: B6B1F4A7B2
// unlocked first try (~12s, CNL https://1fichier.com/?sk41r9pymiaqel1jes5u).
// CAVEAT: FCE74DF1E1 rejects the identical pipeline (container-specific strictness).
//
// USAGE: node cdp-instant.mjs <anyPageWsUrl> <containerUrl>
//   anyPageWsUrl: ws://127.0.0.1:<port>/devtools/page/<id> (any target on that browser)
//   needs: python on PATH (pow.py), node 22+ (global fetch + WebSocket)
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createDecipheriv } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const [anyWs, containerUrl] = process.argv.slice(2);
if (!anyWs?.startsWith('ws') || !containerUrl?.includes('filecrypt.cc/Container/')) {
  console.error('usage: node cdp-instant.mjs <anyPageWsUrl> https://filecrypt.cc/Container/XXXX.html');
  process.exit(2);
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const patchSrc = readFileSync(path.join(HERE, 'init-instant.js'), 'utf8');
const powPy = path.join(HERE, 'pow.py');

let id = 1; const pend = new Map();
function attach(wsUrl) {
  const ws = new WebSocket(wsUrl);
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  return new Promise((res, rej) => { ws.addEventListener('open', () => res(ws)); ws.addEventListener('error', rej); });
}
function makeCmd(ws, t = 15000) {
  return (m, p) => new Promise((res, rej) => { const i = id++; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + m)); } }, t); });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 1. fresh target
const ctlWs = await attach(anyWs.split(' ')[0]);
const ctl = makeCmd(ctlWs);
const { result: { targetId } } = await ctl('Target.createTarget', { url: containerUrl });
console.log('target', targetId);
ctlWs.close();

// 2. find its page ws
const httpBase = anyWs.split(' ')[0].slice(0, anyWs.indexOf('/devtools/page/')).replace(/^ws/, 'http');
let pageWs = '';
for (let i = 0; i < 15; i++) {
  await sleep(1000);
  const targets = await (await fetch(httpBase + '/json')).json();
  const t = targets.find(t => t.id === targetId || t.url === containerUrl);
  if (t?.webSocketDebuggerUrl) { pageWs = t.webSocketDebuggerUrl.split(' ')[0]; break; }
}
if (!pageWs) { console.error('target page never appeared'); process.exit(1); }
console.log('pageWs', pageWs);

// 3. patch + click + solve
const ws = await attach(pageWs);
const cmd = makeCmd(ws);
async function ev(expr) {
  const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
}
await cmd('Page.bringToFront', {});
// wait for captcha idle (fresh page)
for (let i = 0; i < 20; i++) {
  const s = await ev(`document.querySelector('#pow-captcha') ? document.querySelector('#pow-captcha').getAttribute('data-state') : 'gone'`).catch(() => '?');
  if (s === 'idle') break;
  await sleep(2000);
}
await cmd('Runtime.evaluate', { expression: patchSrc });
const mockCheck = await ev(`(function(){ try { const w = new Worker('/js/pow_captcha_worker.js?v=test'); return (w && w.__fcMock === true) ? 'mock' : 'real'; } catch(e){ return 'err'; } })()`);
if (mockCheck !== 'mock') { console.error('PATCH NOT ACTIVE'); process.exit(1); }
console.log('click', await ev(`(function(){const b=document.querySelector('#pow-captcha .pow-captcha__box'); if(!b) return 'no box'; b.click(); return 'clicked';})()`));

const t0 = Date.now(); let solved = false;
let unlocked = false;
let lastFeat = '{}';
const FEAT_EXPR = `JSON.stringify({chal:window.__fcChallenge||'',id:document.querySelector('input[name=pow_id]')?.value||'',nonce:document.querySelector('input[name=pow_nonce]')?.value||'',elapsed:document.querySelector('input[name=pow_elapsed]')?.value||'',pauses:document.querySelector('input[name=pow_pauses]')?.value||'',dataLen:(document.querySelector('input[name=pow_data]')?.value||'').length,xFull:document.querySelector('input[name=pow_x]')?.value||''})`;
for (let i = 0; i < 90; i++) {
  await sleep(1000);
  const chal = await ev(`window.__fcChallenge||''`).catch(() => '');
  const diff = await ev(`window.__fcDifficulty||0`).catch(() => 0);
  // snapshot fields every tick; keep last non-empty (submit wipes them)
  try {
    const f = await ev(FEAT_EXPR).catch(() => '{}');
    if (f && f !== '{}') {
      const o = JSON.parse(f);
      if (o.nonce || o.dataLen > 0) lastFeat = f;
    }
  } catch (e) {}
  if (i % 10 === 0) console.log(`wait t=${i}s chal=${chal ? String(chal).slice(0, 8) + '...' : '-'} diff=${diff}`);
  if (chal && diff && !solved) {
    const yhost = await ev(`window.__fcYhost||''`).catch(() => '');
    const yres = await ev(`JSON.stringify(performance.getEntriesByType('resource').map(r=>r.name).filter(u=>/cutcaptcha|pow\\.filecrypt|captcha\\.filecrypt/.test(u)))`).catch(() => '[]');
    console.log(`solve diff=${diff} yhost=${yhost} yres=${yres} ...`);
    const out = spawnSync('python', [powPy, String(chal), String(diff)], { encoding: 'utf-8', timeout: 120000 });
    if (out.status !== 0) { console.error('pow.py err', (out.stderr || out.stdout || '').slice(0, 300)); process.exit(1); }
    const j = JSON.parse(out.stdout);
    console.log(`nonce=${j.nonce} in ${j.ms}ms`);
    await cmd('Runtime.evaluate', { expression: `window.__fcSolution=${j.nonce}` });
    solved = true;
  }
  const state = await ev(`document.querySelector('#pow-captcha') ? document.querySelector('#pow-captcha').getAttribute('data-state') : 'gone'`).catch(() => '?');
  if (state === 'done' || state === 'gone') {
    console.log('RUNDATA ' + lastFeat);
    // unlock = captcha GONE *and* links present (cap=false alone can be transient unload)
    for (let k = 0; k < 12; k++) {
      await sleep(3000);
      const cap = await ev(`!!document.querySelector('#pow-captcha')`).catch(() => true);
      if (!cap) {
        const hasLinks = await ev(`document.querySelectorAll('form[onsubmit*="CNLPOP"]').length > 0 || Array.from(document.querySelectorAll('a')).some(a=>/^https?:\\/\\//.test(a.href) && !/filecrypt\\.cc/.test(a.href))`).catch(() => false);
        if (hasLinks) { unlocked = true; break; }
      }
    }
    break;
  }
  if (state === 'fail') break;
}
console.log(`pow ${((Date.now() - t0) / 1000).toFixed(0)}s unlocked=${unlocked}`);
if (!unlocked) { console.error('STILL GATED (server re-issued challenge — container may enforce extra strictness)'); process.exit(3); }

// 4. extract links (CNL decrypt + anchors)
const cnl = await ev(`JSON.stringify(Array.from(document.querySelectorAll('form[onsubmit*="CNLPOP"]')).map(f=>f.getAttribute('onsubmit')))`);
const links = [];
for (const s of JSON.parse(cnl || '[]')) {
  const m = s.match(/CNLPOP\('([^']*)',\s*'([^']*)',\s*'([^']*)'/);
  if (!m) continue;
  const [, bid, a, b] = m;
  const jk = /^[0-9a-fA-F]{32}$/.test(a) ? a : b;
  const crypted = jk === a ? b : a;
  try {
    const k = Buffer.from(jk, 'hex');
    const d = createDecipheriv('aes-128-cbc', k, k);
    const plain = Buffer.concat([d.update(Buffer.from(crypted, 'base64')), d.final()]).toString('utf8').replace(/\x00/g, '').replace(/\r/g, '').trim();
    for (const line of plain.split('\n')) if (line.trim()) links.push(line.trim());
  } catch (e) { console.error('decrypt err', e.message); }
}
const ext = JSON.parse(await ev(`JSON.stringify(Array.from(document.querySelectorAll('a')).map(a=>a.href).filter(h=>/^https?:\\/\\//.test(h) && !/filecrypt\\.cc/.test(h)))`) || '[]');
console.log('--- HOST LINKS ---');
for (const l of [...new Set([...links, ...ext])]) console.log(l);
ws.close();
process.exit(links.length || ext.length ? 0 : 1);
