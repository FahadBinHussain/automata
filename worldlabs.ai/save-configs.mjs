import { writeFileSync } from 'fs';
import { join } from 'path';

const BASE = 'https://worldlabs.ai';
const OUT_DIR = process.env.WORLDLABS_OUT_DIR || join(process.env.USERPROFILE, 'Downloads', 'automata', 'worldlabs.ai');

const nameToSplat = {
  "Autumn": "autumn",
  "Amphitheater": "amphitheater",
  "Town": "town",
  "Garden": "garden",
  "Bath": "bath",
  "Train": "anime-train",
};

console.log("Fetching page...");
const resp = await fetch(`${BASE}/`);
const html = await resp.text();

const pageChunkMatch = [...html.matchAll(/(?:src|href)="\/?(_next\/static\/chunks\/app\/page[^"]+\.js[^"]*)"/g)];

const pageChunkUrl = `${BASE}/${pageChunkMatch[0][1]}`;
console.log("Fetching chunk:", pageChunkUrl);
const jsResp = await fetch(pageChunkUrl);
const js = await jsResp.text();

const arrStart = js.indexOf('[{id:');
if (arrStart === -1) { console.error("No scene array"); process.exit(1); }

let depth = 0, arrEnd = arrStart;
for (let i = arrStart; i < js.length; i++) {
  if (js[i] === '[') depth++;
  if (js[i] === ']') { depth--; if (depth === 0) { arrEnd = i + 1; break; } }
}

const arrStr = js.substring(arrStart, arrEnd);
const parsed = arrStr
  .replace(/new \w+\.Pq0\(([^)]+)\)/g, '[$1]')
  .replace(/new \w+\.O9p\(([^)]+)\)/g, '[$1]')
  .replace(/Math\.PI/g, String(Math.PI));

// Fix bare decimals like .5 -> 0.5 and -.5 -> -0.5 for valid JSON
let fixed = parsed.replace(/([\[,:\s]-?)(\.\d)/g, (m, pre, dec) => pre + '0' + dec);
// Quote unquoted object keys: {id:5 -> {"id":5
fixed = fixed.replace(/\{(\s*)(\w+):/g, '{ $1"$2":');
fixed = fixed.replace(/,(\s*)(\w+):/g, ', $1"$2":');
const scenes = JSON.parse(fixed);

for (const s of scenes) {
  const slug = nameToSplat[s.name];
  if (!slug) continue;

  const config = {
    position: s.position || [0, 0, 0],
    rotation: s.rotation || [Math.PI, 0, 0],
    offset: s.offset || [0, 0, 0],
    cameraRadius: s.cameraRadius || null,
    radius: s.radius || null,
    duration: s.duration || null,
  };

  const path = `${OUT_DIR}/${slug}.json`;
  writeFileSync(path, JSON.stringify(config, null, 2));
  console.log(`Saved: ${slug}.json`);
  console.log(JSON.stringify(config, null, 2));
}
