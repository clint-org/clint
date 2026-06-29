/**
 * Activity-wiring integration coverage (task CA, migration 20260628300000;
 * re-anchor + re-type coverage, migration 20260629030000).
 *
 * The Activity feed (get_activity_feed) reads public.trial_change_events. Task CA
 * restored two emitters that were lost when C1 retired the marker-audit trigger:
 *
 *   Gap (a): _classify_change emits a `date_moved` row for a CT.gov registry-date
 *            drift (startDateStruct / primaryCompletionDateStruct /
 *            completionDateStruct). ingest_ctgov_snapshot inserts it
 *            (source='ctgov'). The full version-drift coverage lives in
 *            ctgov-marker-precision-over-time.spec.ts group 3; here we assert the
 *            row reaches the get_activity_feed READ path.
 *
 *   Gap (b): update_event (the analyst edit RPC; the Stage 3 merged Event form
 *            edits through it) emits a single source='analyst' row for a
 *            trial-anchored event -- `date_moved` when the event_date moved,
 *            `event_edited` otherwise. It does NOT create an Intelligence-feed
 *            brief (primary_intelligence) and does NOT emit for a no-op edit.
 *
 *   Stage 3 re-anchor / re-type: update_event accepts p_event_type_id,
 *            p_anchor_type, p_anchor_id (all DEFAULT NULL; no-op when omitted).
 *            Validates the anchor exactly like create_event; CA emit targets the
 *            NEW effective anchor when re-anchoring.
 *
 * All assertions go through the live RPCs (update_event, ingest_ctgov_snapshot,
 * get_activity_feed) and the real RLS-checked auth model. Work happens in the
 * persona org space, where `contributor` is a space editor and `reader` a viewer.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectCode, expectOk } from '../harness/as';

const CTGOV_SECRET = 'local-dev-ctgov-secret';

function shortNct(): string {
  return `NCT${randomUUID().replace(/\D/g, '').slice(0, 8).padEnd(8, '0')}`;
}

let p: Personas;
let admin: SupabaseClient;
let systemTypeId: string;

const eventIds: string[] = [];
const trialIds: string[] = [];
let companyId: string;
let assetId: string;

interface FeedItem {
  id: string;
  trial_id: string;
  event_type: string;
  source: string;
  payload: Record<string, unknown>;
}

/** Read get_activity_feed for a single trial as the given persona. */
async function feedForTrial(persona: 'contributor' | 'reader', trialId: string): Promise<FeedItem[]> {
  const r = await as(p, persona).rpc('get_activity_feed', {
    p_space_id: p.org.spaceId,
    p_filters: { trial_id: trialId },
  });
  return expectOk(r) as FeedItem[];
}

async function newTrial(name: string): Promise<string> {
  const { data, error } = await admin
    .from('trials')
    .insert({ space_id: p.org.spaceId, asset_id: assetId, name, created_by: p.ids.contributor })
    .select('id')
    .single();
  if (error) throw new Error(`newTrial: ${error.message}`);
  const id = (data as { id: string }).id;
  trialIds.push(id);
  return id;
}

async function newTrialEvent(trialId: string, title: string, eventDate: string): Promise<string> {
  const { data, error } = await admin
    .from('events')
    .insert({
      space_id: p.org.spaceId,
      event_type_id: systemTypeId,
      title,
      event_date: eventDate,
      anchor_type: 'trial',
      anchor_id: trialId,
      created_by: p.ids.contributor,
      metadata: { source: 'analyst' },
    })
    .select('id')
    .single();
  if (error) throw new Error(`newTrialEvent: ${error.message}`);
  const id = (data as { id: string }).id;
  eventIds.push(id);
  return id;
}

/** update_event with sensible defaults; only title + date vary across tests. */
function callUpdateEvent(
  persona: 'contributor' | 'reader',
  eventId: string,
  title: string,
  eventDate: string
) {
  return as(p, persona).rpc('update_event', {
    p_event_id: eventId,
    p_title: title,
    p_event_date: eventDate,
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
  });
}

