import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';

try {
  const p = new URL('.env.local', import.meta.url);
  if (existsSync(p)) for (const l of readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
} catch {}
const ORIGIN = process.env.THEOLDLLM_ORIGIN || 'https://<app>.vercel.app';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled','--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await page.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  
  // listen for turnstile token generation
  page.on('response', async (res) => {
    if (res.url().includes('turnstile') && res.url().includes('fbE')) {
      const text = await res.text().catch(() => '');
      if (text.includes('token') || text.length > 100) {
        console.log('TURNSTILE RESP URL:', res.url());
        console.log('BODY:', text.substring(0,300));
      }
    }
  });
  
  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(20000);
  
  // check for any turnstile token in page
  const token = await page.evaluate(() => {
    return window.turnstileToken || window.cfTurnstileResponse || document.querySelector('[name="cf-turnstile-response"]')?.value;
  });
  console.log('turnstile token from page:', token ? token.substring(0,100) : 'none');
  
  // try to get token from window object
  const keys = await page.evaluate(() => Object.keys(window).filter(k => k.toLowerCase().includes('turnstile') || k.toLowerCase().includes('cf_')));
  console.log('window keys:', keys);
  
  await browser.close();
})();
