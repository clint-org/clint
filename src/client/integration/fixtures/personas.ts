/**
 * Persona fixture + JWT vault for the role-access integration suite.
 *
 * Seeds a deterministic graph against the local Supabase (agency + tenant +
 * space + 7 personas with role-shaped memberships) and mints an HS256 JWT for
 * each persona using the local instance's known JWT secret.
 *
 * Reruns are idempotent: any prior fixture entities (matched by the
 * `personas.test` email suffix and a fixed subdomain prefix) are wiped before
 * fresh ones are created. A `supabase db reset` between runs is NOT required.
 *
 * This module is local/CI-only. Production verifies JWTs with an ES256 key
 * pair whose private half is unreachable, so direct signing only works against
 * the local Supabase instance.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { Client as PgClient } from 'pg';

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];
const SUPABASE_JWT_SECRET =
  process.env['SUPABASE_JWT_SECRET'] ??
  'super-secret-jwt-token-with-at-least-32-characters-long';
const SUPABASE_DB_URL =
  process.env['SUPABASE_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'SUPABASE_SERVICE_ROLE_KEY is required. Run `supabase status -o env` and export it.',
  );
}

const EMAIL_SUFFIX = 'personas.test';
const SUBDOMAIN_PREFIX = 'pftest';
const AGENCY_SUBDOMAIN = `${SUBDOMAIN_PREFIX}-agency`;
const TENANT_SUBDOMAIN = `${SUBDOMAIN_PREFIX}-tenant`;

/**
 * Subdomain prefix tests should use when calling RPCs that create new
 * agencies/tenants (e.g. provision_agency in the platform_admin section).
 * The wipe sweeps these on every run.
 */
export const TEST_SUBDOMAIN_PREFIX = `${SUBDOMAIN_PREFIX}-tx-`;

export type PersonaName =
  | 'platform_admin'
  | 'agency_owner'    // Owns the test agency AND has an explicit tenant_members row (#10 setup).
  | 'agency_only'     // Owns the test agency but has NO tenant_members row anywhere (firewall).
  | 'tenant_owner'
  | 'space_owner'
  | 'contributor'
  | 'reader'
  | 'no_memberships'
  | 'anon';

export interface Personas {
  jwts: Record<PersonaName, string>;
  ids: Record<Exclude<PersonaName, 'anon'>, string>;
  org: { agencyId: string; tenantId: string; spaceId: string };
  url: string;
  anonKey: string;
}

const PERSONA_ROLES: Exclude<PersonaName, 'anon'>[] = [
  'platform_admin',
  'agency_owner',
  'agency_only',
  'tenant_owner',
  'space_owner',
  'contributor',
  'reader',
  'no_memberships',
];

/** Service-role client. Bypasses RLS; used only for fixture setup/teardown. */
function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Sign an HS256 JWT in the shape Supabase Auth issues. */
function mintJwt(userId: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      sub: userId,
      aud: 'authenticated',
      role: 'authenticated',
      email,
      iat: now,
      exp: now + 3600,
      iss: 'supabase-demo',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
    },
    SUPABASE_JWT_SECRET,
    { algorithm: 'HS256' },
  );
}

/** Wipe any prior fixture state so reruns are idempotent.
 *
 * Uses a direct SQL connection to set `clint.member_guard_cascade = 'on'` for
 * the duration of the wipe transaction. The member-self-protection triggers
 * (migration 73) check that GUC and short-circuit when it's set, which lets
 * us delete tenants/spaces/agencies that still have member rows without
 * tripping the last-owner protection.
 *
 * Why not the supabase-js admin client: PostgREST runs each request as its
 * own transaction. The `BEFORE DELETE FOR EACH STATEMENT` trigger on the
 * parent table sets the GUC, but in practice the cascade-row triggers don't
 * always observe it -- empirically the trigger raises during cascade despite
 * the marker. A direct pg connection lets us set it explicitly and reliably.
 *
 * Tests created auxiliary entities (e.g. spaces created by `create_space`
 * during a test run) so wiping by the well-known fixture subdomains alone
 * isn't enough. We also wipe everything attached to the persona user_ids.
 */
