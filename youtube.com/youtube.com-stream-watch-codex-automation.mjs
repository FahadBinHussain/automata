import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const rawArgs = process.argv.slice(2);
if (rawArgs[0] === '--') rawArgs.shift();
const args = parseArgs(rawArgs);
const configPath = args.get('config') || 'config/youtube_stream_automation.json';
const config = loadConfig(configPath);
const email = args.get('email') || config.email || '<your-email>';
const statePath =
  args.get('state') ||
  config.statePath ||
  'game_detect_local/automation_state/youtube_stream_watch_state.json';
const outputPath =
  args.get('output') ||
  config.outputPath ||
  'game_detect_local/results/youtube_stream_watch_latest.json';
const apply = flag('apply', false);
const autoPublish = args.has('auto-publish')
  ? flag('auto-publish', false)
  : apply && config.autoPublishSafeStreams === true;
const notify = args.has('notify') ? flag('notify', false) : config.notify !== false;
const recentLimit = Number(args.get('limit') || config.recentLimit || 50);
const lookbackDays = Number(args.get('lookback-days') || config.lookbackDays || 14);

const defaults = {
  devTitlePatterns: [
    '\\bcoding\\b',
    '\\bdeveloper\\b',
    '\\bdev stream\\b',
    '\\bprogramming\\b',
    '\\bbuild(ing)?\\b.*\\b(app|site|bot|tool)\\b',
  ],
  adultTitlePatterns: ['\\bCarnal Instinct\\b', '\\bNSFW\\b', '\\b18\\+\\b', '\\badult\\b'],
  genericTitlePatterns: ['^This game is PEAK!?$', '^Watch me have some fun', '^Live Stream$', '^Untitled$'],
  keepPrivateVideoIds: [],
};

const rules = {
  dev: compilePatterns(config.devTitlePatterns || defaults.devTitlePatterns),
  adult: compilePatterns(config.adultTitlePatterns || defaults.adultTitlePatterns),
  generic: compilePatterns(config.genericTitlePatterns || defaults.genericTitlePatterns),
  keepPrivateIds: new Set(config.keepPrivateVideoIds || defaults.keepPrivateVideoIds),
};

async function main() {
  const credentials = getStoredCredentials(email);
  const accessToken = await getAccessToken(credentials);
  const tokenEmail = await tokenOwnerEmail(accessToken);
  const channel = await authenticatedChannel(accessToken);
  const videos = await listRecentLivestreams(accessToken, channel.uploadsPlaylistId, recentLimit, lookbackDays);
  const state = loadState();
  const report = {
    generatedAt: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry-run',
    accountEmail: tokenEmail,
    channelTitle: channel.title,
    checked: videos.length,
    apply,
    autoPublish,
    notify,
    actions: [],
  };

  for (const video of videos) {
    const previous = state.videos[video.id] || null;
    const classification = classifyVideo(video);
    const action = await planAndMaybeApply(accessToken, video, classification, previous);
    report.actions.push(action);
    state.videos[video.id] = {
      firstSeenAt: previous?.firstSeenAt || report.generatedAt,
      lastSeenAt: report.generatedAt,
      title: video.title,
      privacyStatus: action.afterPrivacyStatus || video.privacyStatus,
      classification: classification.type,
      actionStatus: action.status,
      publishedAt: video.publishedAt,
      url: video.url,
    };
  }

  report.counts = countActions(report.actions);
  saveJson(outputPath, report);
  saveState(state, report.generatedAt);

  if (notify) {
    const message = notificationMessage(report);
    if (message) {
      sendNotification(message, `youtube-stream-watch:${report.generatedAt.slice(0, 10)}:${report.actions.map((item) => item.id).join(',')}`);
    }
  }

  console.log(JSON.stringify({
    outputPath,
    statePath,
    accountEmail: report.accountEmail,
    channelTitle: report.channelTitle,
    counts: report.counts,
    mode: report.mode,
  }, null, 2));
}

function parseArgs(values) {
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    parsed.set(key, next && !next.startsWith('--') ? values[++index] : 'true');
  }
  return parsed;
}

function flag(name, defaultValue) {
  if (!args.has(name)) return defaultValue;
  return !['0', 'false', 'no', 'off'].includes(String(args.get(name)).toLowerCase());
}

function loadConfig(filePath) {
  const candidates = [filePath, 'config/youtube_stream_automation.example.json'];
  for (const candidate of candidates) {
    try {
      return JSON.parse(fs.readFileSync(candidate, 'utf8'));
    } catch {}
  }
  return {};
}

function compilePatterns(patterns) {
  return patterns.map((pattern) => new RegExp(pattern, 'i'));
}

function runPowerShell(script) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'PowerShell command failed').trim());
  }
  return result.stdout.trim();
}

