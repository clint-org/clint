-- Fix: asset briefs stored under entity_type='product' in primary_intelligence_anchors
--
-- primary_intelligence_anchors has a CHECK constraint that forbids 'asset';
-- the allowed owner types are: trial | company | product | space.
-- Assets are registered as 'product' anchors (the pre-rename type), but several
-- functions were querying/building with 'asset', causing asset detail pages to
-- return zero briefs and asset-delete to orphan their anchors.
--
-- primary_intelligence_links (link targets) correctly stores 'asset' for assets,
-- because that table has a separate enum that includes 'asset'.
-- material_links also stores 'product' for assets, but that is a pre-existing
-- inconsistency out of scope here (see bottom of file).
--
-- Sites changed:
--   get_asset_detail_with_intelligence  -- 'entity_type' key and list_intelligence call
--   get_bullseye_assets                 -- 4 anchor-count/activity comparisons
--   preview_asset_delete                -- anchor count branch
--   preview_company_delete              -- anchor count branch
--   _cleanup_polymorphic_refs           -- add 'product' delete when v_type='asset'
--
-- Sites deliberately kept as 'asset':
--   referenced_in_entity(v_space_id, 'asset', ...)  -- queries primary_intelligence_links
--   pil.entity_type = 'asset'                       -- PI-links, correct value
--   ml.entity_type  = 'asset'                       -- material_links, out of scope

-- ============================================================
-- 1. get_asset_detail_with_intelligence
-- ============================================================
create or replace function public.get_asset_detail_with_intelligence(p_asset_id uuid)
  returns jsonb
  language plpgsql
  stable security definer
  set search_path to ''
as $function$
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
    'space_id',      v_space_id,
    'entity_type',   'product',          -- anchors store 'product' for assets (CHECK forbids 'asset')
    'entity_id',     p_asset_id,
    'briefs',        public.list_intelligence_for_entity(v_space_id, 'product', p_asset_id),  -- queries anchors
    'referenced_in', public.referenced_in_entity(v_space_id, 'asset', p_asset_id)             -- queries links (stores 'asset' -- keep)
  );
end;
$function$;

-- ============================================================
-- 2. get_bullseye_assets  (4 anchor comparisons: 'asset' -> 'product')
-- ============================================================
create or replace function public.get_bullseye_assets(
  p_space_id       uuid,
  p_indication_ids uuid[]  default null::uuid[],
  p_company_ids    uuid[]  default null::uuid[],
  p_moa_ids        uuid[]  default null::uuid[],
  p_roa_ids        uuid[]  default null::uuid[],
  p_phases         text[]  default null::text[],
  p_asset_ids      uuid[]  default null::uuid[],
  p_trial_ids      uuid[]  default null::uuid[]
)
  returns jsonb
  language plpgsql
  stable
  set search_path to ''
as $function$
declare
  v_result    jsonb;
  v_show_preclin boolean := public.space_shows_preclinical(p_space_id);