beforeAll(async () => {
  p = await buildPersonas();
  admin = adminClient();

  const { data: type } = await admin
    .from('event_types')
    .select('id')
    .is('space_id', null)
    .limit(1)
    .single();
  systemTypeId = (type as { id: string }).id;

  const { data: co, error: coErr } = await admin
    .from('companies')
    .insert({ space_id: p.org.spaceId, name: 'Activity Wiring Co', created_by: p.ids.contributor })
    .select('id')
    .single();
  if (coErr) throw new Error(`company: ${coErr.message}`);
  companyId = (co as { id: string }).id;

  const { data: asset, error: aErr } = await admin
    .from('assets')
    .insert({ space_id: p.org.spaceId, company_id: companyId, name: 'Activity Wiring Asset', created_by: p.ids.contributor })
    .select('id')
    .single();
  if (aErr) throw new Error(`asset: ${aErr.message}`);
  assetId = (asset as { id: string }).id;
}, 120_000);

afterAll(async () => {
  // change-events cascade on trial delete; delete events + trials + asset + company.
  if (eventIds.length) await admin.from('trial_change_events').delete().in('event_id', eventIds);
  if (eventIds.length) await admin.from('events').delete().in('id', eventIds);
  if (trialIds.length) {
    await admin.from('trial_change_events').delete().in('trial_id', trialIds);
    await admin.from('trials').delete().in('id', trialIds);
  }
  if (assetId) await admin.from('assets').delete().eq('id', assetId);
  if (companyId) await admin.from('companies').delete().eq('id', companyId);
});

describe('gap (b): analyst event edit via update_event -> Activity', () => {
  it('a date change emits one source=analyst date_moved row that get_activity_feed returns', async () => {
    const trialId = await newTrial('AW date-move trial');
    const eventId = await newTrialEvent(trialId, 'Topline readout', '2026-01-01');

    expectOk(await callUpdateEvent('contributor', eventId, 'Topline readout', '2026-05-01'));

    const feed = await feedForTrial('contributor', trialId);
    const rows = feed.filter((f) => f.event_type === 'date_moved');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe('analyst');
    expect(rows[0]!.payload['which_date']).toBe('event_date');
    expect(rows[0]!.payload['from']).toBe('2026-01-01');
    expect(rows[0]!.payload['to']).toBe('2026-05-01');
  });

  it('a title-only change emits one source=analyst event_edited row (no date_moved)', async () => {
    const trialId = await newTrial('AW title-edit trial');
    const eventId = await newTrialEvent(trialId, 'Original title', '2026-02-01');

    expectOk(await callUpdateEvent('contributor', eventId, 'Revised title', '2026-02-01'));

    const feed = await feedForTrial('contributor', trialId);
    expect(feed.filter((f) => f.event_type === 'date_moved')).toHaveLength(0);
    const edits = feed.filter((f) => f.event_type === 'event_edited');
    expect(edits).toHaveLength(1);
    expect(edits[0]!.source).toBe('analyst');
    expect(edits[0]!.payload['title']).toBe('Revised title');
  });

  it('a no-op edit (identical title + date) emits nothing', async () => {
    const trialId = await newTrial('AW no-op trial');
    const eventId = await newTrialEvent(trialId, 'Unchanged', '2026-03-01');

    expectOk(await callUpdateEvent('contributor', eventId, 'Unchanged', '2026-03-01'));

    const feed = await feedForTrial('contributor', trialId);
    expect(feed).toHaveLength(0);
  });

  it('the analyst edit does NOT create an Intelligence-feed brief (primary_intelligence)', async () => {
    const trialId = await newTrial('AW no-brief trial');
    const eventId = await newTrialEvent(trialId, 'Readout', '2026-04-01');

    const { count: before } = await admin
      .from('primary_intelligence')
      .select('id', { count: 'exact', head: true })
      .eq('space_id', p.org.spaceId);

    expectOk(await callUpdateEvent('contributor', eventId, 'Readout', '2026-09-01'));

    const { count: after } = await admin
      .from('primary_intelligence')
      .select('id', { count: 'exact', head: true })
      .eq('space_id', p.org.spaceId);

    expect(after).toBe(before);
    // but the Activity row IS present
    const feed = await feedForTrial('contributor', trialId);
    expect(feed.filter((f) => f.source === 'analyst')).toHaveLength(1);
  });

  it('a viewer cannot edit (42501) so no Activity row is emitted', async () => {
    const trialId = await newTrial('AW viewer trial');
    const eventId = await newTrialEvent(trialId, 'Locked', '2026-05-01');

    expectCode(await callUpdateEvent('reader', eventId, 'Hacked', '2027-01-01'), '42501');

    const feed = await feedForTrial('contributor', trialId);
    expect(feed).toHaveLength(0);
  });
});

