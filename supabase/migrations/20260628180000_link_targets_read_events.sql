-- A7: Repoint intelligence + material link-target resolvers to events.
--
-- Pattern 1 (get_primary_intelligence_history, build_intelligence_payload_for_row):
--   Rename the entity_name 'marker' branch to 'event', resolving title from
--   public.events instead of the now-dropped markers table.
--
-- Pattern 2 (list_materials_for_entity, list_materials_for_space):
--   Both already have a correct 'event' entity_name branch.
--   Drop the redundant 'marker' branch.
--   Repoint trial_id derivation to events.anchor_id (anchor_type='trial').
--
-- The literal string 'marker' in validation not-in lists is kept as-is (legacy
-- material_links rows with entity_type='marker' are gracefully resolved to null
-- entity_name; no such rows exist in greenfield but the input gate stays permissive).

-- ============================================================
-- 1. get_primary_intelligence_history
--    Only change: 'marker'->'event' in entity_name case.
-- ============================================================

create or replace function public.get_primary_intelligence_history(p_anchor_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_space_id uuid;
  v_can_read boolean;
begin
  select space_id into v_space_id
    from public.primary_intelligence_anchors
   where id = p_anchor_id;
  if v_space_id is null then return null; end if;

  v_can_read := public.is_agency_member_of_space(v_space_id)
                or public.has_space_access(v_space_id);
  if not v_can_read then return null; end if;

  return (
    with rows as (
      select * from public.primary_intelligence p
       where p.anchor_id = p_anchor_id
    ),
    current_row as (
      select * from rows where state = 'published' limit 1
    ),
    draft_row as (
      select * from rows where state = 'draft' order by updated_at desc limit 1
    ),
    versions as (
      select * from rows where state in ('published','archived','withdrawn')
    ),
    versions_with_base as (
      select v.*,
             (
               select v2.id
                 from versions v2
                where v2.version_number < v.version_number
                  and v2.published_at is not null
                  and v2.withdrawn_at is null
                order by v2.version_number desc
                limit 1
             ) as diff_base_id
        from versions v
    ),
    version_links as (
      select
        l.primary_intelligence_id as row_id,
        jsonb_agg(
          jsonb_build_object(
            'entity_type',       l.entity_type,
            'entity_id',         l.entity_id,
            'entity_name', case l.entity_type
              when 'trial'   then (select tr.name  from public.trials    tr where tr.id = l.entity_id)
              when 'event'   then (select ev.title from public.events    ev where ev.id = l.entity_id)
              when 'company' then (select co.name  from public.companies co where co.id = l.entity_id)
              when 'asset'   then (select a.name   from public.assets    a  where a.id  = l.entity_id)
              when 'product' then (select a.name   from public.assets    a  where a.id  = l.entity_id)
              else null
            end,
            'relationship_type', l.relationship_type,
            'gloss',             l.gloss,
            'display_order',     l.display_order
          )
          order by l.display_order, l.created_at
        ) as links
      from public.primary_intelligence_links l
      join versions_with_base v on v.id = l.primary_intelligence_id
      group by l.primary_intelligence_id
    ),
    events as (
      select created_at as at, 'draft_started'::text as kind, id as row_id,
             null::int as version_number, last_edited_by as by, null::text as note
        from rows
      union all
      select published_at, 'published', id, version_number, published_by, publish_note
        from rows where published_at is not null
      union all
      select archived_at, 'archived', id, version_number, null, null
        from rows where archived_at is not null
      union all
      select withdrawn_at, 'withdrawn', id, version_number, withdrawn_by, withdraw_note
        from rows where withdrawn_at is not null
    ),
    author_ids as (
      select array_agg(distinct id) as ids
        from (
          select by as id from events where by is not null
          union
          select last_edited_by from rows where last_edited_by is not null
        ) s
    )
    select jsonb_build_object(
      'current', (select to_jsonb(c) from current_row c),
      'draft',   (select to_jsonb(d) from draft_row d),
      'versions', coalesce(
        (select jsonb_agg(
          jsonb_build_object(
            'id',              v.id,
            'version_number',  v.version_number,
            'state',           v.state,
            'headline',        v.headline,
            'summary_md',      v.summary_md,
            'implications_md', v.implications_md,
            'publish_note',    v.publish_note,
            'published_at',    v.published_at,
            'published_by',    v.published_by,
            'archived_at',     v.archived_at,
            'withdrawn_at',    v.withdrawn_at,
            'withdrawn_by',    v.withdrawn_by,
            'withdraw_note',   v.withdraw_note,
            'diff_base_id',    v.diff_base_id,
            'links',           coalesce(vl.links, '[]'::jsonb)
          )
          order by v.version_number desc
        )
          from versions_with_base v
          left join version_links vl on vl.row_id = v.id
        ),
        '[]'::jsonb
      ),
      'events', coalesce(
        (select jsonb_agg(
          jsonb_build_object(
            'at',             e.at,
            'kind',           e.kind,
            'row_id',         e.row_id,
            'version_number', e.version_number,
            'by',             e.by,
            'note',           e.note
          )
          order by
            e.at asc,
            case e.kind
              when 'draft_started' then 0
              when 'published'     then 1
              when 'archived'      then 2
              when 'withdrawn'     then 3
            end
        ) from events e),
        '[]'::jsonb
      ),
      'authors', public.resolve_user_display_names((select ids from author_ids))
    )
  );
end;
$function$;

-- ============================================================
-- 2. build_intelligence_payload_for_row
--    Only change: 'marker'->'event' in entity_name case.
-- ============================================================

create or replace function public.build_intelligence_payload_for_row(p_row_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
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
                when 'event'   then (select ev.title from public.events  ev where ev.id = l.entity_id)
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
$function$;

-- ============================================================
-- 3. list_materials_for_entity
--    Drop 'marker' entity_name branch (keep 'event' branch).
--    Repoint trial_id derivation to events.anchor_id (anchor_type='trial').
-- ============================================================

create or replace function public.list_materials_for_entity(p_entity_type text, p_entity_id uuid, p_material_types text[] default null::text[], p_limit integer default 50, p_offset integer default 0)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_rows jsonb;
  v_total int;
begin
  if p_entity_type not in ('trial', 'marker', 'company', 'product', 'space', 'event') then
    raise exception 'invalid entity_type: %', p_entity_type
      using errcode = '22023';
  end if;

  select count(*)::int
    into v_total
  from public.material_links ml
  join public.materials m on m.id = ml.material_id
  where ml.entity_type = p_entity_type
    and ml.entity_id = p_entity_id
    and m.finalized_at is not null
    and (p_material_types is null or m.material_type = any(p_material_types))
    and public.has_space_access(m.space_id);

  select coalesce(jsonb_agg(to_jsonb(r) order by r.uploaded_at desc), '[]'::jsonb)
    into v_rows
  from (
    select m.id, m.space_id, m.uploaded_by, m.file_path, m.file_name,
           m.file_size_bytes, m.mime_type, m.material_type, m.title, m.uploaded_at,
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'entity_type', l.entity_type,
               'entity_id', l.entity_id,
               'entity_name', (case l.entity_type
                 when 'trial' then (select coalesce(t.acronym, t.name) from public.trials t where t.id = l.entity_id)
                 when 'company' then (select c.name from public.companies c where c.id = l.entity_id)
                 when 'product' then (select a.name from public.assets a where a.id = l.entity_id)
                 when 'space' then (select s.name from public.spaces s where s.id = l.entity_id)
                 when 'event' then (select ev.title from public.events ev where ev.id = l.entity_id)
               end),
               'trial_id', (case when l.entity_type = 'event' then (
                 select e.anchor_id from public.events e
                 where e.id = l.entity_id and e.anchor_type = 'trial'
                 limit 1
               ) end),
               'display_order', l.display_order
             ) order by l.display_order)
             from public.material_links l
             where l.material_id = m.id
           ), '[]'::jsonb) as links
      from public.material_links ml
      join public.materials m on m.id = ml.material_id
     where ml.entity_type = p_entity_type
       and ml.entity_id = p_entity_id
       and m.finalized_at is not null
       and (p_material_types is null or m.material_type = any(p_material_types))
       and public.has_space_access(m.space_id)
     order by m.uploaded_at desc
     limit greatest(p_limit, 0)
     offset greatest(p_offset, 0)
  ) r;

  return jsonb_build_object(
    'rows', v_rows,
    'total', coalesce(v_total, 0),
    'limit', p_limit,
    'offset', p_offset
  );
