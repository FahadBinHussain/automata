#!/usr/bin/env node
/**
 * worldlabs-downloader.mjs
 *
 * Scrapes https://www.worldlabs.ai/ for all 3D assets (GLB models, SPZ gaussian splats, textures)
 * and downloads them locally. Optionally serves them with a built-in viewer.
 *
 * Usage:
 *   node worldlabs-downloader.mjs                    # download to ./worldlabs-assets/
 *   node worldlabs-downloader.mjs -o /path/to/dir    # custom output dir
 *   node worldlabs-downloader.mjs --serve             # download + start local server
 *   node worldlabs-downloader.mjs --serve --port 9000 # custom port
 *   node worldlabs-downloader.mjs --serve-only        # serve existing ./worldlabs-assets/
 *
 * No external dependencies — uses only Node.js built-ins.
 */

import { mkdir, writeFile, stat } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { join, basename, extname } from "node:path";
import { parseArgs } from "node:util";
import { createServer } from "node:http";

const { values: opts } = parseArgs({
  options: {
    o: { type: "string", default: "worldlabs-assets" },
    serve: { type: "boolean", default: false },
    "serve-only": { type: "boolean", default: false },
    port: { type: "string", default: "8080" },
    marble: { type: "string" },
  },
  strict: false,
});

const OUT_DIR = resolve(opts.o);
const PORT = parseInt(opts.port, 10);
const BASE = "https://www.worldlabs.ai";

// ── Step 1: Scrape homepage for asset URLs ──────────────────────────────────

async function scrapeAssets() {
  console.log("Scraping worldlabs.ai homepage...");
  const html = await fetchText(`${BASE}/`);

  const assets = new Map(); // url -> { url, type, name }

  // Match all href/src attributes for preload links and resource tags
  const urlPatterns = [
    /href="([^"]*\.(glb|spz|webp|png|jpg|jpeg|gif|obj|fbx|usdz))"/gi,
    /src="([^"]*\.(glb|spz|webp|png|jpg|jpeg|gif|obj|fbx|usdz))"/gi,
  ];

  for (const re of urlPatterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      let url = m[1];
      if (url.startsWith("/")) url = BASE + url;
      if (!url.startsWith("http")) continue;

      const ext = extname(url).toLowerCase();
      const name = basename(url).split("?")[0];

      let type = "unknown";
      if (ext === ".glb") type = "model";
      else if (ext === ".spz") type = "splat";
      else if ([".webp", ".png", ".jpg", ".jpeg"].includes(ext)) type = "texture";

      if (!assets.has(url)) {
        assets.set(url, { url, type, name });
      }
    }
  }

  // Also scan JS chunks for additional splat/model URLs not in HTML preloads
  const jsChunks = [...html.matchAll(/src="(_next\/static\/chunks\/[^"]+\.js)"/g)];
  for (const chunkMatch of jsChunks) {
    const chunkUrl = `${BASE}/${chunkMatch[1]}`;
    try {
      const js = await fetchText(chunkUrl);
      const jsUrls = [
        ...js.matchAll(/["']([^"']*\.(glb|spz))["']/g),
      ];
      for (const jm of jsUrls) {
        let url = jm[1];
        if (url.startsWith("/")) url = BASE + url;
        if (!url.startsWith("http")) continue;
        const ext = extname(url).toLowerCase();
        const name = basename(url).split("?")[0];
        let type = ext === ".glb" ? "model" : ext === ".spz" ? "splat" : "unknown";
        if (type !== "unknown" && !assets.has(url)) {
          assets.set(url, { url, type, name });
        }
      }
    } catch { /* skip failed chunks */ }
  }

  // Probe for higher-resolution splat variants not in HTML preloads
  // worldlabs hosts 100k, 200k, and 500k versions — download highest available
  const splatBaseNames = [...assets.values()]
    .filter(a => a.type === "splat")
    .map(a => a.name.replace(/-\d+k\.spz$/, ""));

  const resolutions = ["500k", "200k", "100k"];
  for (const base of splatBaseNames) {
    for (const res of resolutions) {
      const probeUrl = `${BASE}/models/splats/${base}-${res}.spz`;
      const probeName = `${base}-${res}.spz`;
      if (assets.has(probeUrl)) continue;
      try {
        const r = await fetch(probeUrl, { method: "HEAD" });
        if (r.ok) {
          assets.set(probeUrl, { url: probeUrl, type: "splat", name: probeName });
          console.log(`  Found higher-res: ${probeName}`);
          break; // found highest for this splat, stop probing lower
        }
      } catch { /* skip */ }
    }
  }

  return [...assets.values()];
}

