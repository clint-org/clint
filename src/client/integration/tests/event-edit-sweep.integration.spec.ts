/**
 * Event edit sweep: exercises every edit dimension through the EXACT arg shape the
 * Angular client sends (UpdateEventArgs + p_event_id, p_metadata dropped when null),
 * via updateAsClient -- the same spread/delete event.service.updateEvent performs.
 *
 * This is the anti-drift net for the save-failure class of bug (a required RPC param
 * the client stopped sending): args are typed as UpdateEventArgs, so a missing or
 * extra key is a COMPILE error, and the runtime call goes through the real RPC.
 *
 * Coverage: all anchor levels (T3); date precision / extent / fuzzy end (T4); re-type,
 * re-anchor, Activity emit (T5); significance / visibility / no_longer_expected /
 * metadata (T6); the form's two-call source save (T7); pre-existing seeded and
 * CT.gov-derived events (T8).
 *
 * Run after `supabase db reset` with SUPABASE_SERVICE_ROLE_KEY exported.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectOk } from '../harness/as';
import { UpdateEventArgs } from '../../src/app/core/models/event-write.model';

// System event_type UUIDs (stable; seeded by the event_types migration).
const ET_STRATEGIC = 'a0000000-0000-0000-0000-000000000070';
const ET_TOPLINE = 'a0000000-0000-0000-0000-000000000013';

function shortNct(): string {
  return `NCT${randomUUID().replace(/\D/g, '').slice(0, 8).padEnd(8, '0')}`;
}

let p: Personas;
let admin: SupabaseClient;
let companyId: string;
let assetId: string;
let trialId: string;
const eventIds: string[] = [];
const extraTrialIds: string[] = [];
const extraSpaceIds: string[] = [];

// Mirror event.service.updateSources: replace-all of the event's sources by URL+label.
async function updateSourcesAsClient(
  client: SupabaseClient,
  eventId: string,
  sources: { url: string; label: string }[],
) {
  return client.rpc('update_event_sources', {
    p_event_id: eventId,
    p_urls: sources.map((s) => s.url),
    p_labels: sources.map((s) => s.label ?? ''),
  });
}

// Fresh scratch space under the personas tenant, owned by space_owner (matches
// event-producers.integration.spec.ts), so seed_demo_data's owner gate is satisfied.
async function newOwnedSpace(name: string): Promise<string> {
  const { data: space, error: spaceErr } = await admin
    .from('spaces')
    .insert({ tenant_id: p.org.tenantId, name, created_by: p.ids.space_owner })
    .select('id')
    .single();
  if (spaceErr) throw new Error(`scratch space insert: ${spaceErr.message}`);
  const spaceId = (space as { id: string }).id;
  const { error: memberErr } = await admin
    .from('space_members')
    .insert({ space_id: spaceId, user_id: p.ids.space_owner, role: 'owner' });
  if (memberErr) throw new Error(`scratch space_members insert: ${memberErr.message}`);
  extraSpaceIds.push(spaceId);
  return spaceId;
}

// Mirror event.service.updateEvent: spread args, add p_event_id, drop p_metadata when null.
async function updateAsClient(client: SupabaseClient, eventId: string, args: UpdateEventArgs) {
  const params: Record<string, unknown> = { p_event_id: eventId, ...args };
  if (params['p_metadata'] == null) delete params['p_metadata'];
  return client.rpc('update_event', params);
}

// Build a full UpdateEventArgs with sane defaults; `over` patches specific keys.
// Typed as UpdateEventArgs so a missing or renamed key fails to compile.
function baseArgs(over: Partial<UpdateEventArgs>): UpdateEventArgs {
  return {
    p_event_type_id: ET_STRATEGIC,
    p_anchor_type: 'space',
    p_anchor_id: null,
    p_title: 'edited',
    p_event_date: '2026-05-01',
    p_projection: 'actual',
    p_date_precision: 'exact',
    p_end_date: null,
    p_end_date_precision: 'exact',
    p_is_ongoing: false,
    p_description: null,
    p_significance: null,
    p_visibility: null,
    p_metadata: null,
    p_no_longer_expected: false,
    p_indication_id: null,
    ...over,
  };
}

// Create an event in the shared persona space and track it for teardown.
async function createEvent(over: Record<string, unknown>): Promise<string> {
  const { data } = await as(p, 'contributor')
    .rpc('create_event', {
      p_space_id: p.org.spaceId,
      p_event_type_id: ET_STRATEGIC,
      p_title: 'before',
      p_event_date: '2026-05-01',
      p_anchor_type: 'space',
      ...over,
    })
    .throwOnError();
  const id = data as string;
  eventIds.push(id);
  return id;
}

beforeAll(async () => {
  p = await buildPersonas();
  admin = adminClient();

  const { data: co, error: coErr } = await admin
    .from('companies')
    .insert({ space_id: p.org.spaceId, name: 'Edit Sweep Co', created_by: p.ids.contributor })
    .select('id')
    .single();
  if (coErr) throw new Error(`company: ${coErr.message}`);
  companyId = (co as { id: string }).id;

  const { data: asset, error: aErr } = await admin
    .from('assets')
    .insert({ space_id: p.org.spaceId, company_id: companyId, name: 'Edit Sweep Asset', created_by: p.ids.contributor })
    .select('id')
    .single();
  if (aErr) throw new Error(`asset: ${aErr.message}`);
  assetId = (asset as { id: string }).id;

  const { data: trial, error: tErr } = await admin
    .from('trials')
    .insert({ space_id: p.org.spaceId, asset_id: assetId, name: 'Edit Sweep Trial', created_by: p.ids.contributor })
    .select('id')
    .single();
  if (tErr) throw new Error(`trial: ${tErr.message}`);
  trialId = (trial as { id: string }).id;
}, 120_000);

afterAll(async () => {
  if (eventIds.length) {
    await admin.from('trial_change_events').delete().in('event_id', eventIds);
    await admin.from('events').delete().in('id', eventIds);
  }
  // CT.gov-derived trials (T8): drop their derived events first, then the trials.
  for (const tId of extraTrialIds) {
    await admin.from('trial_change_events').delete().eq('trial_id', tId);
    await admin.from('events').delete().eq('anchor_id', tId).eq('anchor_type', 'trial');
    await admin.from('trials').delete().eq('id', tId);
  }
  // Seeded scratch spaces (T8): best-effort teardown; a db reset wipes anything left.
  for (const sId of extraSpaceIds) {
    await admin.from('events').delete().eq('space_id', sId);
    await admin.from('spaces').delete().eq('id', sId);
  }
  if (trialId) {
    await admin.from('trial_change_events').delete().eq('trial_id', trialId);
    await admin.from('trials').delete().eq('id', trialId);
  }
  if (assetId) await admin.from('assets').delete().eq('id', assetId);
  if (companyId) await admin.from('companies').delete().eq('id', companyId);
});

// ===========================================================================
// T3: every anchor level edits via the client shape, anchor_type preserved.
// ===========================================================================
describe('edit by anchor level (client shape)', () => {
  it.each([
    ['space', () => ({ p_anchor_type: 'space' as const, p_anchor_id: null })],
    ['company', () => ({ p_anchor_type: 'company' as const, p_anchor_id: companyId })],
    ['asset', () => ({ p_anchor_type: 'asset' as const, p_anchor_id: assetId })],
    ['trial', () => ({ p_anchor_type: 'trial' as const, p_anchor_id: trialId })],
  ])('edits a %s-anchored event title via the client shape', async (_lvl, anchor) => {
    const a = anchor();
    const id = await createEvent({ p_anchor_type: a.p_anchor_type, p_anchor_id: a.p_anchor_id });
    expectOk(await updateAsClient(as(p, 'contributor'), id, baseArgs({ ...a, p_title: 'after' })));
    const { data } = await admin
      .from('events')
      .select('title, anchor_type')
      .eq('id', id)
      .single();
    expect(data).toMatchObject({ title: 'after', anchor_type: a.p_anchor_type });
  });
});

// ===========================================================================
// T4: date precision, extent (point -> bounded, fuzzy end), and guards.
// ===========================================================================
describe('edit date precision and extent (client shape)', () => {
  it('edits date precision exact -> quarter and persists both precision and date', async () => {
    const id = await createEvent({ p_anchor_type: 'trial', p_anchor_id: trialId, p_event_date: '2026-01-15' });
    expectOk(
      await updateAsClient(
        as(p, 'contributor'),
        id,
        baseArgs({ p_anchor_type: 'trial', p_anchor_id: trialId, p_event_date: '2026-02-15', p_date_precision: 'quarter' }),
      ),
    );
    const { data } = await admin.from('events').select('event_date, date_precision').eq('id', id).single();
    expect(data).toMatchObject({ event_date: '2026-02-15', date_precision: 'quarter' });
  });

  it('edits extent point -> bounded with a fuzzy (quarter) end date', async () => {
    const id = await createEvent({ p_anchor_type: 'trial', p_anchor_id: trialId, p_event_date: '2026-01-15' });
    expectOk(
      await updateAsClient(
        as(p, 'contributor'),
        id,
        baseArgs({
          p_anchor_type: 'trial',
          p_anchor_id: trialId,
          p_event_date: '2026-01-15',
          p_end_date: '2026-08-15',
          p_end_date_precision: 'quarter',
        }),
      ),
    );
    const { data } = await admin.from('events').select('end_date, end_date_precision').eq('id', id).single();
    expect(data).toMatchObject({ end_date: '2026-08-15', end_date_precision: 'quarter' });
  });

  it('rejects ongoing + end_date together (22023)', async () => {
    const id = await createEvent({ p_anchor_type: 'trial', p_anchor_id: trialId, p_event_date: '2026-01-15' });
    const res = await updateAsClient(
      as(p, 'contributor'),
      id,
      baseArgs({ p_anchor_type: 'trial', p_anchor_id: trialId, p_is_ongoing: true, p_end_date: '2026-08-15' }),
    );
    expect(res.error).toBeTruthy();
  });
});

// ===========================================================================
// T5: re-type, re-anchor (level + entity change), and Activity emit.
// ===========================================================================
describe('re-type, re-anchor, and Activity emit (client shape)', () => {
  it('re-types and re-anchors a trial event onto an asset', async () => {
    const id = await createEvent({ p_anchor_type: 'trial', p_anchor_id: trialId, p_event_date: '2026-04-01' });
    expectOk(
      await updateAsClient(
        as(p, 'contributor'),
        id,
        baseArgs({
          p_event_type_id: ET_TOPLINE,
          p_anchor_type: 'asset',
          p_anchor_id: assetId,
          p_event_date: '2026-04-01',
        }),
      ),
    );
    const { data } = await admin
      .from('events')
      .select('event_type_id, anchor_type, anchor_id')
      .eq('id', id)
      .single();
    expect(data).toMatchObject({ event_type_id: ET_TOPLINE, anchor_type: 'asset', anchor_id: assetId });
  });

  it('emits a trial_change_events date_moved row on a trial-anchored date edit', async () => {
    const id = await createEvent({ p_anchor_type: 'trial', p_anchor_id: trialId, p_event_date: '2026-04-01' });
    expectOk(
      await updateAsClient(
        as(p, 'contributor'),
        id,
        baseArgs({ p_anchor_type: 'trial', p_anchor_id: trialId, p_event_date: '2026-09-01' }),
      ),
    );
    const { data } = await admin.from('trial_change_events').select('event_type').eq('event_id', id);
    expect((data as { event_type: string }[]).some((r) => r.event_type === 'date_moved')).toBe(true);
  });
});

// ===========================================================================
// T6: significance, visibility, no_longer_expected, metadata.
// ===========================================================================
describe('flags and metadata round-trip (client shape)', () => {
  it('round-trips significance, visibility, no_longer_expected, and metadata', async () => {
    const id = await createEvent({ p_anchor_type: 'company', p_anchor_id: companyId, p_event_date: '2026-04-01' });
    expectOk(
      await updateAsClient(
        as(p, 'contributor'),
        id,
        baseArgs({
          p_anchor_type: 'company',
          p_anchor_id: companyId,
          p_significance: 'low',
          p_visibility: 'pinned',
          p_no_longer_expected: true,
          p_metadata: { tags: ['m&a'], pathway: 'NDA' },
        }),
      ),
    );
    const { data } = await admin
      .from('events')
      .select('significance, visibility, no_longer_expected, metadata')
      .eq('id', id)
      .single();
    expect(data).toMatchObject({
      significance: 'low',
      visibility: 'pinned',
      no_longer_expected: true,
      metadata: { tags: ['m&a'], pathway: 'NDA' },
    });
  });

  it('omitting p_metadata leaves stored metadata untouched (coalesce semantics)', async () => {
    const id = await createEvent({
      p_anchor_type: 'company',
      p_anchor_id: companyId,
      p_event_date: '2026-04-01',
      p_metadata: { tags: ['keep'] },
    });
    expectOk(
      await updateAsClient(
        as(p, 'contributor'),
        id,
        baseArgs({ p_anchor_type: 'company', p_anchor_id: companyId, p_title: 'meta-keep-2', p_metadata: null }),
      ),
    );
    const { data } = await admin.from('events').select('metadata').eq('id', id).single();
    expect((data as { metadata: unknown }).metadata).toEqual({ tags: ['keep'] });
  });
});

// ===========================================================================
// T7: sources add / replace / reorder / clear -- the form's two-call save.
// ===========================================================================
describe('source management via the two-call save (client shape)', () => {
  it('adds, replaces, reorders, and clears sources via update_event_sources', async () => {
    const id = await createEvent({ p_anchor_type: 'trial', p_anchor_id: trialId, p_event_date: '2026-04-01' });

    // The exact two-call save the form runs: update_event, then update_event_sources.
    expectOk(await updateAsClient(as(p, 'contributor'), id, baseArgs({ p_anchor_type: 'trial', p_anchor_id: trialId })));
    expectOk(await updateSourcesAsClient(as(p, 'contributor'), id, [{ url: 'https://google.com', label: 'googl' }]));
    let rows = (
      await admin.from('event_sources').select('url, label, sort_order').eq('event_id', id).order('sort_order')
    ).data as { url: string; label: string; sort_order: number }[];
    expect(rows).toHaveLength(1);
    // sort_order is 1-based in update_event_sources; the reorder step below proves ordering.
    expect(rows[0]).toMatchObject({ url: 'https://google.com', label: 'googl' });

    // Replace-all with two, reordered.
    expectOk(
      await updateSourcesAsClient(as(p, 'contributor'), id, [
        { url: 'https://b.test', label: 'B' },
        { url: 'https://a.test', label: 'A' },
      ]),
    );
    rows = (await admin.from('event_sources').select('url').eq('event_id', id).order('sort_order')).data as {
      url: string;
      sort_order: number;
    }[];
    expect(rows.map((r) => r.url)).toEqual(['https://b.test', 'https://a.test']);

    // Clear.
    expectOk(await updateSourcesAsClient(as(p, 'contributor'), id, []));
    const { count } = await admin
      .from('event_sources')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', id);
    expect(count).toBe(0);
  });
});

// ===========================================================================
// T8: editing pre-existing seeded and CT.gov-derived events (not form-created).
// ===========================================================================
describe('edits pre-existing (non-form-created) events (client shape)', () => {
  it('edits a pre-existing seeded event via the client shape', async () => {
    // seed_demo_data (owner-gated, SECURITY INVOKER) populates a fresh space with
    // the unified event model (companies/assets/trials + events).
    const spaceId = await newOwnedSpace('Edit Sweep Seeded Space');
    expectOk(await as(p, 'space_owner').rpc('seed_demo_data', { p_space_id: spaceId }));

    const { data: ev } = await admin
      .from('events')
      .select('id, anchor_type, anchor_id, event_type_id')
      .eq('space_id', spaceId)
      .limit(1)
      .single();
    const e = ev as {
      id: string;
      anchor_type: UpdateEventArgs['p_anchor_type'];
      anchor_id: string | null;
      event_type_id: string;
    };
    expectOk(
      await updateAsClient(
        as(p, 'space_owner'),
        e.id,
        baseArgs({
          p_event_type_id: e.event_type_id,
          p_anchor_type: e.anchor_type,
          p_anchor_id: e.anchor_id,
          p_title: 'seeded-edited',
          p_event_date: '2026-06-01',
        }),
      ),
    );
    const { data } = await admin.from('events').select('title').eq('id', e.id).single();
    expect((data as { title: string }).title).toBe('seeded-edited');
  });

  it('edits a CT.gov-derived trial-date event via the client shape', async () => {
    // create_trial derives analyst-owned Trial Start/End events from phase dates
    // (_create_trial_date_markers); these are not form-created but must stay editable.
    const { data: tId } = await as(p, 'contributor')
      .rpc('create_trial', {
        p_space_id: p.org.spaceId,
        p_asset_id: assetId,
        p_name: 'Derived-date trial',
        p_identifier: shortNct(),
        p_phase_type: 'P3',
        p_phase_start_date: '2026-03-01',
      })
      .throwOnError();
    extraTrialIds.push(tId as string);

    const { data: derived } = await admin
      .from('events')
      .select('id, event_type_id, anchor_type, anchor_id')
      .eq('anchor_id', tId as string)
      .eq('anchor_type', 'trial')
      .limit(1)
      .single();
    const d = derived as {
      id: string;
      event_type_id: string;
      anchor_type: UpdateEventArgs['p_anchor_type'];
      anchor_id: string | null;
    };
    expectOk(
      await updateAsClient(
        as(p, 'contributor'),
        d.id,
        baseArgs({
          p_event_type_id: d.event_type_id,
          p_anchor_type: d.anchor_type,
          p_anchor_id: d.anchor_id,
          p_title: 'derived-edited',
          p_description: 'edited note',
          p_significance: 'high',
          p_event_date: '2026-07-01',
        }),
      ),
    );
    const { data } = await admin
      .from('events')
      .select('title, description, significance')
      .eq('id', d.id)
      .single();
    expect(data).toMatchObject({ title: 'derived-edited', description: 'edited note', significance: 'high' });
  });
});
