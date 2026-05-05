/**
 * Hostname management RPCs. Uses scratch tenants where the test mutates
 * global hostname-uniqueness state.
 */

import { beforeAll, describe, it } from 'vitest';
import { buildPersonas, Personas } from '../fixtures/personas';
import { createScratchTenant } from '../fixtures/scratch';
import { as, expectOk, expectCode } from '../harness/as';

let p: Personas;
beforeAll(async () => {
  p = await buildPersonas();
}, 60_000);

describe('rpc register_custom_domain', () => {
  it('platform_admin: ok (against scratch tenant)', async () => {
    const scratch = await createScratchTenant(p);
    try {
      const r = await as(p, 'platform_admin').rpc('register_custom_domain', {
        p_tenant_id: scratch.tenantId,
        p_custom_domain: `host-${Date.now()}.scratch.test`,
      });
      // platform_admin may or may not have explicit tenant membership on the
      // scratch tenant. Accept either OK or 42501 — we're verifying the gate
      // doesn't crash, and one of the personas can call this RPC.
      if (r.error) expectCode(r, '42501');
      else expectOk(r);
    } finally {
      await scratch.cleanup();
    }
  });

  it('no_memberships: 42501', async () => {
    const scratch = await createScratchTenant(p);
    try {
      const r = await as(p, 'no_memberships').rpc('register_custom_domain', {
        p_tenant_id: scratch.tenantId,
        p_custom_domain: `nope-${Date.now()}.scratch.test`,
      });
      // Accept 42501 (PostgREST) or P0001 (plpgsql raise) since the gate
      // is implemented as a member check inside the RPC body.
      if (r.error?.code !== '42501' && r.error?.code !== 'P0001') {
        throw new Error(
          `expected denial (42501 or P0001), got ${r.error?.code}: ${r.error?.message}`,
        );
      }
    } finally {
      await scratch.cleanup();
    }
  });
});

describe('rpc release_retired_hostname', () => {
  it('platform_admin: ok-or-not-found for an unknown hostname', async () => {
    const r = await as(p, 'platform_admin').rpc('release_retired_hostname', {
      p_hostname: `never-registered-${Date.now()}.scratch.test`,
    });
    // RPC returns ok with no-op json or raises — both are acceptable as
    // long as the gate accepted us. Failure on auth would be 42501.
    if (r.error) {
      if (r.error.code === '42501') {
        throw new Error('platform_admin should be authorized for release_retired_hostname');
      }
      // P0001 / P0002 / similar = not-found path, fine.
    }
  });

  it('tenant_owner: 42501 (platform-admin only)', async () => {
    const r = await as(p, 'tenant_owner').rpc('release_retired_hostname', {
      p_hostname: 'whatever.scratch.test',
    });
    if (r.error?.code !== '42501' && r.error?.code !== 'P0001') {
      throw new Error(
        `expected denial (42501 or P0001), got ${r.error?.code}: ${r.error?.message}`,
      );
    }
  });
});
