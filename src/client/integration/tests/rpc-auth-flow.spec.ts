/**
 * Auth-flow RPCs: invitation acceptance, self-join, agency membership.
 * These are the boundaries where forged or replayed credentials would have
 * the highest blast radius; every row here is a gate check.
 */

import { beforeAll, describe, it } from 'vitest';
import { buildPersonas, Personas } from '../fixtures/personas';
import { as, expectCode } from '../harness/as';

let p: Personas;
beforeAll(async () => {
  p = await buildPersonas();
}, 60_000);

describe('rpc accept_invite', () => {
  it('invalid code: error', async () => {
    const r = await as(p, 'no_memberships').rpc('accept_invite', {
      p_code: `bogus-${Date.now()}`,
    });
    if (!r.error) throw new Error('expected error for invalid invite');
  });

  it('anon: 42501 (auth required)', async () => {
    const r = await as(p, 'anon').rpc('accept_invite', { p_code: 'x' });
    expectCode(r, '42501');
  });
});

describe('rpc accept_space_invite', () => {
  it('invalid code: error', async () => {
    const r = await as(p, 'no_memberships').rpc('accept_space_invite', {
      p_code: `bogus-space-${Date.now()}`,
    });
    if (!r.error) throw new Error('expected error for invalid space invite');
  });

  it('anon: 42501', async () => {
    const r = await as(p, 'anon').rpc('accept_space_invite', { p_code: 'x' });
    expectCode(r, '42501');
  });
});

describe('rpc self_join_tenant', () => {
  it('non-matching email domain: error', async () => {
    // self_join_tenant gates on the tenant's email-domain allowlist. The
    // pftest-tenant has email_domain null (per personas fixture), so any
    // self-join attempt should be rejected with a specific code rather
    // than crash.
    const r = await as(p, 'no_memberships').rpc('self_join_tenant', {
      p_subdomain: 'pftest-tenant',
    });
    if (!r.error) throw new Error('expected error: tenant has no allowlist');
  });

  it('anon: 42501', async () => {
    const r = await as(p, 'anon').rpc('self_join_tenant', { p_subdomain: 'pftest-tenant' });
    expectCode(r, '42501');
  });
});

describe('rpc add_agency_member', () => {
  it('agency_owner: ok or known error (own agency)', async () => {
    const r = await as(p, 'agency_owner').rpc('add_agency_member', {
      p_agency_id: p.org.agencyId,
      p_email: `new-${Date.now()}@personas.test`,
      p_role: 'member',
    });
    // Accept OK or any error EXCEPT 42501 — 42501 would mean the gate
    // wrongly rejected agency_owner of their own agency.
    if (r.error?.code === '42501') {
      throw new Error('agency_owner unexpectedly denied for their own agency');
    }
  });

  it('tenant_owner (not in agency): 42501 / P0001', async () => {
    const r = await as(p, 'tenant_owner').rpc('add_agency_member', {
      p_agency_id: p.org.agencyId,
      p_email: 'x@x.test',
      p_role: 'member',
    });
    if (r.error?.code !== '42501' && r.error?.code !== 'P0001') {
      throw new Error(`expected denial, got ${r.error?.code}: ${r.error?.message}`);
    }
  });
});
