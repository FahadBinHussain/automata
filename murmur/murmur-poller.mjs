const sqlite3 = require('sqlite3').verbose();
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

try {
  const envLocal = path.join(__dirname, '.env.local');
  if (fs.existsSync(envLocal)) for (const line of fs.readFileSync(envLocal, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
} catch {}

const WACLI_STORE = process.env.WACLI_STORE || path.join(process.env.APPDATA, 'mainframe/accounts/whatsapp/<your-phone-number>/store');
const HF_TARGET = process.env.MURMUR_WEBHOOK_URL || 'https://<murmur-space>.hf.space/wacli/webhook';
const HF_TOKEN = process.env.HF_TOKEN || fs.readFileSync(
  process.env.HF_TOKEN_FILE || path.join(process.env.APPDATA, 'mainframe/accounts/hf/<your-email>/token'),
  'utf8'
).trim();
const DB_PATH = path.join(WACLI_STORE, 'wacli.db');
const STATE_PATH = path.join(process.env.TEMP || 'C:\\tmp', 'murmur-poller-state.json');

let processedIds = new Set();
let lastPollTs = 0;

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    processedIds = new Set(data.ids || []);
    lastPollTs = data.lastPollTs || 0;
    console.log('[poller] loaded ' + processedIds.size + ' processed IDs');
  } catch {
    processedIds = new Set();
    lastPollTs = 0;
  }
}

function saveState() {
  const data = { ids: Array.from(processedIds).slice(-5000), lastPollTs };
  fs.writeFileSync(STATE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function computeSignature(payload) {
  const crypto = require('crypto');
  const hmac = crypto.createHmac('sha256', process.env.MURMUR_WEBHOOK_SECRET || '').update(payload).digest('hex');
  return 'sha256=' + hmac;
}

function forwardToMurmur(payload) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(payload);
    const sig = computeSignature(data);
    const options = {
      hostname: process.env.MURMUR_WEBHOOK_HOST || '<murmur-space>.hf.space',
      path: '/wacli/webhook',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'Authorization': 'Bearer ' + HF_TOKEN,
        'X-Wacli-Signature': sig,
      },
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

function poll() {
  const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, err => {
    if (err) {
      console.error('[poller] db open error:', err.message);
      return;
    }
    db.all(
      `SELECT rowid, msg_id, ts, chat_jid, sender_jid, sender_name, text FROM messages WHERE text LIKE '/ai%' AND ts > ? ORDER BY ts ASC`,
      [lastPollTs],
      async (err, rows) => {
        if (err) {
          console.error('[poller] query error:', err.message);
          db.close();
          return;
        }
        console.log('[poller] found', rows.length, 'rows');
        let maxTs = lastPollTs;
        for (const row of rows) {
          const msgId = row.msg_id || String(row.rowid);
          if (!msgId) continue;
          if (processedIds.has(msgId)) continue;

          const text = row.text || '';
          if (!text.trim().startsWith('/ai')) continue;

          console.log('[poller] forwarding:', msgId, row.chat_jid, text.slice(0, 50));

          const payload = JSON.stringify({
            Chat: parseJID(row.chat_jid),
            ID: msgId,
            SenderJID: row.sender_jid || '',
            Timestamp: new Date((row.ts || 0) * 1000).toISOString(),
            FromMe: false,
            Text: text,
            PushName: row.sender_name || '',
          });

          try {
            const resp = await forwardToMurmur(payload);
            console.log('[poller] murmur responded', resp.status, resp.body.slice(0, 100));
            processedIds.add(msgId);
          } catch (e) {
            console.error('[poller] forward failed:', e.message);
            break;
          }

          if (row.ts > maxTs) maxTs = row.ts;
        }
        lastPollTs = maxTs;
        saveState();
        db.close();
      }
    );
  });
}

function parseJID(jidStr) {
  if (!jidStr) return { user: '', server: 's.whatsapp.net' };
  const parts = jidStr.split('@');
  if (parts.length === 2) return { user: parts[0], server: parts[1] };
  return { user: jidStr, server: 's.whatsapp.net' };
}

loadState();
poll();
setInterval(poll, 15_000);
