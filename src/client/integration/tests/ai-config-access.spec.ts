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
    await setConfig({ ai_enabled: true, daily_cost_cap_cents: 500 });

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
    expect('daily_cost_cap_cents' in data).toBe(false);
  });

  it('gives the tenant owner a usage percentage and rate limits, never the cost cap', async () => {
    await setConfig({
      ai_enabled: true,
      daily_cost_cap_cents: 1000,
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
    expect('daily_cost_cap_cents' in data).toBe(false);
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
      p_daily_cost_cap_cents: 999,
    });
    expect(r.error).not.toBeNull();
  });

  it('blocks a tenant owner from writing caps directly (RLS platform-admin-only)', async () => {
    await setConfig({ ai_enabled: true, daily_cost_cap_cents: 500 });

    // RLS USING fails for the owner, so the UPDATE matches zero rows: no error,
    // but the cap is untouched.
    await as(p, 'tenant_owner')
      .from('ai_config')
      .update({ daily_cost_cap_cents: 1 })
      .eq('tenant_id', p.org.tenantId);

    const { data } = await admin
      .from('ai_config')
      .select('daily_cost_cap_cents')
      .eq('tenant_id', p.org.tenantId)
      .maybeSingle();
    expect(data?.['daily_cost_cap_cents']).toBe(500);
  });

  it('lets a platform admin set caps via platform_admin_update_ai_config', async () => {
    const r = await as(p, 'platform_admin').rpc('platform_admin_update_ai_config', {
      p_tenant_id: p.org.tenantId,
      p_reason: 'integration test',
      p_daily_cost_cap_cents: 750,
      p_per_user_rate_per_min: 8,
    });
    const data = expectOk(r) as Record<string, unknown>;
    expect(data['daily_cost_cap_cents']).toBe(750);
    expect(data['per_user_rate_per_min']).toBe(8);
  });

  it('forbids a tenant owner from calling platform_admin_update_ai_config', async () => {
    const r = await as(p, 'tenant_owner').rpc('platform_admin_update_ai_config', {
      p_tenant_id: p.org.tenantId,
      p_reason: 'should fail',
      p_daily_cost_cap_cents: 1,
    });
    expectCode(r, '42501');
  });
});
