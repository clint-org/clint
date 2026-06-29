/**
 * @crud @event -- entity write CRUD (assets, trials) + the merged Event form.
 *
 * Supersedes the e2e-dev/tests/event-form.spec.ts scaffold (delete that file).
 *
 * Covers, through the real browser against deployed dev (owner role):
 *   1. Asset create (name + company) + rename via the dialog; persisted via apiAs.
 *   2. Trial create (name + asset + phase) + rename via "Edit trial details"; assert
 *      phase_type='P3' persisted, then force phase_type_source='ctgov' and assert the Phase
 *      select is disabled + the 'ct.gov' provenance badge shows. (Phase start/end dates are
 *      optional and not set -- the PrimeNG datepicker model isn't driven by a plain fill().)
 *   3. Merged Event form EDIT -- the update_event regression guard. Seed the event via apiAs,
 *      then row-action EDIT -> merged "Edit event" dialog -> rename (keep trial anchor) ->
 *      Update event; assert the title persisted (update_event resolved through the real client
 *      named-arg path -- it PGRST202'd until p_source_url was dropped) + a trial_change_events
 *      'event_edited' Activity row.
 *   4. Same dialog, re-anchor Trial -> Asset via the Level + entity p-selects (QA-004); assert
 *      anchor_type/anchor_id moved via apiAs. Also through update_event.
 *
 * GROUNDING: every EVENT selector is grounded in origin/develop (the DEPLOYED cutover form),
 * not this working tree's pre-cutover event-form.component.ts. Asset/trial form templates are
 * byte-identical worktree<->develop except the Add buttons live in app-section-header on develop
 * (getByRole({name}) still matches). Citations are in the agent's selectorCitations output.
 */
import { test, expect, apiAs } from '../fixtures';
import type { Page } from '@playwright/test';
import { seedBasics } from '../helpers/seed';
import { lockTrialPhaseFromCtgov } from '../helpers/ctgov-lock';

test.use({ worldRoles: ['owner'] });

// ---- PrimeNG interaction helpers (overlays append to body, so options live on `page`) ----

/** Open a p-select (incl. grouped + filtered) and pick an option, scoped to the
 *  open listbox so a page-global option never matches. Clicks the `.p-select` host
 *  (robust across PrimeNG focusable-element variants), narrows via the filter box
 *  when present, then clicks the option. */
async function pickSelect(
  page: Page,
  inputId: string,
  optionLabel: string | RegExp
): Promise<void> {
  const host = page
    .locator(`#${inputId}`)
    .locator('xpath=ancestor-or-self::*[contains(@class,"p-select")][1]');
  await host.click();
  // scope to the p-select option list (aria-label 'Option List') so a sibling
  // p-autocomplete listbox in the same dialog never collides.
  const listbox = page.getByRole('listbox', { name: 'Option List' });
  await listbox.waitFor({ state: 'visible' });
  const filter = listbox.getByRole('searchbox');
  if (await filter.count()) {
    await filter.first().fill(optionLabel instanceof RegExp ? optionLabel.source : optionLabel);
  }
  await listbox.getByRole('option', { name: optionLabel }).first().click();
  await listbox.waitFor({ state: 'detached' }).catch(() => {});
}

const sp = (t: string, s: string, sub: string): string => `/t/${t}/s/${s}${sub}`;

