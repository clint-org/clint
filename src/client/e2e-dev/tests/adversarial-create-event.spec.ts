/**
 * QA-008 adversarial create_event validation -- pins the actual server contract.
 *
 * Two layers:
 *  1. RPC probes (apiAs owner -> rpc('create_event')): which adversarial inputs the
 *     DB ACCEPTS vs BLOCKS, asserting the documented SQLSTATE for each guard. This is
 *     the regression net for the create_event guards + the events-table CHECK/NOT NULL
 *     constraints (direct/import/RPC callers bypass the Angular form).
 *  2. UI: the event form rejects an empty title (Create submit disabled), and -- the
 *     key SECURITY assertion -- an XSS title stored via RPC renders ESCAPED (no injected
 *     element, no script execution) on the live surfaces.
 *
 * Grounding (deployed-dev sources live on origin/feat/event-model[-stage-3]; this branch
 * predates the event model, so citations are branch blobs, see selectorCitations):
 *  - create_event body: supabase/migrations/20260628250000_event_sources_rpc_writes.sql
 *      L55 has_space_access -> 42501; L57 ongoing+end_date -> 22023; L60 bad anchor_type
 *      -> 22023; L64 null anchor_id -> 22023; L74 anchor-not-in-space -> 42501. NO check
 *      for: empty/long title, end>=start, or date sanity bounds -> those are ACCEPTED.
 *  - events table: supabase/migrations/20260628071042_events_table.sql -- title NOT NULL
 *      (L5 -> 23502); projection/date_precision/significance/visibility CHECK (L13/9/15/16
 *      -> 23514).
 *  - XSS: title is interpolated ({{ d.title }} event-detail-panel.component.html:25) or
 *      [innerHTML]='item.title | highlight' (events-page.component.html:206) where the
 *      highlight pipe HTML-escapes first (highlight-search.ts:18-28) -> no live element,
 *      no execution. Never bind event title via raw [innerHTML].
 *
 * Source: QA-008 in docs/notes/event-model-qa-dev-issues.md (17 adversarial probes).
 */
import { test, expect } from '../fixtures';
import { apiAs, createScratchWorld } from '../fixtures';
import { seedBasics } from '../helpers/seed';

// RPC probes + the form only need the owner identity.
test.use({ worldRoles: ['owner'] });

const sp = (tenantId: string, spaceId: string, sub = '') => `/t/${tenantId}/s/${spaceId}${sub}`;

type Api = ReturnType<typeof apiAs>;

/** Look up a system (global) event type by name -- same pattern as helpers/seed.ts:69. */
async function systemEventTypeId(api: Api, name: string): Promise<string> {
  const { data, error } = await api
    .from('event_types')
    .select('id')
    .eq('name', name)
    .is('space_id', null)
    .single();
  if (error) throw new Error(`event_type '${name}' lookup: ${error.message}`);
  return (data as { id: string }).id;
}

