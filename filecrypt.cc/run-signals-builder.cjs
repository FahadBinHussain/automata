// runs filecrypt m.js (R) or s.js (S) headless in node with browser shims.
// for s.js: S.start() -> dwell -> fake pointer/click events -> collect()
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const shim = `
globalThis.window = globalThis;
globalThis.self = globalThis;
Object.defineProperty(globalThis, 'navigator', { value: {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  appVersion: '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  platform: 'Win32',
  vendor: 'Google Inc.',
  language: 'en-US',
  languages: ['en-US', 'en'],
  hardwareConcurrency: 16,
  deviceMemory: 8,
  maxTouchPoints: 0,
  plugins: { length: 5, 0: {name:'PDF Viewer'}, 1: {name:'Chrome PDF Viewer'}, 2: {name:'Chromium PDF Viewer'}, 3: {name:'Microsoft Edge PDF Viewer'}, 4: {name:'WebKit built-in PDF'} },
  mimeTypes: { length: 2 },
  webdriver: false,
  connection: { effectiveType: '4g', rtt: 50, downlink: 10 },
}, configurable: true });
globalThis.location = { href: 'https://filecrypt.cc/Container/FCE74DF1E1.html', protocol: 'https:', hostname: 'filecrypt.cc', host: 'filecrypt.cc', pathname: '/Container/FCE74DF1E1.html', origin: 'https://filecrypt.cc' };
globalThis.screen = { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, colorDepth: 24, pixelDepth: 24 };
globalThis.history = { length: 3 };
globalThis.innerWidth = 1920; globalThis.innerHeight = 1040;
globalThis.outerWidth = 1920; globalThis.outerHeight = 1080;
globalThis.devicePixelRatio = 1;
globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');
globalThis.document = {
  createElement: () => ({ getContext: () => null, style: {}, setAttribute(){}, appendChild(){} }),
  documentElement: { style: {} },
  body: null,
  cookie: '',
  hidden: false,
  visibilityState: 'visible',
  addEventListener(){},
};
globalThis.addEventListener = () => {};
globalThis.requestAnimationFrame = (f) => setTimeout(f, 16);
`;
const target = process.argv[2];
const importUrl = require('url').pathToFileURL(path.resolve(target)).href;
const isSignals = process.argv[3] === 'signals';
const mode = process.argv[4] || 'R'; // 'R' | 'collect'
const bootstrap = `
;(async () => {
  try {
    const m = await import(${JSON.stringify(importUrl)});
    ${
      isSignals
        ? `const S = m.S;
    if (!S) { console.log('NO_S'); process.exit(2); }
    if (typeof S.start === 'function') { try { S.start(); } catch (e) {} }
    await sleep(2600);
    const t0 = performance.timeOrigin || Date.now() - 2600;
    const now = () => Date.now();
    const mkEv = (x, y, ts) => ({ isTrusted: true, pointerType: 'mouse', pointerId: 1, clientX: x, clientY: y, screenX: x, screenY: y + 80, pageX: x, pageY: y, button: 0, buttons: 1, timeStamp: ts, type: 'pointerdown', target: { getBoundingClientRect: () => ({ left: 860, top: 480, width: 200, height: 40 }) }, view: globalThis });
    try { S.recordPointer(mkEv(930, 505, now() - t0)); } catch (e) { console.log('ptrErr=' + e.message); }
    await sleep(120);
    try { S.recordPointer(mkEv(944, 508, now() - t0)); } catch (e) {}
    await sleep(140);
    const clickEv = Object.assign(mkEv(948, 510, now() - t0), { type: 'click', detail: 1 });
    try { S.recordClick(clickEv); } catch (e) { console.log('clickErr=' + e.message); }
    await sleep(300);
    const c = S.collect();
    console.log('COLLECT_TYPE=' + typeof c);
    console.log('COLLECT=' + (typeof c === 'object' ? JSON.stringify(c) : String(c)));`
        : `const fn = m.R || (m.default && m.default.R);
    if (typeof fn !== 'function') { console.log('NO_R'); process.exit(2); }
    const out = await fn();
    console.log('RESULT_TYPE=' + typeof out);
    console.log('RESULT=' + (typeof out === 'object' ? JSON.stringify(out) : String(out)));`
    }
  } catch (e) {
    console.log('ERR=' + (e && e.message));
    process.exit(1);
  }
})();
`;
fs.writeFileSync(path.join(path.dirname(target), 'run_payload.mjs'), shim + '\nconst sleep = (ms) => new Promise(r => setTimeout(r, ms));\n' + fs.readFileSync(target, 'utf8') + '\n' + bootstrap);
console.log('wrote run_payload.mjs');

