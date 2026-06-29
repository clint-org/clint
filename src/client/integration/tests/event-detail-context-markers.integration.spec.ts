/**
 * get_event_detail context lists: upcoming_markers / recent_markers.
 *
 * The event-model rewrite stubbed these two arrays to `[]`, so the marker
 * detail pane's "Upcoming events" / "Recent events" sections never rendered.
 * Migration 20260629190000 repopulates them, scoped to the clicked event's
 * parent asset (trial/asset events roll up to the asset; company events scope
 * to the company; space events to the space), mirroring the bullseye drawer.
 *
 * This proves the SQL bucketing: future-vs-past split around today, ascending
 * upcoming / descending recent, the clicked event excluded, a sibling asset's
 * events excluded (scope firewall), and is_projected derived from projection.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectOk } from '../harness/as';

// System event_type UUID (Topline Data; seeded by the event_types migration).
const ET_TOPLINE = 'a0000000-0000-0000-0000-000000000013';

let p: Personas;
let admin: SupabaseClient;

let companyId: string;
let assetA: string;
let assetB: string;

let pastA1: string; // asset A, ~40d ago, projection actual
let pastA2: string; // asset A, ~10d ago, projection actual
let futA1: string; // asset A, ~10d ahead, projection actual (the clicked event)
let futA2: string; // asset A, ~40d ahead, projection primary (projected)
let futB1: string; // asset B, ~20d ahead -> must NOT leak into asset A's lists

/** ISO YYYY-MM-DD offset from the DB's "now" (use real clock, not a fixed year). */
function isoOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function createAssetEvent(opts: {
  title: string;
  date: string;
  anchorId: string;
  projection?: string;
}): Promise<string> {
  const r = await as(p, 'space_owner').rpc('create_event', {
    p_space_id: p.org.spaceId,
    p_event_type_id: ET_TOPLINE,
    p_title: opts.title,
    p_event_date: opts.date,
    p_anchor_type: 'asset',
    p_anchor_id: opts.anchorId,
    p_projection: opts.projection ?? 'actual',
  });
  return expectOk(r) as unknown as string;
}

interface ContextMarker {
  marker_id: string;
  event_date: string;
  is_projected: boolean;
  projection: string | null;
}
interface Detail {
  catalyst: { asset_id: string | null };
  upcoming_markers: ContextMarker[];
  recent_markers: ContextMarker[];
}

async function fetchDetail(eventId: string): Promise<Detail> {
  const r = await as(p, 'space_owner').rpc('get_event_detail', { p_event_id: eventId });
  return expectOk(r) as unknown as Detail;
}

beforeAll(async () => {
  p = await buildPersonas();
  admin = adminClient();

  const { data: co, error: coErr } = await admin
    .from('companies')
    .insert({
      space_id: p.org.spaceId,
      name: 'Context Pharma',
      display_order: 0,
      created_by: p.ids.space_owner,
    })
    .select()
    .single();
  if (coErr) throw new Error(`company insert: ${coErr.message}`);
  companyId = co.id as string;

  const { data: assets, error: aErr } = await admin
    .from('assets')
    .insert([
      {
        space_id: p.org.spaceId,
        company_id: companyId,
        name: 'Context-A',
        display_order: 0,
        created_by: p.ids.space_owner,
      },
      {
        space_id: p.org.spaceId,
        company_id: companyId,
        name: 'Context-B',
        display_order: 1,
        created_by: p.ids.space_owner,
      },
    ])
    .select();
  if (aErr) throw new Error(`assets insert: ${aErr.message}`);
  assetA = (assets.find((a) => a.name === 'Context-A')!.id as string);
  assetB = (assets.find((a) => a.name === 'Context-B')!.id as string);

  pastA1 = await createAssetEvent({ title: 'A past 40', date: isoOffset(-40), anchorId: assetA });
  pastA2 = await createAssetEvent({ title: 'A past 10', date: isoOffset(-10), anchorId: assetA });
  futA1 = await createAssetEvent({ title: 'A future 10', date: isoOffset(10), anchorId: assetA });
  futA2 = await createAssetEvent({
    title: 'A future 40',
    date: isoOffset(40),
    anchorId: assetA,
    projection: 'primary',
  });
  futB1 = await createAssetEvent({ title: 'B future 20', date: isoOffset(20), anchorId: assetB });
}, 120_000);

afterAll(async () => {
  // Tidy up; the personas wipe also handles these on the next run.
  for (const id of [pastA1, pastA2, futA1, futA2, futB1].filter(Boolean)) {
    await admin.from('events').delete().eq('id', id);
  }
  if (assetA || assetB) await admin.from('assets').delete().in('id', [assetA, assetB]);
  if (companyId) await admin.from('companies').delete().eq('id', companyId);
});

describe('get_event_detail upcoming_markers / recent_markers', () => {
  it('upcoming excludes the clicked event and a sibling asset, ascending by date', async () => {
    const d = await fetchDetail(futA1);
    expect(d.catalyst.asset_id).toBe(assetA);
    // Only asset-A future events, excluding the clicked futA1 -> just futA2.
    // futB1 (sibling asset) must not leak in.
    expect(d.upcoming_markers.map((m) => m.marker_id)).toEqual([futA2]);
    expect(d.upcoming_markers.map((m) => m.marker_id)).not.toContain(futB1);
  });

  it('recent returns past asset-A events, most-recent first', async () => {
    const d = await fetchDetail(futA1);
    // past events on asset A, descending: pastA2 (10d ago) before pastA1 (40d ago).
    expect(d.recent_markers.map((m) => m.marker_id)).toEqual([pastA2, pastA1]);
  });

  it('derives is_projected from projection (primary -> projected)', async () => {
    const d = await fetchDetail(futA1);
    const projected = d.upcoming_markers.find((m) => m.marker_id === futA2);
    expect(projected?.is_projected).toBe(true);
    expect(projected?.projection).toBe('primary');
  });

  it('clicking a past event surfaces the future ones as upcoming', async () => {
    const d = await fetchDetail(pastA1);
    // From the oldest event: upcoming = both futures (asc), recent = pastA2 only.
    expect(d.upcoming_markers.map((m) => m.marker_id)).toEqual([futA1, futA2]);
    expect(d.recent_markers.map((m) => m.marker_id)).toEqual([pastA2]);
  });
});
