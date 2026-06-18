// Recapture every product screenshot in public/internal/stout-intro.html at 2x,
// showing real FUNCTIONALITY (selections, detail panels, pasted input). Drives a
// headed real Chrome (Google trusts it for OAuth); you log in once, then it
// captures all 13 views.
//
// Usage (parse host/tenant/space from any in-app URL of the target engagement):
//   DECK_URL="https://bi.clintapp.com/t/<tid>/s/<sid>" node capture-deck-shots.mjs
// Optional: HIDE_CHROME=1 hides the env banner + AI-incident banner if present.
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, 'public/internal/img');
const PROFILE = resolve(here, '.shots-profile-run');

const DECK_URL = process.env['DECK_URL'];
if (!DECK_URL) {
  console.error('Set DECK_URL="https://<host>/t/<tid>/s/<sid>"');
  process.exit(1);
}
const m = DECK_URL.match(/^(https?:\/\/[^/]+)\/t\/([0-9a-f-]{36})\/s\/([0-9a-f-]{36})/);
if (!m) {
  console.error('DECK_URL must look like https://<host>/t/<tid>/s/<sid>');
  process.exit(1);
}
const [, HOST, TID, SID] = m;
const BASE = `${HOST}/t/${TID}/s/${SID}`;
const HIDE = process.env['HIDE_CHROME'] === '1';

const log = (...a) => console.log('[deck]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (page, name) => {
  if (HIDE) await hideChrome(page);
  await page.screenshot({ path: resolve(OUT, name) });
  log('wrote', name);
};
async function settle(page, ms = 1800) {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(ms).catch(() => {});
}
async function hideChrome(page) {
  await page
    .evaluate(() => {
      document.querySelectorAll('app-env-banner').forEach((el) => (el.style.display = 'none'));
      // Best-effort: hide an AI service incident notice if one is showing.
      for (const el of document.querySelectorAll('div,section,aside')) {
        if (/active incident|suspended access/i.test(el.textContent || '') && el.children.length < 6) {
          el.style.display = 'none';
        }
      }
    })
    .catch(() => {});
}

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome',
  headless: false,
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  reducedMotion: 'reduce',
  ignoreDefaultArgs: ['--enable-automation'],
  args: ['--disable-blink-features=AutomationControlled'],
});
let page = ctx.pages()[0] ?? (await ctx.newPage());

// 1) Whitelabel login (logged-out). Wait for the branded form to render.
log('opening login...');
await page.goto(`${HOST}/login`, { waitUntil: 'domcontentloaded' }).catch(() => {});
const signedOut = page.url().includes('/login');
if (signedOut) {
  await page
    .getByRole('button', { name: /sign in with google/i })
    .waitFor({ state: 'visible', timeout: 20000 })
    .catch(() => {});
  await settle(page, 1200);
  if (page.url().includes('/login')) await shot(page, 'whitelabel-stout-login.png');
}

// 2) Wait for Google OAuth.
log('=== LOG IN with Google in the Chrome window (up to 10 min) ===');
const deadline = Date.now() + 10 * 60 * 1000;
let authed = false;
while (Date.now() < deadline) {
  try {
    for (const p of ctx.pages().filter((x) => !x.isClosed())) {
      const u = p.url();
      if (u.startsWith(HOST) && !u.includes('/login') && !u.includes('/auth/callback')) {
        page = p;
        authed = true;
        break;
      }
    }
  } catch {}
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

// 4) Bullseye -- select a live dot.
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

// 5) Catalysts -- select a real catalyst row (opens side panel).
try {
  await page.goto(`${BASE}/catalysts`, { waitUntil: 'domcontentloaded' });
  await settle(page, 2000);
  const row = page.locator('tr.cursor-pointer').first();
  await row.click().catch(() => {});
  await page.waitForTimeout(900);
  await page.mouse.move(900, 8);
  await page.waitForTimeout(600);
  await shot(page, 'catalysts.png');
} catch (e) {
  log('FAILED catalysts.png -', e.message);
}

// 6) Events -- select first event (opens thread panel).
try {
  await page.goto(`${BASE}/events`, { waitUntil: 'domcontentloaded' });
  await settle(page, 2000);
  await page.locator('tbody tr').first().click().catch(() => {});
  await page.waitForTimeout(1400);
  await shot(page, 'events.png');
} catch (e) {
  log('FAILED events.png -', e.message);
}

// 7) Source import -- paste NCT IDs.
try {
  await page.goto(`${BASE}/import`, { waitUntil: 'domcontentloaded' });
  await settle(page, 1500);
  const NCTS = ['NCT04435626', 'NCT03860935', 'NCT04667377', 'NCT06068946', 'NCT05869903', 'NCT05971940'];
  const box = page.getByPlaceholder('Paste NCT IDs, one per line or comma-separated');
  await box.click();
  await box.fill(NCTS.join('\n'));
  await page.waitForTimeout(700);
  await shot(page, 'source-import.png');
} catch (e) {
  log('FAILED source-import.png -', e.message);
}

// 8) Command palette.
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

// 9) Materials -- the browse page (full-width filter strip + deliverable list).
await go('/materials', 'materials.png', 2400);

// 10) Trial detail: resolve a trial that HAS intelligence (from the intelligence
//     browse), then capture its published note (#primary-intelligence) and its
//     markers table (#markers).
let trialId = process.env['TRIAL_ID'] || null;
if (!trialId) {
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