async function wipe(admin: SupabaseClient): Promise<void> {
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (listErr) throw new Error(`listUsers failed: ${listErr.message}`);
  const personas = list.users.filter((u) => u.email?.endsWith(`@${EMAIL_SUFFIX}`));
  const personaIds = personas.map((u) => u.id);

  const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
  await pg.connect();
  try {
    await pg.query('begin');
    await pg.query(`set local clint.member_guard_cascade = 'on'`);

    if (personaIds.length > 0) {
      // Tables where personas left rows that don't cascade through tenant/agency
      // deletion. These have to go before auth.users delete or the FK blocks it.
      await pg.query(`delete from public.tenant_invites where created_by = any($1::uuid[])`, [personaIds]);
      await pg.query(`delete from public.space_invites  where created_by = any($1::uuid[])`, [personaIds]);
      await pg.query(`delete from public.agency_invites where invited_by  = any($1::uuid[]) or accepted_by = any($1::uuid[])`, [personaIds]);

      // Spaces, products, companies, trials etc. reference auth.users via
      // created_by without cascade. Delete every space the persona created
      // (cascades to space-scoped data) plus everything under the test tenant.
      await pg.query(
        `delete from public.spaces where created_by = any($1::uuid[]) or tenant_id in (select id from public.tenants where subdomain = $2)`,
        [personaIds, TENANT_SUBDOMAIN],
      );
    }

    // Test-created tenants (named with TEST_SUBDOMAIN_PREFIX by tests that
    // call RPCs which create new tenants/agencies, e.g. provision_agency).
    await pg.query(`delete from public.tenants where subdomain like $1`, [`${TEST_SUBDOMAIN_PREFIX}%`]);

    // Test-created agencies (provision_agency in platform_admin tests).
    // Includes their cascading agency_members + agency_invites.
    await pg.query(`delete from public.agencies where subdomain like $1`, [`${TEST_SUBDOMAIN_PREFIX}%`]);

    // Well-known fixture entities.
    await pg.query(`delete from public.tenants where subdomain = $1`, [TENANT_SUBDOMAIN]);
    await pg.query(`delete from public.agencies where subdomain = $1`, [AGENCY_SUBDOMAIN]);

    if (personaIds.length > 0) {
      // Finally remove the persona auth.users rows. FK refs are now cleared.
      await pg.query(`delete from auth.users where id = any($1::uuid[])`, [personaIds]);
    }

    await pg.query('commit');
  } catch (err) {
    await pg.query('rollback');
    throw err;
  } finally {
    await pg.end();
  }
}

