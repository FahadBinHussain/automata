import { chromium } from 'playwright';

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
  
  await page.goto('https://<app-url>/', { waitUntil: 'domcontentloaded', timeout: 30000 });
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
