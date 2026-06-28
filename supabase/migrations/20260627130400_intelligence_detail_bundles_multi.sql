-- migration: 20260627130400_intelligence_detail_bundles_multi
-- purpose: rewrite the four entity detail-bundle RPCs to return briefs[] via
--   list_intelligence_for_entity instead of the ambiguous published/draft keys;
--   drop get_marker_detail_with_intelligence (markers are not brief owners);
--   drop the now-dead 5-param build_intelligence_payload; fix a metadata-leak
--   in build_intelligence_payload_for_row that let draft-editor identities
--   appear in published intelligence payloads; fix referenced_in_entity which
--   still referenced primary_intelligence.entity_type/entity_id columns that
--   were dropped in 20260627130000 when those fields moved to
--   primary_intelligence_anchors.
--
-- Caller audit (5-param build_intelligence_payload before this migration):
--   get_trial_detail_with_intelligence    -- rewritten below
--   get_company_detail_with_intelligence  -- rewritten below
--   get_asset_detail_with_intelligence    -- rewritten below
--   get_space_intelligence                -- rewritten below
--   get_marker_detail_with_intelligence   -- dropped below
-- No other live function calls build_intelligence_payload(uuid,text,uuid,text,int).
-- Confirmed via: SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace
--   AND pg_get_functiondef(oid) ILIKE '%build_intelligence_payload%'
--   AND proname NOT LIKE '%build_intelligence_payload%';
--
-- not tier-1: no @audit:tier1 marker.

-- =============================================================================
-- 0. Fix referenced_in_entity: primary_intelligence.entity_type and entity_id
--    were dropped in 20260627130000_intelligence_anchors_schema (those columns
--    moved to primary_intelligence_anchors). The function must join anchors to
--    read them. All other logic (link dedup, space/state filter, limit) is
--    preserved verbatim.
-- =============================================================================

create or replace function public.referenced_in_entity(
  p_space_id    uuid,
  p_entity_type text,
  p_entity_id   uuid,
  p_limit       integer default 20
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',                p.id,
        'entity_type',       a.entity_type,
        'entity_id',         a.entity_id,
        'state',             p.state,
        'headline',          p.headline,
        'updated_at',        p.updated_at,
        'last_edited_by',    p.last_edited_by,
        'relationship_type', l.relationship_type,
        'gloss',             l.gloss
      )
      order by p.updated_at desc
    ),
    '[]'::jsonb
  )
  from (
    select distinct on (l.primary_intelligence_id) l.*
    from public.primary_intelligence_links l
    where l.entity_type = p_entity_type
      and l.entity_id   = p_entity_id
    order by l.primary_intelligence_id, l.display_order, l.created_at
  ) l
  join public.primary_intelligence p
    on p.id = l.primary_intelligence_id
  join public.primary_intelligence_anchors a
    on a.id = p.anchor_id
  where p.space_id = p_space_id
    and p.state    = 'published'
  limit p_limit;
$$;

comment on function public.referenced_in_entity(uuid, text, uuid, integer) is
  'Returns published primary_intelligence rows that link to the given entity, '
  'deduped to one row per intelligence piece (lowest display_order link). '
  'entity_type and entity_id come from primary_intelligence_anchors (those '
  'columns were dropped from primary_intelligence in 20260627130000).';

-- =============================================================================
-- 1. Metadata-leak fix: rebuild build_intelligence_payload_for_row so that
--    contributors and authors are scoped to non-draft versions when the
--    payload row itself is not a draft. This prevents a viewer who calls a
--    published brief from seeing the identity of anyone who only touched an
--    unpublished draft on the same anchor. When the row IS a draft (agency-only
--    path), only the draft row's own last_edited_by is included.
--    Based on the live 130350 body; all other logic preserved verbatim.
-- =============================================================================

