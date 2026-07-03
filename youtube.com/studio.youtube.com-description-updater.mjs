// Purpose: update YouTube Studio descriptions through the real Studio UI.
// Usage: node studio_youtube_description_updater.mjs descriptions.json [browser-profile-path]
// Manifest shape: [{ "id": "VIDEO_ID", "description": "00:00 Chapter\n..." }]

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const chromium = await loadChromium();

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error('Missing descriptions.json manifest path.');
  process.exit(2);
}

const profilePath =
  process.argv[3] ||
  String.raw`C:\Users\<user>\AppData\Roaming\mainframe\accounts\browserui\<your-email>`;

const headless = /^(1|true|yes)$/i.test(process.env.YOUTUBE_STUDIO_HEADLESS || '');
const minimized = /^(1|true|yes)$/i.test(process.env.YOUTUBE_STUDIO_MINIMIZED || '');
const videos = JSON.parse(readFileSync(manifestPath, 'utf8'));

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
    const row = { id: video.id };
    results.push(row);

    await page.goto(`https://studio.youtube.com/video/${video.id}/edit`, {
      waitUntil: 'domcontentloaded',
    });
    await page.locator('ytcp-video-metadata-editor, ytcp-video-details-section').first().waitFor();

    row.beforeDescription = await readDescription();
    row.setDescription = await setDescription(video.description);
    row.save = await saveIfNeeded();

    await page.goto(`https://studio.youtube.com/video/${video.id}/edit`, {
      waitUntil: 'domcontentloaded',
    });
    await page.locator('ytcp-video-metadata-editor, ytcp-video-details-section').first().waitFor();
    row.afterDescription = await readDescription();
    row.matches = normalizeDescription(row.afterDescription) === normalizeDescription(video.description);

    console.log(JSON.stringify(row));
  }

  console.log(JSON.stringify({ results }, null, 2));
} catch (error) {
  await page.screenshot({ path: 'studio-ui-description-error.png', fullPage: true }).catch(() => {});
  console.log(JSON.stringify({ error: error.message, results, url: page.url() }, null, 2));
  process.exitCode = 1;
} finally {
  await context.close();
}

async function readDescription() {
  return page.evaluate(() => {
    function readEditableValue(element) {
      if (!element) return '';
      if (element.isContentEditable) return element.textContent || '';
      return element.value || '';
    }

    function findDescriptionElement() {
      const direct =
        document.querySelector('#description-textarea #textbox') ||
        document.querySelector('#description-textarea [contenteditable="true"]') ||
        document.querySelector('textarea[aria-label*="Description" i]') ||
        document.querySelector('[contenteditable="true"][aria-label*="Description" i]');
      if (direct) return direct;

      const textboxes = Array.from(document.querySelectorAll('ytcp-social-suggestions-textbox'));
      const byId = textboxes.find((element) => /description/i.test(element.id || ''));
      if (byId) return byId.querySelector('#textbox, [contenteditable="true"], textarea');

      const label = Array.from(document.querySelectorAll('div, span, label'))
        .find((element) => (element.textContent || '').trim().toLowerCase() === 'description');
      const container = label?.closest('ytcp-social-suggestions-textbox, ytcp-form-input-container, div');
      return container?.querySelector('#textbox, [contenteditable="true"], textarea') || null;
    }

    const element = findDescriptionElement();
    return element ? readEditableValue(element) : '';
  });
}

async function setDescription(description) {
  const ok = await page.evaluate((value) => {
    function findDescriptionElement() {
      const direct =
        document.querySelector('#description-textarea #textbox') ||
        document.querySelector('#description-textarea [contenteditable="true"]') ||
        document.querySelector('textarea[aria-label*="Description" i]') ||
        document.querySelector('[contenteditable="true"][aria-label*="Description" i]');
      if (direct) return direct;

      const textboxes = Array.from(document.querySelectorAll('ytcp-social-suggestions-textbox'));
      const byId = textboxes.find((element) => /description/i.test(element.id || ''));
      if (byId) return byId.querySelector('#textbox, [contenteditable="true"], textarea');

      const label = Array.from(document.querySelectorAll('div, span, label'))
        .find((element) => (element.textContent || '').trim().toLowerCase() === 'description');
      const container = label?.closest('ytcp-social-suggestions-textbox, ytcp-form-input-container, div');
      return container?.querySelector('#textbox, [contenteditable="true"], textarea') || null;
    }

    const element = findDescriptionElement();
    if (!element) return false;
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    element.focus();
    if (element.isContentEditable) {
      element.textContent = value;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.blur();
      return true;
    }

    const proto = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor?.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.blur();
    return true;
  }, description);
  if (!ok) throw new Error('Description editable element not found');
  await page.waitForTimeout(1000);
  return 'set';
}

async function saveIfNeeded() {
  const saveButton = page.locator('ytcp-button#save button').first();
  await saveButton.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const button = document.querySelector('ytcp-button#save button');
    return button && !(button.disabled || button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true');
  });

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

function normalizeDescription(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim();
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