test.describe('@crud @event entity write CRUD + merged event form', () => {
  // ----------------------------------------------------------------------------------------
  // 1. ASSET create + edit
  // ----------------------------------------------------------------------------------------
  test('owner creates then renames an asset via the dialog', async ({
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
    // MOA/ROA taxonomy multiselects are exercised separately; create needs only name + company.
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

    // --- edit: rename via the row actions dialog (asset-list row-actions ariaLabel
    // 'Actions for ' + asset.name, asset-list.component.html:162) ---
    // row-actions puts the aria-label on the p-button HOST (role generic, not button),
    // so target it by label, not role.
    const assetActions = page.getByLabel(`Actions for ${name}`, { exact: true });
    await expect(assetActions).toBeVisible({ timeout: 15_000 });
    await assetActions.click();
    await page.getByRole('menuitem', { name: /^Edit$/ }).click();
    const editDialog = page.getByRole('dialog');
    await expect(editDialog).toBeVisible();
    await page.locator('#asset-name').fill(renamed);
    await editDialog.getByRole('button', { name: /update asset/i }).click();

    await expect(page.getByRole('row', { name: new RegExp(renamed) })).toBeVisible();

    // rename persisted
    const after = await owner.from('assets').select('name').eq('id', assetId).single();
    expect(after.data?.name).toBe(renamed);
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
    // phase dates are optional and the PrimeNG datepicker model isn't driven by a plain
    // fill(); they're not asserted here, so create with name + asset + phase only.
    await dialog.getByRole('button', { name: /^Create$/ }).click();

    // create navigates to the new trial's detail page (h1 = trial name).
    await expect(page.getByRole('heading', { name: trialName, level: 1 })).toBeVisible();

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
    await page.getByLabel('Trial actions', { exact: true }).click();
    await page.getByRole('menuitem', { name: /edit details/i }).click();
    const editDialog = page.getByRole('dialog', { name: /edit trial details/i });
    await expect(editDialog).toBeVisible();
    const renamed = `${trialName} v2`;
    await page.locator('#trial-form-name').fill(renamed);
    await editDialog.getByRole('button', { name: /^Save$/ }).click();
    await expect(editDialog).toBeHidden(); // wait for the save RPC to finish before asserting

    const afterEdit = await owner.from('trials').select('name').eq('id', trialId).single();
    expect(afterEdit.data?.name).toBe(renamed);

    // --- CT.gov phase lock: force phase_type_source='ctgov' (no real registry sync possible) ---
    await lockTrialPhaseFromCtgov(trialId, 'P3');
    await gotoSettled(page, sp(world.tenantId, world.spaceId, `/profiles/trials/${trialId}`));
    await page.getByLabel('Trial actions', { exact: true }).click();
    await page.getByRole('menuitem', { name: /edit details/i }).click();
    const lockedDialog = page.getByRole('dialog', { name: /edit trial details/i });
    await expect(lockedDialog).toBeVisible();
    // Phase select is disabled when phaseTypeLocked() (trial-edit-form: [disabled]="phaseTypeLocked()||disabled()")
    await expect(lockedDialog.locator('#trial-form-phase-type')).toBeDisabled(); // VERIFY: p-select disabled maps to aria-disabled / pointer-events; may need [aria-disabled]
    // and a 'ct.gov' provenance badge is shown next to the field label
    await expect(lockedDialog.getByText(/ct\.gov/i).first()).toBeVisible();
  });

  // ----------------------------------------------------------------------------------------
  // 3. MERGED EVENT FORM edit -- the update_event regression guard. The event is SEEDED via
  //    apiAs (robust), so this isolates the EDIT path: the one update_event named-arg call
  //    that PGRST202'd on every event edit until the DB dropped the vestigial p_source_url
  //    (see rpc-contract @contract). Covers rename (keep anchor -> Activity row) + re-anchor.
  // ----------------------------------------------------------------------------------------
  test('owner edits a seeded event via the merged dialog: rename (update_event)', async ({
    world,
    pageAs,
    gotoSettled,
  }) => {
    test.slow();
    const seed = await seedBasics(world); // 'Topline readout' clinical event on the trial
    const owner = apiAs(world, 'owner');
    const page = await pageAs('owner');
    await gotoSettled(page, sp(world.tenantId, world.spaceId, `/profiles/trials/${seed.trialId}`));

    const renamed = `Topline readout ${world.id} v2`;

    // --- edit #1: rename via the merged "Edit event" dialog (keeps the trial anchor) ---
    // row-actions puts aria-label 'Actions for event <title>' on the p-button HOST
    // (role generic, not button -- row-actions.component.ts:28), so target by label.
    const actions = page.getByLabel('Actions for event Topline readout', { exact: true });
    await expect(actions).toBeVisible({ timeout: 15_000 });
    await actions.click();
    await page.getByRole('menuitem', { name: /^Edit$/ }).click();
    const editDialog = page.getByRole('dialog', { name: /edit event/i });
    await expect(editDialog).toBeVisible();
    await editDialog.locator('#ev-title').fill(renamed);
    await editDialog.getByRole('button', { name: /^Update event$/ }).click();
    await expect(editDialog).toBeHidden();

    // update_event resolved through the real client named-arg path (PGRST202 before the
    // p_source_url drop). Title persisted; trial anchor unchanged.
    let ev = await owner
      .from('events')
      .select('title, anchor_type, anchor_id')
      .eq('id', seed.eventId)
      .single();
    expect(ev.error).toBeNull();
    expect(ev.data?.title).toBe(renamed);
    expect(ev.data?.anchor_type).toBe('trial');

    // title changed while trial-anchored -> an 'event_edited' Activity row is emitted
    // (migration 20260629030000 trial_change_events).
    const acts = await owner
      .from('trial_change_events')
      .select('event_type')
      .eq('event_id', seed.eventId);
    expect(acts.error).toBeNull();
    expect((acts.data ?? []).some((a) => a.event_type === 'event_edited')).toBe(true);
  });

  // ----------------------------------------------------------------------------------------
  // 4. MERGED EVENT FORM re-anchor (QA-004) -- also through update_event. The edit dialog's
  //    Level + entity selects are p-selects (ev-level, ev-entity); changing the anchor moves
  //    the event off the trial onto the asset.
  // ----------------------------------------------------------------------------------------
  test('owner re-anchors a seeded event from trial to asset via the edit dialog (update_event)', async ({
    world,
    pageAs,
    gotoSettled,
  }) => {
    test.slow();
    const seed = await seedBasics(world);
    const owner = apiAs(world, 'owner');
    const page = await pageAs('owner');
    await gotoSettled(page, sp(world.tenantId, world.spaceId, `/profiles/trials/${seed.trialId}`));

    const actions = page.getByLabel('Actions for event Topline readout', { exact: true });
    await expect(actions).toBeVisible({ timeout: 15_000 });
    await actions.click();
    await page.getByRole('menuitem', { name: /^Edit$/ }).click();
    const dialog = page.getByRole('dialog', { name: /edit event/i });
    await expect(dialog).toBeVisible();

    // Level select (no filter) -> Asset; then the entity select (filter on) -> the seeded asset.
    await pickSelect(page, 'ev-level', /^Asset$/);
    await pickSelect(page, 'ev-entity', new RegExp(seed.assetName));
    await dialog.getByRole('button', { name: /^Update event$/ }).click();
    await expect(dialog).toBeHidden();

    // update_event re-anchored the event onto the asset.
    const ev = await owner
      .from('events')
      .select('anchor_type, anchor_id')
      .eq('id', seed.eventId)
      .single();
    expect(ev.error).toBeNull();
    expect(ev.data?.anchor_type).toBe('asset');
    expect(ev.data?.anchor_id).toBe(seed.assetId);
  });
});
