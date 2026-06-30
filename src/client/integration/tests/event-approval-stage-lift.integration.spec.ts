/**
 * Approval/Launch stage lift (issue #159) -- end to end through the SHIPPED RPCs.
 *
 * Proves that an actual Approval/Launch event tagged with an indication lifts
 * asset_indications.development_status to APPROVED/LAUNCHED for THAT indication
 * (so the bullseye/heatmap stop pinning approved assets at their trial phase),
 * while leaving sibling indications and forecasted/cleared events untouched.
 *
 * Everything runs via create_event / update_event (the real client contract:
 * args typed as CreateEventArgs/UpdateEventArgs, so a dropped key is a compile
 * error) -> the events trigger -> _recompute_asset_indication_status. No function
 * is modified here; the trigger does ensure-row + recompute.
 *
 * Run after `supabase db reset` with SUPABASE_SERVICE_ROLE_KEY exported.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as } from '../harness/as';
import { CreateEventArgs, UpdateEventArgs } from '../../src/app/core/models/event-write.model';

const ET_APPROVAL = 'a0000000-0000-0000-0000-000000000035';
const ET_LAUNCH = 'a0000000-0000-0000-0000-000000000036';

let p: Personas;
let admin: SupabaseClient;
let companyId: string;
let assetId: string;
let fcsId: string; // indication with a P3 trial
let htgId: string; // sibling indication with a P3 trial
let newId: string; // indication with NO trial / NO asset_indication row
const eventIds: string[] = [];

async function statusOf(indicationId: string): Promise<string | null> {
  const { data } = await admin
    .from('asset_indications')
    .select('development_status')
    .eq('asset_id', assetId)
    .eq('indication_id', indicationId)
    .maybeSingle()
    .throwOnError();
  return (data as { development_status: string | null } | null)?.development_status ?? null;
}

// create_event via the client contract (named args incl. p_indication_id).
async function createEvent(args: Partial<CreateEventArgs> & { p_event_type_id: string }): Promise<string> {
  const full: CreateEventArgs = {
    p_event_type_id: args.p_event_type_id,
    p_title: args.p_title ?? 'approval',
    p_event_date: args.p_event_date ?? '2026-01-01',
    p_anchor_type: args.p_anchor_type ?? 'asset',
    p_anchor_id: args.p_anchor_id ?? assetId,
    p_projection: args.p_projection ?? 'actual',
    p_date_precision: args.p_date_precision ?? 'exact',
    p_end_date: null,
    p_end_date_precision: 'exact',
    p_is_ongoing: false,
    p_description: null,
    p_significance: null,
    p_visibility: null,
    p_metadata: null,
    p_sources: null,
    p_indication_id: args.p_indication_id ?? null,
  };
  const { data } = await as(p, 'space_owner')
    .rpc('create_event', { p_space_id: p.org.spaceId, ...full })
    .throwOnError();
  const id = data as string;
  eventIds.push(id);
  return id;
}

async function updateEvent(eventId: string, over: Partial<UpdateEventArgs>): Promise<void> {
  const full: UpdateEventArgs = {
    p_event_type_id: ET_APPROVAL,
    p_anchor_type: 'asset',
    p_anchor_id: assetId,
    p_title: 'approval',
    p_event_date: '2026-01-01',
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
    p_indication_id: fcsId,
    ...over,
  };
  await as(p, 'space_owner').rpc('update_event', { p_event_id: eventId, ...full }).throwOnError();
}

beforeAll(async () => {
  p = await buildPersonas();
  admin = adminClient();
  const uid = p.ids.space_owner;
  const sid = p.org.spaceId;

  companyId = (await admin.from('companies').insert({ space_id: sid, name: 'Lift Co', created_by: uid }).select('id').single().throwOnError()).data!.id;
  assetId = (await admin.from('assets').insert({ space_id: sid, company_id: companyId, name: 'Lift Asset', created_by: uid }).select('id').single().throwOnError()).data!.id;

  fcsId = (await admin.from('indications').insert({ space_id: sid, name: 'Lift FCS', created_by: uid }).select('id').single().throwOnError()).data!.id;
  htgId = (await admin.from('indications').insert({ space_id: sid, name: 'Lift HTG', created_by: uid }).select('id').single().throwOnError()).data!.id;
  newId = (await admin.from('indications').insert({ space_id: sid, name: 'Lift NEW', created_by: uid }).select('id').single().throwOnError()).data!.id;

  const condFcs = (await admin.from('conditions').insert({ space_id: sid, name: 'Lift cond FCS', source: 'analyst' }).select('id').single().throwOnError()).data!.id;
  const condHtg = (await admin.from('conditions').insert({ space_id: sid, name: 'Lift cond HTG', source: 'analyst' }).select('id').single().throwOnError()).data!.id;
  await admin.from('condition_indication_map').insert([
    { condition_id: condFcs, indication_id: fcsId },
    { condition_id: condHtg, indication_id: htgId },
  ]).throwOnError();

  // program rows first (auto), then trials -> recompute sets P3.
  await admin.from('asset_indications').insert([
    { asset_id: assetId, indication_id: fcsId, space_id: sid, development_status_source: 'auto', created_by: uid },
    { asset_id: assetId, indication_id: htgId, space_id: sid, development_status_source: 'auto', created_by: uid },
  ]).throwOnError();

  const trialFcs = (await admin.from('trials').insert({ space_id: sid, asset_id: assetId, name: 'Lift trial FCS', phase_type: 'P3', created_by: uid }).select('id').single().throwOnError()).data!.id;
  await admin.from('trial_conditions').insert({ trial_id: trialFcs, condition_id: condFcs, source: 'analyst' }).throwOnError();
  const trialHtg = (await admin.from('trials').insert({ space_id: sid, asset_id: assetId, name: 'Lift trial HTG', phase_type: 'P3', created_by: uid }).select('id').single().throwOnError()).data!.id;
  await admin.from('trial_conditions').insert({ trial_id: trialHtg, condition_id: condHtg, source: 'analyst' }).throwOnError();
}, 120_000);

afterAll(async () => {
  if (eventIds.length) await admin.from('events').delete().in('id', eventIds);
  await admin.from('events').delete().eq('anchor_id', assetId).eq('anchor_type', 'asset');
  await admin.from('trials').delete().eq('asset_id', assetId);
  await admin.from('asset_indications').delete().eq('asset_id', assetId);
  await admin.from('conditions').delete().like('name', 'Lift cond%');
  await admin.from('indications').delete().in('id', [fcsId, htgId, newId]);
  if (assetId) await admin.from('assets').delete().eq('id', assetId);
  if (companyId) await admin.from('companies').delete().eq('id', companyId);
});

describe('approval/launch stage lift via shipped RPCs (#159)', () => {
  it('baseline: both indications derive P3 from trials', async () => {
    expect(await statusOf(fcsId)).toBe('P3');
    expect(await statusOf(htgId)).toBe('P3');
  });

  it('actual Approval tagged FCS lifts FCS to APPROVED, HTG stays P3', async () => {
    const id = await createEvent({ p_event_type_id: ET_APPROVAL, p_indication_id: fcsId });
    const { data: row } = await admin.from('events').select('indication_id').eq('id', id).single().throwOnError();
    expect((row as { indication_id: string }).indication_id).toBe(fcsId);
    expect(await statusOf(fcsId)).toBe('APPROVED');
    expect(await statusOf(htgId)).toBe('P3');

    // actual -> forecasted reverts
    await updateEvent(id, { p_projection: 'forecasted', p_indication_id: fcsId });
    expect(await statusOf(fcsId)).toBe('P3');

    // back to actual re-lifts; then clearing the indication reverts (full-replace null)
    await updateEvent(id, { p_projection: 'actual', p_indication_id: fcsId });
    expect(await statusOf(fcsId)).toBe('APPROVED');
    await updateEvent(id, { p_projection: 'actual', p_indication_id: null });
    const { data: cleared } = await admin.from('events').select('indication_id').eq('id', id).single().throwOnError();
    expect((cleared as { indication_id: string | null }).indication_id).toBeNull();
    expect(await statusOf(fcsId)).toBe('P3');
  });

  it('Launch lifts past APPROVED to LAUNCHED', async () => {
    await createEvent({ p_event_type_id: ET_LAUNCH, p_indication_id: fcsId, p_event_date: '2026-02-01' });
    expect(await statusOf(fcsId)).toBe('LAUNCHED');
  });

  it('ensure-row: approval for an indication with no program row creates it and lifts', async () => {
    expect(await statusOf(newId)).toBeNull(); // no asset_indication row yet
    await createEvent({ p_event_type_id: ET_APPROVAL, p_indication_id: newId, p_event_date: '2026-03-01' });
    expect(await statusOf(newId)).toBe('APPROVED');
  });

  it('rejects an indication from another space', async () => {
    const { error } = await as(p, 'space_owner').rpc('create_event', {
      p_space_id: p.org.spaceId,
      p_event_type_id: ET_APPROVAL,
      p_title: 'bad',
      p_event_date: '2026-01-01',
      p_anchor_type: 'asset',
      p_anchor_id: assetId,
      p_indication_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(error).not.toBeNull();
  });
});
