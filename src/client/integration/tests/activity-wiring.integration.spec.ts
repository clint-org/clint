/**
 * Activity-wiring integration coverage (task CA, migration 20260628300000).
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
