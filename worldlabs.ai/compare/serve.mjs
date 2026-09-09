#!/usr/bin/env node
/**
 * serve.mjs — static server for the worldlabs scene compare viewer.
 *
 * purpose: serve the compare/ viewer AND the downloaded scene files (.spz /
 *          .json / .webp) from one root, so the browser can fetch them over
 *          http (file:// cannot fetch local binaries).
 *
 * usage:   node serve.mjs
 *          node serve.mjs --root "C:\Users\<user>\Downloads" --port 8123
 *
 * then:    http://127.0.0.1:8123/automata/worldlabs.ai/compare/view.html
 *
 * default root = %USERPROFILE%\Downloads (the folder the downloader saves to)
 *
 * features: HTTP Range support (spark streams big .spz), correct mime for
 *           .spz/.webp/.json, no-cache so config edits show up immediately.
 * no dependencies — node built-ins only.
 */

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, extname, normalize, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

const { values: opts } = parseArgs({
  options: {
    root: { type: "string", default: "" },
    port: { type: "string", default: "8123" },
  },
  strict: false,
});

// resolve() both sides: on windows join() emits backslashes, so comparing a
// forward-slash root against a joined path would 403 every request.
const ROOT = resolve(opts.root || join(process.env.USERPROFILE || process.env.HOME || ".", "Downloads"));
const PORT = parseInt(opts.port, 10);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".spz":  "application/octet-stream",
  ".ply":  "application/octet-stream",
  ".splat":"application/octet-stream",
  ".webp": "image/webp",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".glb":  "model/gltf-binary",
};

const VIEWER = "/automata/worldlabs.ai/compare/view.html";

createServer(async (req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0].split("#")[0]);
  if (urlPath === "/") urlPath = VIEWER;

  // block traversal
  const filePath = resolve(join(ROOT, normalize(urlPath)));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
    res.writeHead(403); res.end("forbidden"); return;
  }

  let st;
  try {
    st = await stat(filePath);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404 not found: " + urlPath);
    return;
  }
  if (st.isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404 (directory): " + urlPath);
    return;
  }

  const ext = extname(filePath).toLowerCase();
  const head = {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
    "Access-Control-Allow-Origin": "*",
  };

  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m) {
      let start = m[1] === "" ? 0 : parseInt(m[1], 10);
      let end   = m[2] === "" ? st.size - 1 : parseInt(m[2], 10);
      end = Math.min(end, st.size - 1);
      if (start > end || start >= st.size) {
        res.writeHead(416, { "Content-Range": `bytes */${st.size}` });
        res.end(); return;
      }
      head["Content-Range"]  = `bytes ${start}-${end}/${st.size}`;
      head["Content-Length"] = end - start + 1;
      res.writeHead(206, head);
      createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
  }

  head["Content-Length"] = st.size;
  res.writeHead(200, head);
  createReadStream(filePath).pipe(res);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`\n  root : ${ROOT}`);
  console.log(`  open : http://127.0.0.1:${PORT}${VIEWER}\n`);
});
