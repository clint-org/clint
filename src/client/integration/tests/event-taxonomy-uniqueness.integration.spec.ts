/**
 * Stage 3 Part C (D2): event taxonomy name-uniqueness constraints
 * (migration 20260629040300). Asserts the three rules at the data layer:
 *   - a duplicate CUSTOM name in one space is rejected (23505 on the space_name_key),
 *   - a custom name reusing a SYSTEM name (different space_id) is allowed (NULLs distinct),
 *   - two SYSTEM rows (space_id IS NULL) with the same name are blocked (partial unique index).
 *
 * Runs through the service role against local Supabase; cleans up its scratch rows.
 * Run after `supabase db reset` with SUPABASE_SERVICE_ROLE_KEY exported.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';

let p: Personas;
let admin: SupabaseClient;
let spaceId: string;
let systemCategoryName: string;
const NAME = '__d2_uniq_smoke__';

beforeAll(async () => {
  p = await buildPersonas();
  admin = adminClient();
  spaceId = p.org.spaceId;
  const { data, error } = await admin
    .from('event_type_categories')
    .select('name')
    .is('space_id', null)
    .limit(1)
    .single();
  if (error) throw new Error(`fetch system category: ${error.message}`);
  systemCategoryName = (data as { name: string }).name;
});

afterAll(async () => {
  await admin.from('event_type_categories').delete().eq('space_id', spaceId).eq('name', NAME);
  await admin
    .from('event_type_categories')
    .delete()
    .eq('space_id', spaceId)
    .eq('name', systemCategoryName);
});

describe('D2 event_type_categories name-uniqueness', () => {
  it('rejects a duplicate custom name within one space (23505)', async () => {
    const first = await admin.from('event_type_categories').insert({ space_id: spaceId, name: NAME });
    expect(first.error).toBeNull();
    const dup = await admin.from('event_type_categories').insert({ space_id: spaceId, name: NAME });
    expect(dup.error?.code).toBe('23505');
  });

  it('allows a custom name that reuses a system name (different space_id)', async () => {
    const res = await admin
      .from('event_type_categories')
      .insert({ space_id: spaceId, name: systemCategoryName });
    expect(res.error).toBeNull();
  });

  it('blocks a second system row (space_id NULL) with an existing system name', async () => {
    const res = await admin
      .from('event_type_categories')
      .insert({ space_id: null, name: systemCategoryName });
    expect(res.error?.code).toBe('23505');
  });
});
