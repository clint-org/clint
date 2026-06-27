-- migration: 20260627130350_intelligence_payload_for_row_definer
-- purpose: make build_intelligence_payload_for_row SECURITY DEFINER so that
--   (a) link entity_name resolves for agency users who have no space_members
--   row (the SECURITY INVOKER version from 20260627130300 returned null names
--   for them, since trials/companies/assets RLS requires has_space_access), and
--   (b) resolve_user_display_names is callable (it is revoked from client roles,
--   so an INVOKER function cannot call it; a DEFINER function can).
--
-- Because DEFINER bypasses RLS, an explicit access guard is added that mirrors
-- the primary_intelligence read RLS the INVOKER version got for free: the caller
-- must be an agency member of the row's space, OR the row is published and the
-- caller has space access. Otherwise return null (do not leak drafts).
--
-- The returned shape gains an `authors` map, matching build_intelligence_payload
-- and the history RPCs: {record, links, contributors, authors}.
--
-- not tier-1: no @audit:tier1 marker.

create or replace function public.build_intelligence_payload_for_row(p_row_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_space_id uuid;
  v_state    text;
  v_anchor   uuid;
  v_can_read boolean;
  v_author_ids uuid[];
begin
  -- Resolve the row's space (via its anchor) and state for the access guard.
  select a.space_id, p.state, p.anchor_id
    into v_space_id, v_state, v_anchor
    from public.primary_intelligence p
    join public.primary_intelligence_anchors a on a.id = p.anchor_id
   where p.id = p_row_id;

  if v_space_id is null then
    return null;
  end if;

  -- Mirror the primary_intelligence read RLS. Without this gate, DEFINER would
  -- widen access and leak drafts to space members.
  v_can_read := public.is_agency_member_of_space(v_space_id)
                or (v_state = 'published' and public.has_space_access(v_space_id));
  if not v_can_read then
    return null;
  end if;

  -- Author ids: contributors (last_edited_by across the anchor's rows) plus the
  -- row's published_by / withdrawn_by.
  select array_agg(distinct id) into v_author_ids
  from (
    select c.last_edited_by as id
      from public.primary_intelligence c
     where c.anchor_id = v_anchor
       and c.last_edited_by is not null
    union
    select p.published_by
      from public.primary_intelligence p
     where p.id = p_row_id and p.published_by is not null
    union
    select p.withdrawn_by
      from public.primary_intelligence p
     where p.id = p_row_id and p.withdrawn_by is not null
  ) ids;

  return (
    select jsonb_build_object(
      'record', to_jsonb(pi),
      'links', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id',                l.id,
              'entity_type',       l.entity_type,
              'entity_id',         l.entity_id,
              'entity_name',       case l.entity_type
                when 'trial'   then (select t.name  from public.trials   t where t.id = l.entity_id)
                when 'marker'  then (select m.title from public.markers  m where m.id = l.entity_id)
                when 'company' then (select c.name  from public.companies c where c.id = l.entity_id)
                when 'asset'   then (select a.name  from public.assets   a where a.id = l.entity_id)
                when 'product' then (select a.name  from public.assets   a where a.id = l.entity_id)
                else null
              end,
              'relationship_type', l.relationship_type,
              'gloss',             l.gloss,
              'display_order',     l.display_order
            )
            order by l.display_order asc, l.relationship_type asc
          )
          from public.primary_intelligence_links l
          where l.primary_intelligence_id = p_row_id
        ),
        '[]'::jsonb
      ),
      'contributors', coalesce(
        (
          select to_jsonb(array_agg(distinct c.last_edited_by))
          from public.primary_intelligence c
          where c.anchor_id = v_anchor
            and c.last_edited_by is not null
        ),
        '[]'::jsonb
      ),
      'authors', public.resolve_user_display_names(v_author_ids)
    )
    from public.primary_intelligence pi
    where pi.id = p_row_id
  );
end;
$$;

