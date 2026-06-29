/**
 * Helpers for the @intelligence brief specs.
 *
 * authorBrief()           -- author a brief via the real anchor-aware RPC
 *                            `upsert_primary_intelligence` (11-arg,
 *                            20260627130100_intelligence_upsert_anchor_aware.sql).
 *                            p_id + p_anchor_id null => a fresh anchor is created.
 * grantAgencyMembership() -- insert an agency_members row for a world role so it
 *                            can READ drafts (RLS policy
 *                            `primary_intelligence drafts readable to agency`,
 *                            20260501113857_primary_intelligence.sql:186, gates
 *                            draft SELECT behind is_agency_member_of_space()).
 *                            is_agency_member() ignores role when none is passed
 *                            (20260428040400), so 'member' is sufficient.
 * setBriefUpdatedAt()     -- backdate a brief's updated_at via the pooler so the
 *                            SINCE filter has a row to exclude.
 *
 * Nothing here needs teardown logic: every row cascades from the space or agency
 * that world.cleanup() already deletes.
 */
import { Client as PgClient } from 'pg';
import { apiAs, userFor, type RoleName, type ScratchWorld } from './scratch-world';
import { requirePoolerUrl } from './dev-env';

export interface AuthorBriefOpts {
  /** Identity to author as. Must be a space owner/editor OR agency member. Default 'owner'. */
  role?: RoleName;
  entityType: 'trial' | 'company' | 'product' | 'space';
  /** Owner entity id (trial/company/asset id; for 'space' pass world.spaceId). */
  entityId: string;
  headline: string;
  summaryMd?: string;
  implicationsMd?: string;
  state: 'draft' | 'published';
  /** Required only when republishing over an existing published version. */
  changeNote?: string | null;
  links?: {
    entity_type: 'trial' | 'marker' | 'company' | 'product';
    entity_id: string;
    relationship_type: string;
    gloss?: string | null;
    display_order?: number;
  }[];
}

/** Author a brief; returns the new primary_intelligence row id. */
export async function authorBrief(world: ScratchWorld, opts: AuthorBriefOpts): Promise<string> {
  const api = apiAs(world, opts.role ?? 'owner');
  const { data, error } = await api.rpc('upsert_primary_intelligence', {
    p_id: null,
    p_anchor_id: null,
    p_space_id: world.spaceId,
    p_entity_type: opts.entityType,
    p_entity_id: opts.entityId,
    p_headline: opts.headline,
    p_summary_md: opts.summaryMd ?? '',
    p_implications_md: opts.implicationsMd ?? '',
    p_state: opts.state,
    p_change_note: opts.changeNote ?? null,
    p_links: (opts.links ?? []).map((l, i) => ({
      entity_type: l.entity_type,
      entity_id: l.entity_id,
      relationship_type: l.relationship_type,
      gloss: l.gloss ?? null,
      display_order: l.display_order ?? i,
    })),
  });
  if (error) throw new Error(`authorBrief upsert_primary_intelligence: ${error.message}`);
  return data as string;
}

/** Promote a world role user to an agency member (default role 'member'). */
export async function grantAgencyMembership(
  world: ScratchWorld,
  role: RoleName = 'owner',
  // agency_members.role has a CHECK allowing only 'owner' on dev
  // (agency_members_role_check); is_agency_member() ignores role anyway, so
  // 'owner' is both required and sufficient to read drafts.
  agencyRole: 'owner' = 'owner'
): Promise<void> {
  const u = userFor(world, role);
  const pg = new PgClient({ connectionString: requirePoolerUrl() });
  await pg.connect();
  try {
    await pg.query(
      `insert into public.agency_members (agency_id, user_id, role)
         select $1, $2, $3
         where not exists (
           select 1 from public.agency_members where agency_id=$1 and user_id=$2
         )`,
      [world.agencyId, u.userId, agencyRole]
    );
  } finally {
    await pg.end();
  }
}

/** Backdate a brief's updated_at by N days via the pooler (for SINCE-filter tests). */
export async function setBriefUpdatedAt(
  world: ScratchWorld,
  briefId: string,
  daysAgo: number
): Promise<void> {
  const pg = new PgClient({ connectionString: requirePoolerUrl() });
  await pg.connect();
  try {
    await pg.query(
      `update public.primary_intelligence
          set updated_at = now() - ($2 || ' days')::interval
        where id = $1 and space_id = $3`,
      [briefId, String(daysAgo), world.spaceId]
    );
  } finally {
    await pg.end();
  }
}