begin
  -- Normalize empty arrays to null (no-filter semantics)
  if p_indication_ids = '{}' then p_indication_ids := null; end if;
  if p_company_ids    = '{}' then p_company_ids    := null; end if;
  if p_moa_ids        = '{}' then p_moa_ids        := null; end if;
  if p_roa_ids        = '{}' then p_roa_ids        := null; end if;
  if p_phases         = '{}' then p_phases         := null; end if;
  if p_asset_ids      = '{}' then p_asset_ids      := null; end if;
  if p_trial_ids      = '{}' then p_trial_ids      := null; end if;

  with
  -- Step 1: identify candidate assets passing all scope filters except phase
  candidate_assets as (
    select distinct a.id as asset_id
    from public.assets a
    where a.space_id = p_space_id
      and (p_company_ids is null or a.company_id = any(p_company_ids))
      and (p_asset_ids is null or a.id = any(p_asset_ids))
      and (p_indication_ids is null or exists (
        select 1 from public.asset_indications ai
        where ai.asset_id = a.id
          and ai.indication_id = any(p_indication_ids)
      ))
      and (p_moa_ids is null or exists (
        select 1 from public.asset_mechanisms_of_action amoa
        where amoa.asset_id = a.id
          and amoa.moa_id = any(p_moa_ids)
      ))
      and (p_roa_ids is null or exists (
        select 1 from public.asset_routes_of_administration aroa
        where aroa.asset_id = a.id
          and aroa.roa_id = any(p_roa_ids)
      ))
      and (p_trial_ids is null or exists (
        select 1 from public.trial_assets ta
        where ta.asset_id = a.id
          and ta.trial_id = any(p_trial_ids)
      ))
  ),

  -- Step 2: compute highest phase rank per candidate asset
  asset_phase as (
    select
      ca.asset_id,
      max(case ai.development_status
        when 'LAUNCHED'  then 6
        when 'APPROVED'  then 5
        when 'P4'        then 4
        when 'P3'        then 3
        when 'P2'        then 2
        when 'P1'        then 1
        when 'PRECLIN'   then 0
        else null
      end) as max_rank
    from candidate_assets ca
    join public.asset_indications ai on ai.asset_id = ca.asset_id
    where ai.development_status is not null
      and (v_show_preclin or ai.development_status is distinct from 'PRECLIN')
    group by ca.asset_id
    having max(case ai.development_status
      when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
      when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
      else null
    end) is not null
  ),

  -- Step 3: apply phase filter
  filtered_assets as (
    select ap.asset_id, ap.max_rank
    from asset_phase ap
    where p_phases is null or (
      case ap.max_rank
        when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
        when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN'
      end
    ) = any(p_phases)
  ),

  -- Step 4: compute intelligence count per asset
  -- anchors use entity_type='product' for assets (CHECK forbids 'asset')
  asset_intel as (
    select
      fa.asset_id,
      (
        -- asset-level briefs: use 'product' (the stored anchor type for assets)
        (select count(distinct a_pi.id)
         from public.primary_intelligence_anchors a_pi
         where a_pi.entity_type = 'product'
           and a_pi.entity_id = fa.asset_id
           and a_pi.space_id = p_space_id)
        +
        -- trial-level briefs for trials belonging to this asset
        (select count(distinct a_pi.id)
         from public.primary_intelligence_anchors a_pi
         where a_pi.entity_type = 'trial'
           and a_pi.space_id = p_space_id
           and a_pi.entity_id in (
             select t.id from public.trials t
             where exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = fa.asset_id)
               and t.space_id = p_space_id
           ))
      ) as intelligence_count
    from filtered_assets fa
  ),

  -- Step 5: compute recent change activity per asset (14-day window)
  -- anchors use entity_type='product' for assets
  asset_activity as (
    select
      fa.asset_id,
      (
        (select count(*)
         from public.trial_change_events e
         join public.trials t on t.id = e.trial_id
         where exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = fa.asset_id)
           and t.space_id = p_space_id
           and e.observed_at >= now() - public.recent_change_window())
        +
        (select count(*)
         from public.primary_intelligence_anchors a_pi
         join public.primary_intelligence pi on pi.anchor_id = a_pi.id and pi.state = 'published'
         where a_pi.space_id = p_space_id
           and pi.updated_at >= now() - public.recent_change_window()
           and (
             (a_pi.entity_type = 'product' and a_pi.entity_id = fa.asset_id)
             or (a_pi.entity_type = 'trial' and a_pi.entity_id in (
                   select t2.id from public.trials t2
                   where exists (select 1 from public.trial_assets ta where ta.trial_id = t2.id and ta.asset_id = fa.asset_id) and t2.space_id = p_space_id))
           ))
      ) as recent_changes_count,
      (
        select c.etype
        from (
          select e.event_type::text as etype, e.observed_at as ets
          from public.trial_change_events e
          join public.trials t on t.id = e.trial_id
          where exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = fa.asset_id)
            and t.space_id = p_space_id
            and e.observed_at >= now() - public.recent_change_window()
          union all
          select 'intelligence_published'::text as etype, pi.updated_at as ets
          from public.primary_intelligence_anchors a_pi
          join public.primary_intelligence pi on pi.anchor_id = a_pi.id and pi.state = 'published'
          where a_pi.space_id = p_space_id
            and pi.updated_at >= now() - public.recent_change_window()
            and (
              (a_pi.entity_type = 'product' and a_pi.entity_id = fa.asset_id)
              or (a_pi.entity_type = 'trial' and a_pi.entity_id in (
                    select t2.id from public.trials t2
                    where exists (select 1 from public.trial_assets ta where ta.trial_id = t2.id and ta.asset_id = fa.asset_id) and t2.space_id = p_space_id))
            )
        ) c
        order by c.ets desc
        limit 1
      ) as most_recent_change_type,
      (
        select c.eid
        from (
          select e.observed_at as ets, e.id as eid
          from public.trial_change_events e
          join public.trials t on t.id = e.trial_id
          where exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = fa.asset_id)
            and t.space_id = p_space_id
            and e.observed_at >= now() - public.recent_change_window()
          union all
          select pi.updated_at as ets, null::uuid as eid
          from public.primary_intelligence_anchors a_pi
          join public.primary_intelligence pi on pi.anchor_id = a_pi.id and pi.state = 'published'
          where a_pi.space_id = p_space_id
            and pi.updated_at >= now() - public.recent_change_window()
            and (
              (a_pi.entity_type = 'product' and a_pi.entity_id = fa.asset_id)
              or (a_pi.entity_type = 'trial' and a_pi.entity_id in (
                    select t2.id from public.trials t2
                    where exists (select 1 from public.trial_assets ta where ta.trial_id = t2.id and ta.asset_id = fa.asset_id) and t2.space_id = p_space_id))
            )
        ) c
        order by c.ets desc
        limit 1
      ) as most_recent_change_event_id
    from filtered_assets fa
  )

  -- Step 6: assemble result
  select jsonb_build_object(
    'assets', coalesce((
      select jsonb_agg(asset_obj order by fa.max_rank desc, a.name)
      from filtered_assets fa
      join public.assets a on a.id = fa.asset_id
      join public.companies c on c.id = a.company_id
      left join asset_intel ai_cnt on ai_cnt.asset_id = fa.asset_id
      left join asset_activity aa on aa.asset_id = fa.asset_id
      cross join lateral (
        select jsonb_build_object(
          'id', a.id,
          'name', a.name,
          'generic_name', a.generic_name,
          'logo_url', a.logo_url,
          'company_id', c.id,
          'company_name', c.name,
          'company_logo_url', c.logo_url,
          'highest_phase_rank', fa.max_rank,
          'highest_phase', case fa.max_rank
            when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
            when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN'
          end,
          'indications', coalesce((
            select jsonb_agg(
              jsonb_build_object('id', ind.id, 'name', ind.name, 'abbreviation', ind.abbreviation)
              order by ind.display_order, ind.name
            )
            from public.asset_indications ai2
            join public.indications ind on ind.id = ai2.indication_id
            where ai2.asset_id = a.id
          ), '[]'::jsonb),
          'moas', coalesce((
            select jsonb_agg(
              jsonb_build_object('id', m.id, 'name', m.name)
              order by m.display_order, m.name
            )
            from public.asset_mechanisms_of_action amoa
            join public.mechanisms_of_action m on m.id = amoa.moa_id
            where amoa.asset_id = a.id
          ), '[]'::jsonb),
          'roas', coalesce((
            select jsonb_agg(
              jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation)
              order by r.display_order, r.name
            )
            from public.asset_routes_of_administration aroa
            join public.routes_of_administration r on r.id = aroa.roa_id
            where aroa.asset_id = a.id
          ), '[]'::jsonb),
          'trials', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', t.id,
                'name', t.name,
                'acronym', t.acronym,
                'identifier', t.identifier,
                'status', t.status,
                'recruitment_status', t.recruitment_status,
                'study_type', t.study_type,
                'phase', t.phase_type
              ) order by t.display_order, t.name
            )
            from public.trials t
            where exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = a.id) and t.space_id = p_space_id
          ), '[]'::jsonb),
          'recent_markers', coalesce((
            select jsonb_agg(marker_obj order by mk_sub.event_date desc)
            from (
              select mk.id, mk.event_date, mk.projection,
                     mt.name as marker_type_name, mt.shape, mt.color,
                     mc.name as category_name
              from public.marker_assignments ma
              join public.markers mk on mk.id = ma.marker_id
              join public.marker_types mt on mt.id = mk.marker_type_id
              left join public.marker_categories mc on mc.id = mt.category_id
              join public.trials t2 on t2.id = ma.trial_id
              where exists (select 1 from public.trial_assets ta where ta.trial_id = t2.id and ta.asset_id = a.id)
                and t2.space_id = p_space_id
                and mk.space_id = p_space_id
              order by mk.event_date desc
              limit 3
            ) mk_sub
            cross join lateral (
              select jsonb_build_object(
                'id', mk_sub.id,
                'event_date', mk_sub.event_date,
                'projection', mk_sub.projection,
                'marker_type_name', mk_sub.marker_type_name,
                'shape', mk_sub.shape,
                'color', mk_sub.color,
                'category_name', mk_sub.category_name
              ) as marker_obj
            ) mk_lateral
          ), '[]'::jsonb),
          'intelligence_count', coalesce(ai_cnt.intelligence_count, 0),
          'recent_changes_count', coalesce(aa.recent_changes_count, 0),
          'most_recent_change_type', aa.most_recent_change_type,
          'most_recent_change_event_id', aa.most_recent_change_event_id,
          'has_recent_activity', coalesce(aa.recent_changes_count, 0) > 0
        ) as asset_obj
      ) as asset_lateral
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

