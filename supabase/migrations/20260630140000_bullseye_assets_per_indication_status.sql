-- get_bullseye_assets: emit per-indication development_status on each indications[]
-- entry so the by-indication bullseye can place a multi-indication asset at THAT
-- indication's stage instead of its overall max (issue #171). Only the indications
-- jsonb gains a key; signature and return type are unchanged. Based on the live
-- pg_get_functiondef; the sole change is the 'development_status' key below.

CREATE OR REPLACE FUNCTION public.get_bullseye_assets(p_space_id uuid, p_indication_ids uuid[] DEFAULT NULL::uuid[], p_company_ids uuid[] DEFAULT NULL::uuid[], p_moa_ids uuid[] DEFAULT NULL::uuid[], p_roa_ids uuid[] DEFAULT NULL::uuid[], p_phases text[] DEFAULT NULL::text[], p_asset_ids uuid[] DEFAULT NULL::uuid[], p_trial_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
  asset_intel as materialized (
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
  asset_activity as materialized (
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
  ),

  -- Step 5b: per-asset "approval recorded but not reflected in stage" flag.
  -- Set-based: scan + aggregate each base table ONCE, then join to candidates.
  -- asset_lift_event aggregates the qualifying actual approval/launch events;
  -- asset_global_rank aggregates each asset's highest development rank across
  -- ALL its asset_indications. Both are MATERIALIZED so the events / indications
  -- RLS policies fire once, not per output row.
  asset_lift_event as materialized (
    select ev.anchor_id as asset_id
    from public.events ev
    join public.event_types et on et.id = ev.event_type_id
    where ev.anchor_type = 'asset'
      and ev.space_id = p_space_id
      and ev.projection = 'actual'
      and coalesce(ev.no_longer_expected, false) = false
      and et.lifts_development_status is not null
    group by ev.anchor_id
  ),
  asset_global_rank as materialized (
    select
      ai.asset_id,
      max(case ai.development_status
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end) as max_rank
    from public.asset_indications ai
    where ai.space_id = p_space_id
    group by ai.asset_id
  ),
  asset_unreflected as materialized (
    select
      fa.asset_id,
      (ale.asset_id is not null and coalesce(agr.max_rank, -1) < 5) as has_unreflected_approval
    from filtered_assets fa
    left join asset_lift_event ale on ale.asset_id = fa.asset_id
    left join asset_global_rank agr on agr.asset_id = fa.asset_id
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
      left join asset_unreflected au on au.asset_id = fa.asset_id
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
              jsonb_build_object('id', ind.id, 'name', ind.name, 'abbreviation', ind.abbreviation, 'development_status', ai2.development_status)
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
              (
                select mk.id, mk.event_date, mk.projection,
                       et.name as marker_type_name, et.shape, et.color,
                       ec.name as category_name
                from public.events mk
                join public.trials t2 on mk.anchor_type = 'trial' and t2.id = mk.anchor_id
                join public.event_types et on et.id = mk.event_type_id
                left join public.event_type_categories ec on ec.id = et.category_id
                where exists (select 1 from public.trial_assets ta where ta.trial_id = t2.id and ta.asset_id = a.id)
                  and t2.space_id = p_space_id
                  and mk.space_id = p_space_id
                  and mk.event_date < current_date
                order by mk.event_date desc
                limit 3
              )
              union all
              (
                select mk.id, mk.event_date, mk.projection,
                       et.name as marker_type_name, et.shape, et.color,
                       ec.name as category_name
                from public.events mk
                join public.trials t2 on mk.anchor_type = 'trial' and t2.id = mk.anchor_id
                join public.event_types et on et.id = mk.event_type_id
                left join public.event_type_categories ec on ec.id = et.category_id
                where exists (select 1 from public.trial_assets ta where ta.trial_id = t2.id and ta.asset_id = a.id)
                  and t2.space_id = p_space_id
                  and mk.space_id = p_space_id
                  and mk.event_date >= current_date
                order by mk.event_date asc
                limit 3
              )
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
          'has_recent_activity', coalesce(aa.recent_changes_count, 0) > 0,
          'has_unreflected_approval', coalesce(au.has_unreflected_approval, false)
        ) as asset_obj
      ) as asset_lateral
    ), '[]'::jsonb),
    'companies_with_intelligence', coalesce((
      select jsonb_agg(distinct a_pi.entity_id)
      from public.primary_intelligence_anchors a_pi
      join public.primary_intelligence pi
        on pi.anchor_id = a_pi.id and pi.state = 'published'
      where a_pi.space_id    = p_space_id
        and a_pi.entity_type = 'company'
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$


