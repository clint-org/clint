/**
 * unified-feed-annotations.spec.ts
 *
 * Integration tests for:
 *  1. Annotation CRUD via upsert_change_event_annotation / delete_change_event_annotation RPCs
 *  2. Unified feed (get_events_page_data) with the "detected" source type leg,
 *     including annotation indicator, category mapping, and pagination
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPersonas, Personas, adminClient } from '../fixtures/personas';
import { createScratchAgency } from '../fixtures/scratch';
import { as } from '../harness/as';
import { SupabaseClient } from '@supabase/supabase-js';

let p: Personas;
let svc: SupabaseClient;
let spaceId: string;
let companyId: string;
let assetId: string;
let trialId: string;
let changeEventId: string;
let agencyCleanup: () => Promise<void>;

beforeAll(async () => {
  p = await buildPersonas();
  svc = adminClient();

  // Create a scratch agency + tenant + space.
  const scratch = await createScratchAgency(p);
  spaceId = scratch.spaceId;
  agencyCleanup = scratch.cleanup;

  // Grant the tenant_owner persona editor-level access to the scratch space so
  // they can see trial_change_events via RLS and call annotation RPCs.
  // Also add the reader persona as a viewer to test the "viewer denied" path.
  {
    const { error } = await svc.from('space_members').insert([
      { space_id: spaceId, user_id: p.ids.tenant_owner, role: 'owner' },
      { space_id: spaceId, user_id: p.ids.reader, role: 'viewer' },
    ]);
    if (error) throw new Error(`insert space_members: ${error.message}`);
  }

  const createdBy = p.ids.tenant_owner;

  // Seed: company > asset > trial > trial_change_event.
  const { data: company, error: companyErr } = await svc
    .from('companies')
    .insert({ space_id: spaceId, name: 'AnnotCo', created_by: createdBy })
    .select('id')
    .single();
  if (companyErr) throw new Error(`insert company: ${companyErr.message}`);
  companyId = company!.id;

  const { data: asset, error: assetErr } = await svc
    .from('assets')
    .insert({
      space_id: spaceId,
      company_id: companyId,
      name: 'AnnotDrug',
      created_by: createdBy,
    })
    .select('id')
    .single();
  if (assetErr) throw new Error(`insert asset: ${assetErr.message}`);
  assetId = asset!.id;

  const { data: trial, error: trialErr } = await svc
    .from('trials')
    .insert({
      space_id: spaceId,
      asset_id: assetId,
      name: 'AnnotTrial',
      created_by: createdBy,
    })
    .select('id')
    .single();
  if (trialErr) throw new Error(`insert trial: ${trialErr.message}`);
  trialId = trial!.id;

  const { data: changeEvent, error: ceErr } = await svc
    .from('trial_change_events')
    .insert({
      trial_id: trialId,
      space_id: spaceId,
      event_type: 'status_changed',
      source: 'ctgov',
      payload: { from: 'RECRUITING', to: 'COMPLETED' },
      occurred_at: new Date().toISOString(),
      observed_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (ceErr) throw new Error(`insert trial_change_events: ${ceErr.message}`);
  changeEventId = changeEvent!.id;
}, 120_000);

afterAll(async () => {
  if (agencyCleanup) await agencyCleanup();
});

// ---------------------------------------------------------------------------
// 1. Annotation CRUD via RPCs
// ---------------------------------------------------------------------------
describe('annotation CRUD', () => {
  let annotationId: string;

  it('upsert_change_event_annotation creates a new annotation', async () => {
    const client = as(p, 'tenant_owner');
    const { data, error } = await client.rpc('upsert_change_event_annotation', {
      p_change_event_id: changeEventId,
      p_body: 'Initial analyst note',
    });
    expect(error).toBeNull();

    const result = data as {
      id: string;
      change_event_id: string;
      body: string;
    };
    expect(result.body).toBe('Initial analyst note');
    expect(result.change_event_id).toBe(changeEventId);
    expect(result.id).toBeTruthy();
    annotationId = result.id;
  });

  it('upsert is idempotent: updates body, keeps same id', async () => {
    const client = as(p, 'tenant_owner');
    const { data, error } = await client.rpc('upsert_change_event_annotation', {
      p_change_event_id: changeEventId,
      p_body: 'Updated analyst note',
    });
    expect(error).toBeNull();

    const result = data as { id: string; body: string };
    expect(result.body).toBe('Updated analyst note');
    expect(result.id).toBe(annotationId);
  });

  it('delete_change_event_annotation removes the annotation', async () => {
    const client = as(p, 'tenant_owner');
    const { error: delErr } = await client.rpc('delete_change_event_annotation', {
      p_change_event_id: changeEventId,
    });
    expect(delErr).toBeNull();

    // Verify it is gone by re-upserting (should create a new row with a new id).
    const { data, error } = await client.rpc('upsert_change_event_annotation', {
      p_change_event_id: changeEventId,
      p_body: 'Re-created after delete',
    });
    expect(error).toBeNull();
    const result = data as { id: string; body: string };
    expect(result.id).not.toBe(annotationId);
    expect(result.body).toBe('Re-created after delete');

    // Clean up the re-created annotation for subsequent tests.
    await client.rpc('delete_change_event_annotation', {
      p_change_event_id: changeEventId,
    });
  });

  it('viewer is denied upsert (42501)', async () => {
    // The reader persona has viewer access to the scratch space, so the RPC
    // can see the change event but the has_space_access(_, {owner,editor})
    // check blocks the write.
    const client = as(p, 'reader');
    const { error } = await client.rpc('upsert_change_event_annotation', {
      p_change_event_id: changeEventId,
      p_body: 'Should fail',
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });

  it('non-member cannot see the change event (02000)', async () => {
    // A user with no space membership cannot even see the trial_change_event
    // via RLS, so the RPC raises "change event not found" (02000).
    const client = as(p, 'no_memberships');
    const { error } = await client.rpc('upsert_change_event_annotation', {
      p_change_event_id: changeEventId,
      p_body: 'Should fail',
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('02000');
  });

  it('upsert with nonexistent change_event_id raises 02000', async () => {
    const client = as(p, 'tenant_owner');
    const { error } = await client.rpc('upsert_change_event_annotation', {
      p_change_event_id: 'deadbeef-dead-dead-dead-deaddeadbeef',
      p_body: 'Ghost note',
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('02000');
  });
});

// ---------------------------------------------------------------------------
// 2. Unified feed (get_events_page_data with detected source type)
// ---------------------------------------------------------------------------
describe('get_events_page_data unified feed', () => {
  it('source=detected returns at least 1 item with source_type=detected', async () => {
    const { data, error } = await svc.rpc('get_events_page_data', {
      p_space_id: spaceId,
      p_source_type: 'detected',
      p_limit: 50,
      p_offset: 0,
    });
    expect(error).toBeNull();

    const result = data as { items: Array<{ source_type: string }>; total: number };
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    expect(result.items.every((i) => i.source_type === 'detected')).toBe(true);
  });

  it('return shape has items array and total number', async () => {
    const { data, error } = await svc.rpc('get_events_page_data', {
      p_space_id: spaceId,
      p_source_type: 'detected',
      p_limit: 50,
      p_offset: 0,
    });
    expect(error).toBeNull();

    const result = data as { items: unknown; total: unknown };
    expect(Array.isArray(result.items)).toBe(true);
    expect(typeof result.total).toBe('number');
  });

  it('mixed feed (p_source_type=null) returns items', async () => {
    const { data, error } = await svc.rpc('get_events_page_data', {
      p_space_id: spaceId,
      p_source_type: null,
      p_limit: 50,
      p_offset: 0,
    });
    expect(error).toBeNull();

    const result = data as { items: Array<{ source_type: string }>; total: number };
    expect(result.items.length).toBeGreaterThanOrEqual(1);
  });

  it('annotation indicator: has_annotation=true after upserting an annotation', async () => {
    // Upsert an annotation on the change event.
    const client = as(p, 'tenant_owner');
    const { error: upsertErr } = await client.rpc('upsert_change_event_annotation', {
      p_change_event_id: changeEventId,
      p_body: 'Annotation for indicator test',
    });
    expect(upsertErr).toBeNull();

    // Query the feed.
    const { data, error } = await svc.rpc('get_events_page_data', {
      p_space_id: spaceId,
      p_source_type: 'detected',
      p_limit: 50,
      p_offset: 0,
    });
    expect(error).toBeNull();

    const result = data as {
      items: Array<{ id: string; has_annotation: boolean; source_type: string }>;
      total: number;
    };
    const match = result.items.find((i) => i.id === changeEventId);
    expect(match).toBeTruthy();
    expect(match!.has_annotation).toBe(true);

    // Clean up annotation.
    await client.rpc('delete_change_event_annotation', {
      p_change_event_id: changeEventId,
    });
  });

  it('category mapping: status_changed maps to Trial status', async () => {
    const { data, error } = await svc.rpc('get_events_page_data', {
      p_space_id: spaceId,
      p_source_type: 'detected',
      p_limit: 50,
      p_offset: 0,
    });
    expect(error).toBeNull();

    const result = data as {
      items: Array<{
        id: string;
        category_name: string;
        change_event_type: string;
      }>;
    };
    const match = result.items.find((i) => i.change_event_type === 'status_changed');
    expect(match).toBeTruthy();
    expect(match!.category_name).toBe('Trial status');
  });

  it('pagination: p_limit=1 returns at most 1 item with total >= 1', async () => {
    const { data, error } = await svc.rpc('get_events_page_data', {
      p_space_id: spaceId,
      p_source_type: 'detected',
      p_limit: 1,
      p_offset: 0,
    });
    expect(error).toBeNull();

    const result = data as { items: unknown[]; total: number };
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.items.length).toBeLessThanOrEqual(1);
  });
});