-- ============================================================
-- 3. preview_asset_delete  (anchor count: 'asset' -> 'product')
-- ============================================================
create or replace function public.preview_asset_delete(p_asset_id uuid)
  returns jsonb
  language plpgsql
  stable security definer
  set search_path to ''
as $function$
declare
  v_uid                        uuid := auth.uid();
  v_space_id                   uuid;
  v_trial_ids                  uuid[];
  v_n_trials                   bigint;
  v_n_trials_unlinked          bigint;
  v_n_trial_notes              bigint;
  v_n_events                   bigint;
  v_n_material_links           bigint;
  v_n_primary_intelligence     bigint;
  v_n_primary_intelligence_links bigint;
  v_n_marker_assignments       bigint;
  v_n_markers_removed_entirely bigint;
  v_n_markers_unlinked_only    bigint;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select a.space_id into v_space_id from public.assets a where a.id = p_asset_id;
  if v_space_id is null then raise exception 'asset % not found', p_asset_id using errcode = 'P0002'; end if;
  if not public.has_space_access(v_space_id) then raise exception 'not authorized' using errcode = '42501'; end if;

  -- Trials FULLY deleted with this asset: those whose ONLY asset is this one.
  select coalesce(array_agg(t.id), array[]::uuid[]) into v_trial_ids
    from public.trials t
    where exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = p_asset_id)
      and not exists (select 1 from public.trial_assets ta2 where ta2.trial_id = t.id and ta2.asset_id <> p_asset_id);
  select count(*) into v_n_trials_unlinked
    from public.trials t
    where exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = p_asset_id)
      and exists (select 1 from public.trial_assets ta2 where ta2.trial_id = t.id and ta2.asset_id <> p_asset_id);
  v_n_trials := coalesce(array_length(v_trial_ids, 1), 0);
  select count(*) into v_n_trial_notes from public.trial_notes tn where tn.trial_id = any(v_trial_ids);
  select count(*) into v_n_events from public.events e where e.asset_id = p_asset_id or e.trial_id = any(v_trial_ids);
  -- material_links: ml.entity_type = 'asset' is out of scope (pre-existing material subsystem value)
  select count(*) into v_n_material_links from public.material_links ml
    where (ml.entity_type = 'asset' and ml.entity_id = p_asset_id)
       or (ml.entity_type = 'trial' and ml.entity_id = any(v_trial_ids));
  -- count anchors (briefs): asset anchors stored as 'product'; keep 'trial' for trial-owned briefs
  select count(*) into v_n_primary_intelligence
    from public.primary_intelligence_anchors a_pi
    where a_pi.space_id = v_space_id
      and (
        (a_pi.entity_type = 'product' and a_pi.entity_id = p_asset_id)
        or (a_pi.entity_type = 'trial' and a_pi.entity_id = any(v_trial_ids))
      );
  -- PI-links: primary_intelligence_links stores 'asset' for assets (different enum, correct value -- keep)
  select count(*) into v_n_primary_intelligence_links from public.primary_intelligence_links pil
    where (pil.entity_type = 'asset' and pil.entity_id = p_asset_id)
       or (pil.entity_type = 'trial' and pil.entity_id = any(v_trial_ids));
  select count(*) into v_n_marker_assignments from public.marker_assignments ma where ma.trial_id = any(v_trial_ids);

  with reachable as (
    select distinct ma.marker_id from public.marker_assignments ma where ma.trial_id = any(v_trial_ids)
  ), split as (
    select rm.marker_id,
      not exists (select 1 from public.marker_assignments ma2 where ma2.marker_id = rm.marker_id and ma2.trial_id <> all(v_trial_ids)) as removed_entirely
    from reachable rm
  )
  select count(*) filter (where removed_entirely), count(*) filter (where not removed_entirely)
    into v_n_markers_removed_entirely, v_n_markers_unlinked_only from split;

  return jsonb_build_object(
    'trials', v_n_trials, 'trials_unlinked', v_n_trials_unlinked, 'trial_notes', v_n_trial_notes, 'events', v_n_events,
    'material_links', v_n_material_links, 'primary_intelligence', v_n_primary_intelligence,
    'primary_intelligence_links', v_n_primary_intelligence_links,
    'marker_assignments', v_n_marker_assignments,
    'markers_removed_entirely', v_n_markers_removed_entirely,
    'markers_unlinked_only', v_n_markers_unlinked_only
  );
