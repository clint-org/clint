/**
 * AI import (source-import) end-to-end against deployed dev. LIVE EXTERNAL: every
 * test in here spends a real Anthropic extraction call (and test 1 also hits
 * ClinicalTrials.gov), so they are tagged @external, run HEADED, and use generous
 * timeouts. They supersede the AI-import test.fixme in external-services.spec.ts.
 *
 * Gating: AI import is gated by the scratch tenant's ai_config.ai_enabled. The
 * importGuard requires owner/editor role AND ai_enabled, else /import bounces to
 * the space dashboard (src/app/core/guards/import.guard.ts:33-62). ai_config is
 * keyed by tenant_id (supabase/migrations/20260526100000_create_ai_config.sql:7-8),
 * so enableAi(world) flips world.tenantId. The row cascades away with the tenant
 * on world.cleanup(), so no extra teardown is needed.
 *
 * Assertions are made via apiAs (owner bearer -> PostgREST) against the real
 * events/trials/companies/assets tables (all authenticated-SELECT in
 * supabase/data-api-grants.json), not just the UI, so a green render never masks
 * a missing write.
 *
 * Sources: docs/notes/import-dedup-test-plan.md (Text A/B verbatim, count deltas),
 * import-page.component.ts / nct-input.component.ts / review-page.component.ts.
 */
import { test, expect, apiAs, dismissEnvBadge } from '../fixtures';
import { enableAi } from '../helpers/ai-config';
import type { ScratchWorld } from '../fixtures';

// A real, stable Phase 3 trial used across the dedup test plan (VANQUISH-1).
const PINNED_NCT = 'NCT04184622';

// Press releases lifted verbatim from docs/notes/import-dedup-test-plan.md.
// Text A and Text B describe the SAME three dated milestones (12 Mar 2025 topline,
// Q3 2025 NDA, 3 Nov 2025 ObesityWeek) in different words -> the dedup matcher must
// recognise B's milestones as existing and add zero events on re-import.
const TEXT_A = `Viking Therapeutics today announced positive topline results from VANQUISH-1, a Phase 3
study (NCT04184622) evaluating VK2735, an investigational dual GIP/GLP-1 receptor agonist,
in adults with obesity. On March 12, 2025, the company reported that patients receiving
VK2735 achieved a mean weight reduction of 14.7% at 52 weeks versus placebo. Viking plans
to submit a New Drug Application to the FDA in the third quarter of 2025, and full results
will be presented at ObesityWeek 2025 on November 3, 2025.`;

const TEXT_B = `Viking Therapeutics has shared encouraging late-stage data from its VANQUISH-1 trial
(NCT04184622), a pivotal Phase 3 program testing VK2735 — a dual GIP and GLP-1 receptor
agonist — in people living with obesity. The readout, disclosed on 12 March 2025, showed
participants on VK2735 lost an average of 14.7 percent of body weight by week 52 relative to
placebo. The company intends to file its New Drug Application with the U.S. FDA during the
third quarter of 2025, with the complete dataset slated for ObesityWeek 2025 on 3 November 2025.`;

// ---------------------------------------------------------------------------
// apiAs probes: count rows the import actually wrote (ground truth, not the UI).
// ---------------------------------------------------------------------------
async function countRows(
  world: ScratchWorld,
  table: 'events' | 'trials' | 'companies' | 'assets'
): Promise<number> {
  const api = apiAs(world, 'owner');
  const { count, error } = await api
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('space_id', world.spaceId);
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return count ?? 0;
}

// ct.gov-derived clinical events arrive via the fire-and-forget background sync
// (review-page.component.ts:1290 triggerSingleTrialSync), not the commit txn, so
// poll rather than assert once.
async function pollEventCount(
  world: ScratchWorld,
  atLeast: number,
  timeoutMs: number
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let last = 0;
  while (Date.now() < deadline) {
    last = await countRows(world, 'events');
    if (last >= atLeast) return last;
    await new Promise((r) => setTimeout(r, 4000));
  }
  return last;
}

const pathFor = (world: ScratchWorld, sub: string): string =>
  `/t/${world.tenantId}/s/${world.spaceId}${sub}`;

const REVIEW_URL = /\/import\/[0-9a-fA-F-]+\/review/;

