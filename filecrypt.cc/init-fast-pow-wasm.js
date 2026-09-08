// init-fast-pow-wasm.js — WASM SHA1 PoW (WIP, 10× target)
// goal: 1-2M H/s in Worker via WASM, vs 100k H/s JS → diff 24 in 8-15s
// status: stub — falls back to JS fast Worker until wasm/sha1.wasm is built
// build: `wat2wasm sha1.wat -o sha1.wasm` (wabt) or `emcc sha1.c -O3 -o sha1.wasm`
// usage: same as init-fast-pow.js → `agent-browser open --init-script <this>`
(() => {
  const fallbackCode = document.currentScript ? document.currentScript.textContent : '';
  console.log('[fast-pow-wasm] stub — using JS fallback, wasm not yet built');
  // TODO: fetch wasm/sha1.wasm, instantiate, replace sha1lz with wasm call
  // const wasm = await fetch(new URL('wasm/sha1.wasm', import.meta.url)).then(r=>r.arrayBuffer());
  // const mod = await WebAssembly.instantiate(wasm, {});
})();