test.describe('@adversarial create_event input validation', () => {
  // -------------------------------------------------------------------------
  // RPC layer: ACCEPTED edge cases (pin CURRENT behavior; flag if hardened).
  // -------------------------------------------------------------------------
  test('RPC accepts the QA-008 edge cases the DB does not (yet) guard', async ({ world }) => {
    const seed = await seedBasics(world);
    const api = apiAs(world, 'owner');
    const eventTypeId = await systemEventTypeId(api, 'Topline Data');

    // base = a valid trial-anchored event; each case overrides one field.
    const base = {
      p_space_id: world.spaceId,
      p_event_type_id: eventTypeId,
      p_title: 'adversarial probe',
      p_event_date: '2025-06-01',
      p_anchor_type: 'trial',
      p_anchor_id: seed.trialId,
    };

    const accept = async (label: string, overrides: Record<string, unknown>) => {
      const { data, error } = await api.rpc('create_event', { ...base, ...overrides });
      expect(error, `${label}: expected ACCEPTED, got ${error?.code} ${error?.message}`).toBeNull();
      expect(typeof data, `${label}: expected a returned event uuid`).toBe('string');
    };

    // C9 inverted range: end_date < event_date. No (end is null or end >= start) CHECK
    // exists in create_event or the events table.
    // REGRESSION-WATCH: if Stage 3 adds `check (end_date is null or end_date >= event_date)`
    // this flips to a 23514 reject -- update this case + move it to the rejects block.
    await accept('C9 inverted range', { p_event_date: '2025-06-01', p_end_date: '2024-01-01' });

    // C10 empty-string title: RPC has no trim-and-reject; events.title is NOT NULL but '' is non-null.
    await accept('C10 empty title', { p_title: '' });

    // C13 6000-char title: no length cap in RPC or column.
    await accept('C13 6000-char title', { p_title: 'a'.repeat(6000) });

    // C14 far-future / C15 far-past: date type accepts; no plausibility bounds.
    await accept('C14 year 3000', { p_event_date: '3000-01-01' });
    await accept('C15 year 0900', { p_event_date: '0900-01-01' });
  });

  // -------------------------------------------------------------------------
  // RPC layer: BLOCKED cases -- regression net for the guards + CHECK constraints.
  // -------------------------------------------------------------------------
  test('RPC blocks the SOLID adversarial cases with the documented SQLSTATE', async ({ world }) => {
    const seed = await seedBasics(world);
    const api = apiAs(world, 'owner');
    const eventTypeId = await systemEventTypeId(api, 'Topline Data');

    const base = {
      p_space_id: world.spaceId,
      p_event_type_id: eventTypeId,
      p_title: 'adversarial probe',
      p_event_date: '2025-06-01',
      p_anchor_type: 'trial',
      p_anchor_id: seed.trialId,
    };

    const reject = async (label: string, code: string, overrides: Record<string, unknown>) => {
      const { data, error } = await api.rpc('create_event', { ...base, ...overrides });
      expect(data, `${label}: expected NO event created`).toBeNull();
      expect(
        error?.code,
        `${label}: expected ${code}, got ${error?.code} (${error?.message})`
      ).toBe(code);
    };

    // anchor type/id mismatch: anchor_type='company' but anchor_id is an in-space trial ->
    // the company existence probe fails -> 42501 (20260628250000_event_sources_rpc_writes.sql:74).
    await reject('anchor type/id mismatch', '42501', {
      p_anchor_type: 'company',
      p_anchor_id: seed.trialId,
    });

    // null title -> events.title NOT NULL (20260628071042_events_table.sql:5).
    await reject('null title', '23502', { p_title: null });

    // bad projection enum -> events.projection CHECK (20260628071042_events_table.sql:13).
    await reject('bad projection enum', '23514', { p_projection: 'bogus' });

    // invalid anchor_type -> RPC raises 22023 BEFORE the column CHECK
    // (20260628250000_event_sources_rpc_writes.sql:60).
    await reject('invalid anchor_type', '22023', { p_anchor_type: 'galaxy', p_anchor_id: null });

    // ongoing + end_date conflict -> RPC raises 22023
    // (20260628250000_event_sources_rpc_writes.sql:57).
    await reject('ongoing + end_date', '22023', { p_is_ongoing: true, p_end_date: '2025-07-01' });
  });

  test('RPC blocks a cross-space anchor (IDOR firewall) with 42501', async ({ world }) => {
    // A second isolated tenant/space; world-1 owner must NOT be able to anchor an event to
    // world-2's trial. The anchor-existence probe is scoped to p_space_id
    // (20260628250000_event_sources_rpc_writes.sql:74) -> 42501.
    const other = await createScratchWorld({ roles: ['owner'] });
    try {
      const otherSeed = await seedBasics(other);
      const api = apiAs(world, 'owner');
      const eventTypeId = await systemEventTypeId(api, 'Topline Data');

      const { data, error } = await api.rpc('create_event', {
        p_space_id: world.spaceId, // owner DOES have access here (so this is not the top-of-fn 42501)
        p_event_type_id: eventTypeId,
        p_title: 'cross-space anchor probe',
        p_event_date: '2025-06-01',
        p_anchor_type: 'trial',
        p_anchor_id: otherSeed.trialId, // ...but the trial lives in another space
      });
      expect(data, 'cross-space: expected NO event created').toBeNull();
      expect(
        error?.code,
        `cross-space: expected 42501, got ${error?.code} (${error?.message})`
      ).toBe('42501');
    } finally {
      await other.cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // UI layer: the form rejects what the RPC tolerates; XSS renders escaped.
  // -------------------------------------------------------------------------
  test('event form blocks submit on an empty title (UI rejects what RPC accepts)', async ({
    world,
    pageAs,
    gotoSettled,
  }) => {
    const seed = await seedBasics(world);
    const page = await pageAs('owner');

    // On deployed dev (cutover) the merged event form is opened from the trial-detail
    // page via "Add event" -> "Log event" dialog (grounded in entity-crud-events.spec.ts).
    // /activity is a read-only change log post-Stage-3 and has no create affordance.
    await gotoSettled(page, sp(world.tenantId, world.spaceId, `/profiles/trials/${seed.trialId}`));

    const openBtn = page.getByRole('button', { name: /add event/i });
    await expect(openBtn).toBeVisible();
    await openBtn.click();

    const dialog = page.getByRole('dialog', { name: /log event/i });
    await expect(dialog).toBeVisible();

    // Title is empty on open -> the form is incomplete -> the "Log event" submit is
    // disabled. This pins "the UI requires a non-empty title" -- the contract the RPC
    // does NOT enforce (C10 above).
    const submit = dialog.getByRole('button', { name: /^log event$/i });
    await expect(submit).toBeDisabled();
  });

  test('XSS title is rendered ESCAPED and never executes (C12 security)', async ({
    world,
    pageAs,
    gotoSettled,
  }) => {
    const seed = await seedBasics(world);
    const api = apiAs(world, 'owner');
    const eventTypeId = await systemEventTypeId(api, 'Topline Data');

    // Store a script-injection title via the RPC (bypasses the form). The payload sets a
    // window flag iff it ever executes as HTML.
    const xssTitle = '<img src=x onerror="window.__xssFired=true">';
    const { data, error } = await api.rpc('create_event', {
      p_space_id: world.spaceId,
      p_event_type_id: eventTypeId,
      p_title: xssTitle,
      p_event_date: '2025-06-01',
      p_anchor_type: 'trial',
      p_anchor_id: seed.trialId,
    });
    expect(error, `XSS seed: ${error?.code} ${error?.message}`).toBeNull();
    expect(typeof data).toBe('string');

    // Assert on every surface that renders the title. These checks are page-global (no list-row
    // selector needed), so they hold whatever route actually paints the event.
    const assertSafe = async (path: string) => {
      const page = await pageAs('owner');
      await gotoSettled(page, path);
      // 1. the onerror handler never ran (no injected-script execution anywhere on the page).
      const fired = await page.evaluate(() => (window as { __xssFired?: boolean }).__xssFired);
      expect(fired, `${path}: XSS payload executed (window.__xssFired set)`).toBeFalsy();
      // 2. no live <img src="x"> element -- the payload stayed inert text. Title is interpolated
      //    ({{ d.title }} event-detail-panel.component.html:25) or [innerHTML] via the highlight
      //    pipe which HTML-escapes first (highlight-search.ts:18-28).
      await expect(page.locator('img[src="x"]')).toHaveCount(0);
      await page.close();
    };

    // Timeline always paints the seeded trial's events (app.routes.ts:255).
    await assertSafe(sp(world.tenantId, world.spaceId, '/timeline'));
    // Trial detail renders the Events table (the title-bearing surface on deployed dev).
    await assertSafe(sp(world.tenantId, world.spaceId, `/profiles/trials/${seed.trialId}`));
  });
});