end;
$function$;

-- ============================================================
-- 4. list_materials_for_space
--    Drop 'marker' entity_name branch (keep 'event' branch).
--    Repoint trial_id derivation to events.anchor_id (anchor_type='trial').
-- ============================================================

create or replace function public.list_materials_for_space(p_space_id uuid, p_material_types text[] default null::text[], p_entity_type text default null::text, p_entity_id uuid default null::uuid, p_limit integer default 100, p_offset integer default 0)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_rows jsonb;
  v_total int;
begin
  if not public.has_space_access(p_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_entity_type is not null
     and p_entity_type not in ('trial', 'marker', 'company', 'product', 'space', 'event')
  then
    raise exception 'invalid entity_type: %', p_entity_type
      using errcode = '22023';
  end if;

  select count(distinct m.id)::int
    into v_total
  from public.materials m
  left join public.material_links ml on ml.material_id = m.id
  where m.space_id = p_space_id
    and m.finalized_at is not null
    and (p_material_types is null or m.material_type = any(p_material_types))
    and (
      p_entity_type is null
      or (
        ml.entity_type = p_entity_type
        and (p_entity_id is null or ml.entity_id = p_entity_id)
      )
    );

  select coalesce(jsonb_agg(to_jsonb(r) order by r.uploaded_at desc), '[]'::jsonb)
    into v_rows
  from (
    select distinct
           m.id, m.space_id, m.uploaded_by, m.file_path, m.file_name,
           m.file_size_bytes, m.mime_type, m.material_type, m.title, m.uploaded_at,
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'entity_type', l.entity_type,
               'entity_id', l.entity_id,
               'entity_name', (case l.entity_type
                 when 'trial' then (select coalesce(t.acronym, t.name) from public.trials t where t.id = l.entity_id)
                 when 'company' then (select c.name from public.companies c where c.id = l.entity_id)
                 when 'product' then (select a.name from public.assets a where a.id = l.entity_id)
                 when 'space' then (select s.name from public.spaces s where s.id = l.entity_id)
                 when 'event' then (select ev.title from public.events ev where ev.id = l.entity_id)
               end),
               'trial_id', (case when l.entity_type = 'event' then (
                 select e.anchor_id from public.events e
                 where e.id = l.entity_id and e.anchor_type = 'trial'
                 limit 1
               ) end),
               'display_order', l.display_order
             ) order by l.display_order)
             from public.material_links l
             where l.material_id = m.id
           ), '[]'::jsonb) as links
      from public.materials m
      left join public.material_links ml on ml.material_id = m.id
     where m.space_id = p_space_id
       and m.finalized_at is not null
       and (p_material_types is null or m.material_type = any(p_material_types))
       and (
         p_entity_type is null
         or (
           ml.entity_type = p_entity_type
           and (p_entity_id is null or ml.entity_id = p_entity_id)
         )
       )
     order by m.uploaded_at desc
     limit greatest(p_limit, 0)
     offset greatest(p_offset, 0)
  ) r;

  return jsonb_build_object(
    'rows', v_rows,
    'total', coalesce(v_total, 0),
    'limit', p_limit,
    'offset', p_offset
  );
