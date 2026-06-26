// Recapture the product screenshots used by the Stout intro deck
// (src/client/public/internal/stout-intro.html) at 2x, each showing a real
// working state (selections, detail panels, pasted input). Drives a HEADED real
// Chrome so Google trusts it for OAuth: you log in once, then it captures every
// shot. The login persists in a gitignored profile dir, so subsequent runs skip
// the login.
//
// This is the durable "refresh the deck when the design changes" tool. To
// refresh a subset after a design change, pass ONLY=timeline,materials.
//
// USAGE (from src/client/):
//   node scripts/capture-deck-shots.mjs
//
// The default target is the prod Pfizer/Stout demo engagement "Obesity
// Competitive Landscape". Override with DECK_URL to point at any engagement:
//   DECK_URL="https://<host>/t/<tenantId>/s/<spaceId>" node scripts/capture-deck-shots.mjs
//
// Options (env vars):
//   DECK_URL   full in-app URL of the target engagement (host + /t/<tid>/s/<sid>)
//   ONLY       comma-separated shot names to capture (default: all). Names are
//              the PNG basenames without extension, e.g. ONLY=timeline,bullseye
//   HIDE       "0" to keep the env banner + AI-incident banner visible (default: hidden)
//   HEADLESS   "1" to run headless (only works once a login profile exists)
//   TRIAL_ID   skip auto-resolving a trial for the intelligence/markers shots
//
// AUTH NOTE: prod whitelabel hosts store the session in a cookie-based
// `sb-auth` (chunked) on `.clintapp.com`, NOT localStorage. This script relies
// on the browser session itself (it never reads the token), so that detail only
// matters if you script REST calls separately.
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../public/internal/img');
const PROFILE = resolve(here, '../.shots-profile-run');

// Default: prod Pfizer/Stout demo engagement "Obesity Competitive Landscape".
const DEFAULT_DECK_URL =
  'https://pfizer.clintapp.com/t/a87a88ae-1b76-4c6b-85e0-1b53c926d0f2/s/66fb48de-b2fc-476b-ae37-31216b1c872c';
const DECK_URL = process.env['DECK_URL'] || DEFAULT_DECK_URL;
const m = DECK_URL.match(/^(https?:\/\/[^/]+)\/t\/([0-9a-f-]{36})\/s\/([0-9a-f-]{36})/);
if (!m) {
  console.error('DECK_URL must look like https://<host>/t/<tid>/s/<sid>');
  process.exit(1);
}
const [, HOST, TID, SID] = m;
const BASE = `${HOST}/t/${TID}/s/${SID}`;
const HIDE = process.env['HIDE'] !== '0';
const HEADLESS = process.env['HEADLESS'] === '1';
const ONLY = (process.env['ONLY'] || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const want = (name) => ONLY.length === 0 || ONLY.includes(name);

const log = (...a) => console.log('[deck]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function settle(page, ms = 1800) {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(ms).catch(() => {});
}

// Hide the env banner and the AI-service incident notice. The incident banner
// can sit INSIDE the page content, so match only compact elements (short text)
// to avoid hiding a wrapper that also contains the form.
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

const shot = async (page, name) => {
  if (HIDE) await hideChrome(page);
  await page.screenshot({ path: resolve(OUT, name) });
  log('wrote', name);
};

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome',
  headless: HEADLESS,
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  reducedMotion: 'reduce',
  ignoreDefaultArgs: ['--enable-automation'],
  args: ['--disable-blink-features=AutomationControlled'],
});
let page = ctx.pages()[0] ?? (await ctx.newPage());

// 1) Whitelabel login (only captured when actually logged out).
log('opening login...');
await page.goto(`${HOST}/login`, { waitUntil: 'domcontentloaded' }).catch(() => {});
if (page.url().includes('/login')) {
  await page
    .getByRole('button', { name: /sign in with google/i })
    .waitFor({ state: 'visible', timeout: 20000 })
    .catch(() => {});
  await settle(page, 1200);
  if (page.url().includes('/login') && want('whitelabel-stout-login')) {
    await shot(page, 'whitelabel-stout-login.png');
  }
}

// 2) Wait for Google OAuth (skipped instantly if the profile is already authed).
log('=== if prompted, LOG IN with Google in the Chrome window (up to 10 min) ===');
const deadline = Date.now() + 10 * 60 * 1000;
let authed = false;
while (Date.now() < deadline) {
  for (const p of ctx.pages().filter((x) => !x.isClosed())) {
    const u = p.url();
    if (u.startsWith(HOST) && !u.includes('/login') && !u.includes('/auth/callback')) {
      page = p;
      authed = true;
      break;
    }
  }
  if (authed) break;
  await sleep(2500);
}
if (!authed) {
  log('Timed out waiting for login.');
  await ctx.close().catch(() => {});
  process.exit(1);
}
await page.bringToFront().catch(() => {});
log('authenticated; capturing.');

