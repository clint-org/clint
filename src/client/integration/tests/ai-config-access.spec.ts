/**
 * AI config access-control integration tests.
 *
 * Covers the move of AI cost caps/rate limits to platform-admin-only control
 * and the owner-safe read path, against real local Supabase:
 *
 *   - get_tenant_ai_status surfaces ai_enabled to ANY tenant accessor (the bug
 *     where space editors/viewers were wrongly blocked from AI import), while
 *     withholding the dollar cost cap from everyone and giving owners a usage
 *     percentage instead.
 *   - ai_config's table RLS is platform-admin-only: tenant owners can neither
 *     read the caps nor write any field directly.
 *   - tenant_owner_update_ai_config is on/off only; platform_admin_update_ai_config
 *     is the sole write path for caps.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectCode, expectOk } from '../harness/as';

let p: Personas;
let admin: SupabaseClient;

async function setConfig(fields: Record<string, unknown>): Promise<void> {
  await admin.from('ai_config').upsert({ tenant_id: p.org.tenantId, ...fields });
}

beforeAll(async () => {
  p = await buildPersonas();
  admin = adminClient();
}, 120_000);

afterAll(async () => {
  await admin.from('ai_config').delete().eq('tenant_id', p.org.tenantId);
});

describe('get_tenant_ai_status', () => {
  it('surfaces ai_enabled to a space editor who is not a tenant owner (import-block bug fix)', async () => {
    await setConfig({ ai_enabled: true, daily_token_cap: 500 });

    // The contributor (space editor) cannot read ai_config directly anymore:
    // table RLS is platform-admin-only, so a direct select returns no rows.
    const direct = await as(p, 'contributor')
      .from('ai_config')
      .select('ai_enabled')
      .eq('tenant_id', p.org.tenantId);
    expect(direct.error).toBeNull();
    expect(direct.data).toEqual([]);

    // But the SECURITY DEFINER RPC surfaces ai_enabled to them.
    const r = await as(p, 'contributor').rpc('get_tenant_ai_status', {
      p_tenant_id: p.org.tenantId,
    });
    const data = expectOk(r) as Record<string, unknown>;
    expect(data['ai_enabled']).toBe(true);
    // Owner-only fields are withheld from a non-owner member.
    expect(data['daily_usage_pct']).toBeNull();
    expect(data['per_user_rate_per_min']).toBeNull();
    expect(data['per_user_rate_per_hour']).toBeNull();
    // The dollar cost cap never leaves the database.
    expect('daily_token_cap' in data).toBe(false);
  });

  it('gives the tenant owner a usage percentage and rate limits, never the cost cap', async () => {
    await setConfig({
      ai_enabled: true,
      daily_token_cap: 1000,
      per_user_rate_per_min: 6,
      per_user_rate_per_hour: 60,
    });

    const r = await as(p, 'tenant_owner').rpc('get_tenant_ai_status', {
      p_tenant_id: p.org.tenantId,
    });
    const data = expectOk(r) as Record<string, unknown>;
    expect(data['ai_enabled']).toBe(true);
    expect(typeof data['daily_usage_pct']).toBe('number');
    expect(data['per_user_rate_per_min']).toBe(6);
    expect(data['per_user_rate_per_hour']).toBe(60);
    expect('daily_token_cap' in data).toBe(false);
  });

  it('reports disabled when no config row exists', async () => {
    await admin.from('ai_config').delete().eq('tenant_id', p.org.tenantId);

    const r = await as(p, 'contributor').rpc('get_tenant_ai_status', {
      p_tenant_id: p.org.tenantId,
    });
    const data = expectOk(r) as Record<string, unknown>;
    expect(data['ai_enabled']).toBe(false);
  });

  it('forbids a user with no access to the tenant', async () => {
    const r = await as(p, 'no_memberships').rpc('get_tenant_ai_status', {
      p_tenant_id: p.org.tenantId,
    });
    expectCode(r, '42501');
  });
});

describe('ai_config write-path lockdown', () => {
  it('tenant_owner_update_ai_config flips the on/off switch', async () => {
    await admin.from('ai_config').delete().eq('tenant_id', p.org.tenantId);

    const r = await as(p, 'tenant_owner').rpc('tenant_owner_update_ai_config', {
      p_tenant_id: p.org.tenantId,
      p_ai_enabled: true,
    });
    const data = expectOk(r) as Record<string, unknown>;
    expect(data['ai_enabled']).toBe(true);
  });

  it('rejects the removed cost-cap params on tenant_owner_update_ai_config', async () => {
    // The 5-arg overload is dropped; PostgREST finds no function matching these
    // args (PGRST202).
    const r = await as(p, 'tenant_owner').rpc('tenant_owner_update_ai_config', {
      p_tenant_id: p.org.tenantId,
      p_ai_enabled: true,
      p_daily_token_cap: 999,
    });
    expect(r.error).not.toBeNull();
  });

  it('blocks a tenant owner from writing caps directly (RLS platform-admin-only)', async () => {
    await setConfig({ ai_enabled: true, daily_token_cap: 500 });

    // RLS USING fails for the owner, so the UPDATE matches zero rows: no error,
    // but the cap is untouched.
    await as(p, 'tenant_owner')
      .from('ai_config')
      .update({ daily_token_cap: 1 })
      .eq('tenant_id', p.org.tenantId);

    const { data } = await admin
      .from('ai_config')
      .select('daily_token_cap')
      .eq('tenant_id', p.org.tenantId)
      .maybeSingle();
    expect(data?.['daily_token_cap']).toBe(500);
  });

  it('lets a platform admin set the token cap, model, and rate via platform_admin_update_ai_config', async () => {
    const r = await as(p, 'platform_admin').rpc('platform_admin_update_ai_config', {
      p_tenant_id: p.org.tenantId,
      p_reason: 'integration test',
      p_ai_model: 'claude-opus-4-8',
      p_daily_token_cap: 750000,
      p_per_user_rate_per_min: 8,
    });
    const data = expectOk(r) as Record<string, unknown>;
    expect(data['daily_token_cap']).toBe(750000);
    expect(data['ai_model']).toBe('claude-opus-4-8');
    expect(data['per_user_rate_per_min']).toBe(8);
  });

  it('rejects an unknown model on platform_admin_update_ai_config', async () => {
    const r = await as(p, 'platform_admin').rpc('platform_admin_update_ai_config', {
      p_tenant_id: p.org.tenantId,
      p_reason: 'bad model',
      p_ai_model: 'not-a-real-model',
    });
    expectCode(r, '22023');
  });

  it('forbids a tenant owner from calling platform_admin_update_ai_config', async () => {
    const r = await as(p, 'tenant_owner').rpc('platform_admin_update_ai_config', {
      p_tenant_id: p.org.tenantId,
      p_reason: 'should fail',
      p_daily_token_cap: 1,
    });
    expectCode(r, '42501');
  });
});

describe('ai_model_pricing catalog', () => {
  it('lets any authenticated user read the active catalog', async () => {
    const r = await as(p, 'contributor')
      .from('ai_model_pricing')
      .select('model_id, family')
      .eq('status', 'active');
    const rows = expectOk(r) as { model_id: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((m) => m.model_id === 'claude-sonnet-4-6')).toBe(true);
  });

  it('blocks a non-admin from writing the catalog (RLS)', async () => {
    await as(p, 'tenant_owner')
      .from('ai_model_pricing')
      .update({ input_cents_per_mtok: 1 })
      .eq('model_id', 'claude-sonnet-4-6');
    // RLS denies the row; the price is unchanged.
    const { data } = await admin
      .from('ai_model_pricing')
      .select('input_cents_per_mtok')
      .eq('model_id', 'claude-sonnet-4-6')
      .single();
    expect(Number(data!.input_cents_per_mtok)).toBe(300);
  });

  it('lets a platform admin change a price (future calls only) and forbids non-admins', async () => {
    const ok = await as(p, 'platform_admin').rpc('platform_admin_upsert_ai_model_pricing', {
      p_model_id: 'claude-sonnet-4-6',
      p_reason: 'integration price bump',
      p_input_cents_per_mtok: 305,
    });
    expect((expectOk(ok) as Record<string, unknown>)['input_cents_per_mtok']).toBe(305);
    // restore
    await as(p, 'platform_admin').rpc('platform_admin_upsert_ai_model_pricing', {
      p_model_id: 'claude-sonnet-4-6',
      p_reason: 'restore',
      p_input_cents_per_mtok: 300,
    });

    const denied = await as(p, 'tenant_owner').rpc('platform_admin_upsert_ai_model_pricing', {
      p_model_id: 'claude-sonnet-4-6',
      p_reason: 'should fail',
      p_input_cents_per_mtok: 1,
    });
    expectCode(denied, '42501');
  });
});

describe('get_ai_usage_rollup failure log', () => {
  it('surfaces error_message + warnings for a failed import at space scope', async () => {
    // Seed a failed ai_call directly (admin bypasses RLS).
    const { data: row } = await admin
      .from('ai_calls')
      .insert({
        tenant_id: p.org.tenantId,
        space_id: p.org.spaceId,
        user_id: p.ids.contributor,
        model: 'claude-sonnet-4-6',
        feature: 'source_extract',
        outcome: 'parse_failed',
        error_code: 'parse_failed',
        error_message: 'model returned invalid JSON',
        warnings: ['truncated_output'],
      })
      .select('id')
      .single();

    const r = await as(p, 'platform_admin').rpc('get_ai_usage_rollup', {
      p_scope: 'space',
      p_id: p.org.spaceId,
      p_window: '7 days',
    });
    const payload = expectOk(r) as { data: Record<string, unknown>[] };
    const failed = payload.data.find((x) => x['ai_call_id'] === row!.id);
    expect(failed).toBeTruthy();
    expect(failed!['error_message']).toBe('model returned invalid JSON');
    expect(failed!['error_code']).toBe('parse_failed');
    expect(failed!['warnings']).toEqual(['truncated_output']);

    await admin.from('ai_calls').delete().eq('id', row!.id);
  });

  it('returns user_email, cost_usd, and entity_counts for a successful import at space scope', async () => {
    // Seed a source document, a successful priced ai_call linked to it, and two
    // companies created from that import (provenance via source_doc_id).
    const { data: doc } = await admin
      .from('source_documents')
      .insert({
        space_id: p.org.spaceId,
        source_kind: 'text',
        source_title: 'Imports drill detail test',
        source_text: 'seed',
        text_hash: 'finding4-drill-1',
        fetch_outcome: 'paste',
        created_by: p.ids.contributor,
      })
      .select('id')
      .single();

    const { data: call } = await admin
      .from('ai_calls')
      .insert({
        tenant_id: p.org.tenantId,
        space_id: p.org.spaceId,
        user_id: p.ids.contributor,
        source_doc_id: doc!.id,
        model: 'claude-opus-4-8',
        feature: 'source_extract',
        outcome: 'success',
        prompt_tokens: 1000,
        completion_tokens: 500,
        cost_estimate_cents: 7.5,
        duration_ms: 1234,
      })
      .select('id')
      .single();

    // Two companies created from this import (exercise the real provenance path).
    for (const name of ['F4 Pharma A', 'F4 Pharma B']) {
      const c = await as(p, 'contributor').rpc('create_company', {
        p_space_id: p.org.spaceId,
        p_name: name,
        p_logo_url: null,
        p_source_doc_id: doc!.id,
      });
      expectOk(c);
    }

    const r = await as(p, 'platform_admin').rpc('get_ai_usage_rollup', {
      p_scope: 'space',
      p_id: p.org.spaceId,
      p_window: '7 days',
    });
    const payload = expectOk(r) as { data: Record<string, unknown>[] };
    const detail = payload.data.find((x) => x['ai_call_id'] === call!.id);
    expect(detail).toBeTruthy();
    // Display contract the imports grid renders (was previously user_id / cost_cents).
    expect(detail!['user_email']).toBe('contributor@personas.test');
    expect(detail!['cost_usd']).toBeCloseTo(0.075, 4); // 7.5 cents -> $0.075
    expect(detail!['entity_counts']).toMatchObject({
      companies: 2,
      assets: 0,
      trials: 0,
      markers: 0,
      events: 0,
    });

    // tenant scope feeds the spaces drill's "Entities" column (flat total).
    const tr = await as(p, 'platform_admin').rpc('get_ai_usage_rollup', {
      p_scope: 'tenant',
      p_id: p.org.tenantId,
      p_window: '7 days',
    });
    const tPayload = expectOk(tr) as { data: Record<string, unknown>[] };
    const spaceRow = tPayload.data.find((x) => x['space_id'] === p.org.spaceId);
    expect(spaceRow).toBeTruthy();
    expect(spaceRow!['entity_count']).toBeGreaterThanOrEqual(2);

    await admin.from('companies').delete().eq('source_doc_id', doc!.id);
    await admin.from('ai_calls').delete().eq('id', call!.id);
    await admin.from('source_documents').delete().eq('id', doc!.id);
  });
});
