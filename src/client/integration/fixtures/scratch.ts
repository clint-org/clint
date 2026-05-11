/**
 * Per-test scratch entities. Each helper creates a throwaway agency / tenant /
 * space via service-role RPC, returns its id, and exposes a cleanup() that
 * drops it via direct SQL. Cleanup is idempotent -- safe to call after the
 * RPC under test already destroyed the entity.
 *
 * Cascade order matches public.delete_space (migration 20260503090000):
 * markers must be deleted before their parent space to satisfy the
 * marker_changes_space_id_fkey audit constraint that fires from the
 * _log_marker_change trigger during cascade.
 *
 * Naming: scratch entities use a recognizable prefix so any leak across runs
 * is bounded by the persona-graph wipe in buildPersonas(), which sweeps by
 * subdomain prefix.
 */

import { Client as PgClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { Personas } from './personas';
import { as } from '../harness/as';

const SUPABASE_DB_URL =
  process.env['SUPABASE_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function shortId(): string {
  return randomUUID().slice(0, 8);
}

export interface ScratchAgency {
  agencyId: string;
  tenantId: string;
  spaceId: string;
  cleanup: () => Promise<void>;
}

export interface ScratchTenant {
  tenantId: string;
  cleanup: () => Promise<void>;
}

export interface ScratchSpace {
  spaceId: string;
  cleanup: () => Promise<void>;
}

/**
 * Provision a fresh agency + tenant + space. Returns ids and a cleanup that
 * drops the agency (cascading through tenants + spaces).
 *
 * Calls provision_agency / provision_tenant / create_space as `platform_admin`,
 * because those RPCs require `auth.uid() is not null` (they reject service-
 * role calls). platform_admin has the broadest write privilege and creating
 * scratch entities under its identity doesn't muddy persona-graph ownership.
 */
export async function createScratchAgency(personas: Personas): Promise<ScratchAgency> {
  const id = shortId();
  const admin = as(personas, 'platform_admin');

  const { data: agencyRow, error: agencyErr } = await admin.rpc('provision_agency', {
    p_name: `Scratch Agency ${id}`,
    p_slug: `scratch-${id}`,
    p_subdomain: `pftest-tx-scratch-${id}`,
    p_owner_email: `scratch-${id}@scratch.test`,
  });
  if (agencyErr) throw new Error(`createScratchAgency.provision_agency: ${agencyErr.message}`);
  const agencyId = (agencyRow as { id: string }).id;

  const { data: tenantRow, error: tenantErr } = await admin.rpc('provision_tenant', {
    p_agency_id: agencyId,
    p_name: `Scratch Tenant ${id}`,
    p_subdomain: `pftest-tx-tenant-${id}`,
  });
  if (tenantErr) throw new Error(`createScratchAgency.provision_tenant: ${tenantErr.message}`);
  const tenantId = (tenantRow as { id: string }).id;

  const { data: spaceRow, error: spaceErr } = await admin.rpc('create_space', {
    p_tenant_id: tenantId,
    p_name: `Scratch Space ${id}`,
  });
  if (spaceErr) throw new Error(`createScratchAgency.create_space: ${spaceErr.message}`);
  const spaceId = (spaceRow as { id: string }).id;

  return { agencyId, tenantId, spaceId, cleanup: () => deleteAgencyCascade(agencyId) };
}

/**
 * Provision a fresh tenant under personas.org.agencyId. Returns the tenant id
 * and a cleanup that drops the tenant (cascading through any spaces).
 */
export async function createScratchTenant(personas: Personas): Promise<ScratchTenant> {
  const id = shortId();
  const admin = as(personas, 'platform_admin');

  const { data: tenantRow, error: tenantErr } = await admin.rpc('provision_tenant', {
    p_agency_id: personas.org.agencyId,
    p_name: `Scratch Tenant ${id}`,
    p_subdomain: `pftest-tx-tenant-${id}`,
  });
  if (tenantErr) throw new Error(`createScratchTenant.provision_tenant: ${tenantErr.message}`);
  const tenantId = (tenantRow as { id: string }).id;

  return { tenantId, cleanup: () => deleteTenantCascade(tenantId) };
}

/**
 * Provision a fresh space under personas.org.tenantId. Returns the space id
 * and a cleanup that drops the space. create_space requires tenant_members
 * membership (no platform_admin override), so we call as tenant_owner.
 */
export async function createScratchSpace(personas: Personas): Promise<ScratchSpace> {
  const id = shortId();
  const owner = as(personas, 'tenant_owner');

  const { data: spaceRow, error: spaceErr } = await owner.rpc('create_space', {
    p_tenant_id: personas.org.tenantId,
    p_name: `Scratch Space ${id}`,
  });
  if (spaceErr) throw new Error(`createScratchSpace.create_space: ${spaceErr.message}`);
  const spaceId = (spaceRow as { id: string }).id;

  return { spaceId, cleanup: () => deleteSpaceCascade(spaceId) };
}

async function deleteSpaceCascade(spaceId: string): Promise<void> {
  const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
  try {
    await pg.connect();
    // Mirror public.delete_space: markers first (so the trigger inserts
    // marker_changes audit rows while the space still exists for FK), then
    // the space (cascade handles space_members, companies, assets, trials,
    // trial_change_events, marker_changes, marker_types).
    await pg.query(`delete from public.markers where space_id = $1`, [spaceId]);
    await pg.query(`delete from public.spaces where id = $1`, [spaceId]);
  } finally {
    await pg.end();
  }
}

async function deleteTenantCascade(tenantId: string): Promise<void> {
  const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
  try {
    await pg.connect();
    await pg.query(
      `delete from public.markers where space_id in
         (select id from public.spaces where tenant_id = $1)`,
      [tenantId]
    );
    await pg.query(`delete from public.spaces where tenant_id = $1`, [tenantId]);
    await pg.query(`delete from public.tenants where id = $1`, [tenantId]);
  } finally {
    await pg.end();
  }
}

async function deleteAgencyCascade(agencyId: string): Promise<void> {
  const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
  try {
    await pg.connect();
    await pg.query(
      `delete from public.markers where space_id in (
         select s.id from public.spaces s
         join public.tenants t on s.tenant_id = t.id
         where t.agency_id = $1
       )`,
      [agencyId]
    );
    await pg.query(
      `delete from public.spaces where tenant_id in
         (select id from public.tenants where agency_id = $1)`,
      [agencyId]
    );
    await pg.query(`delete from public.tenants where agency_id = $1`, [agencyId]);
    await pg.query(`delete from public.agencies where id = $1`, [agencyId]);
  } finally {
    await pg.end();
  }
}
