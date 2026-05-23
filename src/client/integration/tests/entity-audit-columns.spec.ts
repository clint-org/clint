/**
 * Entity audit columns: verifies that created_by is set on INSERT and
 * updated_by is set on UPDATE for all entity tables that carry these columns.
 *
 * Covers: companies, products, trials, markers, events, trial_notes.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectOk } from '../harness/as';

let p: Personas;

beforeAll(async () => {
  p = await buildPersonas();
}, 90_000);

describe('entity audit columns', () => {
  const admin = adminClient();

  it('companies: created_by on insert, updated_by on update', async () => {
    const userId = p.ids.contributor;
    const client = as(p, 'contributor');

    const { data: inserted } = await client
      .from('companies')
      .insert({ space_id: p.org.spaceId, name: 'Audit Co', created_by: userId })
      .select('id, created_by, updated_by')
      .single();
    expectOk({ data: inserted, error: null });
    expect(inserted!.created_by).toBe(userId);
    expect(inserted!.updated_by).toBeNull();

    const { data: updated } = await client
      .from('companies')
      .update({ name: 'Audit Co Renamed', updated_by: userId })
      .eq('id', inserted!.id)
      .select('updated_by')
      .single();
    expectOk({ data: updated, error: null });
    expect(updated!.updated_by).toBe(userId);
  });

  it('products: created_by on insert, updated_by on update', async () => {
    const userId = p.ids.contributor;
    const client = as(p, 'contributor');

    const { data: co } = await admin
      .from('companies')
      .insert({ space_id: p.org.spaceId, name: 'ProdCo', created_by: userId })
      .select('id')
      .single();

    const { data: inserted } = await client
      .from('products')
      .insert({
        space_id: p.org.spaceId,
        company_id: co!.id,
        name: 'TestAsset',
        created_by: userId,
      })
      .select('id, created_by, updated_by')
      .single();
    expectOk({ data: inserted, error: null });
    expect(inserted!.created_by).toBe(userId);
    expect(inserted!.updated_by).toBeNull();

    const { data: updated } = await client
      .from('products')
      .update({ name: 'TestAsset Renamed', updated_by: userId })
      .eq('id', inserted!.id)
      .select('updated_by')
      .single();
    expectOk({ data: updated, error: null });
    expect(updated!.updated_by).toBe(userId);
  });

  it('trials: created_by on insert, updated_by on update', async () => {
    const userId = p.ids.contributor;
    const client = as(p, 'contributor');

    const { data: co } = await admin
      .from('companies')
      .insert({ space_id: p.org.spaceId, name: 'TrialCo', created_by: userId })
      .select('id')
      .single();
    const { data: prod } = await admin
      .from('products')
      .insert({
        space_id: p.org.spaceId,
        company_id: co!.id,
        name: 'TrialAsset',
        created_by: userId,
      })
      .select('id')
      .single();
    const { data: ta } = await admin
      .from('therapeutic_areas')
      .insert({ space_id: p.org.spaceId, name: 'Cardiology', created_by: userId })
      .select('id')
      .single();

    const { data: inserted } = await client
      .from('trials')
      .insert({
        space_id: p.org.spaceId,
        product_id: prod!.id,
        therapeutic_area_id: ta!.id,
        name: 'Trial Audit',
        identifier: 'NCT99999999',
        created_by: userId,
      })
      .select('id, created_by, updated_by')
      .single();
    expectOk({ data: inserted, error: null });
    expect(inserted!.created_by).toBe(userId);
    expect(inserted!.updated_by).toBeNull();

    const { data: updated } = await client
      .from('trials')
      .update({ name: 'Trial Audit Renamed', updated_by: userId })
      .eq('id', inserted!.id)
      .select('updated_by')
      .single();
    expectOk({ data: updated, error: null });
    expect(updated!.updated_by).toBe(userId);
  });

  it('markers: created_by on insert, updated_by on update', async () => {
    const userId = p.ids.contributor;
    const client = as(p, 'contributor');

    const { data: mtRow } = await admin
      .from('marker_types')
      .select('id')
      .eq('is_system', true)
      .limit(1)
      .single();

    const { data: inserted } = await client
      .from('markers')
      .insert({
        space_id: p.org.spaceId,
        marker_type_id: mtRow!.id,
        title: 'Audit Marker',
        event_date: '2026-06-01',
        projection: 'actual',
        created_by: userId,
      })
      .select('id, created_by, updated_by')
      .single();
    expectOk({ data: inserted, error: null });
    expect(inserted!.created_by).toBe(userId);
    expect(inserted!.updated_by).toBeNull();

    const { data: updated } = await client
      .from('markers')
      .update({ title: 'Audit Marker Renamed', updated_by: userId })
      .eq('id', inserted!.id)
      .select('updated_by')
      .single();
    expectOk({ data: updated, error: null });
    expect(updated!.updated_by).toBe(userId);
  });

  it('events: created_by on insert, updated_by on update', async () => {
    const userId = p.ids.contributor;
    const client = as(p, 'contributor');

    const { data: catRow } = await admin.from('event_categories').select('id').limit(1).single();

    const { data: inserted } = await client
      .from('events')
      .insert({
        space_id: p.org.spaceId,
        category_id: catRow!.id,
        title: 'Audit Event',
        event_date: '2026-06-01',
        created_by: userId,
      })
      .select('id, created_by, updated_by')
      .single();
    expectOk({ data: inserted, error: null });
    expect(inserted!.created_by).toBe(userId);
    expect(inserted!.updated_by).toBeNull();

    const { data: updated } = await client
      .from('events')
      .update({ title: 'Audit Event Renamed', updated_by: userId })
      .eq('id', inserted!.id)
      .select('updated_by')
      .single();
    expectOk({ data: updated, error: null });
    expect(updated!.updated_by).toBe(userId);
  });

  it('trial_notes: created_by on insert, updated_by on update', async () => {
    const userId = p.ids.contributor;
    const client = as(p, 'contributor');

    const { data: co } = await admin
      .from('companies')
      .insert({ space_id: p.org.spaceId, name: 'NoteCo', created_by: userId })
      .select('id')
      .single();
    const { data: prod } = await admin
      .from('products')
      .insert({
        space_id: p.org.spaceId,
        company_id: co!.id,
        name: 'NoteAsset',
        created_by: userId,
      })
      .select('id')
      .single();
    const { data: ta } = await admin
      .from('therapeutic_areas')
      .insert({ space_id: p.org.spaceId, name: 'Neuro', created_by: userId })
      .select('id')
      .single();
    const { data: trial } = await admin
      .from('trials')
      .insert({
        space_id: p.org.spaceId,
        product_id: prod!.id,
        therapeutic_area_id: ta!.id,
        name: 'Note Trial',
        identifier: 'NCT88888888',
        created_by: userId,
      })
      .select('id')
      .single();

    const { data: inserted } = await client
      .from('trial_notes')
      .insert({
        space_id: p.org.spaceId,
        trial_id: trial!.id,
        content: 'Audit note',
        created_by: userId,
      })
      .select('id, created_by, updated_by')
      .single();
    expectOk({ data: inserted, error: null });
    expect(inserted!.created_by).toBe(userId);
    expect(inserted!.updated_by).toBeNull();

    const { data: updated } = await client
      .from('trial_notes')
      .update({ content: 'Audit note updated', updated_by: userId })
      .eq('id', inserted!.id)
      .select('updated_by')
      .single();
    expectOk({ data: updated, error: null });
    expect(updated!.updated_by).toBe(userId);
  });
});
