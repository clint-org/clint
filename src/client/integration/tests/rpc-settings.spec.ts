/**
 * Settings-write RPCs. All scoped to the shared persona graph (no scratch
 * needed). Each RPC gets one positive row (correct persona, OK) and one
 * negative row (wrong persona, gate denies).
 */

import { beforeAll, describe, it } from 'vitest';
import { buildPersonas, Personas } from '../fixtures/personas';
import { as, expectOk } from '../harness/as';

let p: Personas;
beforeAll(async () => {
  p = await buildPersonas();
}, 60_000);

function expectDenied(result: { error: { code?: string; message?: string } | null }) {
  if (!result.error) {
    throw new Error('expected denial, got success');
  }
  // Settings RPCs may surface denial as 42501 (PostgREST grant), P0001 (raise
  // exception in plpgsql), or PGRST302 (PostgREST RLS) depending on how the
  // gate is implemented. Accept any of those.
  const code = result.error.code ?? '';
  if (!['42501', 'P0001', 'PGRST302'].includes(code)) {
    throw new Error(
      `expected denial code (42501/P0001/PGRST302), got ${code}: ${result.error.message}`,
    );
  }
}

describe('rpc update_tenant_access', () => {
  it('tenant_owner: ok', async () => {
    const r = await as(p, 'tenant_owner').rpc('update_tenant_access', {
      p_tenant_id: p.org.tenantId,
      p_settings: {},
    });
    expectOk(r);
  });

  it('contributor: denied', async () => {
    const r = await as(p, 'contributor').rpc('update_tenant_access', {
      p_tenant_id: p.org.tenantId,
      p_settings: {},
    });
    expectDenied(r);
  });
});

describe('rpc update_tenant_branding', () => {
  it('tenant_owner: ok', async () => {
    const r = await as(p, 'tenant_owner').rpc('update_tenant_branding', {
      p_tenant_id: p.org.tenantId,
      p_branding: {},
    });
    expectOk(r);
  });

  it('reader: denied', async () => {
    const r = await as(p, 'reader').rpc('update_tenant_branding', {
      p_tenant_id: p.org.tenantId,
      p_branding: {},
    });
    expectDenied(r);
  });
});

describe('rpc update_agency_branding', () => {
  it('agency_owner: ok', async () => {
    const r = await as(p, 'agency_owner').rpc('update_agency_branding', {
      p_agency_id: p.org.agencyId,
      p_branding: {},
    });
    expectOk(r);
  });

  it('tenant_owner (non-agency): denied', async () => {
    const r = await as(p, 'tenant_owner').rpc('update_agency_branding', {
      p_agency_id: p.org.agencyId,
      p_branding: {},
    });
    expectDenied(r);
  });
});

describe('rpc update_space_field_visibility', () => {
  it('space_owner: ok', async () => {
    const r = await as(p, 'space_owner').rpc('update_space_field_visibility', {
      p_space_id: p.org.spaceId,
      p_visibility: {},
    });
    expectOk(r);
  });

  it('reader: denied', async () => {
    const r = await as(p, 'reader').rpc('update_space_field_visibility', {
      p_space_id: p.org.spaceId,
      p_visibility: {},
    });
    expectDenied(r);
  });
});