end;
$function$;

-- ============================================================
-- 4. preview_company_delete  (anchor count: 'asset' -> 'product')
-- ============================================================
create or replace function public.preview_company_delete(p_company_id uuid)
  returns jsonb
  language plpgsql
  stable security definer
  set search_path to ''
as $function$
declare
  v_uid                        uuid := auth.uid();
  v_space_id                   uuid;
  v_asset_ids                  uuid[];
  v_trial_ids                  uuid[];
  v_n_assets                   bigint;
  v_n_trials                   bigint;
  v_n_trial_notes              bigint;
  v_n_events                   bigint;
  v_n_material_links           bigint;
  v_n_primary_intelligence     bigint;
  v_n_primary_intelligence_links bigint;
  v_n_marker_assignments       bigint;
  v_n_markers_removed_entirely bigint;
  v_n_markers_unlinked_only    bigint;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select c.space_id into v_space_id from public.companies c where c.id = p_company_id;
  if v_space_id is null then raise exception 'company % not found', p_company_id using errcode = 'P0002'; end if;
  if not public.has_space_access(v_space_id) then raise exception 'not authorized' using errcode = '42501'; end if;

  select coalesce(array_agg(a.id), array[]::uuid[]) into v_asset_ids from public.assets a where a.company_id = p_company_id;
  select coalesce(array_agg(t.id), array[]::uuid[]) into v_trial_ids from public.trials t where t.asset_id = any(v_asset_ids);
  v_n_assets := coalesce(array_length(v_asset_ids, 1), 0);
  v_n_trials := coalesce(array_length(v_trial_ids, 1), 0);

  select count(*) into v_n_trial_notes from public.trial_notes tn where tn.trial_id = any(v_trial_ids);
  select count(*) into v_n_events from public.events e where e.company_id = p_company_id or e.asset_id = any(v_asset_ids) or e.trial_id = any(v_trial_ids);
  -- material_links: ml.entity_type = 'asset' is out of scope (pre-existing material subsystem value)
  select count(*) into v_n_material_links from public.material_links ml
    where (ml.entity_type = 'company' and ml.entity_id = p_company_id)
       or (ml.entity_type = 'asset' and ml.entity_id = any(v_asset_ids))
       or (ml.entity_type = 'trial' and ml.entity_id = any(v_trial_ids));
  -- count anchors (briefs): asset anchors stored as 'product'; keep 'company'/'trial' as-is
  select count(*) into v_n_primary_intelligence
    from public.primary_intelligence_anchors a_pi
    where a_pi.space_id = v_space_id
      and (
        (a_pi.entity_type = 'company' and a_pi.entity_id = p_company_id)
        or (a_pi.entity_type = 'product' and a_pi.entity_id = any(v_asset_ids))
        or (a_pi.entity_type = 'trial' and a_pi.entity_id = any(v_trial_ids))
      );
  -- PI-links: primary_intelligence_links stores 'asset' for assets (different enum, correct value -- keep)
  select count(*) into v_n_primary_intelligence_links from public.primary_intelligence_links pil
    where (pil.entity_type = 'company' and pil.entity_id = p_company_id)
       or (pil.entity_type = 'asset' and pil.entity_id = any(v_asset_ids))
       or (pil.entity_type = 'trial' and pil.entity_id = any(v_trial_ids));
  select count(*) into v_n_marker_assignments from public.marker_assignments ma where ma.trial_id = any(v_trial_ids);

  with reachable as (
    select distinct ma.marker_id from public.marker_assignments ma where ma.trial_id = any(v_trial_ids)
  ), split as (
    select rm.marker_id,
      not exists (select 1 from public.marker_assignments ma2 where ma2.marker_id = rm.marker_id and ma2.trial_id <> all(v_trial_ids)) as removed_entirely
    from reachable rm
  )
  select count(*) filter (where removed_entirely), count(*) filter (where not removed_entirely)
    into v_n_markers_removed_entirely, v_n_markers_unlinked_only from split;

  return jsonb_build_object(
    'assets', v_n_assets, 'trials', v_n_trials, 'trial_notes', v_n_trial_notes,
    'events', v_n_events, 'material_links', v_n_material_links,
    'primary_intelligence', v_n_primary_intelligence,
    'primary_intelligence_links', v_n_primary_intelligence_links,
    'marker_assignments', v_n_marker_assignments,
    'markers_removed_entirely', v_n_markers_removed_entirely,
    'markers_unlinked_only', v_n_markers_unlinked_only
  );