end;
$function$;

-- ============================================================
-- In-file smoke (data-conditional, prod-safe)
-- ============================================================

do $$
declare
  v_demo_space_id uuid := '00000000-0000-0000-0000-0000000d0100'::uuid;
  v_demo_trial_id uuid := '00000000-0000-0000-0000-0000000d0400'::uuid;
  v_space_exists  boolean;
  v_pi_anchor_id  uuid;
  v_pi_row_id     uuid;
  v_result        jsonb;
begin
  -- Check if demo space exists
  select exists(
    select 1 from public.spaces where id = v_demo_space_id
  ) into v_space_exists;

  if not v_space_exists then
    raise notice 'A7 smoke: demo space absent, skipping data assertions (prod-safe).';
    return;
  end if;

  -- Smoke list_materials_for_space
  begin
    v_result := public.list_materials_for_space(v_demo_space_id, null, null, null, 50, 0);
    if v_result is null then
      raise exception 'A7 smoke: list_materials_for_space returned null for demo space';
    end if;
    raise notice 'A7 smoke: list_materials_for_space OK (total=%)', v_result->>'total';
  exception when sqlstate '42501' then
    raise notice 'A7 smoke: list_materials_for_space forbidden (no session user) - schema OK.';
  end;

  -- Smoke list_materials_for_entity
  begin
    v_result := public.list_materials_for_entity('trial', v_demo_trial_id, null, 50, 0);
    if v_result is null then
      raise exception 'A7 smoke: list_materials_for_entity returned null for demo trial';
    end if;
    raise notice 'A7 smoke: list_materials_for_entity OK (total=%)', v_result->>'total';
  exception when sqlstate '42501' then
    raise notice 'A7 smoke: list_materials_for_entity forbidden (no session user) - schema OK.';
  end;

  -- Smoke get_primary_intelligence_history (find a real anchor if any)
  select id into v_pi_anchor_id
    from public.primary_intelligence_anchors
   where space_id = v_demo_space_id
   limit 1;

  if v_pi_anchor_id is not null then
    begin
      v_result := public.get_primary_intelligence_history(v_pi_anchor_id);
      raise notice 'A7 smoke: get_primary_intelligence_history OK (anchor=%)', v_pi_anchor_id;
    exception when sqlstate '42501' then
      raise notice 'A7 smoke: get_primary_intelligence_history forbidden (no session user) - schema OK.';
    end;
  else
    raise notice 'A7 smoke: no primary_intelligence_anchors in demo space, skipping history smoke.';
  end if;

  -- Smoke build_intelligence_payload_for_row (find a real row if any)
  select id into v_pi_row_id
    from public.primary_intelligence
   where anchor_id in (
     select id from public.primary_intelligence_anchors where space_id = v_demo_space_id
   )
   limit 1;

  if v_pi_row_id is not null then
    begin
      v_result := public.build_intelligence_payload_for_row(v_pi_row_id);
      raise notice 'A7 smoke: build_intelligence_payload_for_row OK (row=%)', v_pi_row_id;
    exception when sqlstate '42501' then
      raise notice 'A7 smoke: build_intelligence_payload_for_row forbidden (no session user) - schema OK.';
    end;
  else
    raise notice 'A7 smoke: no primary_intelligence rows in demo space, skipping payload smoke.';
  end if;

  raise notice 'A7 smoke: all checks passed.';
end;
$$;

notify pgrst, 'reload schema';
