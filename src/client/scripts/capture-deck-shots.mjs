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
//   SYNC       "1" to click CT.gov "Sync" on the intelligence/trial-detail trials
//              before capturing -- needed right after a fresh space reseed so the
//              CT.GOV DATA panel reads as synced (seed does not set ctgov fields)
//   INTEL_TRIAL_ID / DETAIL_TRIAL_ID  pin the trial UUIDs for the intelligence /
//              trial-detail shots instead of resolving them by NCT
//
// AUTH NOTE: prod whitelabel hosts store the session in a cookie-based
// `sb-auth` (chunked) on `.clintapp.com`, NOT localStorage. This script relies
// on the browser session itself (it never reads the token), so that detail only
// matters if you script REST calls separately.
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../public/internal/img');
const PROFILE = resolve(here, '../.shots-profile-run');

// Default: prod Pfizer/Stout demo engagement "Obesity Competitive Landscape"
// (the seed-demo refreshed space provisioned 2026-06-26 for the deck refresh).
const DEFAULT_DECK_URL =
  'https://pfizer.clintapp.com/t/a87a88ae-1b76-4c6b-85e0-1b53c926d0f2/s/780b5021-a432-42ea-9c68-d63d9cac4e5e';
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

// Compose two screenshots side by side (left | gutter | right) into one PNG.
// Used for the source-import shot: the processing stepper next to the resolved
// review (results) screen.
async function composeSideBySide(leftPath, rightPath, outPath, gutter = 40) {
  const lm = await sharp(leftPath).metadata();
  const rm = await sharp(rightPath).metadata();
  const height = Math.max(lm.height, rm.height);
  const width = lm.width + gutter + rm.width;
  await sharp({
    create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite([
      { input: leftPath, left: 0, top: 0 },
      { input: rightPath, left: lm.width + gutter, top: 0 },
    ])
    .png()
    .toFile(outPath);
}

// A realistic press release pasted into the import "From text" tab. Long enough
// to clear the 50-char extract gate and rich enough that the model resolves
// companies / assets / trials for the review screen.
const IMPORT_ARTICLE_TEXT = `Eli Lilly and Company today announced positive topline results from ATTAIN-1, a Phase 3 study evaluating orforglipron, an investigational once-daily oral GLP-1 receptor agonist, in adults with obesity or overweight. In ATTAIN-1 (NCT05869903), participants treated with orforglipron achieved a mean weight reduction of up to 12.4% at 72 weeks compared with placebo. The safety profile was consistent with the GLP-1 class, with gastrointestinal adverse events the most commonly reported. Lilly plans to submit orforglipron for regulatory approval in obesity by the end of the year, positioning it against injectable incretins including Novo Nordisk's Wegovy and Lilly's own Zepbound.`;

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

// Timeline -- scroll so ~2023 is the leftmost year (the dense, varied marker
// field from the reference cover shot) and hover a marker so its tooltip card
// shows. Default load auto-centers on "today" (~2025-2028), which hides the
// earlier marker clusters; we scroll left to surface them.
if (want('timeline')) {
  try {
    await page.goto(`${BASE}/timeline`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Compact trial rows: turn the per-space "intelligence headlines" pref OFF
    // so PI rows collapse to a single line. The PI bookmark flag still renders
    // on every trial that owns intelligence; dropping the headline line packs
    // more rows -- and thus more markers + flags -- into the captured frame.
    // Set before the grid hydrates its pref, then reload so it takes effect.
    await page
      .evaluate((sid) => {
        try {
          localStorage.setItem(`clint:pi-headlines:${sid}`, 'false');
        } catch {}
      }, SID)
      .catch(() => {});
    await page.reload({ waitUntil: 'domcontentloaded' });
    await settle(page, 2600);
    // Find the 2023 year header cell document-wide, then scroll ITS scrollable
    // ancestor so 2023 lands just past the frozen label columns. (Deriving the
    // container from the cell is more robust than guessing which .overflow-x-auto
    // wrapper holds the header.)
    const scrollOnce = (INSET) => {
      const cells = [...document.querySelectorAll('.grid-header-cell')];
      const y = cells.find((c) => /\b2023\b/.test(c.textContent || ''));
      if (!y) return { err: 'no 2023 cell', total: cells.length };
      let sc = y.parentElement;
      while (
        sc &&
        !(sc.scrollWidth > sc.clientWidth + 20 && /(auto|scroll)/.test(getComputedStyle(sc).overflowX))
      ) {
        sc = sc.parentElement;
      }
      if (!sc) return { err: 'no scrollable ancestor' };
      sc.scrollLeft += y.getBoundingClientRect().left - sc.getBoundingClientRect().left - INSET;
      return { ok: true, scrollLeft: Math.round(sc.scrollLeft) };
    };
    log('timeline scroll:', JSON.stringify(await page.evaluate(scrollOnce, 560)));
    await page.waitForTimeout(500);
    // Re-assert in case the grid's initial-scroll effect reset it.
    await page.evaluate(scrollOnce, 560).catch(() => {});
    await page.waitForTimeout(700);
    // Hover a representative marker to pop its tooltip card.
    const markers = page.locator('app-marker div[role="button"]');
    const n = await markers.count();
    if (n) {
      const target = markers.nth(Math.min(n - 1, Math.floor(n * 0.45)));
      await target.scrollIntoViewIfNeeded().catch(() => {});
      await target.hover({ force: true }).catch(() => {});
      await page.waitForSelector('app-marker-tooltip', { timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(700);
    }
    await shot(page, 'timeline.png');
  } catch (e) {
    log('FAILED timeline.png -', e.message);
  }
}

// Heatmap -- group by MOA, then open a group that owns published primary
// intelligence so the detail panel renders the "N of M assets have
// intelligence" PI section next to the in-cell PI bookmark flags.
if (want('heatmap')) {
  try {
    await page.goto(`${BASE}/heatmap/by-moa`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await settle(page, 2400);
    const piRow = page
      .locator('table.matrix tbody tr', { hasText: 'GLP-1 receptor agonist' })
      .first();
    if (await piRow.count()) {
      await piRow.click().catch(() => {});
      await page.waitForTimeout(1200);
    }
    await page.mouse.move(20, 8);
    await page.waitForTimeout(500);
    await shot(page, 'heatmap.png');
  } catch (e) {
    log('FAILED heatmap.png -', e.message);
  }
}
await go('/events?source=detected', 'activity.png');

// 4) Bullseye -- select an asset that owns published primary intelligence
// (CagriSema) so the asset panel shows its Intelligence section while the chart
// keeps its PI bookmark flags + activity rings. Fall back to a mid live dot.
if (want('bullseye')) {
  try {
    await page.goto(`${BASE}/bullseye`, { waitUntil: 'domcontentloaded' });
    await settle(page, 2600);
    const piDot = page.locator('circle.bullseye-dot[aria-label^="CagriSema"]').first();
    if (await piDot.count()) {
      await piDot.click({ force: true });
    } else {
      const dots = page.locator('circle.bullseye-dot:not(.bullseye-dot-faded)');
      const n = await dots.count();
      if (n) await dots.nth(Math.min(n - 1, Math.floor(n / 2))).click({ force: true });
    }
    await page.waitForTimeout(1200);
    await page.mouse.move(900, 8);
    await page.waitForTimeout(600);
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

// 6) Events -- select an event that belongs to a thread so the detail pane
//    renders the "Thread" section (the seeded "Pfizer oral GLP-1 retreat" thread
//    chains the danuglipron discontinuation -> R&D pivot events).
if (want('events')) {
  try {
    // Filter to source_type=event so the manual events (incl. the seeded
    // thread) sit on the first page instead of being buried under 2026 markers.
    await page.goto(`${BASE}/events?source=event`, { waitUntil: 'domcontentloaded' });
    await settle(page, 2400);
    // A threaded row carries a "Part of a thread" badge; click its row.
    const threadRow = page
      .locator('tbody tr', { has: page.locator('[aria-label="Part of a thread"]') })
      .first();
    if (await threadRow.count()) {
      await threadRow.click().catch(() => {});
    } else {
      log('  (no threaded event row found -- falling back to first row)');
      await page.locator('tbody tr').first().click().catch(() => {});
    }
    // Wait for the detail pane's Thread section to render.
    await page
      .getByText(/^Thread\b/i)
      .first()
      .waitFor({ timeout: 5000 })
      .catch(() => log('  (Thread section not detected in detail pane)'));
    await page.waitForTimeout(1000);
    await shot(page, 'events.png');
  } catch (e) {
    log('FAILED events.png -', e.message);
  }
}

// 7) Source import -- paste a real article into "From text", run extraction,
//    and capture BOTH the processing stepper and the resolved review (results)
//    screen, then compose them side by side. The import page is gated by
//    importGuard (owner/editor + tenant ai_enabled). Extraction logs an ai_call
//    and builds an in-memory proposal but commits NO entities (a separate step
//    on the review screen does that), so triggering it does not mutate the space.
if (want('source-import')) {
  try {
    await page.goto(`${BASE}/import`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await page.getByRole('tab', { name: /from text/i }).click().catch(() => {});
    await page.waitForTimeout(600);
    const box = page.getByLabel('Source text');
    if (await box.count()) {
      await box.click();
      await box.fill(IMPORT_ARTICLE_TEXT);
      await page.waitForTimeout(500);
      await page.getByRole('button', { name: /^extract$/i }).last().click().catch(() => {});
      // Processing stepper (Fetching / Extracting / Enriching).
      await page.waitForSelector('app-loader', { timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(1200);
      if (HIDE) await hideChrome(page);
      await page.screenshot({ path: resolve(OUT, 'source-import-processing.png') });
      log('wrote source-import-processing.png');
      // Results -- extraction resolves and navigates to the review screen.
      await page.waitForURL(/\/import\/[^/]+\/review/, { timeout: 60000 }).catch(() => {});
      await settle(page, 2800);
      if (HIDE) await hideChrome(page);
      await page.screenshot({ path: resolve(OUT, 'source-import-results.png') });
      log('wrote source-import-results.png');
      // Compose the two states side by side.
      await composeSideBySide(
        resolve(OUT, 'source-import-processing.png'),
        resolve(OUT, 'source-import-results.png'),
        resolve(OUT, 'source-import.png')
      );
      log('wrote source-import.png (composite)');
    } else {
      log('  (Source text input not found -- guard may have redirected; check ai_enabled + role)');
    }
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

// 9) Materials -- captured on a trial detail page (SUMMIT) so the deliverables
//    show in context in the entity's materials section, matching the deck's
//    "filed where the client looks / attach to the entities they cover" point.
//    (Handled below alongside the other trial-detail shots, since it needs the
//    NCT->trial resolver.)

// 10) Trial detail: two pinned trials, resolved by NCT so reseeds (which
//     regenerate UUIDs) keep working.
//       intelligence   -> ATTRibute-CM (NCT03860935): published intelligence +
//                         CT.gov-synced -> rich #primary-intelligence note.
//       trial-detail    -> REDEFINE-2 (NCT05394519): seeded trial-scoped events,
//                         referenced-in a published read, activity, markers ->
//                         every section of #markers and below is populated.
const ATTRIBUTE_CM_NCT = 'NCT03860935';
const REDEFINE_2_NCT = 'NCT05394519';
const MATERIALS_NCT = 'NCT04847557'; // SUMMIT -- a trial with several linked materials

async function resolveTrialIdByNct(nct) {
  await page.goto(`${BASE}/manage/trials`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 2200);
  const search = page.getByPlaceholder('Search trials...');
  if (await search.count()) {
    await search.fill(nct);
    await page.waitForTimeout(1200);
  }
  const clicked = await page.evaluate((wantNct) => {
    for (const tr of document.querySelectorAll('table tbody tr')) {
      if ((tr.textContent || '').includes(wantNct)) {
        const btn = tr.querySelector('button');
        if (btn) {
          btn.click();
          return true;
        }
      }
    }
    return false;
  }, nct);
  if (!clicked) return null;
  await page.waitForURL(/\/manage\/trials\/[0-9a-f-]{36}/, { timeout: 8000 }).catch(() => {});
  return (page.url().match(/\/manage\/trials\/([0-9a-f-]{36})/) || [])[1] || null;
}

// CT.gov sync for a trial via the trial-detail "Sync" button. The seed does not
// set ctgov fields, so right after a fresh reseed the CT.GOV DATA panel reads
// "Not yet synced" until this runs. Gated on SYNC=1.
async function syncTrialCtgov(trialId) {
  if (!trialId) return;
  await page.goto(`${BASE}/manage/trials/${trialId}`, { waitUntil: 'domcontentloaded' });
  await settle(page, 2000);
  const syncBtn = page.getByRole('button', { name: /^sync$/i });
  if (await syncBtn.count()) {
    await syncBtn.first().click().catch(() => {});
    await page.waitForTimeout(5000);
    log('  synced ctgov for', trialId);
  }
}

let intelTrialId = process.env['INTEL_TRIAL_ID'] || null;
let detailTrialId = process.env['DETAIL_TRIAL_ID'] || null;
if (want('intelligence') && !intelTrialId) {
  intelTrialId = await resolveTrialIdByNct(ATTRIBUTE_CM_NCT).catch(() => null);
}
if (want('trial-detail') && !detailTrialId) {
  detailTrialId = await resolveTrialIdByNct(REDEFINE_2_NCT).catch(() => null);
}
let materialsTrialId = process.env['MATERIALS_TRIAL_ID'] || null;
if (want('materials') && !materialsTrialId) {
  materialsTrialId = await resolveTrialIdByNct(MATERIALS_NCT).catch(() => null);
}
log('intel trial id:', intelTrialId, '| detail trial id:', detailTrialId, '| materials trial id:', materialsTrialId);

if (process.env['SYNC'] === '1') {
  await syncTrialCtgov(intelTrialId);
  await syncTrialCtgov(detailTrialId);
}

async function trialSection(name, anchor, trialId) {
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
await trialSection('intelligence.png', '#primary-intelligence', intelTrialId);
await trialSection('trial-detail.png', '#markers', detailTrialId);

// Materials -- an entity (SUMMIT trial) detail page, framed so the materials
// section's deliverable list AND its drag-and-drop upload zone are both in view
// (the drop zone lives beneath the list on entity pages, not on the library).
if (want('materials')) {
  if (!materialsTrialId) {
    log('skip materials.png (no trial)');
  } else {
    try {
      await page.goto(`${BASE}/manage/trials/${materialsTrialId}`, { waitUntil: 'domcontentloaded' });
      await settle(page, 2200);
      const drop = page.locator('app-material-upload-zone').first();
      if (await drop.count()) {
        await drop.evaluate((el) => el.scrollIntoView({ block: 'end' })).catch(() => {});
      } else {
        await page
          .locator('#materials')
          .first()
          .evaluate((el) => el.scrollIntoView({ block: 'start' }))
          .catch(() => log('  (materials anchor missing)'));
      }
      await page.waitForTimeout(800);
      await shot(page, 'materials.png');
    } catch (e) {
      log('FAILED materials.png -', e.message);
    }
  }
}

log('Done. Wrote shots to', OUT);
await ctx.close().catch(() => {});
process.exit(0);