create or replace function public.build_intelligence_payload_for_row(p_row_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_space_id   uuid;
  v_state      text;
  v_anchor     uuid;
  v_can_read   boolean;
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

  -- Mirror the primary_intelligence read RLS. Without this gate, DEFINER
  -- would widen access and leak drafts to space members.
  v_can_read := public.is_agency_member_of_space(v_space_id)
                or (v_state = 'published' and public.has_space_access(v_space_id));
  if not v_can_read then
    return null;
  end if;

  -- Build author IDs with draft-editor isolation.
  -- For non-draft rows (published/archived/withdrawn): include only editors
  --   from non-draft anchor versions so viewers cannot infer who touched an
  --   unpublished draft.
  -- For draft rows (agency-only path): include only the draft row's own
  --   last_edited_by.
  -- published_by/withdrawn_by are specific to the row being built: always safe.
  select array_agg(distinct id) into v_author_ids
  from (
    select c.last_edited_by as id
      from public.primary_intelligence c
     where c.anchor_id = v_anchor
       and c.last_edited_by is not null
       and (case when v_state = 'draft' then c.id = p_row_id else c.state <> 'draft' end)
    union
    select p2.published_by
      from public.primary_intelligence p2
     where p2.id = p_row_id and p2.published_by is not null
    union
    select p2.withdrawn_by
      from public.primary_intelligence p2
     where p2.id = p_row_id and p2.withdrawn_by is not null
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
            and (case when v_state = 'draft' then c.id = p_row_id else c.state <> 'draft' end)
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
  'guard mirroring the primary_intelligence read RLS (agency member, or '
  'published row with space access). contributors and authors are scoped to '
  'prevent draft-editor identity leaks: for non-draft rows only non-draft '
  'anchor versions contribute; for draft rows only the draft row''s own editor.';

revoke execute on function public.build_intelligence_payload_for_row(uuid) from public, anon;
grant  execute on function public.build_intelligence_payload_for_row(uuid) to authenticated;

-- =============================================================================
-- 2. get_trial_detail_with_intelligence
--    SECURITY DEFINER so agency-only users (no space_members row) can resolve
--    the trial's space_id without hitting the trials SELECT RLS (which gates
--    on has_space_access). Explicit access guard mirrors the intelligence RLS.
-- =============================================================================

create or replace function public.get_trial_detail_with_intelligence(p_trial_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_space_id uuid;
begin
  select space_id into v_space_id from public.trials where id = p_trial_id;
  if v_space_id is null then
    return null;
  end if;

  if not (public.is_agency_member_of_space(v_space_id) or public.has_space_access(v_space_id)) then
    return null;
  end if;

  return jsonb_build_object(
    'space_id',   v_space_id,
    'entity_type', 'trial',
    'entity_id',  p_trial_id,
    'briefs',     public.list_intelligence_for_entity(v_space_id, 'trial', p_trial_id),
    'referenced_in', public.referenced_in_entity(v_space_id, 'trial', p_trial_id)
  );
end;
$$;

comment on function public.get_trial_detail_with_intelligence(uuid) is
  'Detail bundle for a trial: {space_id, entity_type, entity_id, briefs, '
  'referenced_in}. briefs is a jsonb array from list_intelligence_for_entity '
  '(lead anchor first). SECURITY DEFINER so agency-only users can resolve the '
  'trial space without a space_members row; explicit access guard (agency '
  'member or space access) prevents unauthorized reads.';

-- =============================================================================
-- 3. get_company_detail_with_intelligence (same pattern)
-- =============================================================================

create or replace function public.get_company_detail_with_intelligence(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_space_id uuid;
begin
  select space_id into v_space_id from public.companies where id = p_company_id;
  if v_space_id is null then
    return null;
  end if;

  if not (public.is_agency_member_of_space(v_space_id) or public.has_space_access(v_space_id)) then
    return null;
  end if;

  return jsonb_build_object(
    'space_id',   v_space_id,
    'entity_type', 'company',
    'entity_id',  p_company_id,
    'briefs',     public.list_intelligence_for_entity(v_space_id, 'company', p_company_id),
    'referenced_in', public.referenced_in_entity(v_space_id, 'company', p_company_id)
  );
end;
$$;

comment on function public.get_company_detail_with_intelligence(uuid) is
  'Detail bundle for a company: {space_id, entity_type, entity_id, briefs, '
  'referenced_in}. SECURITY DEFINER with agency-or-space access guard.';

-- =============================================================================
-- 4. get_asset_detail_with_intelligence (same pattern)
-- =============================================================================

create or replace function public.get_asset_detail_with_intelligence(p_asset_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_space_id uuid;
begin
  select space_id into v_space_id from public.assets where id = p_asset_id;
  if v_space_id is null then
    return null;
  end if;

  if not (public.is_agency_member_of_space(v_space_id) or public.has_space_access(v_space_id)) then
    return null;
  end if;

  return jsonb_build_object(
    'space_id',   v_space_id,
    'entity_type', 'asset',
    'entity_id',  p_asset_id,
    'briefs',     public.list_intelligence_for_entity(v_space_id, 'asset', p_asset_id),
    'referenced_in', public.referenced_in_entity(v_space_id, 'asset', p_asset_id)
  );
end;
$$;

comment on function public.get_asset_detail_with_intelligence(uuid) is
  'Detail bundle for an asset: {space_id, entity_type, entity_id, briefs, '
  'referenced_in}. SECURITY DEFINER with agency-or-space access guard.';

-- =============================================================================
-- 5. get_space_intelligence
--    No secondary entity lookup needed (space IS the entity), so SECURITY
--    INVOKER is sufficient; list_intelligence_for_entity handles access.
-- =============================================================================

create or replace function public.get_space_intelligence(p_space_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  return jsonb_build_object(
    'space_id',   p_space_id,
    'entity_type', 'space',
    'entity_id',  p_space_id,
    'briefs',     public.list_intelligence_for_entity(p_space_id, 'space', p_space_id),
    'referenced_in', '[]'::jsonb
  );
end;
$$;

comment on function public.get_space_intelligence(uuid) is
  'Detail bundle for a space: {space_id, entity_type, entity_id, briefs, '
  'referenced_in}. briefs is a jsonb array from list_intelligence_for_entity. '
  'referenced_in is always [] (spaces are not referenced-in targets).';

-- =============================================================================
-- 6. Drop the vestigial marker detail RPC. Markers are not brief owners;
--    the marker entity_type was removed from the anchor schema in this feature.
-- =============================================================================

drop function if exists public.get_marker_detail_with_intelligence(uuid);

-- =============================================================================
-- 7. Drop the legacy 5-param build_intelligence_payload. All five former
--    callers are handled above (four rewritten, one dropped). No other live
--    function references the bare 5-param form.
-- =============================================================================

drop function if exists public.build_intelligence_payload(uuid, text, uuid, text, integer);

notify pgrst, 'reload schema';
