/**
 * Regression guard: update_event must resolve for the EXACT arg shape the Angular
 * client sends (UpdateEventArgs + p_event_id, no p_source_url). Pre-fix the deployed
 * RPC kept a required p_source_url, so PostgREST returned PGRST202 and every edit
 * failed with "Could not save the event."
 *
 * The arg set below is the literal shape event.service.updateEvent builds: the
 * UpdateEventArgs keys plus p_event_id, with p_metadata omitted when null. No
 * p_source_url -- the client dropped it. The bug is overload resolution at
 * PostgREST, so a space anchor reproduces it identically to a trial anchor.
 *
 * Run after `supabase db reset` with SUPABASE_SERVICE_ROLE_KEY exported.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectOk } from '../harness/as';

const ET_STRATEGIC = 'a0000000-0000-0000-0000-000000000070';

let p: Personas;
let admin: SupabaseClient;
let eventId: string;

beforeAll(async () => {
  p = await buildPersonas();
  admin = adminClient();
  const { data: id } = await as(p, 'contributor')
    .rpc('create_event', {
      p_space_id: p.org.spaceId,
      p_event_type_id: ET_STRATEGIC,
      p_title: 'Edit-shape target',
      p_event_date: '2026-03-01',
      p_anchor_type: 'space',
    })
    .throwOnError();
  eventId = id as string;
}, 120_000);

afterAll(async () => {
  if (eventId) await admin.from('events').delete().eq('id', eventId);
});

describe('update_event resolves for the production client arg shape', () => {
  it('accepts UpdateEventArgs + p_event_id with no p_source_url', async () => {
    // EXACT keys event.service.updateEvent sends; p_metadata omitted when null.
    const clientArgs = {
      p_event_id: eventId,
      p_event_type_id: ET_STRATEGIC,
      p_anchor_type: 'space',
      p_anchor_id: null,
      p_title: 'Edit-shape target RENAMED',
      p_event_date: '2026-03-01',
      p_projection: 'actual',
      p_date_precision: 'exact',
      p_end_date: null,
      p_end_date_precision: 'exact',
      p_is_ongoing: false,
      p_description: null,
      p_significance: null,
      p_visibility: null,
      p_no_longer_expected: false,
    };
    expectOk(await as(p, 'contributor').rpc('update_event', clientArgs));
    const { data } = await admin.from('events').select('title').eq('id', eventId).single();
    expect((data as { title: string }).title).toBe('Edit-shape target RENAMED');
  });
});