comment on function public.build_intelligence_payload_for_row(uuid) is
  'Returns {record, links(with entity_name), contributors, authors} for a '
  'single primary_intelligence row. SECURITY DEFINER with an internal access '
  'guard mirroring the primary_intelligence read RLS (agency member of space, '
  'or published row with space access). DEFINER lets link entity_name resolve '
  'for agency-only users and lets resolve_user_display_names be called.';

revoke execute on function public.build_intelligence_payload_for_row(uuid) from public, anon;
grant  execute on function public.build_intelligence_payload_for_row(uuid) to authenticated;

-- =============================================================================
-- list_intelligence_for_entity must also be SECURITY DEFINER.
--
-- Why: the primary_intelligence read RLS (20260624140200) gates PUBLISHED rows
-- behind has_space_access(space_id). agency-only users (who author for tenants
-- but have no space_members row) fail that check, so under SECURITY INVOKER the
-- per-anchor "select id ... where state='published'" lookup returns nothing for
-- them -- the published payload came back null. This is the same RLS asymmetry
-- that forced build_intelligence_payload to be SECURITY DEFINER (20260505220000).
-- The 130300 version of this list function was INVOKER, which is why the agency
-- entity_name assertion failed.
--
-- DEFINER bypasses RLS for the row lookups, so the access decision now lives in
-- two explicit places that mirror the RLS exactly and do NOT widen access:
--   1. the anchor predicate: agency member, OR (space access AND an anchor has a
--      published version). Outsiders (no space access, not agency) get nothing.
--   2. build_intelligence_payload_for_row's own guard: published rows need
--      agency-or-space-access; draft rows are agency-only. So a viewer who can
--      see a published-bearing anchor still gets draft = null (no draft leak),
--      matching the INVOKER semantics the brief intended.
-- =============================================================================

create or replace function public.list_intelligence_for_entity(
  p_space_id    uuid,
  p_entity_type text,
  p_entity_id   uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'anchor_id',     a.id,
        'is_lead',       a.is_lead,
        'display_order', a.display_order,
        'published', (
          select public.build_intelligence_payload_for_row(p.id)
          from public.primary_intelligence p
          where p.anchor_id = a.id and p.state = 'published'
          limit 1
        ),
        'draft', (
          select public.build_intelligence_payload_for_row(p.id)
          from public.primary_intelligence p
          where p.anchor_id = a.id and p.state = 'draft'
          order by p.updated_at desc
          limit 1
        ),
        'updated_at', (
          select max(p.updated_at)
          from public.primary_intelligence p
          where p.anchor_id = a.id
        ),
        'version_count', (
          select count(*)
          from public.primary_intelligence p
          where p.anchor_id = a.id
            and p.state in ('published', 'archived', 'withdrawn')
        )
      )
      order by a.is_lead desc, a.display_order asc, a.created_at asc
    ),
    '[]'::jsonb
  )
  from public.primary_intelligence_anchors a
  where a.space_id    = p_space_id
    and a.entity_type = p_entity_type
    and a.entity_id   = p_entity_id
    and (
      public.is_agency_member_of_space(p_space_id)
      or (
        public.has_space_access(p_space_id)
        and exists (
          select 1 from public.primary_intelligence p
          where p.anchor_id = a.id and p.state = 'published'
        )
      )
    );
$$;

comment on function public.list_intelligence_for_entity(uuid, text, uuid) is
  'Returns a jsonb array of briefs for one entity, ordered lead-first then by '
  'display_order. Each element: {anchor_id, is_lead, display_order, published, '
  'draft, updated_at, version_count}; published/draft are full payload objects '
  'from build_intelligence_payload_for_row or null. SECURITY DEFINER (the '
  'primary_intelligence read RLS hides published rows from agency-only users, '
  'so an INVOKER lookup returned null published payloads for them). Access is '
  'gated by the anchor predicate (agency member, or space access with a '
  'published version) plus the per-row builder guard, which mirror RLS without '
  'widening it: outsiders get nothing and drafts stay agency-only.';

revoke execute on function public.list_intelligence_for_entity(uuid, text, uuid) from public, anon;
grant  execute on function public.list_intelligence_for_entity(uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';