// 3) Simple route views.
const go = async (path, name, ms = 1800) => {
  if (!want(name.replace('.png', ''))) return;
  try {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await settle(page, ms);
    await shot(page, name);
  } catch (e) {
    log('FAILED', name, '-', e.message);
  }
};
await go('', 'engagement-landing.png');
await go('/timeline', 'timeline.png', 2400);
await go('/heatmap/by-moa', 'heatmap.png', 2400);
await go('/events?source=detected', 'activity.png');

// 4) Bullseye -- select a live dot to open the asset panel.
if (want('bullseye')) {
  try {
    await page.goto(`${BASE}/bullseye`, { waitUntil: 'domcontentloaded' });
    await settle(page, 2600);
    const dots = page.locator('circle.bullseye-dot:not(.bullseye-dot-faded)');
    const n = await dots.count();
    if (n) {
      await dots.nth(Math.min(n - 1, Math.floor(n / 2))).click({ force: true });
      await page.waitForTimeout(1200);
      await page.mouse.move(900, 8);
      await page.waitForTimeout(600);
    }
    await shot(page, 'bullseye.png');
  } catch (e) {
    log('FAILED bullseye.png -', e.message);
  }
}

// 5) Catalysts -- select a real catalyst row (opens side panel).
if (want('catalysts')) {
  try {
    await page.goto(`${BASE}/catalysts`, { waitUntil: 'domcontentloaded' });
    await settle(page, 2000);
    await page.locator('tr.cursor-pointer').first().click().catch(() => {});
    await page.waitForTimeout(900);
    await page.mouse.move(900, 8);
    await page.waitForTimeout(600);
    await shot(page, 'catalysts.png');
  } catch (e) {
    log('FAILED catalysts.png -', e.message);
  }
}

// 6) Events -- select first event (opens thread panel).
if (want('events')) {
  try {
    await page.goto(`${BASE}/events`, { waitUntil: 'domcontentloaded' });
    await settle(page, 2000);
    await page.locator('tbody tr').first().click().catch(() => {});
    await page.waitForTimeout(1400);
    await shot(page, 'events.png');
  } catch (e) {
    log('FAILED events.png -', e.message);
  }
}

// 7) Source import -- paste NCT IDs. The import page is gated by importGuard
//    (owner/editor + tenant ai_enabled) and does a full SPA reload, so wait
//    longer than the route views or the screenshot fires on a blank frame.
if (want('source-import')) {
  try {
    await page.goto(`${BASE}/import`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const NCTS = ['NCT04435626', 'NCT03860935', 'NCT04667377', 'NCT06068946', 'NCT05869903', 'NCT05971940'];
    const box = page.getByPlaceholder('Paste NCT IDs, one per line or comma-separated');
    if (await box.count()) {
      await box.click();
      await box.fill(NCTS.join('\n'));
      await page.waitForTimeout(900);
    } else {
      log('  (NCT input not found -- guard may have redirected; check ai_enabled + role)');
    }
    await shot(page, 'source-import.png');
  } catch (e) {
    log('FAILED source-import.png -', e.message);
  }
}

// 8) Command palette.
if (want('command-palette')) {
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await settle(page, 1500);
    await page.keyboard.press('Meta+k');
    await page.waitForTimeout(1200);
    await shot(page, 'command-palette.png');
    await page.keyboard.press('Escape');
  } catch (e) {
    log('FAILED command-palette.png -', e.message);
  }
}

// 9) Materials -- browse page (full-width filter strip + deliverable list).
await go('/materials', 'materials.png', 2400);

// 10) Trial detail: resolve a trial that HAS intelligence (from the intelligence
//     browse), then capture its published note (#primary-intelligence) and its
//     markers table (#markers).
let trialId = process.env['TRIAL_ID'] || null;
if (!trialId && (want('intelligence') || want('trial-detail'))) {
  try {
    await page.goto(`${BASE}/intelligence`, { waitUntil: 'domcontentloaded' });
    await settle(page, 2200);
    trialId = await page.evaluate(() => {
      for (const a of document.querySelectorAll('a[href*="/manage/trials/"]')) {
        const id = (a.getAttribute('href').match(/manage\/trials\/([0-9a-f-]{36})/) || [])[1];
        if (id) return id;
      }
      return null;
    });
  } catch (e) {
    log('FAILED resolving intelligence trial -', e.message);
  }
}
log('trial id:', trialId);

async function trialSection(name, anchor) {
  if (!want(name.replace('.png', ''))) return;
  if (!trialId) return log('skip', name, '(no trial)');
  try {
    await page.goto(`${BASE}/manage/trials/${trialId}`, { waitUntil: 'domcontentloaded' });
    await settle(page, 2000);
    await page
      .locator(anchor)
      .first()
      .evaluate((el) => el.scrollIntoView({ block: 'start' }))
      .catch(() => log('  (anchor missing:', anchor, ')'));
    await page.waitForTimeout(800);
    await shot(page, name);
  } catch (e) {
    log('FAILED', name, '-', e.message);
  }
}
await trialSection('intelligence.png', '#primary-intelligence');
await trialSection('trial-detail.png', '#markers');

log('Done. Wrote shots to', OUT);
await ctx.close().catch(() => {});
process.exit(0);
