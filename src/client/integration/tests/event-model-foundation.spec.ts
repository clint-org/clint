/**
 * Event model foundation (Stage 1): exercises create_event / update_event against
 * local Supabase under real persona auth. Verifies server-side audit fields, the
 * significance-inherits-null default, RLS (viewer rejected), the anchor-in-space
 * guard, and the append-only event_changes log.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectOk } from '../harness/as';

let p: Personas;
beforeAll(async () => {
  p = await buildPersonas();
}, 90_000);

const TOPLINE = 'a0000000-0000-0000-0000-000000000013'; // Topline Data (high)
const LEADER = 'a0000000-0000-0000-0000-000000000050'; // Leadership Change (low)

describe('event model foundation', () => {
  const admin = adminClient();

  it('create_event inserts an asset-anchored event; created_by from JWT, significance inherits (null)', async () => {
    const { data: company } = await admin
      .from('companies')
      .insert({ space_id: p.org.spaceId, name: 'Lilly EM', created_by: p.ids.space_owner })
      .select('id')
      .single();
    const { data: asset } = await admin
      .from('assets')
      .insert({ space_id: p.org.spaceId, company_id: company!.id, name: 'Zepbound EM', created_by: p.ids.space_owner })
      .select('id')
      .single();

    const r = await as(p, 'contributor').rpc('create_event', {
      p_space_id: p.org.spaceId,
      p_event_type_id: TOPLINE,
      p_title: 'Topline readout',
      p_event_date: '2025-09-15',
      p_anchor_type: 'asset',
      p_anchor_id: asset!.id,
    });
    const id = expectOk(r);

    const { data: row } = await admin.from('events').select('*').eq('id', id).single();
    expect(row!.created_by).toBe(p.ids.contributor);
    expect(row!.anchor_type).toBe('asset');
    expect(row!.significance).toBeNull();
  });

  it('create_event rejects a viewer (42501)', async () => {
    const r = await as(p, 'reader').rpc('create_event', {
      p_space_id: p.org.spaceId,
      p_event_type_id: TOPLINE,
      p_title: 'x',
      p_event_date: '2025-01-01',
      p_anchor_type: 'space',
    });
    expect(r.error?.code).toBe('42501');
  });

  it('create_event rejects an anchor from another space (42501)', async () => {
    const { data: space2 } = await admin
      .from('spaces')
      .insert({ tenant_id: p.org.tenantId, name: 'EM other space', created_by: p.ids.space_owner })
      .select('id')
      .single();
    const { data: company2 } = await admin
      .from('companies')
      .insert({ space_id: space2!.id, name: 'Foreign Co', created_by: p.ids.space_owner })
      .select('id')
      .single();
    const { data: foreign } = await admin
      .from('assets')
      .insert({ space_id: space2!.id, company_id: company2!.id, name: 'Foreign asset', created_by: p.ids.space_owner })
      .select('id')
      .single();

    const r = await as(p, 'contributor').rpc('create_event', {
      p_space_id: p.org.spaceId,
      p_event_type_id: TOPLINE,
      p_title: 'x',
      p_event_date: '2025-01-01',
      p_anchor_type: 'asset',
      p_anchor_id: foreign!.id,
    });
    expect(r.error?.code).toBe('42501');
  });

  it('update_event sets updated_by + visibility and writes a created+updated change pair', async () => {
    const client = as(p, 'contributor');
    const created = await client.rpc('create_event', {
      p_space_id: p.org.spaceId,
      p_event_type_id: LEADER,
      p_title: 'CEO comment',
      p_event_date: '2024-01-10',
      p_anchor_type: 'space',
    });
    const id = expectOk(created);

    const updated = await client.rpc('update_event', {
      p_event_id: id,
      p_title: 'CEO comment (updated)',
      p_event_date: '2024-01-10',
      p_projection: 'actual',
      p_date_precision: 'exact',
      p_end_date: null,
      p_end_date_precision: 'exact',
      p_is_ongoing: false,
      p_description: null,
      p_significance: null,
      p_visibility: 'pinned',
      p_no_longer_expected: false,
    });
    expectOk(updated);

    const { data: row } = await admin
      .from('events')
      .select('updated_by, visibility')
      .eq('id', id)
      .single();
    expect(row!.updated_by).toBe(p.ids.contributor);
    expect(row!.visibility).toBe('pinned');

    const { data: changes } = await admin
      .from('event_changes')
      .select('change_type')
      .eq('event_id', id)
      .order('changed_at', { ascending: true });
    expect(changes!.map((c) => c.change_type)).toEqual(['created', 'updated']);
  });
});
