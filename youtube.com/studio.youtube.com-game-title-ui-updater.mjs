// Purpose: update YouTube Studio video category + game title through the real Studio UI.
// Usage:
//   node studio.youtube.com-game-title-ui-updater.mjs videos.json [browser-profile-path]
// Manifest shape:
//   [{ "id": "VIDEO_ID", "search": "PUBG Mobile", "finalTitle": "PUBG Mobile", "optionRegex": "^PUBG Mobile\\b" }]

import { readFileSync } from 'node:fs';
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

const videos = JSON.parse(readFileSync(manifestPath, 'utf8')).map((video) => {
  const finalTitle = video.finalTitle || video.search;
  return {
    ...video,
    finalTitle,
    option: new RegExp(video.optionRegex || `^${escapeRegex(finalTitle)}\\b`, 'i'),
  };
});

const context = await chromium.launchPersistentContext(profilePath, {
  headless,
  viewport: { width: 1536, height: 900 },
  args: [
    '--disable-features=Translate,AutomationControlled',
    ...(minimized && !headless ? ['--start-minimized'] : []),
  ],
});

const page = context.pages()[0] || (await context.newPage());
page.setDefaultTimeout(45000);
page.setDefaultNavigationTimeout(90000);

const results = [];

try {
  for (const video of videos) {
    const row = { id: video.id, expected: video.finalTitle };
    results.push(row);

    await page.goto(`https://studio.youtube.com/video/${video.id}/edit`, {
      waitUntil: 'domcontentloaded',
    });
    await page.locator('ytcp-video-metadata-editor, ytcp-video-details-section').first().waitFor();

    row.mfk = await ensureNotMadeForKidsAnswered();
    row.advanced = await ensureAdvancedOpen();
    row.category = await setGamingCategory();
    row.selectedGame = await setGameTitle(video);
    row.save = await saveIfNeeded();
    row.visibleCategory = await readCategory();
    row.visibleGameInput = await readGameInput();

    console.log(JSON.stringify(row));
  }

  console.log(JSON.stringify({ results }, null, 2));
} catch (error) {
  await page.screenshot({ path: 'studio-ui-game-title-error.png', fullPage: true }).catch(() => {});
  console.log(JSON.stringify({ error: error.message, results, url: page.url() }, null, 2));
  process.exitCode = 1;
} finally {
  await context.close();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function ensureAdvancedOpen() {
  if (await page.locator('#category').count()) return 'already-open';
  const showMore = page.locator('ytcp-button#toggle-button button, ytcp-button#toggle-button').first();
  await showMore.scrollIntoViewIfNeeded();
  await showMore.click();
  await page.locator('#category').waitFor({ state: 'visible' });
  return 'clicked';
}

async function ensureNotMadeForKidsAnswered() {
  const noMfk = page
    .locator('tp-yt-paper-radio-button, ytcp-radio-button')
    .filter({ hasText: /No, it's not made for kids/i })
    .first();
  if ((await noMfk.count()) === 0) return 'no-radio-not-found';
  const selected = await noMfk
    .evaluate((el) => el.hasAttribute('checked') || el.getAttribute('aria-checked') === 'true')
    .catch(() => false);
  if (selected) return 'already-no';
  await noMfk.scrollIntoViewIfNeeded();
  await noMfk.click({ force: true });
  await page.waitForTimeout(500);
  return 'selected-no';
}

async function setGamingCategory() {
  const category = page.locator('#category').first();
  const current = await readCategory();
  if (/Gaming/.test(current)) return 'already-gaming';
  await category.scrollIntoViewIfNeeded();
  const trigger = category.locator('ytcp-dropdown-trigger').first();
  if ((await trigger.count()) > 0) {
    await trigger.click({ force: true });
  } else {
    await category.click({ force: true });
  }
  await page.waitForTimeout(800);
  const clicked = await page.evaluate(() => {
    const item = Array.from(document.querySelectorAll('tp-yt-paper-item[role="option"]')).find(
      (element) => (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim() === 'Gaming',
    );
    if (!item) return false;
    item.click();
    return true;
  });
  if (!clicked) throw new Error('Gaming option not found after opening category menu');
  await page.waitForTimeout(800);
  return 'selected-gaming';
}

async function setGameTitle(video) {
  const input = page.locator('input[aria-label^="Game title"]').first();
  await input.waitFor({ state: 'visible' });
  await input.scrollIntoViewIfNeeded();
  await input.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(video.search, { delay: 10 });
  await page.waitForFunction(
    (patternSource) => {
      const pattern = new RegExp(patternSource, 'i');
      return Array.from(document.querySelectorAll('tp-yt-paper-item[role="option"]')).some((element) =>
        pattern.test((element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim()),
      );
    },
    video.option.source,
    { timeout: 30000 },
  );
  const selected = await page.evaluate((patternSource) => {
    const pattern = new RegExp(patternSource, 'i');
    const item = Array.from(document.querySelectorAll('tp-yt-paper-item[role="option"]')).find((element) =>
      pattern.test((element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim()),
    );
    if (!item) return null;
    const text = (item.innerText || item.textContent || '').replace(/\s+/g, ' ').trim();
    item.click();
    return text;
  }, video.option.source);
  if (!selected) throw new Error(`Game option not found for ${video.finalTitle}`);
  await page.waitForTimeout(1000);
  return selected;
}

async function saveIfNeeded() {
  const saveButton = page.locator('ytcp-button#save button').first();
  await saveButton.waitFor({ state: 'visible' });
  const disabled = await saveButton.evaluate((el) =>
    Boolean(el.disabled || el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true'),
  );
  if (disabled) return 'already-disabled';

  const responsePromise = page
    .waitForResponse((response) => response.url().includes('/youtubei/v1/video_manager/metadata_update'), {
      timeout: 45000,
    })
    .catch((error) => ({ error: error.message }));

  await saveButton.click();
  const response = await responsePromise;
  if ('error' in response) throw new Error(`Save request did not complete: ${response.error}`);
  if (response.status() < 200 || response.status() >= 300) throw new Error(`Save failed with HTTP ${response.status()}`);

  await page.waitForFunction(() => {
    const button = document.querySelector('ytcp-button#save button');
    const body = document.body?.innerText || '';
    return (
      body.includes('Changes saved') ||
      Boolean(button?.disabled || button?.hasAttribute('disabled') || button?.getAttribute('aria-disabled') === 'true')
    );
  });
  return `clicked-save-http-${response.status()}`;
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
