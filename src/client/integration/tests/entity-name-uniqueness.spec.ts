/**
 * Entity name uniqueness constraints. Verifies the unique(space_id, name)
 * constraints on therapeutic_areas, marker_types, and event_categories, plus
 * the partial unique indexes that protect system rows (space_id IS NULL).
 *
 * Spec: docs/superpowers/specs/2026-05-23-entity-name-uniqueness-design.md
 */

import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { createScratchSpace } from '../fixtures/scratch';
import type { SupabaseClient } from '@supabase/supabase-js';

let p: Personas;
let admin: SupabaseClient;

beforeAll(async () => {
  p = await buildPersonas();
  admin = adminClient();
}, 90_000);

// ---------------------------------------------------------------------------
// therapeutic_areas
// ---------------------------------------------------------------------------
describe('therapeutic_areas unique(space_id, name)', () => {
  it('rejects duplicate name within the same space', async () => {
    const userId = p.ids.tenant_owner;
    const name = `TA-dup-${Date.now()}`;

    const first = await admin
      .from('therapeutic_areas')
      .insert({ space_id: p.org.spaceId, name, created_by: userId })
      .select('id')
      .single();
    expect(first.error).toBeNull();

    const second = await admin
      .from('therapeutic_areas')
      .insert({ space_id: p.org.spaceId, name, created_by: userId });
    expect(second.error).not.toBeNull();
    expect(second.error!.code).toBe('23505');
  });

  it('allows same name in different spaces', async () => {
    const scratch = await createScratchSpace(p);
    try {
      const userId = p.ids.tenant_owner;
      const name = `TA-cross-${Date.now()}`;

      const inOriginal = await admin
        .from('therapeutic_areas')
        .insert({ space_id: p.org.spaceId, name, created_by: userId })
        .select('id')
        .single();
      expect(inOriginal.error).toBeNull();

      const inScratch = await admin
        .from('therapeutic_areas')
        .insert({ space_id: scratch.spaceId, name, created_by: userId })
        .select('id')
        .single();
      expect(inScratch.error).toBeNull();
    } finally {
      await scratch.cleanup();
    }
  });

  it('upsert with on-conflict returns cleanly', async () => {
    const userId = p.ids.tenant_owner;
    const name = `TA-upsert-${Date.now()}`;

    await admin
      .from('therapeutic_areas')
      .insert({ space_id: p.org.spaceId, name, created_by: userId });

    const upsert = await admin
      .from('therapeutic_areas')
      .upsert(
        { space_id: p.org.spaceId, name, created_by: userId },
        { onConflict: 'space_id,name', ignoreDuplicates: true },
      );
    expect(upsert.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// marker_types
// ---------------------------------------------------------------------------
describe('marker_types unique(space_id, name)', () => {
  let categoryId: string;

  beforeAll(async () => {
    const { data } = await admin
      .from('marker_categories')
      .select('id')
      .eq('is_system', true)
      .limit(1)
      .single();
    categoryId = data!.id;
  });

  it('rejects duplicate name within the same space', async () => {
    const userId = p.ids.tenant_owner;
    const name = `MT-dup-${Date.now()}`;
    const base = {
      space_id: p.org.spaceId,
      name,
      created_by: userId,
      category_id: categoryId,
      shape: 'circle',
      fill_style: 'filled',
      color: '#000000',
      is_system: false,
    };

    const first = await admin.from('marker_types').insert(base).select('id').single();
    expect(first.error).toBeNull();

    const second = await admin.from('marker_types').insert(base);
    expect(second.error).not.toBeNull();
    expect(second.error!.code).toBe('23505');
  });

  it('allows same name in different spaces', async () => {
    const scratch = await createScratchSpace(p);
    try {
      const userId = p.ids.tenant_owner;
      const name = `MT-cross-${Date.now()}`;
      const base = {
        name,
        created_by: userId,
        category_id: categoryId,
        shape: 'circle',
        fill_style: 'filled',
        color: '#000000',
        is_system: false,
      };

      const inOriginal = await admin
        .from('marker_types')
        .insert({ ...base, space_id: p.org.spaceId })
        .select('id')
        .single();
      expect(inOriginal.error).toBeNull();

      const inScratch = await admin
        .from('marker_types')
        .insert({ ...base, space_id: scratch.spaceId })
        .select('id')
        .single();
      expect(inScratch.error).toBeNull();
    } finally {
      await scratch.cleanup();
    }
  });

  it('partial index rejects duplicate system marker type names', async () => {
    const name = `SysMT-dup-${Date.now()}`;
    const base = {
      space_id: null,
      name,
      created_by: null,
      category_id: categoryId,
      shape: 'circle',
      fill_style: 'filled',
      color: '#000000',
      is_system: true,
    };

    const first = await admin.from('marker_types').insert(base).select('id').single();
    expect(first.error).toBeNull();

    const second = await admin.from('marker_types').insert(base);
    expect(second.error).not.toBeNull();
    expect(second.error!.code).toBe('23505');

    // cleanup: remove the test system marker type
    await admin.from('marker_types').delete().eq('id', first.data!.id);
  });
});

// ---------------------------------------------------------------------------
// event_categories
// ---------------------------------------------------------------------------
describe('event_categories unique(space_id, name)', () => {
  it('rejects duplicate name within the same space', async () => {
    const userId = p.ids.tenant_owner;
    const name = `EC-dup-${Date.now()}`;

    const first = await admin
      .from('event_categories')
      .insert({
        space_id: p.org.spaceId,
        name,
        display_order: 99,
        is_system: false,
        created_by: userId,
      })
      .select('id')
      .single();
    expect(first.error).toBeNull();

    const second = await admin
      .from('event_categories')
      .insert({
        space_id: p.org.spaceId,
        name,
        display_order: 100,
        is_system: false,
        created_by: userId,
      });
    expect(second.error).not.toBeNull();
    expect(second.error!.code).toBe('23505');
  });

  it('allows same name in different spaces', async () => {
    const scratch = await createScratchSpace(p);
    try {
      const userId = p.ids.tenant_owner;
      const name = `EC-cross-${Date.now()}`;

      const inOriginal = await admin
        .from('event_categories')
        .insert({
          space_id: p.org.spaceId,
          name,
          display_order: 99,
          is_system: false,
          created_by: userId,
        })
        .select('id')
        .single();
      expect(inOriginal.error).toBeNull();

      const inScratch = await admin
        .from('event_categories')
        .insert({
          space_id: scratch.spaceId,
          name,
          display_order: 99,
          is_system: false,
          created_by: userId,
        })
        .select('id')
        .single();
      expect(inScratch.error).toBeNull();
    } finally {
      await scratch.cleanup();
    }
  });

  it('partial index rejects duplicate system event category names', async () => {
    const name = `SysEC-dup-${Date.now()}`;

    const first = await admin
      .from('event_categories')
      .insert({
        space_id: null,
        name,
        display_order: 999,
        is_system: true,
        created_by: null,
      })
      .select('id')
      .single();
    expect(first.error).toBeNull();

    const second = await admin
      .from('event_categories')
      .insert({
        space_id: null,
        name,
        display_order: 1000,
        is_system: true,
        created_by: null,
      });
    expect(second.error).not.toBeNull();
    expect(second.error!.code).toBe('23505');

    // cleanup: remove the test system event category
    await admin.from('event_categories').delete().eq('id', first.data!.id);
  });

  it('space-custom row does not collide with system row of same name', async () => {
    const userId = p.ids.tenant_owner;
    // 'Leadership' is a seeded system category (space_id = null)
    const name = 'Leadership';

    const spaceRow = await admin
      .from('event_categories')
      .insert({
        space_id: p.org.spaceId,
        name,
        display_order: 99,
        is_system: false,
        created_by: userId,
      })
      .select('id')
      .single();
    expect(spaceRow.error).toBeNull();
  });
});
