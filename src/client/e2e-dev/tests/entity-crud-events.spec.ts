/**
 * @crud @event -- entity write CRUD (assets, trials) + the merged Event form.
 *
 * Supersedes the e2e-dev/tests/event-form.spec.ts scaffold (delete that file).
 *
 * Covers, through the real browser against deployed dev (owner role):
 *   1. Asset create + edit (rename, set/extend MOA+ROA) via the dialog; persisted via apiAs.
 *   2. Trial create (phase + start/end) + edit; phase_type persisted; CT.gov-locked Phase
 *      field is read-only/disabled once phase_type_source='ctgov' (set via a harness helper
 *      because a synthetic NCT cannot reach the registry).
 *   3. Merged Event form: trial-detail \"Add event\" -> pick type/title/date/significance High
 *      -> Log event; assert events row via apiAs + the trial Events table. Then row-action EDIT
 *      -> merged \"Edit event\" dialog -> re-type + rename (keep trial anchor) -> Update event;
 *      assert event_type_id/title + a trial_change_events 'event_edited' Activity row. Then a
 *      final EDIT -> re-anchor Trial->Asset -> Update; assert anchor_type/anchor_id via apiAs.
 *
 * GROUNDING: every EVENT selector is grounded in origin/develop (the DEPLOYED cutover form),
 * not this working tree's pre-cutover event-form.component.ts. Asset/trial form templates are
 * byte-identical worktree<->develop except the Add buttons live in app-section-header on develop
 * (getByRole({name}) still matches). Citations are in the agent's selectorCitations output.
 */
import { test, expect, apiAs } from '../fixtures';
import type { Page, Locator } from '@playwright/test';
import { seedBasics } from '../helpers/seed';
import { lockTrialPhaseFromCtgov } from '../helpers/ctgov-lock';

test.use({ worldRoles: ['owner'] });

// ---- PrimeNG interaction helpers (overlays append to body, so options live on `page`) ----

/** Open a p-select by its inputId and click an option by visible text. */
async function pickSelect(
  page: Page,
  inputId: string,
  optionLabel: string | RegExp
): Promise<void> {
  // VERIFY: PrimeNG v21 sets inputId on the focusable element; clicking it opens the panel.
  // If a headed run shows it not opening, click the enclosing `.p-select` wrapper instead.
  await page.locator(`#${inputId}`).click();
  const listbox = page.getByRole('listbox');
  const filter = listbox.getByRole('searchbox');
  if (typeof optionLabel === 'string' && (await filter.count())) {
    await filter.first().fill(optionLabel);
  }
  await page.getByRole('option', { name: optionLabel }).first().click();
}

/** Type an ISO date into a p-datepicker input and dismiss the calendar overlay. */
async function fillDate(page: Page, inputId: string, iso: string): Promise<void> {
  const input = page.locator(`#${inputId}`);
  await input.click();
  await input.fill(iso);
  await page.keyboard.press('Escape'); // VERIFY: closes the p-datepicker overlay
}

/** Select an existing option in a taxonomy multiselect (app-taxonomy-multiselect -> p-multiselect).
 *  The inputId sits on the HIDDEN combobox input (data-pc-section="hiddeninput"), which is not
 *  clickable; click the visible p-multiselect HOST instead. */
async function pickMultiselect(page: Page, inputId: string, optionLabel: string): Promise<void> {
  const host = page
    .locator(`#${inputId}`)
    .locator('xpath=ancestor::*[contains(@class,"p-multiselect")][1]');
  await host.click();
  const panel = page.getByRole('listbox');
  const filter = panel.getByRole('searchbox');
  if (await filter.count()) await filter.first().fill(optionLabel);
  await page.getByRole('option', { name: optionLabel }).first().click();
  await page.keyboard.press('Escape');
  await page
    .locator('.p-multiselect-overlay')
    .waitFor({ state: 'detached' })
    .catch(() => {});
}

const sp = (t: string, s: string, sub: string): string => `/t/${t}/s/${s}${sub}`;

