/**
 * Intelligence brief authoring + citation resolution + feed filters.
 *
 * Covers acceptance matrix row 6 (docs/notes/event-model-qa-coverage.md:29) and
 * the Intelligence Feed PUBLISHED/DRAFTS/ENTITY/SINCE filters
 * (docs/notes/event-model-qa-coverage.md:50).
 *
 * Authoring is done through the real anchor-aware RPC `upsert_primary_intelligence`
 * (supabase/migrations/20260627130100_intelligence_upsert_anchor_aware.sql) rather
 * than the heavy compose drawer; feed rendering, filters, and citation resolution
 * are asserted through the live UI.
 *
 * IMPORTANT (RLS): draft primary_intelligence rows are readable ONLY to agency
 * members (policy `primary_intelligence drafts readable to agency`,
 * supabase/migrations/20260501113857_primary_intelligence.sql:186). The scratch
 * `owner` is a space owner, not an agency member -- it can author a draft but not
 * read it back -- so grantAgencyMembership() promotes it to an agency member.
 */
import { test, expect, createScratchWorld, openAs, settle, type ScratchWorld } from '../fixtures';
import { seedBasics, type SeedIds } from '../helpers/seed';
import { authorBrief, grantAgencyMembership, setBriefUpdatedAt } from '../helpers/intelligence';

test.describe.configure({ mode: 'serial' });