end;
$function$;

-- ============================================================
-- 5. _cleanup_polymorphic_refs
--    The asset trigger fires with tg_argv[0]='asset' (v_type='asset').
--    primary_intelligence_anchors CHECK forbids 'asset'; asset briefs are
--    stored under entity_type='product'. The existing delete on v_type='asset'
--    never matches anything and leaves those anchors orphaned.
--    Add a targeted 'product' delete when v_type='asset'.
--    primary_intelligence_links and material_links already use 'asset' for
--    assets (different enums) and are left unchanged.
-- ============================================================
create or replace function public._cleanup_polymorphic_refs()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_type text := tg_argv[0];
begin
  -- links that POINT TO the deleted entity as a target
  delete from public.primary_intelligence_links
    where entity_type = v_type and entity_id = old.id;
  -- briefs OWNED by the deleted entity (only the four owner types match the CHECK)
  delete from public.primary_intelligence_anchors
    where entity_type = v_type and entity_id = old.id;
  -- asset/product value split: asset trigger fires with v_type='asset', but
  -- primary_intelligence_anchors stores entity_type='product' for assets
  -- (the pre-rename type; 'asset' is forbidden by CHECK). Delete 'product'
  -- anchors when the deleted entity is an asset so briefs are not orphaned.
  if v_type = 'asset' then
    delete from public.primary_intelligence_anchors
      where entity_type = 'product' and entity_id = old.id;
  end if;
  delete from public.material_links
    where entity_type = v_type and entity_id = old.id;
  return old;
end;
$function$;

-- Flush PostgREST schema cache so new signatures are visible immediately.
notify pgrst, 'reload schema';