function getStoredCredentials(accountEmail) {
  const profilePath = path.join(process.env.APPDATA, 'mainframe', 'accounts', 'gws', accountEmail.toLowerCase());
  const clientSecretPath = path.join(profilePath, 'client_secret.json');
  const script = `
$ErrorActionPreference='Stop'
$env:GOOGLE_WORKSPACE_CLI_CONFIG_DIR='${profilePath.replaceAll("'", "''")}'
$env:GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND='file'
$oldPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$raw = & gws auth export --unmasked 2>$null
$ErrorActionPreference = $oldPreference
if ($LASTEXITCODE -ne 0 -or -not $raw) { throw 'could not export stored oauth metadata' }
$text = ($raw -join [Environment]::NewLine)
$start = $text.IndexOf('{')
$end = $text.LastIndexOf('}')
if ($start -lt 0 -or $end -lt $start) { throw 'could not locate oauth metadata json' }
$text.Substring($start, $end - $start + 1)
`;
  const exported = runPowerShell(script);
  const credentials = JSON.parse(exported);
  const clientConfig = JSON.parse(fs.readFileSync(clientSecretPath, 'utf8'));
  const client = clientConfig.installed || clientConfig.web || clientConfig;
  return {
    client_id: credentials.client_id || client.client_id,
    client_secret: credentials.client_secret || client.client_secret,
    refresh_token: credentials.refresh_token,
  };
}

async function getAccessToken(credentials) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      refresh_token: credentials.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!response.ok) throw new Error(`OAuth token refresh failed: ${response.status} ${await safeError(response)}`);
  const token = await response.json();
  if (!token.access_token) throw new Error('OAuth token refresh did not return an access token');
  return token.access_token;
}

async function tokenOwnerEmail(accessToken) {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => null);
  if (!response?.ok) return null;
  const body = await response.json().catch(() => ({}));
  return body.email || null;
}

async function safeError(response) {
  try {
    const data = await response.json();
    return data.error_description || data.error?.message || data.error || response.statusText;
  } catch {
    return response.statusText;
  }
}

async function youtube(accessToken, route, options = {}) {
  const response = await fetch(`https://www.googleapis.com/youtube/v3/${route}`, {
    ...options,
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`YouTube API failed (${response.status}) for ${route}: ${await safeError(response)}`);
  return response.json();
}

async function authenticatedChannel(accessToken) {
  const data = await youtube(accessToken, 'channels?part=contentDetails,snippet&mine=true');
  const channel = data.items?.[0];
  if (!channel) throw new Error('Could not find authenticated channel.');
  return {
    title: channel.snippet?.title || '',
    uploadsPlaylistId: channel.contentDetails?.relatedPlaylists?.uploads,
  };
}

async function listRecentLivestreams(accessToken, uploadsPlaylistId, limit, days) {
  const uploads = [];
  let pageToken = '';
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  do {
    const params = new URLSearchParams({ part: 'snippet,contentDetails', playlistId: uploadsPlaylistId, maxResults: '50' });
    if (pageToken) params.set('pageToken', pageToken);
    const page = await youtube(accessToken, `playlistItems?${params}`);
    uploads.push(...(page.items || []));
    pageToken = page.nextPageToken || '';
  } while (pageToken && uploads.length < Math.max(limit * 3, 100));

  const ids = unique(uploads.map((item) => item.contentDetails?.videoId || item.snippet?.resourceId?.videoId).filter(Boolean));
  const videos = [];
  for (const chunk of chunks(ids, 50)) {
    const params = new URLSearchParams({
      part: 'snippet,contentDetails,status,liveStreamingDetails',
      id: chunk.join(','),
      maxResults: '50',
    });
    const page = await youtube(accessToken, `videos?${params}`);
    for (const item of page.items || []) {
      const publishedAt = item.snippet?.publishedAt ? Date.parse(item.snippet.publishedAt) : 0;
      if (publishedAt && publishedAt < cutoff) continue;
      if (!item.liveStreamingDetails?.actualStartTime && !item.liveStreamingDetails?.scheduledStartTime) continue;
      videos.push({
        id: item.id,
        title: item.snippet?.title || '',
        description: item.snippet?.description || '',
        publishedAt: item.snippet?.publishedAt || '',
        privacyStatus: item.status?.privacyStatus || '',
        status: item.status || {},
        duration: parseDurationSeconds(item.contentDetails?.duration),
        liveStreamingDetails: item.liveStreamingDetails || {},
        url: `https://www.youtube.com/watch?v=${item.id}`,
      });
      if (videos.length >= limit) return videos;
    }
  }
  return videos;
}

function classifyVideo(video) {
  const haystack = `${video.title}\n${video.description}`;
  if (rules.keepPrivateIds.has(video.id)) return { type: 'adult', reason: 'configured keep-private id' };
  if (rules.adult.some((pattern) => pattern.test(haystack))) return { type: 'adult', reason: 'adult title/description pattern' };
  if (rules.dev.some((pattern) => pattern.test(haystack))) return { type: 'dev', reason: 'developer/coding title/description pattern' };
  return { type: 'safe-game-candidate', reason: 'no dev/adult pattern matched' };
}

async function planAndMaybeApply(accessToken, video, classification, previous) {
  const isSafe = classification.type === 'safe-game-candidate';
  const genericTitle = rules.generic.some((pattern) => pattern.test(video.title.trim()));
  const action = {
    id: video.id,
    url: video.url,
    title: video.title,
    beforePrivacyStatus: video.privacyStatus,
    afterPrivacyStatus: video.privacyStatus,
    classification,
    isNew: !previous,
    status: 'observed',
    workflows: {
      title: isSafe && genericTitle ? 'needs-title-choice' : 'not-needed',
      gameDetection: isSafe ? 'needed' : 'blocked',
      playlists: isSafe ? 'needed-after-game-detection' : 'blocked',
      studioGameTitle: isSafe ? 'needed-after-majority-game' : 'blocked',
    },
  };

  if (!isSafe) {
    action.status = `kept-private-${classification.type}`;
    return action;
  }

  if (video.privacyStatus !== 'public') {
    if (apply && autoPublish) {
      await youtubeUpdateStatus(accessToken, video.id, video.status || {});
      action.afterPrivacyStatus = 'public';
      action.status = 'published-safe-stream';
    } else {
      action.status = 'would-publish-safe-stream';
    }
  } else {
    action.status = 'already-public-safe-stream';
  }

  return action;
}

async function youtubeUpdateStatus(accessToken, id, currentStatus) {
  const nextStatus = {};
  for (const key of ['embeddable', 'license', 'publicStatsViewable', 'selfDeclaredMadeForKids', 'containsSyntheticMedia']) {
    if (Object.prototype.hasOwnProperty.call(currentStatus, key)) nextStatus[key] = currentStatus[key];
  }
  nextStatus.privacyStatus = 'public';
  await youtube(accessToken, 'videos?part=status', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, status: nextStatus }),
  });
}

