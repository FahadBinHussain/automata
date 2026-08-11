#!/usr/bin/env node
// generic CDP evaluator for the Steam client UI (steamwebhelper)
// usage: node steam-cdp-eval.mjs <wsUrl> <jsExpression>
// prints the Runtime.evaluate result as JSON on stdout

const wsUrl = process.argv[2];
const expr = process.argv[3];

const ws = new WebSocket(wsUrl);
let nextId = 0;
const pending = new Map();

function send(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error('timeout: ' + method)); }
    }, 30000);
  });
}

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
    else p.resolve(msg.result);
  }
};
ws.onerror = (e) => { console.error('WS error: ' + (e.message || e.type)); process.exit(1); };

ws.onopen = async () => {
  try {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      console.error('EXCEPTION: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
      process.exit(2);
    }
    console.log(JSON.stringify(r.result));
    process.exit(0);
  } catch (e) {
    console.error('FAIL: ' + e.message);
    process.exit(1);
  }
};