describe('gap (a): CT.gov date drift -> Activity (through get_activity_feed)', () => {
  it('a startDateStruct drift surfaces a source=ctgov date_moved row in the feed', async () => {
    const trialId = await newTrial('AW ctgov drift trial');
    const nct = shortNct();

    const ingest = (version: number, postDate: string, startDate: string) =>
      admin.rpc('ingest_ctgov_snapshot', {
        p_secret: CTGOV_SECRET,
        p_trial_id: trialId,
        p_space_id: p.org.spaceId,
        p_nct_id: nct,
        p_version: version,
        p_post_date: postDate,
        p_payload: {
          protocolSection: { statusModule: { startDateStruct: { date: startDate, type: 'ANTICIPATED' } } },
        },
        p_fetched_via: 'manual_sync',
        p_module_hints: null,
      });

    expectOk(await ingest(1, '2026-01-01', '2026-06-01'));
    expectOk(await ingest(2, '2026-02-01', '2026-09-01'));

    const feed = await feedForTrial('contributor', trialId);
    const rows = feed.filter((f) => f.event_type === 'date_moved');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const row of rows) {
      expect(row.source).toBe('ctgov');
      expect(row.payload['which_date']).toBe('start');
    }
  });
});

/**
 * Stage 3 re-anchor + re-type (migration 20260629030000).
 *
 * update_event now accepts p_event_type_id / p_anchor_type / p_anchor_id, each
 * DEFAULT NULL so existing callers are unaffected.  These tests cover the four
 * requirements from the brief:
 *
 *   (a) anchor_type / anchor_id / event_type_id are updated when provided.
 *   (b) invalid anchor_type -> 22023.
 *   (c) anchor_id belonging to a different space -> 22023.
 *   (d) re-anchoring a trial event still emits the analyst trial_change_events
 *       row, keyed to the NEW trial.
 */
