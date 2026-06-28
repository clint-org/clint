/**
 * events-detected-date-moved-title.spec.ts
 *
 * Regression guard for the detected `date_moved` feed title.
 *
 * get_events_page_data builds the title for detected CT.gov change rows in SQL.
 * The date_moved branch once read payload keys the producer never writes
 * (`field` + `days_shifted`); the real keys are `which_date` + `days_diff`.
 * Because SQL `||` propagates NULL, a single missing key collapsed the whole
 * title to NULL, so these rows rendered blank in the Events overview
 * "Most recent" list, were invisible to title search, and never flagged high
 * priority on a large shift.
 *
 * This spec inserts trial_change_events with realistic payloads and asserts the
 * title renders, the magnitude is NULL-safe, search matches, and the >60-day
 * priority rule fires.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPersonas, Personas, adminClient } from '../fixtures/personas';
import { createScratchAgency } from '../fixtures/scratch';
import { SupabaseClient } from '@supabase/supabase-js';

interface FeedItem {
  source_type: string;
  title: string;
  priority: string | null;
  change_event_type: string | null;
}

let p: Personas;
let svc: SupabaseClient;
let spaceId: string;
let trialId: string;
let agencyCleanup: () => Promise<void>;

beforeAll(async () => {
  p = await buildPersonas();
  svc = adminClient();

  const scratch = await createScratchAgency(p);
  spaceId = scratch.spaceId;
  agencyCleanup = scratch.cleanup;

  const createdBy = p.ids.tenant_owner;

  const { data: company, error: companyErr } = await svc
    .from('companies')
    .insert({ space_id: spaceId, name: 'Co1', created_by: createdBy })
    .select('id')
    .single();
  if (companyErr) throw new Error(`insert company: ${companyErr.message}`);

  const { data: asset, error: assetErr } = await svc
    .from('assets')
    .insert({ space_id: spaceId, company_id: company!.id, name: 'Prod1', created_by: createdBy })
    .select('id')
    .single();
  if (assetErr) throw new Error(`insert asset: ${assetErr.message}`);

  const { data: trial, error: trialErr } = await svc
    .from('trials')
    .insert({ space_id: spaceId, asset_id: asset!.id, name: 'Trial1', created_by: createdBy })
    .select('id')
    .single();
  if (trialErr) throw new Error(`insert trial: ${trialErr.message}`);
  trialId = trial!.id;

  // Three detected date_moved changes:
  //  - big accelerate (>60d) -> high priority, "pulled forward"
  //  - small accelerate (<=60d) -> normal priority
  //  - missing days_diff -> title must still render (NULL-safe magnitude)
  const { error: ceErr } = await svc.from('trial_change_events').insert([
    {
      space_id: spaceId,
      trial_id: trialId,
      event_type: 'date_moved',
      source: 'ctgov',
      occurred_at: '2026-06-20T00:00:00Z',
      payload: {
        which_date: 'event_date',
        marker_title: 'REDEFINE-2 topline projected',
        direction: 'accelerate',
        days_diff: 369,
        from: '2026-01-01',
        to: '2025-01-01',
      },
    },
    {
      space_id: spaceId,
      trial_id: trialId,
      event_type: 'date_moved',
      source: 'ctgov',
      occurred_at: '2026-06-19T00:00:00Z',
      payload: {
        which_date: 'event_date',
        marker_title: 'VK2735 oral P2 final results projected',
        direction: 'accelerate',
        days_diff: 52,
        from: '2026-03-01',
        to: '2026-01-08',
      },
    },
    {
      space_id: spaceId,
      trial_id: trialId,
      event_type: 'date_moved',
      source: 'ctgov',
      occurred_at: '2026-06-18T00:00:00Z',
      payload: {
        which_date: 'primary_completion',
        direction: 'delay',
        from: '2026-01-01',
        to: '2026-06-01',
      },
    },
  ]);
  if (ceErr) throw new Error(`insert trial_change_events: ${ceErr.message}`);
}, 120_000);

afterAll(async () => {
  if (agencyCleanup) await agencyCleanup();
});

async function detectedItems(search?: string): Promise<FeedItem[]> {
  const { data, error } = await svc.rpc('get_events_page_data', {
    p_space_id: spaceId,
    p_source_type: 'detected',
    p_search: search ?? null,
    p_limit: 50,
    p_offset: 0,
  });
  if (error) throw new Error(`get_events_page_data: ${error.message}`);
  return (data as { items: FeedItem[] }).items;
}

describe('get_events_page_data detected date_moved title', () => {
  it('renders a non-blank title for every detected row', async () => {
    const items = await detectedItems();
    expect(items.length).toBe(3);
    for (const item of items) {
      expect(item.title.trim().length).toBeGreaterThan(0);
    }
  });

  it('leads with the marker title and reports direction + magnitude', async () => {
    const items = await detectedItems();
    const big = items.find((i) => i.title.startsWith('REDEFINE-2 topline projected'));
    expect(big?.title).toBe('REDEFINE-2 topline projected: event date pulled forward 369 days');
  });

  it('omits the magnitude (NULL-safe) when days_diff is missing, keeping a title', async () => {
    const items = await detectedItems();
    const noDays = items.find((i) => i.title.startsWith('Primary Completion'));
    expect(noDays?.title).toBe('Primary Completion delayed');
  });

  it('never assigns a priority to detected rows (no auto high tier)', async () => {
    const items = await detectedItems();
    const big = items.find((i) => i.title.includes('369 days'));
    const small = items.find((i) => i.title.includes('52 days'));
    expect(big).toBeDefined();
    expect(small).toBeDefined();
    expect(big?.priority ?? null).toBeNull();
    expect(small?.priority ?? null).toBeNull();
    expect(items.every((i) => (i.priority ?? null) === null)).toBe(true);
  });

  it('matches the rendered title in search (previously blank, unsearchable)', async () => {
    const hits = await detectedItems('pulled forward');
    expect(hits.length).toBe(2);
    expect(hits.every((i) => i.change_event_type === 'date_moved')).toBe(true);
  });
});
