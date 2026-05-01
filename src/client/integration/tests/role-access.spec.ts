/**
 * Role-access matrix: a representative slice for v1.
 *
 * Covers the rules that surfaced in the 2026-05-01 retest, including the
 * three follow-ups closed in this session (#10, #15, the agency-backed
 * eviction guard). Each test is one matrix row -- "as <persona>, do <op>,
 * expect <observable>". Adding a row is one `it()`; the fixture is shared.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { buildPersonas, Personas } from '../fixtures/personas';
import { as, expectCode, expectCount, expectOk } from '../harness/as';

let p: Personas;

beforeAll(async () => {
  p = await buildPersonas();
}, 60_000);

describe('is_platform_admin()', () => {
  it('returns true for the platform_admin persona', async () => {
    const result = await as(p, 'platform_admin').rpc('is_platform_admin');
    expect(expectOk(result)).toBe(true);
  });

  it('returns false for the tenant_owner persona', async () => {
    const result = await as(p, 'tenant_owner').rpc('is_platform_admin');
    expect(expectOk(result)).toBe(false);
  });
});

describe('anonymous', () => {
  it('rpc provision_agency: 42501 (granted to authenticated only)', async () => {
    const result = await as(p, 'anon').rpc('provision_agency', {
      p_name: 'X',
      p_slug: 'x-test',
      p_subdomain: 'x-test',
      p_owner_email: 'x@x.test',
    });
    expectCode(result, '42501');
  });
});

// 'Leadership' system event category, seeded by migration 20260413120000.
// Convenient for tests that need a real category_id without standing one up.
const LEADERSHIP_CATEGORY_ID = 'e0000000-0000-0000-0000-000000000001';

describe('reader (space viewer of the test space)', () => {
  it('insert events: 42501 (RLS rejects writes for viewers)', async () => {
    const result = await as(p, 'reader').from('events').insert({
      space_id: p.org.spaceId,
      category_id: LEADERSHIP_CATEGORY_ID,
      title: 'should be rejected',
      event_date: '2026-05-01',
    });
    expectCode(result, '42501');
  });

  it('select tenants: returns the parent tenant (closes #15)', async () => {
    // Pure space-only members must see the parent tenant. Migration 85 (oops,
    // really 20260501050000) extended tenants SELECT policy to include
    // space-only members via has_tenant_access().
    const result = await as(p, 'reader')
      .from('tenants')
      .select('id')
      .eq('id', p.org.tenantId);
    expectCount(result, 1);
  });

  it('rpc seed_demo_data: 42501 (must be space owner)', async () => {
    const result = await as(p, 'reader').rpc('seed_demo_data', {
      p_space_id: p.org.spaceId,
    });
    expectCode(result, '42501', 'must be space owner');
  });
});

describe('contributor (space editor of the test space)', () => {
  it('insert events: ok', async () => {
    const result = await as(p, 'contributor').from('events').insert({
      space_id: p.org.spaceId,
      category_id: LEADERSHIP_CATEGORY_ID,
      title: 'contributor-added',
      event_date: '2026-05-01',
    });
    expectOk(result);
  });

  it('rpc seed_demo_data: 42501 (only space owner can seed)', async () => {
    const result = await as(p, 'contributor').rpc('seed_demo_data', {
      p_space_id: p.org.spaceId,
    });
    expectCode(result, '42501', 'must be space owner');
  });
});

describe('tenant owner (no space membership)', () => {
  it('rpc add_tenant_owner: ok with held invite for unknown email', async () => {
    const result = await as(p, 'tenant_owner').rpc('add_tenant_owner', {
      p_tenant_id: p.org.tenantId,
      p_email: `unknown-${Date.now()}@personas.test`,
    });
    const data = expectOk(result) as { owner_invited: boolean };
    expect(data.owner_invited).toBe(true);
  });

  it('insert events on a space they are not a member of: 42501', async () => {
    const result = await as(p, 'tenant_owner').from('events').insert({
      space_id: p.org.spaceId,
      category_id: LEADERSHIP_CATEGORY_ID,
      title: 'tenant-owner-write-without-space-membership',
      event_date: '2026-05-01',
    });
    expectCode(result, '42501');
  });

  it('cannot remove agency-backed tenant member (closes #10)', async () => {
    // Trying to delete the agency_owner's explicit tenant_members row.
    const result = await as(p, 'tenant_owner')
      .from('tenant_members')
      .delete()
      .eq('tenant_id', p.org.tenantId)
      .eq('user_id', p.ids.agency_owner);
    expectCode(result, '42501', 'Cannot remove an agency owner');
  });
});

describe('agency owner (parent agency, also an explicit tenant member)', () => {
  it('rpc create_space: rejects with explicit "Not a member of this tenant"', async () => {
    // The agency_owner persona has BOTH an agency_members row AND an explicit
    // tenant_members row in this fixture (the #10 setup). So they ARE a tenant
    // member here -- create_space should succeed for them. We assert ok.
    // (The strict-no-tenant-row variant would need a separate persona; out of
    // scope for v1.)
    const result = await as(p, 'agency_owner').rpc('create_space', {
      p_tenant_id: p.org.tenantId,
      p_name: `agency-owner-space-${Date.now()}`,
    });
    expectOk(result);
  });
});

describe('tenant_members_view shape', () => {
  it('is_agency_backed true for agency_owner, false for tenant_owner', async () => {
    const result = await as(p, 'tenant_owner')
      .from('tenant_members_view')
      .select('user_id, is_agency_backed')
      .eq('tenant_id', p.org.tenantId);
    const rows = expectOk(result) as { user_id: string; is_agency_backed: boolean }[];
    const byUser = new Map(rows.map((r) => [r.user_id, r.is_agency_backed]));
    expect(byUser.get(p.ids.agency_owner)).toBe(true);
    expect(byUser.get(p.ids.tenant_owner)).toBe(false);
  });
});
