#!/usr/bin/env node
/**
 * serve-variants.mjs — serve every generated site variant in the www repo side by side.
 *
 * purpose: the www repo holds one variant per model (astro builds, plain static
 *          html, an express app). this serves each variant on its own port so
 *          absolute asset paths (/ _astro/...) keep working, and you can flip
 *          between tabs to pick a winner.
 *
 * usage:   node serve-variants.mjs
 *          node serve-variants.mjs --dir "C:\Users\Admin\Downloads\www" --base-port 4101
 *          node serve-variants.mjs --allow-missing
 *
 * then:    one port per variant, all printed on start.
 *
 * notes:   astro variants are served from their dist/ build — this script does
 *          NOT build them, run `pnpm build` / `npm run build` first. static html
 *          variants are served straight from their folder. the express variant
 *          (deepseek-r1) keeps its own server on :3000 and is not started here.
 *          a missing dist/ is a hard error unless --allow-missing is passed, so
 *          a broken build never shows up as a silent blank page.
 * no dependencies — node built-ins only.
 */

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, extname, normalize, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

const { values: opts } = parseArgs({
  options: {
    dir: { type: "string", default: "" },
    "base-port": { type: "string", default: "4101" },
    "allow-missing": { type: "boolean", default: false },
  },
  strict: false,
});

const REPO = resolve(
  opts.dir || join(process.env.USERPROFILE || process.env.HOME || ".", "Downloads", "www")
);
const BASE_PORT = parseInt(opts["base-port"], 10);

const VARIANTS = [
  { label: "claude sonnet 4.6", dir: "claude sonnet 4.6", root: "dist" },
  { label: "gpt 5.5", dir: "gpt 5.5", root: "dist" },
  { label: "xiamo mimo v2.5 pro", dir: "xiamo-700-million mimo v2.5 pro", root: "dist" },
  { label: "gpt 5.5 extra high 1", dir: "gpt 5.5 extra high 1", root: "." },
  { label: "gpt 5.5 extra high 2", dir: "gpt 5.5 extra high 2", root: "." },
  { label: "deepseek v4.1 flash", dir: "deepseek v4.1 flash", root: "." },
  { label: "deepseek v4.1 flash 2", dir: "deepseek v4.1 flash 2", root: "." },
  { label: "qwen 3.8 flash max", dir: "qwen 3.8 flash max", root: "." },
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".map": "application/json",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function serveRoot(ROOT) {
  return async (req, res) => {
    let urlPath = decodeURIComponent(req.url.split("?")[0].split("#")[0]);
    if (urlPath.endsWith("/")) urlPath += "index.html";

    // resolve() both sides: on windows join() emits backslashes, so comparing a
    // forward-slash root against a joined path would 403 every request.
    const filePath = resolve(join(ROOT, normalize(urlPath)));
    if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
      res.writeHead(403); res.end("forbidden"); return;
    }

    let st;
    try {
      st = await stat(filePath);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 not found: " + urlPath);
      return;
    }
    if (st.isDirectory()) {
      const idx = join(filePath, "index.html");
      try {
        st = await stat(idx);
      } catch {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("404 (no index.html): " + urlPath);
        return;
      }
      res.writeHead(301, { Location: urlPath.replace(/\/?$/, "/") + "index.html" });
      res.end();
      return;
    }

    const ext = extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": st.size,
      "Cache-Control": "no-cache",
    });
    createReadStream(filePath).pipe(res);
  };
}

const missing = [];
for (const v of VARIANTS) {
  const root = resolve(join(REPO, v.dir, v.root));
  try {
    const st = await stat(root);
    if (!st.isDirectory()) throw new Error("not a directory");
    v.absRoot = root;
  } catch {
    missing.push({ ...v, absRoot: root });
  }
}

if (missing.length) {
  console.error("\n  FAILED — these variant roots do not exist:");
  for (const m of missing) console.error(`    ${m.label}  ->  ${m.absRoot}`);
  console.error("\n  astro variants need a build first (pnpm build / npm run build).");
  if (!opts["allow-missing"]) {
    console.error("  refusing to start. pass --allow-missing to serve the rest anyway.\n");
    process.exit(1);
  }
  console.error("  --allow-missing given, serving the remaining variants.\n");
}

const started = [];
VARIANTS.forEach((v, i) => {
  if (!v.absRoot) return;
  const port = BASE_PORT + i;
  createServer(serveRoot(v.absRoot)).listen(port, "127.0.0.1", () => {
    started.push({ port, label: v.label, root: v.absRoot });
    if (started.length === VARIANTS.filter((x) => x.absRoot).length) {
      console.log(`\n  repo : ${REPO}\n`);
      for (const s of started) {
        console.log(`  ${String(s.port).padEnd(6)} ${s.label.padEnd(26)} http://127.0.0.1:${s.port}/`);
      }
      console.log(`\n  express variant (deepseek-r1) is separate: node server.js -> http://127.0.0.1:3000/\n`);
    }
  });
});
