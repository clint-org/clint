/**
 * list_intelligence_feed: the merged Intelligence-feed RPC.
 *
 * Proves the unified briefs+events stream: feed_ts-desc interleave (briefs by
 * updated_at, events by created_at), NO significance/visibility gating, the
 * kind/category/since/query filters, pagination + total, and RLS scoping.
 *
 * Seeds the personas fixture space (which buildPersonas recreates empty each
 * run) with one published brief and three events at controlled timestamps so
 * the interleave assertion is deterministic. event_date is deliberately
 * unrelated to created_at to prove it is not the sort key.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectOk } from '../harness/as';

const ET_TOPLINE = 'a0000000-0000-0000-0000-000000000013'; // Topline Data -> Data category, high
const ET_LEADERSHIP = 'a0000000-0000-0000-0000-000000000050'; // Leadership Change -> Corporate, low
const ET_LOE = 'a0000000-0000-0000-0000-000000000020'; // LOE Date -> Loss of Exclusivity, high
const ET_TRIAL_START = 'a0000000-0000-0000-0000-000000000011'; // Trial Start -> structural Clinical

interface FeedRow {
  kind: 'brief' | 'event';
  id: string;
  feed_ts: string;
  title: string;
  entity_type: string | null;
  category_name?: string;
  significance?: string | null;
  visibility?: string | null;
}
interface FeedResult {
  rows: FeedRow[];
  total: number;
  limit: number;
  offset: number;
}

let p: Personas;
let spaceId: string;
let companyId: string;

beforeAll(async () => {
  p = await buildPersonas();
  spaceId = p.org.spaceId;
  const admin = adminClient();

  // a company to anchor company-level events
  const co = expectOk(
    await admin
      .from('companies')
      .insert({ space_id: spaceId, name: 'FeedCo', created_by: p.ids.space_owner })
      .select('id')
      .single()
  ) as { id: string };
  companyId = co.id;

  // one published brief, updated_at = 2026-03-10
  const anchor = expectOk(
    await admin
      .from('primary_intelligence_anchors')
      .insert({ space_id: spaceId, entity_type: 'company', entity_id: companyId, is_lead: true, display_order: 0 })
      .select('id')
      .single()
  ) as { id: string };
  expectOk(
    await admin
      .from('primary_intelligence')
      .insert({
        space_id: spaceId,
        anchor_id: anchor.id,
        state: 'published',
        headline: 'FeedCo competitive read',
        summary_md: 'Body about FeedCo.',
        implications_md: 'x',
        last_edited_by: p.ids.space_owner,
        version_number: 1,
        published_at: '2026-03-10T12:00:00Z',
        updated_at: '2026-03-10T12:00:00Z',
      })
      .select('id')
      .single()
  );

  // three events. created_at controls feed order; event_date is unrelated.
  // - leadership (LOW significance), created 2026-03-12  -> must still appear (no gating)
  // - LOE (HIGH) but visibility='hidden', created 2026-03-08 -> must still appear (no gating)
  // - topline clinical (HIGH), created 2026-03-05
  const rows = [
    { event_type_id: ET_LEADERSHIP, title: 'CEO comment', event_date: '2026-01-15', created_at: '2026-03-12T09:00:00Z', visibility: null as string | null },
    { event_type_id: ET_LOE, title: 'Hidden LOE', event_date: '2030-06-01', created_at: '2026-03-08T09:00:00Z', visibility: 'hidden' },
    { event_type_id: ET_TOPLINE, title: 'Topline readout', event_date: '2026-09-01', created_at: '2026-03-05T09:00:00Z', visibility: null },
  ];
  for (const r of rows) {
    expectOk(
      await admin
        .from('events')
        .insert({
          space_id: spaceId,
          event_type_id: r.event_type_id,
          title: r.title,
          event_date: r.event_date,
          anchor_type: 'company',
          anchor_id: companyId,
          visibility: r.visibility,
          projection: 'actual',
          created_by: p.ids.space_owner,
          created_at: r.created_at,
        })
        .select('id')
        .single()
    );
  }

  // A structural trial-lifecycle marker (Trial Start = system Clinical category),
  // created most-recently so it WOULD top the feed if not excluded. The feed drops
  // the whole Clinical category (phase-bar scaffolding), regardless of provenance.
  expectOk(
    await admin
      .from('events')
      .insert({
        space_id: spaceId,
        event_type_id: ET_TRIAL_START,
        title: 'Trial lifecycle marker',
        event_date: '2026-05-01',
        anchor_type: 'company',
        anchor_id: companyId,
        projection: 'actual',
        created_by: p.ids.space_owner,
        created_at: '2026-03-20T09:00:00Z',
      })
      .select('id')
      .single()
  );
});

async function feed(args: Record<string, unknown>): Promise<FeedResult> {
  const res = await as(p, 'space_owner').rpc('list_intelligence_feed', {
    p_space_id: spaceId,
    p_kinds: null,
    p_categories: null,
    p_since: null,
    p_query: null,
    p_limit: 25,
    p_offset: 0,
    ...args,
  });
  return expectOk(res) as unknown as FeedResult;
}

describe('list_intelligence_feed', () => {
  it('interleaves briefs (updated_at) and events (created_at) feed_ts-desc', async () => {
    const r = await feed({});
    expect(r.total).toBe(4);
    // order by feed_ts desc: leadership(03-12), brief(03-10), hiddenLOE(03-08), topline(03-05)
    expect(r.rows.map((x) => x.title)).toEqual([
      'CEO comment',
      'FeedCo competitive read',
      'Hidden LOE',
      'Topline readout',
    ]);
    expect(r.rows.map((x) => x.kind)).toEqual(['event', 'brief', 'event', 'event']);
  });

  it('excludes structural Clinical trial-lifecycle markers, even though newest', async () => {
    const r = await feed({});
    expect(r.rows.map((x) => x.title)).not.toContain('Trial lifecycle marker');
    // brief + 3 curated events (Data/Corporate/LOE); the Clinical marker is dropped
    // despite being the newest row.
    expect(r.total).toBe(4);
    const onlyEvents = await feed({ p_kinds: ['event'] });
    expect(onlyEvents.rows.map((x) => x.title)).not.toContain('Trial lifecycle marker');
    expect(onlyEvents.total).toBe(3);
  });

  it('does NOT gate on significance or visibility (low-sig + hidden both appear)', async () => {
    const r = await feed({ p_kinds: ['event'] });
    const titles = r.rows.map((x) => x.title);
    expect(titles).toContain('CEO comment'); // low significance
    expect(titles).toContain('Hidden LOE'); // visibility = hidden
    expect(r.total).toBe(3);
  });

  it('p_kinds filters legs', async () => {
    expect((await feed({ p_kinds: ['brief'] })).total).toBe(1);
    expect((await feed({ p_kinds: ['event'] })).total).toBe(3);
  });

  it('p_categories filters the event leg only; briefs unaffected', async () => {
    // The Leadership Change type lives in the 'Corporate' category (the
    // corporate_event_family migration consolidated Leadership/Financial/Strategic).
    const r = await feed({ p_categories: ['Corporate'] });
    // 1 corporate event (CEO comment) + the 1 brief (briefs have no category, so they pass)
    expect(r.total).toBe(2);
    expect(r.rows.filter((x) => x.kind === 'event').map((x) => x.title)).toEqual(['CEO comment']);
    expect(r.rows.some((x) => x.kind === 'brief')).toBe(true);
  });

  it('p_query matches brief headline/summary OR event title/description', async () => {
    expect((await feed({ p_query: 'topline' })).total).toBe(1);
    expect((await feed({ p_query: 'feedco' })).total).toBe(1); // brief headline
  });

  it('p_since filters on feed_ts across both kinds', async () => {
    const r = await feed({ p_since: '2026-03-09T00:00:00Z' });
    // leadership(03-12) + brief(03-10) only
    expect(r.total).toBe(2);
  });

  it('paginates with a stable total', async () => {
    const page1 = await feed({ p_limit: 2, p_offset: 0 });
    const page2 = await feed({ p_limit: 2, p_offset: 2 });
    expect(page1.total).toBe(4);
    expect(page1.rows).toHaveLength(2);
    expect(page2.rows).toHaveLength(2);
    expect(page1.rows[0].title).toBe('CEO comment');
    expect(page2.rows[0].title).toBe('Hidden LOE');
  });

  it('RLS: a non-member sees nothing', async () => {
    const r = await as(p, 'no_memberships').rpc('list_intelligence_feed', {
      p_space_id: spaceId,
      p_kinds: null,
      p_categories: null,
      p_since: null,
      p_query: null,
      p_limit: 25,
      p_offset: 0,
    });
    expect((expectOk(r) as unknown as FeedResult).total).toBe(0);
  });
});
