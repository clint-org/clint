/**
 * Tenant creation/provisioning RPCs.
 */

import { beforeAll, describe, it } from 'vitest';
import { buildPersonas, Personas, TEST_SUBDOMAIN_PREFIX } from '../fixtures/personas';
import { as, expectOk } from '../harness/as';

let p: Personas;
beforeAll(async () => {
  p = await buildPersonas();
}, 60_000);

describe('rpc provision_tenant', () => {
  it('platform_admin: ok (provisions under personas agency)', async () => {
    const r = await as(p, 'platform_admin').rpc('provision_tenant', {
      p_agency_id: p.org.agencyId,
      p_name: `Lifecycle Tenant ${Date.now()}`,
      p_subdomain: `${TEST_SUBDOMAIN_PREFIX}lc-${Date.now()}`,
    });
    expectOk(r);
  });

  it('no_memberships: denied', async () => {
    const r = await as(p, 'no_memberships').rpc('provision_tenant', {
      p_agency_id: p.org.agencyId,
      p_name: 'should-fail',
      p_subdomain: `${TEST_SUBDOMAIN_PREFIX}nope-${Date.now()}`,
    });
    if (r.error?.code !== '42501' && r.error?.code !== 'P0001') {
      throw new Error(`expected denial, got ${r.error?.code}: ${r.error?.message}`);
    }
  });
});

// create_tenant was dropped in migration 20260430120000_drop_self_provision_paths.
// Tenant creation is exclusively via provision_tenant now.

describe('rpc provision_tenant: idempotency / collision', () => {
  it('platform_admin: duplicate subdomain rejected', async () => {
    const sub = `${TEST_SUBDOMAIN_PREFIX}dup-${Date.now()}`;
    const first = await as(p, 'platform_admin').rpc('provision_tenant', {
      p_agency_id: p.org.agencyId,
      p_name: `Dup A ${sub}`,
      p_subdomain: sub,
    });
    expectOk(first);
    const second = await as(p, 'platform_admin').rpc('provision_tenant', {
      p_agency_id: p.org.agencyId,
      p_name: `Dup B ${sub}`,
      p_subdomain: sub,
    });
    if (!second.error) {
      throw new Error('expected duplicate-subdomain error');
    }
  });
});