test.describe('@intelligence brief authoring + citation + feed filters', () => {
  let world: ScratchWorld;
  let seed: SeedIds;

  // Unique, searchable headlines so getByText/getByRole('link') are unambiguous.
  let trialHeadline = '';
  let companyHeadline = '';
  let draftHeadline = '';

  const path = (sub: string) => `/t/${world.tenantId}/s/${world.spaceId}${sub}`;
  const CITED_EVENT_TITLE = 'Topline readout'; // seeded by seedBasics (helpers/seed.ts:80)

  test.beforeAll(async () => {
    world = await createScratchWorld(); // default roles: ['owner']
    seed = await seedBasics(world); // company -> asset -> P3 trial -> 'Topline readout' event

    // owner must be an agency member to READ drafts back (RLS); authoring alone
    // is allowed to a space owner, but the DRAFTS tab uses a SECURITY INVOKER
    // RPC and the draft SELECT policy is agency-only.
    await grantAgencyMembership(world, 'owner');

    trialHeadline = `Topline beats endpoint ${world.id}`;
    companyHeadline = `Pipeline reshaped ${world.id}`;
    draftHeadline = `Working thesis ${world.id}`;

    // 1. published brief anchored to the seeded trial (this is the 'brief citing
    //    the topline event' -- the trial owns the cited event).
    await authorBrief(world, {
      entityType: 'trial',
      entityId: seed.trialId,
      headline: trialHeadline,
      summaryMd: 'Primary endpoint met with a clear separation from comparator.',
      state: 'published',
    });

    // 2. published brief anchored to the seeded company, backdated 60 days so the
    //    SINCE filter has something to exclude.
    const companyBriefId = await authorBrief(world, {
      entityType: 'company',
      entityId: seed.companyId,
      headline: companyHeadline,
      summaryMd: 'Portfolio re-prioritized around the late-stage obesity asset.',
      state: 'published',
    });
    await setBriefUpdatedAt(world, companyBriefId, 60);

    // 3. draft brief anchored to the trial (DRAFTS tab only).
    await authorBrief(world, {
      entityType: 'trial',
      entityId: seed.trialId,
      headline: draftHeadline,
      summaryMd: 'Unpublished read still under review.',
      state: 'draft',
    });
  });

  test.afterAll(async () => {
    await world?.cleanup();
  });

  // 1. PUBLISHED shows published briefs, hides the draft; DRAFTS is the inverse.
  test('published brief shows in feed (PUBLISHED) and not DRAFTS; draft is inverse', async ({
    browser,
  }) => {
    const { page, context } = await openAs(browser, world, 'owner');

    // PUBLISHED (default status)
    await settle(page, path('/intelligence'));
    await expect(page.getByText(trialHeadline)).toBeVisible();
    await expect(page.getByText(companyHeadline)).toBeVisible();
    await expect(page.getByText(draftHeadline)).toHaveCount(0);

    // Toggle to DRAFTS via the status selectbutton control.
    // intelligence-browse.component.ts:97-98 role="toolbar" aria-label="Intelligence filters"
    // intelligence-browse.component.ts:106-115 p-selectbutton aria-label="Filter by status"
    const toolbar = page.getByRole('toolbar', { name: 'Intelligence filters' });
    // VERIFY: exact PrimeNG 21 p-selectbutton option DOM unconfirmed (option may be
    // a button/div with role). Fallback if click is flaky: settle(page, '/intelligence?status=drafts').
    await toolbar.getByText('Drafts', { exact: true }).click();

    // onStatusChange writes ?status=drafts (intelligence-browse.component.ts:344) -- durable signal.
    await expect(page).toHaveURL(/status=drafts/);
    await expect(page.getByText(draftHeadline)).toBeVisible();
    await expect(page.getByText(trialHeadline)).toHaveCount(0);
    await expect(page.getByText(companyHeadline)).toHaveCount(0);

    await context.close();
  });

  // 2. Matrix row 6: open the published brief -> click citation -> trial detail
  //    showing the cited topline event.
  test('published brief citation resolves to trial detail with the cited event', async ({
    browser,
  }) => {
    const { page, context } = await openAs(browser, world, 'owner');
    await settle(page, path('/intelligence'));

    // Feed-row headline is the click target / citation link.
    // intelligence-feed.component.ts:56-60 <a [routerLink]="entityRouterLink(row)"> ... [innerHTML]="headline(row)"
    const citation = page.getByRole('link', { name: trialHeadline });
    await expect(citation).toBeVisible();
    await citation.click();
    await page.waitForLoadState('networkidle').catch(() => {});

    // buildEntityRouterLink -> /t/:tenant/s/:space/profiles/trials/:id
    // (intelligence-router-link.ts:23-24; route app.routes.ts:400)
    await expect(page).toHaveURL(new RegExp(`/profiles/trials/${seed.trialId}`));
    // trial name appears in both the page <h1> and a "Recent" nav chip -> scope to the heading.
    await expect(page.getByRole('heading', { name: seed.trialName })).toBeVisible();

    // The cited 'Topline readout' event renders in the trial detail Events section.
    // entity-events-panel.component.html:32 {{ row.title }}
    // VERIFY: confirm the Events panel auto-loads the seeded event without interaction.
    await expect(page.getByText(CITED_EVENT_TITLE)).toBeVisible({ timeout: 10_000 });

    await context.close();
  });

  // 3a. ENTITY filter narrows the published list (Trial only).
  test('ENTITY filter narrows the feed to the selected entity type', async ({ browser }) => {
    const { page, context } = await openAs(browser, world, 'owner');
    await settle(page, path('/intelligence'));

    // both visible before filtering
    await expect(page.getByText(trialHeadline)).toBeVisible();
    await expect(page.getByText(companyHeadline)).toBeVisible();

    // Entity multiselect (intelligence-browse.component.ts: <p-multi-select>
    // ariaLabel "Filter by entity type", optionLabel "label", appendTo body). The
    // accessible combobox is a hidden inner node, so click the p-multi-select HOST
    // (which carries the open handler), then pick the option from the body panel.
    const entityMs = page
      .locator('p-multi-select')
      .filter({ has: page.getByRole('combobox', { name: 'Filter by entity type' }) });
    await entityMs.click();
    await page.getByRole('option', { name: 'Trial', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.waitForLoadState('networkidle').catch(() => {});

    await expect(page.getByText(trialHeadline)).toBeVisible();
    await expect(page.getByText(companyHeadline)).toHaveCount(0);

    await context.close();
  });

  // 3b. SINCE filter narrows the published list. Driven via the documented
  //     `since=Nd` deep-link, which sets the same `since` signal the datepicker
  //     binds to (intelligence-browse.component.ts:328-337 reads queryParam;
  //     datepicker control at intelligence-browse.component.ts:149-158).
  test('SINCE filter excludes briefs older than the window', async ({ browser }) => {
    const { page, context } = await openAs(browser, world, 'owner');
    // since=7d -> recent trial brief stays, 60-day-old company brief is excluded.
    await settle(page, path('/intelligence?since=7d'));

    await expect(page.getByText(trialHeadline)).toBeVisible();
    await expect(page.getByText(companyHeadline)).toHaveCount(0);

    await context.close();
  });
});
