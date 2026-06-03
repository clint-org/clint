import { chromium } from '@playwright/test';
import { join } from 'path';

const BASE_URL = 'https://bi.dev.clintapp.com';
const STORAGE_PATH = join(__dirname, '.auth-session.json');

async function saveAuth() {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log(`\nOpening ${BASE_URL} -- please log in via Google OAuth.`);
  console.log('The browser will close automatically once login is detected.\n');

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  // Wait until we land past /login and /auth/callback
  await page.waitForFunction(
    () => !window.location.pathname.includes('/login') && !window.location.pathname.includes('/auth/callback'),
    { timeout: 120_000 }
  );
  await page.waitForTimeout(3000);

  await context.storageState({ path: STORAGE_PATH });
  console.log('Session saved successfully.');

  await browser.close();
}

saveAuth().catch((err) => {
  console.error('Auth save failed:', err);
  process.exit(1);
});
