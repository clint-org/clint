// Capture the real screens for the Stout demo run-of-show (the rehearsal page
// at docs/notes/stout-demo-runsheet.html). One PNG per beat: deck slides + the
// BI obesity open + the Pfizer NSCLC ladder (pitch -> 3mo -> 1yr).
//
// Reuses the SAME headed-login profile as capture-deck-shots.mjs
// (.shots-profile-run), so if you already logged in for a deck refresh this
// runs without any prompt. Otherwise a real Chrome window opens once, you sign
// in with Google, and it captures the rest automatically.
//
// USAGE (from src/client/):
//   node scripts/capture-runsheet-shots.mjs            # headed (logs in if needed)
//   HEADLESS=1 node scripts/capture-runsheet-shots.mjs # only once a profile is authed
//   ONLY=03-pitch-home,06-1yr-home node scripts/capture-runsheet-shots.mjs
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../public/internal/stout-runsheet-assets');
mkdirSync(OUT, { recursive: true });
const PROFILE = resolve(here, '../.shots-profile-run'); // shared with capture-deck-shots.mjs

const DECK = 'https://clintapp.com/internal/stout-intro.html?present';
const PFIZER = 'https://pfizer.clintapp.com/t/a87a88ae-1b76-4c6b-85e0-1b53c926d0f2/s';
const BI = 'https://bi.clintapp.com/t/c747dd15-a176-4edb-acb2-8c716ea1fd4b/s';
const S_OBESITY = `${BI}/4fd154ce-7c85-475f-a47f-a244d80509a8`;
const S_PITCH = `${PFIZER}/373a85f9-2417-49f7-b28e-7de9c1b7d326`;
const S_3MO = `${PFIZER}/39736f76-af54-486d-b05f-ae7f9c558448`;
const S_1YR = `${PFIZER}/7f642772-5578-4635-899a-22860c6b7299`;
const S_EMPTY = `${PFIZER}/5dbea303-160c-43e0-b149-8bf0266b696e`;

const HEADLESS = process.env['HEADLESS'] === '1';
const ONLY = (process.env['ONLY'] || '').split(',').map((s) => s.trim()).filter(Boolean);
const want = (name) => ONLY.length === 0 || ONLY.includes(name);
const log = (...a) => console.log('[runsheet]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// App shots: deck slide N (1-based). Navigate to the deck then advance.
// App pages: full in-app URL (auth needed).
const SHOTS = [
  { name: '01-deck-open', deck: 1 },
  { name: '02-obesity-timeline', url: `${S_OBESITY}/timeline` },
  { name: '03-pitch-home', url: `${S_PITCH}` },
  { name: '04-pitch-bullseye', url: `${S_PITCH}/bullseye` },
  { name: '05-3mo-home', url: `${S_3MO}` },
  { name: '06-1yr-home', url: `${S_1YR}` },
  { name: '07-1yr-intelligence', url: `${S_1YR}/intelligence` },
  { name: '08-deck-roadmap', deck: 4 },
  { name: '09-deck-trust', deck: 7 },
  { name: '10-deck-pricing', deck: 8 },
  { name: '11-deck-ask', deck: 9 },
  // run-sheet v2 (your-flow) additions:
  { name: '12-data-backbone', url: `${S_OBESITY}/profiles/companies` },
  { name: '13-obesity-bullseye', url: `${S_OBESITY}/bullseye` },
  { name: '14-pitch-heatmap', url: `${S_PITCH}/heatmap` },
  { name: '15-pitch-materials', url: `${S_PITCH}/materials` },
  { name: '16-import', url: `${S_EMPTY}/import` },
];

async function settle(page, ms = 1700) {
  await page.waitForLoadState('networkidle', { timeout: 9000 }).catch(() => {});
  await page.waitForTimeout(ms).catch(() => {});
}

// Hide the dev env banner + any AI-incident notice so shots read clean.
async function hideChrome(page) {
  await page
    .evaluate(() => {
      document.querySelectorAll('app-env-banner').forEach((el) => (el.style.display = 'none'));
      for (const el of document.querySelectorAll('div,section,aside,p')) {
        const t = el.textContent || '';
        if (/active incident|suspended access/i.test(t) && t.length < 240) el.style.display = 'none';
      }
    })
    .catch(() => {});
}

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: HEADLESS,
  channel: 'chrome',
  ignoreDefaultArgs: ['--enable-automation'],
  args: ['--disable-blink-features=AutomationControlled'],
  viewport: { width: 1512, height: 900 },
  deviceScaleFactor: 1,
});
const page = ctx.pages()[0] || (await ctx.newPage());

// Ensure we are logged in (instant if the profile already is).
log('checking session...');
await page.goto(`https://pfizer.clintapp.com/login`, { waitUntil: 'domcontentloaded' }).catch(() => {});
if (page.url().includes('/login')) {
  log('Not logged in. A Chrome window is open: sign in with Google. Waiting up to 3 min...');
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    if (!page.url().includes('/login') && !page.url().includes('/auth/callback')) break;
    await sleep(1500);
  }
  if (page.url().includes('/login')) {
    log('Timed out waiting for login. Re-run after signing in.');
    await ctx.close();
    process.exit(1);
  }
}
log('session OK');

async function gotoDeckSlide(n) {
  await page.goto(DECK, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await settle(page, 900);
  for (let i = 1; i < n; i++) {
    await page.keyboard.press('ArrowRight');
    await sleep(450);
  }
  await sleep(700);
}

for (const s of SHOTS) {
  if (!want(s.name)) continue;
  try {
    if (s.deck) {
      await gotoDeckSlide(s.deck);
    } else {
      await page.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await settle(page);
      await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
      await hideChrome(page);
      await sleep(500);
    }
    await page.screenshot({ path: resolve(OUT, `${s.name}.png`) });
    log('wrote', `${s.name}.png`);
  } catch (e) {
    log('FAILED', s.name, e?.message || e);
  }
}

await ctx.close();
log('done ->', OUT);
