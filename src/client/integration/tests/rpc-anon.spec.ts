/**
 * Anon-callable RPC surface. These are the RPCs the marketing site and the
 * pre-bootstrap brand fetch hit before the user has a session, so they must
 * accept anon callers and return useful data (or a clean fallback).
 */

import { beforeAll, describe, it, expect } from 'vitest';
import { buildPersonas, Personas } from '../fixtures/personas';
import { as, expectOk, expectCode } from '../harness/as';

let p: Personas;
beforeAll(async () => {
  p = await buildPersonas();
}, 60_000);

describe('rpc check_subdomain_available', () => {
  // Despite its anon-friendly name, this RPC is granted to authenticated
  // only (it's used by the agency portal's tenant-provisioning wizard).
  it('agency_owner: free subdomain returns true', async () => {
    const r = await as(p, 'agency_owner').rpc('check_subdomain_available', {
      p_subdomain: `unused-${Date.now()}`,
    });
    expect(expectOk(r)).toBe(true);
  });

  it('agency_owner: taken subdomain returns false', async () => {
    // pftest-tenant is the well-known tenant subdomain seeded by
    // buildPersonas() — guaranteed taken.
    const r = await as(p, 'agency_owner').rpc('check_subdomain_available', {
      p_subdomain: 'pftest-tenant',
    });
    expect(expectOk(r)).toBe(false);
  });

  it('anon: 42501 (authenticated-only)', async () => {
    const r = await as(p, 'anon').rpc('check_subdomain_available', {
      p_subdomain: 'whatever',
    });
    expectCode(r, '42501');
  });
});

describe('rpc get_brand_by_host', () => {
  it('anon: bogus host returns a usable brand record (default fallback)', async () => {
    const r = await as(p, 'anon').rpc('get_brand_by_host', {
      p_host: 'definitely-not-a-real-host.invalid',
    });
    const data = expectOk(r) as { kind?: string };
    expect(data).toBeTruthy();
    expect(typeof data.kind).toBe('string');
  });

  it('anon: real-shaped host returns brand with kind field', async () => {
    const r = await as(p, 'anon').rpc('get_brand_by_host', {
      p_host: 'app.example.com',
    });
    const data = expectOk(r) as { kind?: string };
    expect(typeof data.kind).toBe('string');
  });
});

describe('rpc get_tenant_access_settings', () => {
  it('tenant_owner: ok', async () => {
    const r = await as(p, 'tenant_owner').rpc('get_tenant_access_settings', {
      p_tenant_id: p.org.tenantId,
    });
    expectOk(r);
  });

  it('anon: 42501 (auth required)', async () => {
    const r = await as(p, 'anon').rpc('get_tenant_access_settings', {
      p_tenant_id: p.org.tenantId,
    });
    expectCode(r, '42501');
  });
});
