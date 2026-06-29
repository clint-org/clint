/**
 * Scratch world: per-run data isolation on dev WITHOUT a db reset.
 *
 * Each world provisions a throwaway agency -> tenant -> space (via the real
 * provision_* / create_space RPCs) and a set of role users (owner / editor /
 * viewer / non-member), each with a REAL GoTrue session obtained by
 * signInWithPassword. Tests inject the session as the `sb-auth-dev` apex cookie.
 *
 * Auth is pooler-only: users are created by direct SQL into auth.users +
 * auth.identities (the write-capable pooler is the only secret), then signed in
 * with the public anon key. No service-role key or JWT secret is needed.
 *
 * Teardown drops everything bottom-up via the pooler. There is NO `markers`
 * table on dev (the event model is live), so cleanup never references it.
 */

import { Client as PgClient } from 'pg';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import {
  DEV_APEX,
  DEV_SUPABASE_ANON_KEY,
  DEV_SUPABASE_URL,
  SCRATCH_PREFIX,
  requirePoolerUrl,
} from './dev-env';

/** Roles exposed for testing. `nonMember` has tenant access but NO space row. */
export type RoleName = 'owner' | 'editor' | 'viewer' | 'nonMember';

export interface RoleUser {
  role: RoleName;
  userId: string;
  email: string;
  session: Session;
}

export interface ScratchWorld {
  id: string;
  /** `pwreg-<id>.dev.clintapp.com` -- the tenant brand host. */
  host: string;
  baseURL: string;
  agencyId: string;
  tenantId: string;
  spaceId: string;
  /** Role users with live sessions (only the roles requested at creation). */
  users: Partial<Record<RoleName, RoleUser>>;
  cleanup: () => Promise<void>;
}

/** Resolve a provisioned role user, with a clear error if it was not requested. */
export function userFor(world: ScratchWorld, role: RoleName): RoleUser {
  const u = world.users[role];
  if (!u) {
    throw new Error(
      `role '${role}' was not provisioned for this world. Pass it to createScratchWorld({ roles: [...] }) ` +
        `or the worldRoles fixture option.`
    );
  }
  return u;
}

function shortId(): string {
  return randomUUID().slice(0, 8);
}