// SCAFFOLD (test.fixme): authored + grounded; pending a headed verification pass that spends
// real Anthropic + ct.gov calls. Harness ready (enableAi flips ai_config.ai_enabled on the
// scratch tenant). Verify the NCT happy path + dedup count-deltas headed before enabling.
test.describe('@external AI import (source-import)', () => {
  // Live Anthropic + ct.gov: extractions run 20-90s; allow plenty of headroom.
  test.setTimeout(300_000);

  test('NCT happy path: resolve -> review -> commit creates company/asset/trial', async ({
    world,
    pageAs,
    gotoSettled,
  }) => {
    await enableAi(world);

    const page = await pageAs('owner');
    await gotoSettled(page, pathFor(world, '/import'));

    // Default tab is NCT list (import-page.component.ts:113). Paste a real NCT and
    // resolve. Textarea aria-label "NCT IDs" (nct-input.component.ts:80); submit
    // button label "Fetch and resolve (...)" (nct-input.component.ts:233-237,149).
    await page.getByLabel('NCT IDs').fill(PINNED_NCT);
    await page.getByRole('button', { name: /Fetch and resolve/ }).click();

    // ct.gov fetch + AI resolve, then a ~1s auto-nav to the review page.
    await page.waitForURL(REVIEW_URL, { timeout: 180_000 });

    // Review header (review-page.component.ts:141) + the resolved trial appears.
    await expect(page.getByRole('heading', { name: 'Review import proposals' })).toBeVisible();
    await expect(page.getByText(PINNED_NCT, { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });

    // Fresh space -> everything is new; Confirm N items (review-page.component.ts:597).
    // The dev env badge (fixed bottom-right) overlaps the Confirm button; clear it first.
    await dismissEnvBadge(page);
    const confirm = page.getByRole('button', { name: /^Confirm \d+ items$/ });
    await expect(confirm).toBeEnabled({ timeout: 30_000 });
    await confirm.click();

    // Commit navigates back to the space dashboard.
    await page.waitForURL((u) => /\/t\/[^/]+\/s\/[^/]+$/.test(u.pathname), { timeout: 60_000 });

    // Deterministic: commit created the company/asset/trial synchronously.
    expect(await countRows(world, 'trials')).toBeGreaterThanOrEqual(1);
    expect(await countRows(world, 'companies')).toBeGreaterThanOrEqual(1);
    expect(await countRows(world, 'assets')).toBeGreaterThanOrEqual(1);

    // The pinned NCT landed as a trial identifier (nct-input dedup reads this col).
    const api = apiAs(world, 'owner');
    const { data: trials, error } = await api
      .from('trials')
      .select('identifier')
      .eq('space_id', world.spaceId);
    expect(error).toBeNull();
    expect((trials ?? []).some((t) => t.identifier === PINNED_NCT)).toBe(true);

    // VERIFY (async): clinical events come from the background ct.gov sync, not the
    // commit txn, so this is a poll. If it is consistently 0 the sync worker may be
    // slow/disabled on dev for scratch tenants -- see open questions, not a UI bug.
    const events = await pollEventCount(world, 1, 120_000);
    expect(
      events,
      'expected >=1 ct.gov clinical event after background sync'
    ).toBeGreaterThanOrEqual(1);
  });

  test('dedup: re-importing the same milestones (reworded) creates no duplicate events', async ({
    world,
    pageAs,
    gotoSettled,
  }) => {
    await enableAi(world);
    const page = await pageAs('owner');

    // --- Commit Text A (press release -> dated milestones become events) ---
    await gotoSettled(page, pathFor(world, '/import'));
    await importFromText(page, TEXT_A);
    await page.waitForURL(REVIEW_URL, { timeout: 180_000 });
    await expect(page.getByRole('heading', { name: 'Review import proposals' })).toBeVisible();

    await dismissEnvBadge(page); // badge overlaps the bottom-right Confirm button
    const confirmA = page.getByRole('button', { name: /^Confirm \d+ items$/ });
    await expect(confirmA).toBeEnabled({ timeout: 30_000 });
    await confirmA.click();
    await page.waitForURL((u) => /\/t\/[^/]+\/s\/[^/]+$/.test(u.pathname), { timeout: 60_000 });

    // Text imports extract dated milestones synchronously, so events exist now.
    const baseline = await countRows(world, 'events');
    expect(baseline, 'Text A should have created at least one event').toBeGreaterThanOrEqual(1);

    // --- Re-import Text B: reworded, SAME milestones -> matcher dedups them ---
    await gotoSettled(page, pathFor(world, '/import'));
    await importFromText(page, TEXT_B);
    await page.waitForURL(REVIEW_URL, { timeout: 180_000 });
    await expect(page.getByRole('heading', { name: 'Review import proposals' })).toBeVisible();

    // Matched milestone leaf rows carry an "existing" meta tag
    // (review-page.component.ts:355) and matched entity rows an "existing" badge
    // (review-page.component.ts:376); both are unchecked by default.
    // VERIFY: the exact rendered text/casing of the badge under headed run.
    await expect(page.getByText('existing', { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });

    // Commit whatever the review allows (often 0 new leaf items; trial/asset already
    // exist). If the source hash differed enough to proceed, that's fine -- the
    // ground-truth assertion below is the per-item event count, not the toast.
    await dismissEnvBadge(page); // badge overlaps the bottom-right Confirm button
    const confirmB = page.getByRole('button', { name: /^Confirm \d+ items$/ });
    if (await confirmB.isEnabled().catch(() => false)) {
      await confirmB.click();
      await page
        .waitForURL((u) => /\/t\/[^/]+\/s\/[^/]+$/.test(u.pathname), { timeout: 60_000 })
        .catch(() => {});
    }

    // Core dedup contract. The matcher must not create a SECOND event for a milestone
    // that already exists. We do NOT assert a fixed count delta: LLM extraction is
    // non-deterministic in HOW MANY of the three milestones it pulls from each phrasing
    // (an observed run had Text A yield 2 of 3 and Text B contribute the 3rd, which the
    // matcher correctly added once while deduping the two A already had). The invariant
    // that actually encodes "no duplicate milestone" is: every event sits on a distinct
    // milestone date -- the three press-release milestones (12 Mar topline, Q3 NDA,
    // 3 Nov ObesityWeek) all carry distinct dates, so a dedup failure would re-add one of
    // them and surface as a repeated date.
    const api = apiAs(world, 'owner');
    const { data: evRows, error: evErr } = await api
      .from('events')
      .select('event_date')
      .eq('space_id', world.spaceId);
    expect(evErr, evErr?.message).toBeNull();
    const dates = (evRows ?? []).map((e) => e.event_date as string);
    const uniqueDates = new Set(dates);
    expect(
      uniqueDates.size,
      `reworded re-import must not duplicate an existing milestone date (dates=${JSON.stringify(dates)})`
    ).toBe(dates.length);
    // Sanity: the union never falls below what Text A established, and never exceeds the
    // three milestones the press releases describe (a fully-broken dedup re-adding A's
    // milestones would overshoot this bound).
    expect(dates.length).toBeGreaterThanOrEqual(baseline);
    expect(dates.length).toBeLessThanOrEqual(3);
  });

  test('extraction entry points: From text extracts; From URL exposes its controls', async ({
    world,
    pageAs,
    gotoSettled,
  }) => {
    await enableAi(world);
    const page = await pageAs('owner');
    await gotoSettled(page, pathFor(world, '/import'));

    // --- From URL: control surface only (a live URL fetch is fragile; no AI spend) ---
    // Tab labels: "From URL" / "From text" (import-page.component.ts:114-115).
    await page.getByRole('tab', { name: 'From URL' }).click();
    const urlInput = page.getByLabel('Source URL'); // import-page.component.ts:135
    await expect(urlInput).toBeVisible();
    // Extract is disabled until a valid URL is entered (canExtractUrl, :213).
    await urlInput.fill('not-a-url');
    await expect(activeExtractButton(page)).toBeDisabled();
    await urlInput.fill('https://www.example.com/press-release');
    await expect(activeExtractButton(page)).toBeEnabled();

    // --- From text: full live extraction -> review ---
    await page.getByRole('tab', { name: 'From text' }).click();
    await importFromText(page, TEXT_A);
    await page.waitForURL(REVIEW_URL, { timeout: 180_000 });
    await expect(page.getByRole('heading', { name: 'Review import proposals' })).toBeVisible();

    // Non-NCT (text) import renders the two-pane layout with the Source text pane
    // (review-page.component.ts:191-203). The entity grid should list the company.
    await expect(page.getByText('Viking', { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});

// ---------------------------------------------------------------------------
// Local helpers (kept in-spec; promote to e2e-dev/helpers if reused elsewhere).
// ---------------------------------------------------------------------------

/**
 * Drive the "From text" tab: select it, fill the Source text textarea
 * (aria-label "Source text", import-page.component.ts:230), click that panel's
 * Extract button (import-page.component.ts:299). Does NOT wait for navigation.
 */
async function importFromText(page: import('@playwright/test').Page, text: string): Promise<void> {
  await page.getByRole('tab', { name: 'From text' }).click();
  const textarea = page.getByLabel('Source text');
  await expect(textarea).toBeVisible();
  await textarea.fill(text);
  await activeExtractButton(page).click();
}

/**
 * The Extract button belongs to BOTH the URL and text tab panels, so scope to the
 * currently visible tabpanel. VERIFY: PrimeNG v21 Tabs render role="tabpanel" and
 * hide inactive panels; if getByRole('tabpanel') matches more than one, switch to
 * scoping by the visible textarea/input's nearest panel in a headed pass.
 */
function activeExtractButton(page: import('@playwright/test').Page) {
  return page.getByRole('tabpanel').getByRole('button', { name: 'Extract', exact: true });
}