describe('Stage 3 re-anchor + re-type via update_event', () => {
  /** Helper: call update_event with the new optional params. */
  function callUpdateEventWithAnchor(
    persona: 'contributor' | 'reader',
    eventId: string,
    opts: {
      eventDate?: string;
      eventTypeId?: string | null;
      anchorType?: string | null;
      anchorId?: string | null;
    } = {},
  ) {
    return as(p, persona).rpc('update_event', {
      p_event_id: eventId,
      p_title: 'Reanchor test event',
      p_event_date: opts.eventDate ?? '2026-01-01',
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
      p_event_type_id: opts.eventTypeId ?? null,
      p_anchor_type: opts.anchorType ?? null,
      p_anchor_id: opts.anchorId ?? null,
    });
  }

  it('(a) re-anchors an event and updates event_type_id when provided', async () => {
    const trialA = await newTrial('Reanchor src trial A');
    const trialB = await newTrial('Reanchor dst trial B');

    // get two distinct system event types
    const { data: types } = await admin
      .from('event_types')
      .select('id')
      .is('space_id', null)
      .limit(2);
    const typeA = (types as { id: string }[])[0]!.id;
    const typeB = (types as { id: string }[])[1]!.id;

    // create event anchored to trialA with typeA
    const { data: ev, error: evErr } = await admin
      .from('events')
      .insert({
        space_id: p.org.spaceId,
        event_type_id: typeA,
        title: 'Reanchor test event',
        event_date: '2026-01-01',
        anchor_type: 'trial',
        anchor_id: trialA,
        created_by: p.ids.contributor,
        metadata: { source: 'analyst' },
      })
      .select('id')
      .single();
    if (evErr) throw new Error(`create event: ${evErr.message}`);
    const eventId = (ev as { id: string }).id;
    eventIds.push(eventId);

    expectOk(
      await callUpdateEventWithAnchor('contributor', eventId, {
        eventTypeId: typeB,
        anchorType: 'trial',
        anchorId: trialB,
      }),
    );

    const { data: row } = await admin
      .from('events')
      .select('anchor_type, anchor_id, event_type_id')
      .eq('id', eventId)
      .single();
    expect((row as { anchor_type: string }).anchor_type).toBe('trial');
    expect((row as { anchor_id: string }).anchor_id).toBe(trialB);
    expect((row as { event_type_id: string }).event_type_id).toBe(typeB);
  });

  it('(b) invalid anchor_type raises 22023', async () => {
    const trialId = await newTrial('Invalid anchor type trial');
    const eventId = await newTrialEvent(trialId, 'Invalid anchor type event', '2026-01-01');

    expectCode(
      await callUpdateEventWithAnchor('contributor', eventId, { anchorType: 'bogus' }),
      '22023',
    );
  });

  it('(c) anchor_id from a different space raises 22023', async () => {
    // create a scratch space in the same tenant with a trial the contributor
    // is NOT a member of; the trial therefore does not belong to the event's space
    const { data: space2, error: spErr } = await admin
      .from('spaces')
      .insert({
        tenant_id: p.org.tenantId,
        name: 'Reanchor cross-space scratch',
        created_by: p.ids.contributor,
      })
      .select('id')
      .single();
    if (spErr) throw new Error(`space2: ${spErr.message}`);
    const space2Id = (space2 as { id: string }).id;

    const { data: co2 } = await admin
      .from('companies')
      .insert({ space_id: space2Id, name: 'Cross-space Co', created_by: p.ids.contributor })
      .select('id')
      .single();
    const { data: as2 } = await admin
      .from('assets')
      .insert({
        space_id: space2Id,
        company_id: (co2 as { id: string }).id,
        name: 'Cross-space Asset',
        created_by: p.ids.contributor,
      })
      .select('id')
      .single();
    const { data: tr2 } = await admin
      .from('trials')
      .insert({
        space_id: space2Id,
        asset_id: (as2 as { id: string }).id,
        name: 'Cross-space Trial',
        created_by: p.ids.contributor,
      })
      .select('id')
      .single();
    const crossTrialId = (tr2 as { id: string }).id;

    // event lives in the main test space
    const mainTrialId = await newTrial('Cross-space main trial');
    const eventId = await newTrialEvent(mainTrialId, 'Cross-space test event', '2026-01-01');

    // re-anchor to a trial in space2 -- must fail with 22023
    expectCode(
      await callUpdateEventWithAnchor('contributor', eventId, {
        anchorType: 'trial',
        anchorId: crossTrialId,
      }),
      '22023',
    );

    // cleanup space2 entities (wipe on next buildPersonas also catches these)
    await admin.from('trials').delete().eq('id', crossTrialId);
    await admin.from('assets').delete().eq('id', (as2 as { id: string }).id);
    await admin.from('companies').delete().eq('id', (co2 as { id: string }).id);
    await admin.from('spaces').delete().eq('id', space2Id);
  });

  it('(d) re-anchoring a trial event emits an analyst trial_change_events row for the NEW trial', async () => {
    const trialA = await newTrial('Activity reanchor src trial');
    const trialB = await newTrial('Activity reanchor dst trial');
    const eventId = await newTrialEvent(trialA, 'Activity reanchor event', '2026-01-01');

    // re-anchor to trialB + change the date so date_moved is triggered
    expectOk(
      await callUpdateEventWithAnchor('contributor', eventId, {
        eventDate: '2026-06-01',
        anchorType: 'trial',
        anchorId: trialB,
      }),
    );

    // CA emit must be on trialB, not trialA
    const feedB = await feedForTrial('contributor', trialB);
    expect(feedB.filter((f) => f.source === 'analyst' && f.event_type === 'date_moved')).toHaveLength(1);

    const feedA = await feedForTrial('contributor', trialA);
    expect(feedA.filter((f) => f.source === 'analyst')).toHaveLength(0);
  });
});