// ── Step 1b: Scrape scene configs from page chunk ────────────────────────────

async function scrapeSceneConfigs() {
  console.log("Scraping scene configs from page chunk...");
  const html = await fetchText(`${BASE}/`);

  // Find the page chunk URL
  const pageChunkMatch = [...html.matchAll(/src="(_next\/static\/chunks\/app\/page[^"]+\.js)"/g)];
  if (pageChunkMatch.length === 0) {
    console.log("  No page chunk found");
    return {};
  }

  const pageChunkUrl = `${BASE}/${pageChunkMatch[0][1]}`;
  const js = await fetchText(pageChunkUrl);

  // Extract the scene definitions array
  const arrStart = js.indexOf('[{id:');
  if (arrStart === -1) {
    console.log("  No scene array found in page chunk");
    return {};
  }

  let depth = 0;
  let arrEnd = arrStart;
  for (let i = arrStart; i < js.length; i++) {
    if (js[i] === "[") depth++;
    if (js[i] === "]") { depth--; if (depth === 0) { arrEnd = i + 1; break; } }
  }

  const arrStr = js.substring(arrStart, arrEnd);

  // Parse the Three.js constructor calls: new l.Pq0(x,y,z) -> [x,y,z]
  // and new l.O9p(x,y,z) -> [x,y,z]
  const parsed = arrStr
    .replace(/new \w+\.Pq0\(([^)]+)\)/g, "[$1]")
    .replace(/new \w+\.O9p\(([^)]+)\)/g, "[$1]");

  let scenes;
  try {
    scenes = JSON.parse(parsed);
  } catch (e) {
    console.error("  Failed to parse scene array:", e.message);
    return {};
  }

  // Map scene names to splat filenames
  const nameToSplat = {
    "Autumn": "autumn",
    "Amphitheater": "amphitheater",
    "Town": "town",
    "Garden": "garden",
    "Bath": "bath",
    "Train": "anime-train",
  };

  const configs = {};
  for (const scene of scenes) {
    const slug = nameToSplat[scene.name];
    if (!slug) continue;

    // Save raw worldlabs format (viewer handles both raw and wrapper)
    configs[slug] = {
      position: scene.position || [0, 0, 0],
      rotation: scene.rotation || [Math.PI, 0, 0],
      offset: scene.offset || [0, 0, 0],
      cameraRadius: scene.cameraRadius || null,
      radius: scene.radius || null,
      duration: scene.duration || null,
    };
    console.log(`  Config: ${scene.name} (${slug})`);
  }

  return configs;
}

// ── Step 2: Download all assets ─────────────────────────────────────────────

