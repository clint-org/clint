/**
 * Stage 3 Part C (Task 12): event taxonomy admin behaviors the new Taxonomies tabs rely on,
 * at the data layer:
 *   - event_types name-uniqueness within a space (D2 constraint) -> duplicate custom name = 23505,
 *   - an event_type_category that is referenced by an event_type cannot be deleted
 *     (FK event_types_category_id_fkey is ON DELETE NO ACTION) -> 23503,
 *     which is what MarkerCategoryInUseError surfaces in the UI.
 *
 * Complements event-taxonomy-uniqueness.integration.spec.ts (which covers the category-name
 * rules). Runs through the service role against local Supabase; cleans up its scratch rows.
 * Run after `supabase db reset` with SUPABASE_SERVICE_ROLE_KEY exported.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';

let p: Personas;
let admin: SupabaseClient;
let spaceId: string;
let categoryId: string;
const CAT = '__tax_admin_cat__';
const TYPE = '__tax_admin_type__';

beforeAll(async () => {
  p = await buildPersonas();
  admin = adminClient();
  spaceId = p.org.spaceId;
  const { data, error } = await admin
    .from('event_type_categories')
    .insert({ space_id: spaceId, name: CAT, display_order: 999 })
    .select('id')
    .single();
  if (error) throw new Error(`seed category: ${error.message}`);
  categoryId = (data as { id: string }).id;
});

afterAll(async () => {
  await admin.from('event_types').delete().eq('space_id', spaceId).eq('category_id', categoryId);
  await admin.from('event_type_categories').delete().eq('id', categoryId);
});

describe('event taxonomy admin (data layer)', () => {
  it('rejects a duplicate custom event_type name within one space (23505)', async () => {
    const first = await admin
      .from('event_types')
      .insert({ space_id: spaceId, category_id: categoryId, name: TYPE, shape: 'circle', color: '#16a34a' });
    expect(first.error).toBeNull();
    const dup = await admin
      .from('event_types')
      .insert({ space_id: spaceId, category_id: categoryId, name: TYPE, shape: 'square', color: '#dc2626' });
    expect(dup.error?.code).toBe('23505');
  });

  it('blocks deleting an event_type_category that is still referenced by an event_type (23503)', async () => {
    // the TYPE row inserted above references categoryId
    const del = await admin.from('event_type_categories').delete().eq('id', categoryId);
    expect(del.error?.code).toBe('23503');
  });
});