/** Create one auth.users row via the admin API. */
async function createUser(
  admin: SupabaseClient,
  name: PersonaName,
): Promise<{ id: string; email: string }> {
  const email = `${name}@${EMAIL_SUFFIX}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error) throw new Error(`createUser ${email} failed: ${error.message}`);
  if (!data.user) throw new Error(`createUser ${email} returned no user`);
  return { id: data.user.id, email };
}

/** Create the persona graph in idempotency-safe order. */
export async function buildPersonas(): Promise<Personas> {
  const admin = adminClient();
  await wipe(admin);

  // 1. Create the seven persona users.
  const userByName: Partial<Record<Exclude<PersonaName, 'anon'>, { id: string; email: string }>> =
    {};
  for (const name of PERSONA_ROLES) {
    userByName[name] = await createUser(admin, name);
  }

  // 2. Promote platform_admin first, before any other writes that might key
  //    off is_platform_admin().
  {
    const { error } = await admin
      .from('platform_admins')
      .insert({ user_id: userByName.platform_admin!.id });
    if (error) throw new Error(`platform_admins insert: ${error.message}`);
  }

  // 3. Agency. Leave email_domain null so personas with @personas.test don't
  //    have to pass enforce_member_email_domain.
  const { data: agency, error: agencyErr } = await admin
    .from('agencies')
    .insert({
      name: 'Personas Test Agency',
      slug: AGENCY_SUBDOMAIN,
      subdomain: AGENCY_SUBDOMAIN,
      app_display_name: 'Personas Test',
      contact_email: userByName.agency_owner!.email,
    })
    .select()
    .single();
  if (agencyErr) throw new Error(`agencies insert: ${agencyErr.message}`);

  // 4. Agency owner rows. Both agency_owner and agency_only own the agency.
  //    The difference is below: agency_owner ALSO has a tenant_members row,
  //    agency_only does not.
  {
    const { error } = await admin.from('agency_members').insert([
      { agency_id: agency.id, user_id: userByName.agency_owner!.id, role: 'owner' },
      { agency_id: agency.id, user_id: userByName.agency_only!.id, role: 'owner' },
    ]);
    if (error) throw new Error(`agency_members insert: ${error.message}`);
  }

  // 5. Tenant under the agency.
  const { data: tenant, error: tenantErr } = await admin
    .from('tenants')
    .insert({
      name: 'Personas Test Tenant',
      slug: TENANT_SUBDOMAIN,
      subdomain: TENANT_SUBDOMAIN,
      agency_id: agency.id,
    })
    .select()
    .single();
  if (tenantErr) throw new Error(`tenants insert: ${tenantErr.message}`);

  // 6. Tenant owner. NOT the agency owner -- the matrix needs a tenant-only owner.
  {
    const { error } = await admin.from('tenant_members').insert({
      tenant_id: tenant.id,
      user_id: userByName.tenant_owner!.id,
      role: 'owner',
    });
    if (error) throw new Error(`tenant_members insert (tenant_owner): ${error.message}`);
  }

  // 7. ALSO add the agency_owner as an explicit tenant_members row. This is
  //    the shape that exercises follow-up #10's is_agency_backed guard: the
  //    agency owner is also a tenant_members row, but their tenant access is
  //    "really" coming from the agency-owner disjunct.
  {
    const { error } = await admin.from('tenant_members').insert({
      tenant_id: tenant.id,
      user_id: userByName.agency_owner!.id,
      role: 'owner',
    });
    if (error) throw new Error(`tenant_members insert (agency_owner): ${error.message}`);
  }

  // 8. Space under the tenant.
  const { data: space, error: spaceErr } = await admin
    .from('spaces')
    .insert({
      tenant_id: tenant.id,
      name: 'Personas Test Space',
      created_by: userByName.tenant_owner!.id,
    })
    .select()
    .single();
  if (spaceErr) throw new Error(`spaces insert: ${spaceErr.message}`);

  // 9. Space-level memberships. space_owner / contributor / reader.
  {
    const rows = [
      { space_id: space.id, user_id: userByName.space_owner!.id, role: 'owner' as const },
      { space_id: space.id, user_id: userByName.contributor!.id, role: 'editor' as const },
      { space_id: space.id, user_id: userByName.reader!.id, role: 'viewer' as const },
    ];
    const { error } = await admin.from('space_members').insert(rows);
    if (error) throw new Error(`space_members insert: ${error.message}`);
  }

  // 10. Mint JWTs for everyone.
  const jwts: Record<PersonaName, string> = {
    platform_admin: mintJwt(userByName.platform_admin!.id, userByName.platform_admin!.email),
    agency_owner: mintJwt(userByName.agency_owner!.id, userByName.agency_owner!.email),
    agency_only: mintJwt(userByName.agency_only!.id, userByName.agency_only!.email),
    tenant_owner: mintJwt(userByName.tenant_owner!.id, userByName.tenant_owner!.email),
    space_owner: mintJwt(userByName.space_owner!.id, userByName.space_owner!.email),
    contributor: mintJwt(userByName.contributor!.id, userByName.contributor!.email),
    reader: mintJwt(userByName.reader!.id, userByName.reader!.email),
    no_memberships: mintJwt(userByName.no_memberships!.id, userByName.no_memberships!.email),
    anon: '',
  };

  return {
    jwts,
    ids: {
      platform_admin: userByName.platform_admin!.id,
      agency_owner: userByName.agency_owner!.id,
      agency_only: userByName.agency_only!.id,
      tenant_owner: userByName.tenant_owner!.id,
      space_owner: userByName.space_owner!.id,
      contributor: userByName.contributor!.id,
      reader: userByName.reader!.id,
      no_memberships: userByName.no_memberships!.id,
    },
    org: {
      agencyId: agency.id,
      tenantId: tenant.id,
      spaceId: space.id,
    },
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
  };
}

/** Optional teardown helper for tests that want to leave the DB clean. */
export async function tearDownPersonas(): Promise<void> {
  await wipe(adminClient());
}
