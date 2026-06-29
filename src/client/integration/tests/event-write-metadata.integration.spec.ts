/**
 * Stage 3 Part B integration coverage: event metadata round-trips + the unified
 * get_event_detail read shape the merged Event form hydrates from.
 *
 *   - create_event(p_metadata) persists events.metadata (tags + regulatory
 *     pathway) verbatim; omitting it leaves metadata null.
 *   - update_event(p_metadata) replaces metadata; omitting it leaves the stored
 *     metadata untouched (coalesce(p_metadata, metadata) semantics).
 *   - get_event_detail returns the unified keys the edit-hydration reverse-mappers
 *     read (event_type_id, anchor_type, anchor_id, significance, visibility,
 *     space_id, created_at, metadata) and derives registry_url for a trial anchor.
 *
 * Re-anchor / re-type via update_event and its trial_change_events (Activity)
 * emit are proven exhaustively in activity-wiring.integration.spec.ts; here we
 * add only the metadata dimension on a re-anchor and assert the Activity row is
 * not regressed by the metadata write.
 *
 * Every assertion runs through the shipped RPCs + the RLS-checked auth model.
 * Run after `supabase db reset` with SUPABASE_SERVICE_ROLE_KEY exported.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectOk } from '../harness/as';

// System event_type UUIDs (stable; seeded by the event_types migration).
const ET_STRATEGIC = 'a0000000-0000-0000-0000-000000000070';
const ET_TOPLINE = 'a0000000-0000-0000-0000-000000000013';
const ET_TRIAL_START = 'a0000000-0000-0000-0000-000000000011';

function shortNct(): string {
  return `NCT${randomUUID().replace(/\D/g, '').slice(0, 8).padEnd(8, '0')}`;
}

let p: Personas;
let admin: SupabaseClient;
let companyId: string;
let assetId: string;
const eventIds: string[] = [];
const trialIds: string[] = [];

async function newTrial(name: string, identifier: string | null = null): Promise<string> {
  const { data, error } = await admin
    .from('trials')
    .insert({ space_id: p.org.spaceId, asset_id: assetId, name, identifier, created_by: p.ids.contributor })
    .select('id')
    .single();
  if (error) throw new Error(`newTrial: ${error.message}`);
  const id = (data as { id: string }).id;
  trialIds.push(id);
  return id;
}

async function readMetadata(eventId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin.from('events').select('metadata').eq('id', eventId).single();
  if (error) throw new Error(`readMetadata: ${error.message}`);
  return (data as { metadata: Record<string, unknown> | null }).metadata;
}

beforeAll(async () => {
  p = await buildPersonas();
  admin = adminClient();

  const { data: co, error: coErr } = await admin
    .from('companies')
    .insert({ space_id: p.org.spaceId, name: 'Metadata Test Co', created_by: p.ids.contributor })
    .select('id')
    .single();
  if (coErr) throw new Error(`company: ${coErr.message}`);
  companyId = (co as { id: string }).id;

  const { data: asset, error: aErr } = await admin
    .from('assets')
    .insert({ space_id: p.org.spaceId, company_id: companyId, name: 'Metadata Test Asset', created_by: p.ids.contributor })
    .select('id')
    .single();
  if (aErr) throw new Error(`asset: ${aErr.message}`);
  assetId = (asset as { id: string }).id;
}, 120_000);

afterAll(async () => {
  if (eventIds.length) {
    await admin.from('trial_change_events').delete().in('event_id', eventIds);
    await admin.from('events').delete().in('id', eventIds);
  }
  if (trialIds.length) {
    await admin.from('trial_change_events').delete().in('trial_id', trialIds);
    await admin.from('trials').delete().in('id', trialIds);
  }
  if (assetId) await admin.from('assets').delete().eq('id', assetId);
  if (companyId) await admin.from('companies').delete().eq('id', companyId);
});

describe('create_event(p_metadata) round-trips events.metadata', () => {
  it('persists tags + pathway verbatim', async () => {
    const r = await as(p, 'contributor').rpc('create_event', {
      p_space_id: p.org.spaceId,
      p_event_type_id: ET_STRATEGIC,
      p_title: 'Metadata create with tags + pathway',
      p_event_date: '2026-02-01',
      p_anchor_type: 'space',
      p_metadata: { tags: ['obesity', 'GLP-1'], pathway: 'BLA' },
    });
    const eventId = expectOk(r) as string;
    eventIds.push(eventId);

    expect(await readMetadata(eventId)).toEqual({ tags: ['obesity', 'GLP-1'], pathway: 'BLA' });
  });

  it('leaves metadata null when p_metadata is omitted', async () => {
    const r = await as(p, 'contributor').rpc('create_event', {
      p_space_id: p.org.spaceId,
      p_event_type_id: ET_STRATEGIC,
      p_title: 'Metadata create without metadata',
      p_event_date: '2026-02-02',
      p_anchor_type: 'space',
    });
    const eventId = expectOk(r) as string;
    eventIds.push(eventId);

    expect(await readMetadata(eventId)).toBeNull();
  });
});

describe('update_event(p_metadata) replace + coalesce semantics', () => {
  it('replaces metadata when provided and preserves it when omitted', async () => {
    const create = await as(p, 'contributor').rpc('create_event', {
      p_space_id: p.org.spaceId,
      p_event_type_id: ET_STRATEGIC,
      p_title: 'Metadata update target',
      p_event_date: '2026-03-01',
      p_anchor_type: 'space',
      p_metadata: { tags: ['initial'] },
    });
    const eventId = expectOk(create) as string;
    eventIds.push(eventId);

    // Provide new metadata -> replaced.
    expectOk(
      await as(p, 'contributor').rpc('update_event', {
        p_event_id: eventId,
        p_title: 'Metadata update target',
        p_event_date: '2026-03-01',
        p_projection: 'actual',
        p_date_precision: 'exact',
        p_end_date: null,
        p_end_date_precision: 'exact',
        p_is_ongoing: false,
        p_description: null,
        p_source_url: null,
        p_significance: null,
        p_visibility: null,
        p_no_longer_expected: false,
        p_metadata: { tags: ['revised', 'commercial'], pathway: 'NDA' },
      }),
    );
    expect(await readMetadata(eventId)).toEqual({ tags: ['revised', 'commercial'], pathway: 'NDA' });

    // Omit metadata on a subsequent edit -> the stored metadata is untouched.
    expectOk(
      await as(p, 'contributor').rpc('update_event', {
        p_event_id: eventId,
        p_title: 'Metadata update target renamed',
        p_event_date: '2026-03-01',
        p_projection: 'actual',
        p_date_precision: 'exact',
        p_end_date: null,
        p_end_date_precision: 'exact',
        p_is_ongoing: false,
        p_description: null,
        p_source_url: null,
        p_significance: null,
        p_visibility: null,
        p_no_longer_expected: false,
      }),
    );
    expect(await readMetadata(eventId)).toEqual({ tags: ['revised', 'commercial'], pathway: 'NDA' });
  });
});

describe('get_event_detail returns the unified edit-hydration keys', () => {
  it('emits event_type_id / anchor / significance / visibility / metadata / audit fields', async () => {
    const create = await as(p, 'contributor').rpc('create_event', {
      p_space_id: p.org.spaceId,
      p_event_type_id: ET_STRATEGIC,
      p_title: 'Unified detail keys',
      p_event_date: '2026-04-01',
      p_anchor_type: 'company',
      p_anchor_id: companyId,
      p_significance: 'high',
      p_visibility: 'pinned',
      p_metadata: { tags: ['licensing'] },
    });
    const eventId = expectOk(create) as string;
    eventIds.push(eventId);

    const detail = expectOk(
      await as(p, 'contributor').rpc('get_event_detail', { p_event_id: eventId }),
    ) as { catalyst: Record<string, unknown> };
    const c = detail.catalyst;

    expect(c['event_type_id']).toBe(ET_STRATEGIC);
    expect(c['anchor_type']).toBe('company');
    expect(c['anchor_id']).toBe(companyId);
    expect(c['significance']).toBe('high');
    expect(c['visibility']).toBe('pinned');
    expect(c['metadata']).toEqual({ tags: ['licensing'] });
    expect(typeof c['space_id']).toBe('string');
    expect(typeof c['created_at']).toBe('string');
    expect(c['registry_url']).toBeNull(); // not trial-anchored
  });

  it('derives registry_url from the anchor trial NCT identifier', async () => {
    const nct = shortNct();
    const trialId = await newTrial('Registry derive trial', nct);
    const create = await as(p, 'contributor').rpc('create_event', {
      p_space_id: p.org.spaceId,
      p_event_type_id: ET_TOPLINE,
      p_title: 'Trial-anchored topline',
      p_event_date: '2026-05-01',
      p_anchor_type: 'trial',
      p_anchor_id: trialId,
    });
    const eventId = expectOk(create) as string;
    eventIds.push(eventId);

    const detail = expectOk(
      await as(p, 'contributor').rpc('get_event_detail', { p_event_id: eventId }),
    ) as { catalyst: { registry_url: string | null } };
    expect(detail.catalyst.registry_url).toBe(`https://clinicaltrials.gov/study/${nct}`);
  });
});

describe('update_event re-anchor carries metadata without regressing Activity', () => {
  it('re-anchors + re-types + sets metadata, and still emits a trial_change_events row', async () => {
    const trialA = await newTrial('Metadata reanchor src');
    const trialB = await newTrial('Metadata reanchor dst');

    const create = await as(p, 'contributor').rpc('create_event', {
      p_space_id: p.org.spaceId,
      p_event_type_id: ET_TOPLINE,
      p_title: 'Reanchor with metadata',
      p_event_date: '2026-06-01',
      p_anchor_type: 'trial',
      p_anchor_id: trialA,
    });
    const eventId = expectOk(create) as string;
    eventIds.push(eventId);

    expectOk(
      await as(p, 'contributor').rpc('update_event', {
        p_event_id: eventId,
        p_title: 'Reanchor with metadata',
        p_event_date: '2026-09-01', // moved -> date_moved activity row
        p_projection: 'actual',
        p_date_precision: 'exact',
        p_end_date: null,
        p_end_date_precision: 'exact',
        p_is_ongoing: false,
        p_description: null,
        p_source_url: null,
        p_significance: null,
        p_visibility: null,
        p_no_longer_expected: false,
        p_event_type_id: ET_TRIAL_START,
        p_anchor_type: 'trial',
        p_anchor_id: trialB,
        p_metadata: { tags: ['reanchored'] },
      }),
    );

    const { data: row } = await admin
      .from('events')
      .select('anchor_id, event_type_id, metadata')
      .eq('id', eventId)
      .single();
    expect((row as { anchor_id: string }).anchor_id).toBe(trialB);
    expect((row as { event_type_id: string }).event_type_id).toBe(ET_TRIAL_START);
    expect((row as { metadata: Record<string, unknown> }).metadata).toEqual({ tags: ['reanchored'] });

    // Activity not regressed: the analyst date_moved row is emitted for the NEW trial.
    const feed = expectOk(
      await as(p, 'contributor').rpc('get_activity_feed', {
        p_space_id: p.org.spaceId,
        p_filters: { trial_id: trialB },
      }),
    ) as { event_type: string; source: string }[];
    expect(feed.filter((f) => f.source === 'analyst' && f.event_type === 'date_moved')).toHaveLength(1);
  });
});