async function downloadAssets(assets) {
  await mkdir(OUT_DIR, { recursive: true });

  const categories = { model: [], splat: [], texture: [], unknown: [] };
  for (const a of assets) categories[a.type]?.push(a) || categories.unknown.push(a);

  console.log(`\nFound ${assets.length} assets:`);
  console.log(`  Models:  ${categories.model.length}`);
  console.log(`  Splats:  ${categories.splat.length}`);
  console.log(`  Textures: ${categories.texture.length}`);
  if (categories.unknown.length) console.log(`  Other:   ${categories.unknown.length}`);

  let downloaded = 0;
  let skipped = 0;

  for (const asset of assets) {
    const dest = join(OUT_DIR, asset.name);

    // Skip if already exists and is same size
    if (existsSync(dest)) {
      try {
        const st = await stat(dest);
        if (st.size > 0) {
          skipped++;
          continue;
        }
      } catch { /* download anyway */ }
    }

    process.stdout.write(`  Downloading ${asset.name}...`);
    try {
      const res = await fetch(asset.url);
      if (!res.ok) {
        console.log(` HTTP ${res.status} — skipped`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(dest, buf);
      const mb = (buf.length / 1048576).toFixed(1);
      console.log(` ${mb} MB`);
      downloaded++;
    } catch (e) {
      console.log(` ERROR: ${e.message}`);
    }
  }

  console.log(`\nDone: ${downloaded} downloaded, ${skipped} skipped (already exist)`);
  console.log(`Output: ${OUT_DIR}`);
}

// ── Step 3: Generate viewer HTML ────────────────────────────────────────────

function generateViewer(splatNames, glbNames) {
  const splatOptions = splatNames.map(n => {
    const label = n.replace(/-\d+k\.spz$/, "").replace(/\.spz$/, "");
    return `<option value="${n}">${label}</option>`;
  }).join("\n      ");

  const glbOptions = glbNames.map(n => {
    const label = n.replace(/\.glb$/, "");
    return `<option value="${n}">${label}</option>`;
  }).join("\n      ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>World Labs 3D Viewer</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#f9f9fb;overflow:hidden;font-family:system-ui,sans-serif}
  #c{width:100vw;height:100vh}
  #ui{position:fixed;top:16px;left:16px;z-index:100;display:flex;flex-direction:column;gap:8px}
  #ui select,#ui button{background:rgba(30,30,30,.85);color:#fff;border:1px solid #444;padding:8px 14px;border-radius:8px;font-size:14px;cursor:pointer;backdrop-filter:blur(8px)}
  #info{position:fixed;bottom:16px;left:16px;z-index:100;background:rgba(0,0,0,.5);padding:8px 14px;border-radius:8px;font-size:13px;color:#ccc;backdrop-filter:blur(8px)}
  #ld{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:200;font-size:18px;color:#888}
</style>
</head>
<body>
<div id="ui">
  <select id="sel">
    <optgroup label="Gaussian Splats">${splatOptions}</optgroup>
    <optgroup label="3D Models">${glbOptions}</optgroup>
  </select>
  <button onclick="resetView()">Reset View</button>
</div>
<div id="ld">Loading...</div>
<div id="info">Drag to rotate | Scroll to zoom | Shift+drag to pan</div>
<div id="c"></div>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/","@sparkjsdev/spark":"https://sparkjs.dev/releases/spark/2.1.0/spark.module.js"}}</script>
<script type="module">
import*as T from"three";import{OrbitControls}from"three/addons/controls/OrbitControls.js";import{GLTFLoader}from"three/addons/loaders/GLTFLoader.js";import{SparkRenderer,SplatMesh}from"@sparkjsdev/spark";
const cfg={},scene=new T.Scene;scene.background=new T.Color(0xf9f9fb);
const cam=new T.PerspectiveCamera(60,innerWidth/innerHeight,.01,1e3);
const ren=new T.WebGLRenderer({antialias:!0,powerPreference:"high-performance"});
ren.setSize(innerWidth,innerHeight);ren.setPixelRatio(Math.min(devicePixelRatio,2));
ren.toneMapping=T.ACESFilmicToneMapping;document.getElementById("c").appendChild(ren.domElement);
const spark=new SparkRenderer({renderer:ren});scene.add(spark);
const ctrl=new OrbitControls(cam,ren.domElement);ctrl.enableDamping=!0;ctrl.dampingFactor=.05;
scene.add(new T.AmbientLight(0xf9f9fb,3.92));
const d1=new T.DirectionalLight(0xffffff,1.1);d1.position.set(4,3,-4);scene.add(d1);
const d2=new T.DirectionalLight(0xffffff,1.1);d2.position.set(0,3,0);scene.add(d2);
const gl=new GLTFLoader;let cur=null;
const sel=document.getElementById("sel");
function clear(){if(cur){scene.remove(cur);cur=null}}
async function load(name){
  document.getElementById("ld").style.display="block";clear();
  const c=cfg[name]||{};
  if(name.endsWith(".spz")){
    const s=new SplatMesh({url:name}),g=new T.Group;g.add(s);
    g.position.set(...c.p);g.rotation.set(...c.r);g.scale.setScalar(c.s);
    cur=g;scene.add(g);cam.position.set(0,0,c.cz||5);ctrl.target.set(0,0,0);ctrl.update();
  }else if(name.endsWith(".glb")){
    try{
      const glt=await new Promise((r,j)=>gl.load(name,r,void 0,j));
      const g=new T.Group;g.add(glt.scene);g.scale.setScalar(c.s);
      g.position.set(...(c.p||[0,0,0]));g.rotation.set(...(c.r||[0,0,0]));
      cur=g;scene.add(g);cam.position.set(0,0,c.cz||10);ctrl.target.set(0,0,0);ctrl.update();
    }catch(e){console.error(e);document.getElementById("ld").textContent="Failed";return}
  }
  document.getElementById("ld").style.display="none";
}
window.resetView=()=>{const c=cfg[sel.value]||{};cam.position.set(0,0,c.cz||5);ctrl.target.set(0,0,0);ctrl.update()};
sel.onchange=()=>load(sel.value);
onresize=()=>{cam.aspect=innerWidth/innerHeight;cam.updateProjectionMatrix();ren.setSize(innerWidth,innerHeight)};
ren.setAnimationLoop(()=>{ctrl.update();ren.render(scene,cam)});
load(sel.value);
</script>
</body>
</html>`;
}

// ── Step 4: Serve ───────────────────────────────────────────────────────────

function serve(dir, port) {
  const MIME = {
    ".html": "text/html", ".js": "application/javascript", ".json": "application/json",
    ".css": "text/css", ".glb": "model/gltf-binary", ".spz": "application/octet-stream",
    ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg",
  };

  const server = createServer((req, res) => {
    let url = req.url.split("?")[0];
    if (url === "/") url = "/viewer.html";

    const filePath = join(dir, url);
    const ext = extname(filePath).toLowerCase();

    if (!existsSync(filePath)) {
      res.writeHead(404); res.end("Not found"); return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache",
    });
    createReadStream(filePath).pipe(res);
  });

  server.listen(port, () => {
    console.log(`\nViewer running at http://127.0.0.1:${port}/`);
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; worldlabs-downloader/1.0)" },
  });
  return res.text();
}

