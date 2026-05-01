/**
 * Role-access matrix.
 *
 * Mirrors the structure of `docs/test-plans/role-access-checker.md`. Each
 * `it()` is one matrix row -- "as <persona>, do <op>, expect <observable>".
 * Pure UI-shape checks (route guard redirects, chrome rendering, button
 * visibility) live in Playwright; this file covers the server-side surface
 * (RPCs, RLS, triggers, view shape).
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { buildPersonas, Personas, TEST_SUBDOMAIN_PREFIX } from '../fixtures/personas';
import { as, expectCode, expectCount, expectOk } from '../harness/as';

let p: Personas;

beforeAll(async () => {
  p = await buildPersonas();
}, 60_000);

// 'Leadership' system event category seeded by migration 20260413120000.
const LEADERSHIP_CATEGORY_ID = 'e0000000-0000-0000-0000-000000000001';

const eventBody = (overrides: Record<string, unknown> = {}) => ({
  space_id: p.org.spaceId,
  category_id: LEADERSHIP_CATEGORY_ID,
  title: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  event_date: '2026-05-01',
  ...overrides,
});

// ============================================================================
// Anonymous
// ============================================================================

describe('anonymous', () => {
  it('rpc provision_agency: 42501 (granted to authenticated only)', async () => {
    const r = await as(p, 'anon').rpc('provision_agency', {
      p_name: 'X',
      p_slug: 'x-test',
      p_subdomain: 'x-test',
      p_owner_email: 'x@x.test',
    });
    expectCode(r, '42501');
  });

  it('rpc get_dashboard_data: ok with [] (RLS filters everything out)', async () => {
    const r = await as(p, 'anon').rpc('get_dashboard_data', { p_space_id: p.org.spaceId });
    const data = expectOk(r);
    expect(Array.isArray(data) ? data.length : -1).toBe(0);
  });

  it('select tenants: empty (RLS hides)', async () => {
    const r = await as(p, 'anon').from('tenants').select('id');
    expectCount(r, 0);
  });

  it('select spaces: empty', async () => {
    const r = await as(p, 'anon').from('spaces').select('id');
    expectCount(r, 0);
  });
});

// ============================================================================
// no_memberships -- signed in but holds no agency/tenant/space rows
// ============================================================================

describe('no_memberships', () => {
  it('select tenants: empty (no membership = no visibility)', async () => {
    const r = await as(p, 'no_memberships').from('tenants').select('id');
    expectCount(r, 0);
  });

  it('select spaces: empty', async () => {
    const r = await as(p, 'no_memberships').from('spaces').select('id');
    expectCount(r, 0);
  });

  it('rpc create_space: P0001 (Not a member of this tenant)', async () => {
    const r = await as(p, 'no_memberships').rpc('create_space', {
      p_tenant_id: p.org.tenantId,
      p_name: 'should-fail',
    });
    expectCode(r, 'P0001', 'Not a member of this tenant');
  });
});

// ============================================================================
// is_platform_admin() helper
// ============================================================================

describe('is_platform_admin()', () => {
  it('true for the platform_admin persona', async () => {
    const r = await as(p, 'platform_admin').rpc('is_platform_admin');
    expect(expectOk(r)).toBe(true);
  });

  it('false for tenant_owner', async () => {
    const r = await as(p, 'tenant_owner').rpc('is_platform_admin');
    expect(expectOk(r)).toBe(false);
  });

  it('false for reader', async () => {
    const r = await as(p, 'reader').rpc('is_platform_admin');
    expect(expectOk(r)).toBe(false);
  });
});

// ============================================================================
// Space Reader (viewer)
// ============================================================================

describe('reader (space viewer)', () => {
  it('insert events: 42501 (RLS rejects writes for viewers)', async () => {
    const r = await as(p, 'reader').from('events').insert(eventBody());
    expectCode(r, '42501');
  });

  it('select events: ok (read access for viewers)', async () => {
    const r = await as(p, 'reader').from('events').select('id').eq('space_id', p.org.spaceId);
    expectOk(r);
  });

  it('select tenants: returns parent tenant (closes #15)', async () => {
    const r = await as(p, 'reader').from('tenants').select('id').eq('id', p.org.tenantId);
    expectCount(r, 1);
  });

  it('select spaces: returns the test space (visible via has_space_access)', async () => {
    const r = await as(p, 'reader').from('spaces').select('id').eq('id', p.org.spaceId);
    expectCount(r, 1);
  });

  it('rpc seed_demo_data: 42501 (must be space owner)', async () => {
    const r = await as(p, 'reader').rpc('seed_demo_data', { p_space_id: p.org.spaceId });
    expectCode(r, '42501', 'must be space owner');
  });

  it('rpc invite_to_space: 42501 (only owner can invite)', async () => {
    const r = await as(p, 'reader').rpc('invite_to_space', {
      p_space_id: p.org.spaceId,
      p_email: `reject-${Date.now()}@personas.test`,
      p_role: 'viewer',
    });
    expectCode(r, '42501');
  });

  it('insert space_invites direct: 42501 (RLS rejects)', async () => {
    const r = await as(p, 'reader').from('space_invites').insert({
      space_id: p.org.spaceId,
      email: 'x@x.test',
      role: 'viewer',
      invite_code: 'a'.repeat(32),
    });
    expectCode(r, '42501');
  });
});

// ============================================================================
// Space Contributor (editor)
// ============================================================================

describe('contributor (space editor)', () => {
  it('insert events: ok', async () => {
    const r = await as(p, 'contributor').from('events').insert(eventBody({ title: 'contrib-1' }));
    expectOk(r);
  });

  it('update events: ok (editing a row)', async () => {
    // Create first, then update.
    const created = await as(p, 'contributor')
      .from('events')
      .insert(eventBody({ title: 'contrib-update-target' }))
      .select('id')
      .single();
    const id = (expectOk(created) as { id: string }).id;
    const r = await as(p, 'contributor')
      .from('events')
      .update({ title: 'contrib-update-final' })
      .eq('id', id);
    expectOk(r);
  });

  it('rpc seed_demo_data: 42501 (only space owner)', async () => {
    const r = await as(p, 'contributor').rpc('seed_demo_data', { p_space_id: p.org.spaceId });
    expectCode(r, '42501', 'must be space owner');
  });

  it('rpc invite_to_space: 42501 (only owner can invite)', async () => {
    const r = await as(p, 'contributor').rpc('invite_to_space', {
      p_space_id: p.org.spaceId,
      p_email: `reject-${Date.now()}@personas.test`,
      p_role: 'viewer',
    });
    expectCode(r, '42501');
  });

  it('insert space_invites direct: 42501', async () => {
    const r = await as(p, 'contributor').from('space_invites').insert({
      space_id: p.org.spaceId,
      email: 'x@x.test',
      role: 'editor',
      invite_code: 'b'.repeat(32),
    });
    expectCode(r, '42501');
  });
});

// ============================================================================
// Space Owner
// ============================================================================

describe('space_owner', () => {
  it('insert events: ok', async () => {
    const r = await as(p, 'space_owner').from('events').insert(eventBody({ title: 'owner-1' }));
    expectOk(r);
  });

  it('rpc invite_to_space role=viewer: ok (held invite for unknown email)', async () => {
    const email = `held-${Date.now()}@personas.test`;
    const r = await as(p, 'space_owner').rpc('invite_to_space', {
      p_space_id: p.org.spaceId,
      p_email: email,
      p_role: 'viewer',
    });
    expectOk(r);
  });

  it('idempotent invite_to_space: same (email, role) returns same invite_code', async () => {
    const email = `idem-${Date.now()}@personas.test`;
    const r1 = await as(p, 'space_owner').rpc('invite_to_space', {
      p_space_id: p.org.spaceId,
      p_email: email,
      p_role: 'editor',
    });
    const d1 = expectOk(r1) as { invite_code?: string };
    const r2 = await as(p, 'space_owner').rpc('invite_to_space', {
      p_space_id: p.org.spaceId,
      p_email: email,
      p_role: 'editor',
    });
    const d2 = expectOk(r2) as { invite_code?: string };
    expect(d1.invite_code).toBeTruthy();
    expect(d1.invite_code).toBe(d2.invite_code);
    // Confirm only one row.
    const list = await as(p, 'space_owner')
      .from('space_invites')
      .select('id')
      .eq('space_id', p.org.spaceId)
      .eq('email', email);
    expectCount(list, 1);
  });

  it('rpc seed_demo_data: ok (space owner can seed)', async () => {
    const r = await as(p, 'space_owner').rpc('seed_demo_data', { p_space_id: p.org.spaceId });
    expectOk(r);
  });

  it('rpc seed_demo_data again: idempotent (no error)', async () => {
    const r = await as(p, 'space_owner').rpc('seed_demo_data', { p_space_id: p.org.spaceId });
    expectOk(r);
  });
});

// ============================================================================
// Tenant Owner (no space membership)
// ============================================================================

describe('tenant_owner (no space membership)', () => {
  it('select spaces (filtered to our tenant): returns the test space', async () => {
    const r = await as(p, 'tenant_owner')
      .from('spaces')
      .select('id')
      .eq('tenant_id', p.org.tenantId);
    expectCount(r, 1);
  });

  it('insert events on a space they are not a member of: 42501', async () => {
    const r = await as(p, 'tenant_owner').from('events').insert(eventBody({ title: 'reject-tenant-owner' }));
    expectCode(r, '42501');
  });

  it('rpc create_space (in their tenant): ok', async () => {
    const r = await as(p, 'tenant_owner').rpc('create_space', {
      p_tenant_id: p.org.tenantId,
      p_name: `tenant-owner-space-${Date.now()}`,
    });
    expectOk(r);
  });

  it('rpc seed_demo_data on a space they are not a member of: 42501', async () => {
    const r = await as(p, 'tenant_owner').rpc('seed_demo_data', { p_space_id: p.org.spaceId });
    expectCode(r, '42501', 'must be space owner');
  });

  it('rpc add_tenant_owner: ok with held invite for unknown email', async () => {
    const r = await as(p, 'tenant_owner').rpc('add_tenant_owner', {
      p_tenant_id: p.org.tenantId,
      p_email: `unknown-${Date.now()}@personas.test`,
    });
    const data = expectOk(r) as { owner_invited: boolean };
    expect(data.owner_invited).toBe(true);
  });

  it('idempotent add_tenant_owner: same email returns same invite_code, one row', async () => {
    const email = `idem-${Date.now()}@personas.test`;
    const r1 = await as(p, 'tenant_owner').rpc('add_tenant_owner', {
      p_tenant_id: p.org.tenantId,
      p_email: email,
    });
    const d1 = expectOk(r1) as { invite_code?: string };
    const r2 = await as(p, 'tenant_owner').rpc('add_tenant_owner', {
      p_tenant_id: p.org.tenantId,
      p_email: email,
    });
    const d2 = expectOk(r2) as { invite_code?: string };
    expect(d1.invite_code).toBeTruthy();
    expect(d1.invite_code).toBe(d2.invite_code);
    const list = await as(p, 'tenant_owner')
      .from('tenant_invites')
      .select('id')
      .eq('tenant_id', p.org.tenantId)
      .eq('email', email);
    expectCount(list, 1);
  });

  it('cannot remove agency-backed tenant member (closes #10)', async () => {
    const r = await as(p, 'tenant_owner')
      .from('tenant_members')
      .delete()
      .eq('tenant_id', p.org.tenantId)
      .eq('user_id', p.ids.agency_owner);
    expectCode(r, '42501', 'Cannot remove an agency owner');
  });
});

// ============================================================================
// Agency Owner (also has explicit tenant_members row)
// ============================================================================

describe('agency_owner (with explicit tenant_members row)', () => {
  it('rpc create_space (in their tenant): ok', async () => {
    const r = await as(p, 'agency_owner').rpc('create_space', {
      p_tenant_id: p.org.tenantId,
      p_name: `agency-owner-space-${Date.now()}`,
    });
    expectOk(r);
  });

  it('insert events on test space (no space_members row): 42501', async () => {
    // tenant_members row + agency-owner role do NOT grant space data write.
    const r = await as(p, 'agency_owner').from('events').insert(eventBody({ title: 'reject-agency-owner' }));
    expectCode(r, '42501');
  });

  it('select events on test space: 0 rows (no space_members row, data firewall)', async () => {
    const r = await as(p, 'agency_owner')
      .from('events')
      .select('id')
      .eq('space_id', p.org.spaceId);
    expectCount(r, 0);
  });
});

// ============================================================================
// Agency Owner (strict: NO tenant_members row anywhere) -- the firewall case
// ============================================================================

describe('agency_only (no tenant_members row)', () => {
  it('rpc create_space: P0001 (Not a member of this tenant)', async () => {
    const r = await as(p, 'agency_only').rpc('create_space', {
      p_tenant_id: p.org.tenantId,
      p_name: 'agency-only-attempt',
    });
    expectCode(r, 'P0001', 'Not a member of this tenant');
  });

  it('select events: 0 rows (data firewall)', async () => {
    const r = await as(p, 'agency_only').from('events').select('id').eq('space_id', p.org.spaceId);
    expectCount(r, 0);
  });

  it('rpc seed_demo_data: 42501', async () => {
    const r = await as(p, 'agency_only').rpc('seed_demo_data', { p_space_id: p.org.spaceId });
    expectCode(r, '42501');
  });

  it('rpc provision_agency: 42501 (platform admin only)', async () => {
    const r = await as(p, 'agency_only').rpc('provision_agency', {
      p_name: 'X',
      p_slug: `${TEST_SUBDOMAIN_PREFIX}reject`,
      p_subdomain: `${TEST_SUBDOMAIN_PREFIX}reject`,
      p_owner_email: 'x@x.test',
    });
    expectCode(r, '42501');
  });
});

// ============================================================================
// Platform Admin
// ============================================================================

describe('platform_admin', () => {
  it('rpc provision_agency: ok', async () => {
    const sub = `${TEST_SUBDOMAIN_PREFIX}prov-${Date.now().toString(36)}`;
    const r = await as(p, 'platform_admin').rpc('provision_agency', {
      p_name: 'PA Test Agency',
      p_slug: sub,
      p_subdomain: sub,
      p_owner_email: `pa-test-${Date.now()}@personas.test`,
    });
    expectOk(r);
  });

  it('rpc lookup_user_by_email (existing): found=true', async () => {
    const r = await as(p, 'platform_admin').rpc('lookup_user_by_email', {
      p_email: 'reader@personas.test',
    });
    const data = expectOk(r) as { found: boolean; user_id?: string };
    expect(data.found).toBe(true);
    expect(data.user_id).toBe(p.ids.reader);
  });

  it('rpc lookup_user_by_email (unknown): found=false', async () => {
    const r = await as(p, 'platform_admin').rpc('lookup_user_by_email', {
      p_email: `nobody-${Date.now()}@personas.test`,
    });
    const data = expectOk(r) as { found: boolean };
    expect(data.found).toBe(false);
  });

  it('select events on test space: ok (admin read bypass)', async () => {
    const r = await as(p, 'platform_admin')
      .from('events')
      .select('id')
      .eq('space_id', p.org.spaceId);
    expectOk(r);
  });

  it('insert events on test space (no space_members row): 42501 (admin bypass is read-only)', async () => {
    const r = await as(p, 'platform_admin').from('events').insert(eventBody({ title: 'admin-write-attempt' }));
    expectCode(r, '42501');
  });

  it('rpc seed_demo_data: ok (platform admin disjunct)', async () => {
    const r = await as(p, 'platform_admin').rpc('seed_demo_data', { p_space_id: p.org.spaceId });
    expectOk(r);
  });
});

// ============================================================================
// tenant_members_view shape (closes #10's surface side)
// ============================================================================

describe('tenant_members_view.is_agency_backed', () => {
  it('true for agency_owner, false for tenant_owner', async () => {
    const r = await as(p, 'tenant_owner')
      .from('tenant_members_view')
      .select('user_id, is_agency_backed')
      .eq('tenant_id', p.org.tenantId);
    const rows = expectOk(r) as { user_id: string; is_agency_backed: boolean }[];
    const byUser = new Map(rows.map((row) => [row.user_id, row.is_agency_backed]));
    expect(byUser.get(p.ids.agency_owner)).toBe(true);
    expect(byUser.get(p.ids.tenant_owner)).toBe(false);
  });

  it('agency_only sees the view too (tenant member via agency-owner disjunct)', async () => {
    const r = await as(p, 'agency_only')
      .from('tenant_members_view')
      .select('user_id, is_agency_backed')
      .eq('tenant_id', p.org.tenantId);
    expectOk(r);
  });
});