function anonClient(): SupabaseClient {
  return createClient(DEV_SUPABASE_URL, DEV_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function bearerClient(accessToken: string): SupabaseClient {
  return createClient(DEV_SUPABASE_URL, DEV_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** A Supabase client carrying a given role's bearer token (for RPC seeding). */
export function apiAs(world: ScratchWorld, role: RoleName): SupabaseClient {
  return bearerClient(userFor(world, role).session.access_token);
}

/**
 * Create a sign-in-able email/password user directly via the pooler, then sign
 * in for a real session. The token columns must be '' (not NULL) or GoTrue
 * returns "Database error querying schema"; email_confirmed_at must be set
 * because dev GoTrue has mailer_autoconfirm=false.
 */
async function createUserAndSignIn(
  pg: PgClient,
  label: string,
  // register for teardown the instant the row exists, BEFORE sign-in, so a
  // sign-in failure (e.g. GoTrue rate limit) cannot orphan the user.
  track: (userId: string) => void
): Promise<{ userId: string; email: string; session: Session }> {
  const userId = randomUUID();
  const email = `${SCRATCH_PREFIX}-${label}-${shortId()}@${SCRATCH_PREFIX}.test`;
  const password = `Pw-${randomUUID()}`;
  track(userId);

  await pg.query(
    `insert into auth.users
       (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change,
        email_change_token_current, phone_change, phone_change_token, reauthentication_token)
     values
       ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
        $2, crypt($3, gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
        '', '', '', '', '', '', '', '')`,
    [userId, email, password]
  );
  await pg.query(
    `insert into auth.identities
       (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
     values ($1::text, $1::uuid, $2::jsonb, 'email', now(), now(), now())`,
    [userId, JSON.stringify({ sub: userId, email, email_verified: true, phone_verified: false })]
  );

  // GoTrue rate-limits auth per IP; the suite creates many users, so retry the
  // sign-in with backoff when the limiter trips.
  let lastErr = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await anonClient().auth.signInWithPassword({ email, password });
    if (!error && data.session) return { userId, email, session: data.session };
    lastErr = error?.message ?? 'no session';
    if (!/rate limit/i.test(lastErr)) break;
    await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
  }
  throw new Error(`signInWithPassword failed for ${label}: ${lastErr}`);
}

/**
 * Provision a fresh agency + tenant + space and a full set of role users.
 * The provisioner is a SEPARATE platform_admin user (the provision_* RPCs
 * require auth.uid() and reject service-role). Role users are NOT platform
 * admins -- platform admin carries an RLS read bypass that would contaminate
 * firewall assertions.
 */
export interface ScratchWorldOptions {
  /** Which role users to provision. Fewer roles = less auth traffic (GoTrue
   *  rate-limits per IP). Default: owner only. Firewall specs request all four. */
  roles?: RoleName[];
}

export async function createScratchWorld(opts: ScratchWorldOptions = {}): Promise<ScratchWorld> {
  const roles = opts.roles ?? ['owner'];
  const pg = new PgClient({ connectionString: requirePoolerUrl() });
  await pg.connect();

  const id = shortId();
  const sub = `${SCRATCH_PREFIX}-${id}`;
  const host = `${sub}.${DEV_APEX}`;
  const baseURL = `https://${host}`;
  const createdUserIds: string[] = [];

  // Defined up-front so cleanup is safe even if provisioning throws midway.
  let agencyId = '';
  let tenantId = '';
  let spaceId = '';

  const cleanup = async (): Promise<void> => {
    const c = new PgClient({ connectionString: requirePoolerUrl() });
    await c.connect();
    try {
      if (spaceId) {
        await c.query(`delete from public.events where space_id=$1`, [spaceId]).catch(() => {});
        await c
          .query(`delete from public.space_members where space_id=$1`, [spaceId])
          .catch(() => {});
      }
      if (tenantId) {
        await c
          .query(`delete from public.tenant_members where tenant_id=$1`, [tenantId])
          .catch(() => {});
      }
      if (spaceId)
        await c.query(`delete from public.spaces where id=$1`, [spaceId]).catch(() => {});
      if (tenantId)
        await c.query(`delete from public.tenants where id=$1`, [tenantId]).catch(() => {});
      if (agencyId)
        await c.query(`delete from public.agencies where id=$1`, [agencyId]).catch(() => {});
      for (const uid of createdUserIds) {
        await c.query(`delete from public.platform_admins where user_id=$1`, [uid]).catch(() => {});
        await c.query(`delete from auth.identities where user_id=$1`, [uid]).catch(() => {});
        await c.query(`delete from auth.users where id=$1`, [uid]).catch(() => {});
      }
    } finally {
      await c.end();
    }
  };

  try {
    // 1. provisioner (platform_admin) -- used only to call provision_* RPCs.
    const track = (uid: string): void => {
      createdUserIds.push(uid);
    };
    const prov = await createUserAndSignIn(pg, 'prov', track);
    // is_platform_admin() reads the platform_admins table by auth.uid() at RPC
    // time -- it is not a JWT claim -- so the existing session works once the
    // row exists. No re-sign-in needed.
    await pg.query(`insert into public.platform_admins (user_id) values ($1)`, [prov.userId]);
    const provApi = bearerClient(prov.session.access_token);

    // 2. provision agency -> tenant -> space via the real RPCs.
    const ag = await provApi.rpc('provision_agency', {
      p_name: `PW Reg Agency ${id}`,
      p_slug: `${SCRATCH_PREFIX}-${id}`,
      p_subdomain: `${SCRATCH_PREFIX}-ag-${id}`,
      p_owner_email: prov.email,
    });
    if (ag.error) throw new Error(`provision_agency: ${ag.error.message}`);
    agencyId = (ag.data as { id: string }).id;

    const tn = await provApi.rpc('provision_tenant', {
      p_agency_id: agencyId,
      p_name: `PW Reg Tenant ${id}`,
      p_subdomain: sub,
    });
    if (tn.error) throw new Error(`provision_tenant: ${tn.error.message}`);
    tenantId = (tn.data as { id: string }).id;

    const sp = await provApi.rpc('create_space', {
      p_tenant_id: tenantId,
      p_name: `PW Reg Space ${id}`,
    });
    if (sp.error) throw new Error(`create_space: ${sp.error.message}`);
    spaceId = (sp.data as { id: string }).id;

    // 3. role users with live sessions (only the requested roles). Memberships:
    // owner/editor/viewer get explicit space rows (which also grant loose tenant
    // access); nonMember gets ONLY a tenant row -> passes tenantGuard but fails
    // spaceGuard (the firewall case from TP-002).
    const users: Partial<Record<RoleName, RoleUser>> = {};
    for (const role of roles) {
      const u = await createUserAndSignIn(pg, role.toLowerCase(), track);
      if (role === 'nonMember') await addTenantMember(pg, tenantId, u.userId, 'owner');
      else await addSpaceMember(pg, spaceId, u.userId, role);
      users[role] = { role, ...u };
    }

    const world: ScratchWorld = { id, host, baseURL, agencyId, tenantId, spaceId, users, cleanup };
    return world;
  } catch (e) {
    await cleanup();
    throw e;
  } finally {
    await pg.end();
  }
}

async function addSpaceMember(
  pg: PgClient,
  spaceId: string,
  userId: string,
  role: 'owner' | 'editor' | 'viewer'
): Promise<void> {
  await pg.query(
    `insert into public.space_members (space_id, user_id, role)
       select $1, $2, $3
       where not exists (select 1 from public.space_members where space_id=$1 and user_id=$2)`,
    [spaceId, userId, role]
  );
}

async function addTenantMember(
  pg: PgClient,
  tenantId: string,
  userId: string,
  role: string
): Promise<void> {
  await pg.query(
    `insert into public.tenant_members (tenant_id, user_id, role)
       select $1, $2, $3
       where not exists (select 1 from public.tenant_members where tenant_id=$1 and user_id=$2)`,
    [tenantId, userId, role]
  );
}