function resolve(p) {
  if (p.match(/^[A-Z]:\\/i) || p.startsWith("/")) return p;
  return join(process.cwd(), p);
}

// ── Marble world scraper (Playwright) ───────────────────────────────────────

async function scrapeMarble(worldUrl) {
  console.log(`\nScraping marble world: ${worldUrl}`);
  await mkdir(OUT_DIR, { recursive: true });

  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error("Playwright not installed. Run: npm install playwright");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

    const spzUrls = new Map();
    const plyUrls = new Map();
    let condImageUrl = null;
    let mpiBase = null;
    let worldName = "world";

  page.on("response", async (resp) => {
    const url = resp.url();
    try {
      if (url.includes("/api/") && resp.status() === 200) {
        const body = await resp.text();
        const data = JSON.parse(body);
        const items = Array.isArray(data) ? data : [data];
        for (const w of items) {
          const spz = w?.generation_output?.spz_urls || w?.spz_urls;
          if (spz && typeof spz === "object") {
          // Only keep the best resolution: full_res > 500k
          const bestKey = spz.full_res ? "full_res" : spz["500k"] ? "500k" : Object.keys(spz)[0];
          if (bestKey && spz[bestKey]) spzUrls.set(bestKey, spz[bestKey]);
            const ply = w?.generation_output?.ply_url || w?.ply_url;
            if (ply) plyUrls.set("ply", ply);
            condImageUrl = w?.generation_output?.cond_image_url || null;
            mpiBase = w?.generation_output?.mpi_url || null;
            worldName = w?.generation_output?.display_name || w?.display_name || "world";
            console.log(`  World: ${worldName}`);
            console.log(`  Resolutions: ${Object.keys(spz).join(", ")}`);
            if (condImageUrl) console.log(`  Input image: ${condImageUrl.split("/").pop()}`);
            if (mpiBase) console.log(`  MPI base: ${mpiBase.split("/").pop()}`);
          }
        }
      }
      if ((url.includes(".spz") || url.includes(".ply")) && resp.status() === 200) {
        const buf = await resp.body();
        const name = url.split("/").pop().split("?")[0];
        const dest = join(OUT_DIR, name);
        await writeFile(dest, buf);
        console.log(`  Downloaded: ${name} (${(buf.length / 1048576).toFixed(1)}MB)`);
      }
    } catch {}
  });

  try {
    await page.goto(worldUrl, { waitUntil: "networkidle", timeout: 30000 });
  } catch {
    console.log("  Page load timeout (normal for SPA), waiting for data...");
  }
  await page.waitForTimeout(8000);

  // Download any URLs not yet captured by response interception
  for (const [key, url] of spzUrls) {
    const name = url.split("/").pop().split("?")[0];
    const dest = join(OUT_DIR, name);
    if (existsSync(dest)) continue;
    console.log(`  Fetching ${key}: ${name}...`);
    try {
      const res = await fetch(url);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        await writeFile(dest, buf);
        console.log(`  Downloaded: ${name} (${(buf.length / 1048576).toFixed(1)}MB)`);
      }
    } catch (e) {
      console.log(`  Failed: ${e.message}`);
    }
  }

  // Also download PLY if present
  for (const [, url] of plyUrls) {
    const name = url.split("/").pop().split("?")[0];
    const dest = join(OUT_DIR, name);
    if (existsSync(dest)) continue;
    console.log(`  Fetching PLY: ${name}...`);
    try {
      const res = await fetch(url);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        await writeFile(dest, buf);
        console.log(`  Downloaded: ${name} (${(buf.length / 1048576).toFixed(1)}MB)`);
      }
    } catch (e) {
      console.log(`  Failed: ${e.message}`);
    }
  }

  // Download conditioning image (input/reference)
  if (condImageUrl) {
    const name = condImageUrl.split("/").pop().split("?")[0];
    const dest = join(OUT_DIR, name);
    if (!existsSync(dest)) {
      console.log(`  Fetching input image: ${name}...`);
      try {
        const res = await fetch(condImageUrl);
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          await writeFile(dest, buf);
          console.log(`  Downloaded: ${name} (${(buf.length / 1048576).toFixed(1)}MB)`);
        }
      } catch (e) { console.log(`  Failed: ${e.message}`); }
    }
  }

  // Download thumbnail from MPI
  if (mpiBase) {
    const thumbUrl = `${mpiBase}/thumbnail_1440.webp`;
    const name = "thumbnail_1440.webp";
    const dest = join(OUT_DIR, name);
    if (!existsSync(dest)) {
      console.log(`  Fetching thumbnail...`);
      try {
        const res = await fetch(thumbUrl);
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          await writeFile(dest, buf);
          console.log(`  Downloaded: ${name} (${(buf.length / 1024).toFixed(0)}KB)`);
        }
      } catch (e) { console.log(`  Failed: ${e.message}`); }
    }
  }

  await browser.close();

  // Return as assets list
  const assets = [];
  for (const [, url] of spzUrls) {
    const name = url.split("/").pop().split("?")[0];
    assets.push({ url, name, type: "splat" });
  }
  for (const [, url] of plyUrls) {
    const name = url.split("/").pop().split("?")[0];
    assets.push({ url, name, type: "splat" });
  }
  return assets;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (opts["serve-only"]) {
    serve(OUT_DIR, PORT);
    return;
  }

  let assets;

  if (opts.marble) {
    assets = await scrapeMarble(opts.marble);
  } else {
    assets = await scrapeAssets();
  }

  if (assets.length === 0) {
    console.error("No assets found");
    process.exit(1);
  }

  await downloadAssets(assets);

  // Scrape and save scene configs (JSON) alongside assets
  if (!opts.marble) {
    try {
      const configs = await scrapeSceneConfigs();
      for (const [slug, config] of Object.entries(configs)) {
        const configPath = join(OUT_DIR, `${slug}.json`);
        await writeFile(configPath, JSON.stringify(config, null, 2));
        console.log(`  Config saved: ${slug}.json`);
      }
    } catch (e) {
      console.warn("Failed to scrape configs:", e.message);
    }
  }

  // Generate viewer
  const splats = assets.filter(a => a.type === "splat").map(a => a.name);
  const glbs = assets.filter(a => a.type === "model").map(a => a.name);
  const viewerHtml = generateViewer(splats, glbs);
  await writeFile(join(OUT_DIR, "viewer.html"), viewerHtml);
  console.log(`Viewer written to ${join(OUT_DIR, "viewer.html")}`);

  if (opts.serve || opts["serve-only"]) {
    serve(OUT_DIR, PORT);
  } else {
    console.log(`\nTo view: node worldlabs-downloader.mjs --serve`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
