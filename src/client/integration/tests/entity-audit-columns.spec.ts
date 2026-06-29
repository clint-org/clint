/**
 * Entity audit columns: verifies that the server-side BEFORE triggers
 * populate created_by from auth.uid() on INSERT and updated_by + updated_at
 * on UPDATE. The client never sends these fields.
 *
 * Covers: companies, assets, trials, events, trial_notes.
 * (markers sub-test removed: markers table dropped in the event-model cutover.)
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectOk } from '../harness/as';

let p: Personas;

beforeAll(async () => {
  p = await buildPersonas();
}, 90_000);

describe('entity audit columns (server-side triggers)', () => {
  const admin = adminClient();

  it('companies: trigger sets created_by and updated_by from JWT', async () => {
    const userId = p.ids.contributor;
    const client = as(p, 'contributor');

    const { data: inserted } = await client
      .from('companies')
      .insert({ space_id: p.org.spaceId, name: 'Audit Co' })
      .select('id, created_by, updated_by')
      .single();
    expectOk({ data: inserted, error: null });
    expect(inserted!.created_by).toBe(userId);
    expect(inserted!.updated_by).toBeNull();

    const { data: updated } = await client
      .from('companies')
      .update({ name: 'Audit Co Renamed' })
      .eq('id', inserted!.id)
      .select('updated_by')
      .single();
    expectOk({ data: updated, error: null });
    expect(updated!.updated_by).toBe(userId);
  });

  it('assets: trigger sets created_by and updated_by from JWT', async () => {
    const userId = p.ids.contributor;
    const client = as(p, 'contributor');

    const { data: co } = await admin
      .from('companies')
      .insert({ space_id: p.org.spaceId, name: 'ProdCo', created_by: userId })
      .select('id')
      .single();

    const { data: inserted } = await client
      .from('assets')
      .insert({ space_id: p.org.spaceId, company_id: co!.id, name: 'TestAsset' })
      .select('id, created_by, updated_by')
      .single();
    expectOk({ data: inserted, error: null });
    expect(inserted!.created_by).toBe(userId);
    expect(inserted!.updated_by).toBeNull();

    const { data: updated } = await client
      .from('assets')
      .update({ name: 'TestAsset Renamed' })
      .eq('id', inserted!.id)
      .select('updated_by')
      .single();
    expectOk({ data: updated, error: null });
    expect(updated!.updated_by).toBe(userId);
  });

  it('trials: trigger sets created_by and updated_by from JWT', async () => {
    const userId = p.ids.contributor;
    const client = as(p, 'contributor');

    const { data: co } = await admin
      .from('companies')
      .insert({ space_id: p.org.spaceId, name: 'TrialCo', created_by: userId })
      .select('id')
      .single();
    const { data: prod } = await admin
      .from('assets')
      .insert({ space_id: p.org.spaceId, company_id: co!.id, name: 'TrialAsset', created_by: userId })
      .select('id')
      .single();

    const { data: inserted } = await client
      .from('trials')
      .insert({
        space_id: p.org.spaceId,
        asset_id: prod!.id,
        name: 'Trial Audit',
        identifier: 'NCT99999999',
      })
      .select('id, created_by, updated_by')
      .single();
    expectOk({ data: inserted, error: null });
    expect(inserted!.created_by).toBe(userId);
    expect(inserted!.updated_by).toBeNull();

    const { data: updated } = await client
      .from('trials')
      .update({ name: 'Trial Audit Renamed' })
      .eq('id', inserted!.id)
      .select('updated_by, updated_at')
      .single();
    expectOk({ data: updated, error: null });
    expect(updated!.updated_by).toBe(userId);
    expect(updated!.updated_at).toBeTruthy();
  });

  // markers sub-test removed: markers table dropped in the event-model cutover.
  // Event audit trigger coverage is provided by the repointed events sub-test below.

  it('events: trigger sets created_by and updated_by from JWT', async () => {
    const userId = p.ids.contributor;
    const client = as(p, 'contributor');

    // Fetch a system event_type (space_id IS NULL) to satisfy the NOT NULL FK.
    const { data: etRow } = await admin
      .from('event_types')
      .select('id')
      .is('space_id', null)
      .limit(1)
      .single();

    const { data: inserted } = await client
      .from('events')
      .insert({
        space_id: p.org.spaceId,
        event_type_id: etRow!.id,
        anchor_type: 'space',
        title: 'Audit Event',
        event_date: '2026-06-01',
      })
      .select('id, created_by, updated_by')
      .single();
    expectOk({ data: inserted, error: null });
    expect(inserted!.created_by).toBe(userId);
    expect(inserted!.updated_by).toBeNull();

    const { data: updated } = await client
      .from('events')
      .update({ title: 'Audit Event Renamed' })
      .eq('id', inserted!.id)
      .select('updated_by')
      .single();
    expectOk({ data: updated, error: null });
    expect(updated!.updated_by).toBe(userId);
  });

  it('trial_notes: trigger sets created_by and updated_by from JWT', async () => {
    const userId = p.ids.contributor;
    const client = as(p, 'contributor');

    const { data: co } = await admin
      .from('companies')
      .insert({ space_id: p.org.spaceId, name: 'NoteCo', created_by: userId })
      .select('id')
      .single();
    const { data: prod } = await admin
      .from('assets')
      .insert({ space_id: p.org.spaceId, company_id: co!.id, name: 'NoteAsset', created_by: userId })
      .select('id')
      .single();
    const { data: trial } = await admin
      .from('trials')
      .insert({
        space_id: p.org.spaceId,
        asset_id: prod!.id,
        name: 'Note Trial',
        identifier: 'NCT88888888',
        created_by: userId,
      })
      .select('id')
      .single();

    const { data: inserted } = await client
      .from('trial_notes')
      .insert({ space_id: p.org.spaceId, trial_id: trial!.id, content: 'Audit note' })
      .select('id, created_by, updated_by')
      .single();
    expectOk({ data: inserted, error: null });
    expect(inserted!.created_by).toBe(userId);
    expect(inserted!.updated_by).toBeNull();

    const { data: updated } = await client
      .from('trial_notes')
      .update({ content: 'Audit note updated' })
      .eq('id', inserted!.id)
      .select('updated_by')
      .single();
    expectOk({ data: updated, error: null });
    expect(updated!.updated_by).toBe(userId);
  });

  it('trigger ignores client-spoofed created_by for authenticated users', async () => {
    const realUserId = p.ids.contributor;
    const spoofedId = p.ids.reader;
    const client = as(p, 'contributor');

    const { data: inserted } = await client
      .from('companies')
      .insert({ space_id: p.org.spaceId, name: 'Spoof Test', created_by: spoofedId })
      .select('id, created_by')
      .single();
    expectOk({ data: inserted, error: null });
    expect(inserted!.created_by).toBe(realUserId);
  });
});
