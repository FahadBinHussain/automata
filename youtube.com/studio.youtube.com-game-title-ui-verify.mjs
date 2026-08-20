// Read-only verifier for YouTube Studio category + game title fields.
// Usage: node studio_youtube_game_title_ui_verify.mjs videos.json [browser-profile-path]

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';

for (const line of readFileSync(join(import.meta.dirname, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

const chromium = await loadChromium();

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error('Missing videos.json manifest path.');
  process.exit(2);
}

const profilePath =
  process.argv[3] ||
  String.raw`${process.env.APPDATA}\mainframe\accounts\agent-browser\${process.env.AGENT_BROWSER_EMAIL || '<your-email>'}`;

const headless = /^(1|true|yes)$/i.test(process.env.YOUTUBE_STUDIO_HEADLESS || "");
const minimized = /^(1|true|yes)$/i.test(process.env.YOUTUBE_STUDIO_MINIMIZED || "");
const videos = JSON.parse(readFileSync(manifestPath, 'utf8'));
const outputPath = 'studio-game-title-verify-next4-results.jsonl';
writeFileSync(outputPath, '');

const context = await chromium.launchPersistentContext(profilePath, {
  headless,
  viewport: { width: 1536, height: 900 },
  args: [
    '--disable-features=Translate,AutomationControlled',
    ...(minimized && !headless ? ['--start-minimized'] : []),
  ],
});

const page = context.pages()[0] || (await context.newPage());
page.setDefaultTimeout(30000);
page.setDefaultNavigationTimeout(90000);

const results = [];

try {
  for (const video of videos) {
    const row = { id: video.id, expected: video.finalTitle || video.search };
    results.push(row);
    try {
      await page.goto(`https://studio.youtube.com/video/${video.id}/edit`, {
        waitUntil: 'domcontentloaded',
      });
      await page.locator('ytcp-video-metadata-editor, ytcp-video-details-section').first().waitFor();
      row.advanced = await ensureAdvancedOpen();
      await page.waitForTimeout(1000);
      row.visibleCategory = await readCategory();
      row.visibleGameInput = await readGameInput();
      row.saveEnabled = await page
        .locator('ytcp-button#save button')
        .first()
        .evaluate((el) => !(el.disabled || el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true'))
        .catch(() => null);
      row.status = 'ok';
    } catch (error) {
      row.status = 'error';
      row.error = error.message;
      row.url = page.url();
    }
    appendFileSync(outputPath, `${JSON.stringify(row)}\n`);
    console.log(JSON.stringify(row));
  }

  console.log(JSON.stringify({ outputPath, results }, null, 2));
} catch (error) {
  await page.screenshot({ path: 'studio-ui-game-title-verify-next4-error.png', fullPage: true }).catch(() => {});
  console.log(JSON.stringify({ error: error.message, results, url: page.url() }, null, 2));
  process.exitCode = 1;
} finally {
  await context.close();
}

async function ensureAdvancedOpen() {
  if (await page.locator('#category').count()) return 'already-open';
  const showMore = page.locator('ytcp-button#toggle-button button, ytcp-button#toggle-button').first();
  await showMore.scrollIntoViewIfNeeded();
  await showMore.click();
  await page.locator('#category').waitFor({ state: 'visible' });
  return 'clicked';
}

async function readCategory() {
  return page
    .locator('#category')
    .first()
    .innerText()
    .then((text) => text.replace(/\s+/g, ' ').trim())
    .catch(() => '');
}

async function readGameInput() {
  return page
    .locator('input[aria-label^="Game title"]')
    .first()
    .inputValue()
    .catch(() => '');
}

async function loadChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch (error) {
    const requireFromCwd = createRequire(resolve(process.cwd(), 'package.json'));
    try {
      return requireFromCwd('playwright').chromium;
    } catch (cwdError) {
      throw new Error(`Unable to load Playwright from script path or current workspace: ${error.message}; ${cwdError.message}`);
    }
  }
}
