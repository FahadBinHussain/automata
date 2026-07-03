const chunkUrl = 'https://worldlabs.ai/_next/static/chunks/app/page-b56d349f241f82bd.js?dpl=dpl_8UpVfPhDtshHh82qFrzg1BiNLr4c';
const jsResp = await fetch(chunkUrl);
const js = await jsResp.text();

// Search for where cfg is populated - look for patterns like cfg[ or cfg =
const patterns = ['cfg[', 'cfg.', 'cameraRadius', 'position', 'offset', 'radius', '.p ', '.r ', '.cz'];
for (const p of patterns) {
  let idx = 0;
  let count = 0;
  while (count < 5) {
    idx = js.indexOf(p, idx);
    if (idx === -1) break;
    console.log(`\n--- "${p}" at ${idx} ---`);
    console.log(js.substring(Math.max(0, idx - 150), idx + 200));
    idx += p.length;
    count++;
  }
}