// SCAFFOLD (test.fixme): authored + selectors grounded in origin/develop, pending a headed
// verification pass. Remaining work: (1) PrimeNG datepicker (#create-phase-*) fill races the
// overlay re-render -- needs a stable typed-format or value-set approach; (2) the merged-form
// EDIT + re-anchor assertions (test 3, second half) call update_event, which is BROKEN on dev
// (omits required p_source_url -- tracked in rpc-contract KNOWN_DIVERGENCES); those flip green
// only once the update_event signature fix deploys. The multiselect host-click + create paths
// (asset/trial/event create) are the parts ready to verify first.
test.describe.fixme('@crud @event entity write CRUD + merged event form', () => {
  // ----------------------------------------------------------------------------------------
  // 1. ASSET create + edit
  // ----------------------------------------------------------------------------------------
  test('owner creates then edits an asset (rename + MOA/ROA) via the dialog', async ({
    world,
    pageAs,
    gotoSettled,
  }) => {
    test.slow();
    const seed = await seedBasics(world); // company + an existing MOA/ROA taxonomy in the space
    const owner = apiAs(world, 'owner');
    const page = await pageAs('owner');
    await gotoSettled(page, sp(world.tenantId, world.spaceId, '/profiles/assets'));

    const name = `Spec Asset ${world.id}`;
    const renamed = `${name} v2`;

    // --- create ---
    await page.getByRole('button', { name: /add asset/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.locator('#asset-name').fill(name);
    await pickSelect(page, 'asset-company', new RegExp(seed.companyName));
    // seedBasics seeded the MOA 'GLP-1 receptor agonist' in this space, so it's an option.
    await pickMultiselect(page, 'asset-moas', 'GLP-1 receptor agonist');
    await dialog.getByRole('button', { name: /create asset/i }).click();

    await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible();

    // persisted via apiAs (assets table is space-scoped)
    const created = await owner
      .from('assets')
      .select('id, name, company_id')
      .eq('space_id', world.spaceId)
      .eq('name', name)
      .single();
    expect(created.error).toBeNull();
    expect(created.data?.company_id).toBe(seed.companyId);
    const assetId = created.data!.id as string;

    // --- edit: rename + add a ROA (existing taxonomy 'Subcutaneous' from seedBasics) ---
    const row = page.getByRole('row', { name: new RegExp(name) });
    await row.getByRole('button', { name: new RegExp(`Actions for ${name}`) }).click();
    await page.getByRole('menuitem', { name: /^Edit$/ }).click();
    const editDialog = page.getByRole('dialog');
    await expect(editDialog).toBeVisible();
    await page.locator('#asset-name').fill(renamed);
    await pickMultiselect(page, 'asset-roas', 'Subcutaneous');
    await editDialog.getByRole('button', { name: /update asset/i }).click();

    await expect(page.getByRole('row', { name: new RegExp(renamed) })).toBeVisible();

    // rename persisted
    const after = await owner.from('assets').select('name').eq('id', assetId).single();
    expect(after.data?.name).toBe(renamed);
    // ROA chip shows in the row (asset-list ROA column renders routes_of_administration)
    await expect(
      page.getByRole('row', { name: new RegExp(renamed) }).getByText('Subcutaneous')
    ).toBeVisible(); // VERIFY: ROA chip text casing in the live row
  });

  // ----------------------------------------------------------------------------------------
  // 2. TRIAL create + edit, incl. CT.gov phase lock
  // ----------------------------------------------------------------------------------------
  test('owner creates a Phase 3 trial, edits it, and CT.gov-locked phase is read-only', async ({
    world,
    pageAs,
    gotoSettled,
  }) => {
    test.slow();
    const seed = await seedBasics(world); // gives an asset to attach the new trial to
    const owner = apiAs(world, 'owner');
    const page = await pageAs('owner');
    await gotoSettled(page, sp(world.tenantId, world.spaceId, '/profiles/trials'));

    const trialName = `Spec Trial ${world.id}`;

    // --- create (New trial dialog) ---
    await page.getByRole('button', { name: /add trial/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.locator('#trial-name').fill(trialName);
    await pickSelect(page, 'trial-product', new RegExp(seed.assetName));
    await pickSelect(page, 'create-phase-type', 'Phase 3'); // optionValue 'P3'
    await fillDate(page, 'create-phase-start', '2025-02-01');
    await fillDate(page, 'create-phase-end', '2027-02-01');
    await dialog.getByRole('button', { name: /^Create$/ }).click();

    await expect(page.getByRole('row', { name: new RegExp(trialName) })).toBeVisible();

    // phase_type persisted = 'P3'
    const created = await owner
      .from('trials')
      .select('id, name, phase_type')
      .eq('space_id', world.spaceId)
      .eq('name', trialName)
      .single();
    expect(created.error).toBeNull();
    expect(created.data?.phase_type).toBe('P3');
    const trialId = created.data!.id as string;

    // --- edit (rename via trial detail "Edit details") ---
    await gotoSettled(page, sp(world.tenantId, world.spaceId, `/profiles/trials/${trialId}`));
    await page.getByRole('button', { name: /trial actions/i }).click();
    await page.getByRole('menuitem', { name: /edit details/i }).click();
    const editDialog = page.getByRole('dialog', { name: /edit trial details/i });
    await expect(editDialog).toBeVisible();
    const renamed = `${trialName} v2`;
    await page.locator('#trial-form-name').fill(renamed);
    await editDialog.getByRole('button', { name: /^Save$/ }).click();

    const afterEdit = await owner.from('trials').select('name').eq('id', trialId).single();
    expect(afterEdit.data?.name).toBe(renamed);

    // --- CT.gov phase lock: force phase_type_source='ctgov' (no real registry sync possible) ---
    await lockTrialPhaseFromCtgov(trialId, 'P3');
    await gotoSettled(page, sp(world.tenantId, world.spaceId, `/profiles/trials/${trialId}`));
    await page.getByRole('button', { name: /trial actions/i }).click();
    await page.getByRole('menuitem', { name: /edit details/i }).click();
    const lockedDialog = page.getByRole('dialog', { name: /edit trial details/i });
    await expect(lockedDialog).toBeVisible();
    // Phase select is disabled when phaseTypeLocked() (trial-edit-form: [disabled]="phaseTypeLocked()||disabled()")
    await expect(lockedDialog.locator('#trial-form-phase-type')).toBeDisabled(); // VERIFY: p-select disabled maps to aria-disabled / pointer-events; may need [aria-disabled]
    // and a 'ct.gov' provenance badge is shown next to the field label
    await expect(lockedDialog.getByText(/ct\.gov/i).first()).toBeVisible();
  });

  // ----------------------------------------------------------------------------------------
  // 3. MERGED EVENT FORM: create on trial detail, re-type+rename, re-anchor trial->asset
  // ----------------------------------------------------------------------------------------
  test('owner logs an event on a trial, re-types+renames it, then re-anchors it to the asset', async ({
    world,
    pageAs,
    gotoSettled,
  }) => {
    test.slow();
    const seed = await seedBasics(world);
    const owner = apiAs(world, 'owner');

    // two distinct system event types to drive type pick + re-type
    const typesRes = await owner
      .from('event_types')
      .select('id, name')
      .eq('is_system', true)
      .order('name');
    expect(typesRes.error).toBeNull();
    const types = (typesRes.data ?? []) as { id: string; name: string }[];
    expect(types.length).toBeGreaterThanOrEqual(2);
    const typeA = types[0];
    const typeB = types.find((t) => t.id !== typeA.id)!;

    const page = await pageAs('owner');
    await gotoSettled(page, sp(world.tenantId, world.spaceId, `/profiles/trials/${seed.trialId}`));

    const title = `Spec Event ${world.id}`;
    const renamed = `${title} v2`;

    // --- create via the merged "Log event" dialog (anchor pre-filled to this trial) ---
    await page.getByRole('button', { name: /add event/i }).click();
    const dialog = page.getByRole('dialog', { name: /log event/i });
    await expect(dialog).toBeVisible();
    await pickSelect(page, 'ev-type', new RegExp(typeA.name));
    await page.locator('#ev-title').fill(title);
    await fillDate(page, 'ev-date', '2025-06-01'); // datePrecision defaults to 'exact'
    // significance lives under the advanced disclosure
    await dialog.getByRole('button', { name: /show advanced/i }).click();
    await dialog.getByRole('button', { name: /^High$/ }).click(); // p-selectButton choice -> stored 'high'  // VERIFY: selectButton option role
    await dialog.getByRole('button', { name: /^Log event$/ }).click();

    // persisted via apiAs: anchored to the trial, significance high, type A
    let ev = await owner
      .from('events')
      .select('id, title, anchor_type, anchor_id, significance, event_type_id')
      .eq('space_id', world.spaceId)
      .eq('title', title)
      .single();
    expect(ev.error).toBeNull();
    expect(ev.data?.anchor_type).toBe('trial');
    expect(ev.data?.anchor_id).toBe(seed.trialId);
    expect(ev.data?.significance).toBe('high');
    expect(ev.data?.event_type_id).toBe(typeA.id);
    const eventId = ev.data!.id as string;

    // appears in the trial-detail Events table (value = t.markers, includes events)
    await gotoSettled(page, sp(world.tenantId, world.spaceId, `/profiles/trials/${seed.trialId}`));
    await expect(page.getByRole('row', { name: new RegExp(title) })).toBeVisible();
    // VERIFY (soft): the new glyph should also render on the trial timeline section.
    // Grounding for a timeline-glyph selector was not established; apiAs + the Events
    // table row above are the load-bearing assertions.

    // --- edit #1: re-type to typeB + rename, KEEP the trial anchor (so Activity emits) ---
    const evRow = page.getByRole('row', { name: new RegExp(title) });
    await evRow.getByRole('button', { name: new RegExp(`Actions for event ${title}`) }).click();
    await page.getByRole('menuitem', { name: /^Edit$/ }).click();
    const editDialog = page.getByRole('dialog', { name: /edit event/i });
    await expect(editDialog).toBeVisible();
    await pickSelect(page, 'ev-type', new RegExp(typeB.name));
    await page.locator('#ev-title').fill(renamed);
    await editDialog.getByRole('button', { name: /^Update event$/ }).click();

    ev = await owner
      .from('events')
      .select('id, title, anchor_type, anchor_id, event_type_id')
      .eq('id', eventId)
      .single();
    expect(ev.data?.title).toBe(renamed);
    expect(ev.data?.event_type_id).toBe(typeB.id);
    expect(ev.data?.anchor_type).toBe('trial');

    // an 'event_edited' Activity row is emitted because title changed while trial-anchored
    // (migration 20260629030000: trial_change_events; re-anchor OFF a trial emits NONE).
    const acts = await owner
      .from('trial_change_events')
      .select('event_type, event_id')
      .eq('event_id', eventId);
    expect(acts.error).toBeNull();
    expect((acts.data ?? []).some((a) => a.event_type === 'event_edited')).toBe(true);

    // --- edit #2: re-anchor Trial -> Asset (asserted via apiAs only; no Activity expected) ---
    await gotoSettled(page, sp(world.tenantId, world.spaceId, `/profiles/trials/${seed.trialId}`));
    const evRow2 = page.getByRole('row', { name: new RegExp(renamed) });
    await evRow2.getByRole('button', { name: new RegExp(`Actions for event ${renamed}`) }).click();
    await page.getByRole('menuitem', { name: /^Edit$/ }).click();
    const reanchorDialog = page.getByRole('dialog', { name: /edit event/i });
    await expect(reanchorDialog).toBeVisible();
    // In edit mode the Level + entity selects render directly (anchor not pre-filled).
    await pickSelect(page, 'ev-level', /^Asset$/);
    await pickSelect(page, 'ev-entity', new RegExp(seed.assetName));
    await reanchorDialog.getByRole('button', { name: /^Update event$/ }).click();

    ev = await owner.from('events').select('anchor_type, anchor_id').eq('id', eventId).single();
    expect(ev.data?.anchor_type).toBe('asset');
    expect(ev.data?.anchor_id).toBe(seed.assetId);
  });
});