function notificationMessage(report) {
  const interesting = report.actions.filter((item) => item.isNew || item.status !== 'observed');
  if (!interesting.length) return '';
  const lines = [
    'YouTube stream watch',
    `${report.channelTitle || 'channel'} · ${report.mode} · checked ${report.checked}`,
    '',
  ];
  for (const item of interesting.slice(0, 12)) {
    lines.push(`${item.status}: ${item.title}`);
    lines.push(item.url);
    lines.push(`classification: ${item.classification.type} (${item.classification.reason})`);
    if (item.workflows.title === 'needs-title-choice') lines.push('title workflow: needs transcript/title options + your choice');
    if (item.workflows.gameDetection === 'needed') lines.push('game workflow: needs full-stream sampling, playlist update, Studio majority game title');
    lines.push('');
  }
  if (interesting.length > 12) lines.push(`+${interesting.length - 12} more in ${outputPath}`);
  return lines.join('\n').trim();
}

function sendNotification(message, dedupeKey) {
  const result = spawnSync(process.execPath, [
    'tools/codex_notify.mjs',
    'send',
    '--source',
    'youtube-stream-watch',
    '--thread-id',
    config.notifyThreadId || process.env.CODEX_NOTIFY_THREAD_ID || '<thread-id>',
    '--title',
    'YouTube stream watch',
    '--message',
    message,
    '--dedupe-key',
    dedupeKey,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 5 * 1024 * 1024,
  });
  if (result.status !== 0) {
    console.error((result.stderr || result.stdout || 'notification command failed').trim());
  }
}

function countActions(actions) {
  const counts = {};
  for (const action of actions) counts[action.status] = (counts[action.status] || 0) + 1;
  return counts;
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return { version: 1, videos: parsed.videos && typeof parsed.videos === 'object' ? parsed.videos : {} };
  } catch {
    return { version: 1, videos: {} };
  }
}

function saveState(state, timestamp) {
  state.lastRunAt = timestamp;
  saveJson(statePath, state);
}

function saveJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function unique(values) {
  return Array.from(new Set(values));
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function parseDurationSeconds(iso) {
  if (!iso) return 0;
  const match = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 0;
  const [, d = '0', h = '0', m = '0', s = '0'] = match;
  return Number(d) * 86400 + Number(h) * 3600 + Number(m) * 60 + Number(s);
}

main().catch((error) => {
  const message = String(error?.message || error)
    .replace(/ya29\.[A-Za-z0-9._-]+/g, '[redacted-access-token]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]');
  console.error(message);
  process.exit(1);
});
