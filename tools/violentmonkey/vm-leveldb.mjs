// purpose: read/write the Violentmonkey chrome.storage.local LevelDB directly,
//   without opening the browser's UI. used by violentmonkey-inject.ps1.
//   the "Local Extension Settings/<vm-extension-id>/" dir is a standard LevelDB;
//   scripts live under keys `code:<n>` (JSON-encoded string of the source),
//   `scr:<n>` (JSON metadata), `mod:<n>` (last-modified timestamp), and
//   `val:<n>` (GM_* values, NEVER touched here).
//
// subcommands:
//   list   <dbPath>                     list all scripts (id, name, version, enabled)
//   find   <dbPath> <name-substring>    print the script id whose name contains the substring
//   inject <dbPath> <id> <sourceFile>   replace source, bump version+mod, verify round-trip
//
// run:
//   node vm-leveldb.mjs list  "<dbPath>"
//   node vm-leveldb.mjs inject "<dbPath>" 30 "C:\path\script.user.js"

import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

// classic-level lives in a shared temp install (not inside this repo); resolve
// it from the path the wrapper passes in, so the module lookup is explicit
// regardless of where this helper is copied.
const require = createRequire(import.meta.url);
const modRoot = process.env.VM_NODE_MODULES || path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'node_modules');
const { ClassicLevel } = require(path.join(modRoot, 'classic-level'));

const [cmd, dbPath, arg3, arg4] = process.argv.slice(2);

if (!cmd || !dbPath) {
  console.error('usage: node vm-leveldb.mjs <list|find|inject> <dbPath> [args...]');
  process.exit(2);
}

const db = new ClassicLevel(dbPath, { keyEncoding: 'utf8', valueEncoding: 'utf8' });

async function allScripts() {
  const out = [];
  for await (const [key, value] of db.iterator({ keys: true, values: true })) {
    if (!key.startsWith('scr:')) continue;
    try {
      const meta = JSON.parse(String(value));
      const id = Number(key.slice(4));
      out.push({
        id,
        name: meta.meta && meta.meta.name,
        version: meta.meta && meta.meta.version,
        enabled: meta.config && meta.config.enabled,
      });
    } catch {}
  }
  return out;
}

async function open() {
  await db.open();
  try {
    if (cmd === 'list') {
      const scripts = await allScripts();
      for (const s of scripts) {
        console.log(`${s.id}\t${s.enabled ? 'on' : 'off'}\tv${s.version}\t${s.name}`);
      }
    } else if (cmd === 'find') {
      if (!arg3) { console.error('find needs a name substring'); process.exit(2); }
      const needle = arg3.toLowerCase();
      const scripts = await allScripts();
      const hits = scripts.filter((s) => s.name && s.name.toLowerCase().includes(needle));
      if (!hits.length) {
        console.error(`no script found with name containing "${arg3}"`);
        process.exit(1);
      }
      for (const s of hits) console.log(`${s.id}\t${s.name}`);
    } else if (cmd === 'inject') {
      if (!arg3 || !arg4) { console.error('inject needs <id> <sourceFile>'); process.exit(2); }
      const id = Number(arg3);
      const source = readFileSync(arg4, 'utf8');

      const codeKey = `code:${id}`;
      const scrKey = `scr:${id}`;
      const modKey = `mod:${id}`;

      const have = await db.get(scrKey).catch(() => null);
      if (!have) { console.error(`no script with id ${id} in this db`); process.exit(1); }

      const oldCode = await db.get(codeKey).catch(() => '');
      console.log('old code:30-ish value is JSON string:', String(oldCode).startsWith('"//'));

      // Violentmonkey stores script source as a JSON-encoded string (escaped
      // \n, wrapped in quotes), NOT raw text. writing raw breaks the options
      // page (it fails to parse and hangs forever).
      await db.put(codeKey, JSON.stringify(source));

      const scr = JSON.parse(have);
      const ver = (source.match(/@version\s+(\S+)/) || [])[1] || scr.meta.version;
      scr.meta.version = ver;
      scr.props = scr.props || {};
      scr.props.lastModified = Date.now();
      scr.props.lastUpdated = Date.now();
      await db.put(scrKey, JSON.stringify(scr));

      await db.put(modKey, String(Date.now()));

      // verify round-trip: stored value must parse back to exactly the source
      const check = await db.get(codeKey);
      let parsed = null;
      try { parsed = JSON.parse(check); } catch {}
      if (!parsed || parsed !== source) {
        console.error('VERIFY FAILED: stored value does not round-trip to source');
        process.exit(1);
      }
      console.log(`injected id ${id} as v${ver} (${source.length} bytes), round-trip OK`);
    } else {
      console.error(`unknown command: ${cmd}`);
      process.exit(2);
    }
  } finally {
    await db.close();
  }
}

open().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
